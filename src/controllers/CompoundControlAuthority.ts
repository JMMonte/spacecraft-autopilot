import * as THREE from 'three';
import type { Spacecraft } from '../core/spacecraft';
import { CompoundThrusterTable } from './CompoundThrusterTable';
import { ThrusterPWM } from './ThrusterPWM';
import { Autopilot } from './autopilot/Autopilot';
import { ManualAllocator } from './autopilot/ManualAllocator';
import { emitAutopilotStateChanged } from '../domain/simulationEvents';
import { createLogger } from '../utils/logger';

const log = createLogger('CompoundControlAuthority');

// Scratch vectors
const _localForce = new THREE.Vector3();

/**
 * Single control authority for a compound (docked) body.
 * Owns one autopilot + one manual allocator + one PWM that spans ALL
 * thrusters across all docked spacecraft.
 */
export class CompoundControlAuthority {
    /** The root spacecraft (compound body host). */
    public root: Spacecraft;
    /** All members including root. */
    public members: Spacecraft[] = [];
    /** Unified thruster table. */
    public thrusterTable: CompoundThrusterTable;
    /** The single autopilot for the compound body. */
    public autopilot: Autopilot;
    /** Manual allocator for keyboard input. */
    private manualAllocator: ManualAllocator;
    /** PWM for the compound thruster array. */
    private pwm: ThrusterPWM;
    /** Combined forces buffer. */
    private forcesBuffer: number[] = [];
    /** Keys pressed (mirrored from the active controller). */
    public keysPressed: Record<string, boolean> = {};

    private constructor(root: Spacecraft, members: Spacecraft[]) {
        this.root = root;
        this.members = members;
        this.thrusterTable = new CompoundThrusterTable();
        this.thrusterTable.build(members);

        const totalThrusters = this.thrusterTable.totalThrusters;
        const thrust = root.spacecraftController?.getThrust?.() ?? 100;
        const maxArr = this.thrusterTable.getCompoundThrusterMax(thrust);

        // Create compound autopilot on the root spacecraft
        // (reads state from root's rigid body = the compound body)
        this.autopilot = new Autopilot(
            root,
            this.thrusterTable.groups,
            thrust, maxArr,
        );
        // Suppress state emission on solo autopilots; authority emits instead
        this.autopilot.suppressStateEmit = false;

        // Manual allocator uses the compound autopilot's config
        const config = this.autopilot.config;
        this.manualAllocator = new ManualAllocator(
            root, config,
            this.thrusterTable.groups,
            thrust, maxArr,
        );

        // PWM
        this.pwm = new ThrusterPWM(thrust, maxArr, totalThrusters);

        // Forces buffer
        this.forcesBuffer = new Array(totalThrusters).fill(0);

        log.debug(`Created for ${members.length} members, ${totalThrusters} thrusters`);
    }

    /** Factory: create from a freshly docked pair. */
    static createFromDock(root: Spacecraft, members: Spacecraft[]): CompoundControlAuthority {
        return new CompoundControlAuthority(root, members);
    }

    /** Add a new member (e.g., third spacecraft docks to compound). */
    addMember(craft: Spacecraft): void {
        if (this.members.includes(craft)) return;
        this.members.push(craft);
        this.rebuild();
    }

    /** Remove a member (undock). Returns true if authority should dissolve. */
    removeMember(craft: Spacecraft): boolean {
        this.members = this.members.filter(m => m !== craft);
        if (this.members.length <= 1) return true; // dissolve
        this.rebuild();
        return false;
    }

    getMemberCount(): number { return this.members.length; }

    /** Rebuild thruster table and recreate allocators (after membership change). */
    private rebuild(): void {
        this.thrusterTable.build(this.members);
        const totalThrusters = this.thrusterTable.totalThrusters;
        const thrust = this.root.spacecraftController?.getThrust?.() ?? 100;
        const maxArr = this.thrusterTable.getCompoundThrusterMax(thrust);

        this.autopilot.setThrusterGroups(this.thrusterTable.groups);
        this.autopilot.setThrust(thrust);
        this.autopilot.setThrusterStrengths(maxArr);

        this.manualAllocator.setThrusterGroups(this.thrusterTable.groups);
        this.manualAllocator.setThrust(thrust);
        this.manualAllocator.setThrusterMax(maxArr);

        this.pwm.setThrusterMax(maxArr);
        this.forcesBuffer = new Array(totalThrusters).fill(0);

        log.debug(`Rebuilt: ${this.members.length} members, ${totalThrusters} thrusters`);
    }

    // ── Main control loop ────────────────────────────────────────

    /**
     * Compute and apply forces for the compound body.
     * Called once per frame from the root's SpacecraftController.
     */
    applyForces(dt: number): boolean[] {
        const n = this.thrusterTable.totalThrusters;

        // Check fuel access
        if (!this.hasFuelAccess()) {
            for (const m of this.members) m.rcsVisuals?.update(dt);
            return new Array(n).fill(false);
        }

        // 1) Manual forces from keyboard (in compound body's local frame)
        const manualForces = this.calculateManualForces();

        // 2) Autopilot forces
        const autopilotForces = this.autopilot.getAutopilotEnabled()
            ? this.autopilot.calculateAutopilotForces(dt)
            : new Array(n).fill(0);

        // 3) Combine
        for (let i = 0; i < n; i++) {
            this.forcesBuffer[i] = (manualForces[i] || 0) + (autopilotForces[i] || 0);
        }

        // 4) Consume fuel
        let totalForce = 0;
        for (let i = 0; i < n; i++) totalForce += this.forcesBuffer[i];
        const fuelFraction = this.consumeFuel(totalForce, dt);
        if (fuelFraction < 1) {
            for (let i = 0; i < n; i++) this.forcesBuffer[i] *= fuelFraction;
        }

        // 5) PWM smoothing
        const { visibility, applied } = this.pwm.apply(this.forcesBuffer, dt);

        // 6) Distribute forces to individual spacecraft's RCS visuals
        this.distributeForces(applied, visibility, dt);

        return visibility;
    }

    /** Calculate manual thruster forces from keysPressed, in compound frame. */
    private calculateManualForces(): number[] {
        const n = this.thrusterTable.totalThrusters;
        const out = new Array(n).fill(0);

        // Map keys to local-frame force vector (same mapping as SpacecraftController)
        _localForce.set(0, 0, 0);
        if (this.keysPressed['KeyW']) _localForce.z += 1;
        if (this.keysPressed['KeyS']) _localForce.z -= 1;
        if (this.keysPressed['KeyA']) _localForce.x -= 1;
        if (this.keysPressed['KeyD']) _localForce.x += 1;
        if (this.keysPressed['Space']) _localForce.y += 1;
        if (this.keysPressed['ShiftLeft'] || this.keysPressed['ShiftRight']) _localForce.y -= 1;

        if (_localForce.lengthSq() > 0.001) {
            const mass = this.getCompoundMass();
            _localForce.multiplyScalar(mass * 0.5); // scale to force
            this.manualAllocator.allocateTranslation(_localForce, out);
        }

        // Rotational manual input
        const rotCmd = new THREE.Vector3(0, 0, 0);
        if (this.keysPressed['ArrowUp']) rotCmd.x += 1;
        if (this.keysPressed['ArrowDown']) rotCmd.x -= 1;
        if (this.keysPressed['ArrowLeft']) rotCmd.y += 1;
        if (this.keysPressed['ArrowRight']) rotCmd.y -= 1;
        if (this.keysPressed['KeyQ']) rotCmd.z += 1;
        if (this.keysPressed['KeyE']) rotCmd.z -= 1;

        if (rotCmd.lengthSq() > 0.001) {
            const thrust = this.root.spacecraftController?.getThrust?.() ?? 100;
            rotCmd.multiplyScalar(thrust);
            this.manualAllocator.allocateRotation(rotCmd, out);
        }

        return out;
    }

    /** Distribute compound force array to individual spacecraft RCS visuals. */
    private distributeForces(applied: number[], visibility: boolean[], dt: number): void {
        // First, hide all cones on all members
        for (const member of this.members) {
            const cones = member.rcsVisuals?.getConeMeshes?.() ?? [];
            for (const cone of cones) if (cone) cone.visible = false;
        }

        // Apply forces and show active cones
        for (const entry of this.thrusterTable.entries) {
            const force = applied[entry.compoundIndex];
            const vis = visibility[entry.compoundIndex];
            if (vis && force > 0) {
                entry.spacecraft.rcsVisuals?.applyForce(entry.localIndex, force, dt);
            }
            // Set cone visibility
            const cones = entry.spacecraft.rcsVisuals?.getConeMeshes?.();
            if (cones?.[entry.localIndex]) {
                cones[entry.localIndex].visible = vis;
            }
        }

        // Update particle systems on all members
        for (const member of this.members) {
            member.rcsVisuals?.update(dt);
        }
    }

    // ── Fuel ─────────────────────────────────────────────────────

    private hasFuelAccess(): boolean {
        for (const m of this.members) {
            if (m.hasFuelAccess()) return true;
        }
        return false;
    }

    private consumeFuel(totalForce: number, dt: number): number {
        if (totalForce <= 0 || dt <= 0) return 1;
        // Try to consume from any member with fuel
        for (const m of this.members) {
            const tank = m.findFuelSource();
            if (tank && !tank.isEmpty) {
                const actual = tank.consumeFuel(totalForce, dt);
                return totalForce > 0 ? actual / totalForce : 1;
            }
        }
        // Legacy fuel (infinite)
        for (const m of this.members) {
            if (!m.getFuelTank() && m.objects.modelOptions.includeFuelTank) return 1;
        }
        return 0;
    }

    private getCompoundMass(): number {
        let total = 0;
        for (const m of this.members) total += m.getMass?.() ?? 100;
        return total;
    }

    // ── Autopilot control ────────────────────────────────────────

    /** Handle autopilot key toggle (forwarded from any member's controller). */
    handleAutopilotControl(code: string): void {
        const keyModeMap: Record<string, () => void> = {
            'KeyT': () => this.autopilot.orientationMatch(),
            'KeyY': () => this.autopilot.pointToPosition(),
            'KeyR': () => this.autopilot.cancelRotation(),
            'KeyG': () => this.autopilot.cancelLinearMotion(),
            'KeyB': () => this.autopilot.goToPosition(),
        };
        const toggle = keyModeMap[code];
        if (toggle) toggle();
    }

    /** Emit autopilot state to the global store. */
    emitState(): void {
        try {
            emitAutopilotStateChanged({
                enabled: this.autopilot.getAutopilotEnabled(),
                activeAutopilots: { ...this.autopilot.getActiveAutopilots() },
            });
        } catch {}
    }

    /** Clean up when dissolving. */
    cleanup(): void {
        this.autopilot.resetAllModes();
        this.autopilot.setEnabled(false);
        log.debug('Dissolved');
    }
}

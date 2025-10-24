import * as THREE from 'three';
import { Spacecraft } from '../core/spacecraft';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { Autopilot } from './autopilot/Autopilot';
import { createLogger } from '../utils/logger';
import { getBasicThrusterGroups } from '../config/spacecraftConfig';
import type { ThrusterGroups } from '../config/spacecraftConfig';
import { computeThrusterGroups } from '../utils/utils';
import type { ThrusterConfig } from '../utils/utils';
import { ManualAllocator } from './autopilot/ManualAllocator';

interface KeyMap {
    [key: string]: boolean;
}

// Removed unused ThrusterMap after switching manual control to vector allocation

export class SpacecraftController {
    private log = createLogger('controllers:SpacecraftController');
    private isActive: boolean = false;
    private spacecraft!: Spacecraft;
    private currentTarget!: string | null;
    private helpers!: SceneHelpers;
    private keysPressed!: KeyMap;
    private mass!: number;
    private thrust!: number;
    private thrusterMax: number[] = new Array(24).fill(0);
    public autopilot!: Autopilot;
    // Thruster pulse-width modulation state (to reduce flicker)
    private thrusterOnLatch: boolean[] = new Array(24).fill(false);
    private thrusterLatchTimer: number[] = new Array(24).fill(0);
    private thrusterLatchedForce: number[] = new Array(24).fill(0);
    private minPulseOn: number = 0.05;  // seconds
    private minPulseOff: number = 0.05; // seconds
    private activationThresholdFactor: number = 0.01; // as fraction of per-thruster thrust (ignite earlier)
    // Reusable buffers to avoid per-frame allocations
    private manualForcesBuffer: number[] = new Array(24).fill(0);
    private combinedForcesBuffer: number[] = new Array(24).fill(0);
    private manualAllocator!: ManualAllocator;
    // Cluster-aware scaling
    private baseThrust!: number;
    // Reserved for future: per-thruster custom caps provided by user/config
    // no waypoint planner

    constructor(spacecraft: Spacecraft, currentTarget: { uuid: string } | null, helpers: SceneHelpers) {
        this.log.debug('SpacecraftController constructor called');
        this.initializeProperties(spacecraft, currentTarget, helpers);
        this.log.debug('SpacecraftController initialized, isActive:', this.isActive);
    }

    public getIsActive(): boolean {
        return this.isActive;
    }

    public setIsActive(value: boolean): void {
        this.log.debug('Setting isActive to:', value);
        this.isActive = value;
    }

    public getCurrentTarget(): string | null {
        return this.currentTarget;
    }

    public setCurrentTarget(target: { uuid: string } | null): void {
        this.currentTarget = target?.uuid || null;
    }

    private initializeProperties(spacecraft: Spacecraft, currentTarget: { uuid: string } | null, helpers: SceneHelpers): void {
        this.log.debug('Initializing SpacecraftController properties');
        this.spacecraft = spacecraft;
        this.currentTarget = currentTarget?.uuid || null;
        this.helpers = helpers;

        // For manual thruster control
        this.keysPressed = {};

        // Derive a "thrust per thruster"
        this.mass = spacecraft.getMass();
        const thrustFactor = 5;
        this.thrust = (this.mass / 24) * thrustFactor;
        this.baseThrust = this.thrust;
        // Default per-thruster capacities (N). Can be customized later via config.
        this.thrusterMax = new Array(24).fill(this.thrust);

        // Create autopilot with correct parameters
        const thrusterGroups = this.getThrusterGroups();
        this.log.debug('Creating autopilot with thruster groups:', thrusterGroups);
        
        this.autopilot = new Autopilot(
            this.spacecraft,
            thrusterGroups,
            this.thrust,
            this.thrusterMax,
            {
                pidGains: {
                    orientation: { kp: 0.05, ki: 0.0, kd: 0.02 },
                    position: { kp: 3.0, ki: 0.0005, kd: 4.0 },
                    momentum: { kp: 3.0, ki: 0.0, kd: 1.0 }
                },
                maxForce: this.thrust * 24,
                dampingFactor: 1.5,
                autoTune: false,
                useWorker: true,
            }
        );

        // Manual allocator uses the same config/groups/caps as autopilot
        this.manualAllocator = new ManualAllocator(
            this.spacecraft,
            this.autopilot.getConfig(),
            thrusterGroups,
            this.thrust,
            this.thrusterMax
        );

        // Do not enable autopilot by default; it will turn on when a mode is activated.
        // This avoids running idle workers across many spacecraft.
        this.log.debug('Autopilot created (initially disabled) with thrust:', this.thrust);
    }

    private getThrusterGroups(): ThrusterGroups {
        try {
            const thrusters: ThrusterConfig[] = this.spacecraft.getThrusterConfigs?.() || [];
            if (Array.isArray(thrusters) && thrusters.length) {
                // If docked, classify torques relative to the combined cluster COM so
                // both spacecraft work in unison when firing rotational groups.
                const partners = this.spacecraft.getDockedSpacecrafts?.() || [];
                if (partners.length > 0) {
                    // Compute world COM of the docked cluster
                    const cluster = [this.spacecraft, ...partners];
                    let mTot = 0;
                    const comW = new THREE.Vector3(0, 0, 0);
                    for (const s of cluster) {
                        const m = Math.max(1e-6, s.getMass?.() || 0);
                        const p = s.getWorldPosition?.();
                        if (!p) continue;
                        comW.addScaledVector(p, m);
                        mTot += m;
                    }
                    if (mTot > 0) comW.multiplyScalar(1 / mTot);

                    // Offset from our origin to COM expressed in our local frame
                    const pW = this.spacecraft.getWorldPosition?.();
                    const qW = this.spacecraft.getWorldOrientation?.();
                    if (pW && qW) {
                        const toComW = comW.clone().sub(pW);
                        const qInv = qW.clone().invert();
                        const toComLocal = toComW.applyQuaternion(qInv);
                        // Shift thruster positions so r = thrusterPos - COMLocal (torque about COM)
                        const shifted = thrusters.map((t: ThrusterConfig) => ({
                            position: t.position.clone().sub(toComLocal),
                            direction: t.direction.clone(),
                        }));
                        return computeThrusterGroups(shifted);
                    }
                }
                // Default: classify in craft-local frame about its origin
                return computeThrusterGroups(thrusters);
            }
        } catch {}
        return getBasicThrusterGroups();
    }

    /**
     * Recompute thruster grouping based on current thruster transforms and
     * propagate updates into the autopilot (main + worker).
     */
    public refreshThrusterGroups(): void {
        const groups = this.getThrusterGroups();
        try { this.autopilot?.setThrusterGroups(groups); } catch {}
        try { this.autopilot?.refreshThrusters?.(); } catch {}
        try { this.manualAllocator?.setThrusterGroups(groups); } catch {}
        try { this.manualAllocator?.invalidateCaps?.(); } catch {}
    }

    public handleKeyDown(event: KeyboardEvent): void {
        if (!this.isActive) return;

        // Prevent handling the same key press multiple times
        if (this.keysPressed[event.code]) return;

        this.keysPressed[event.code] = true;

        // 1) Manual thruster logic
        this.handleManualControl(event.code);

        // 2) Autopilot toggles
        this.handleAutopilotControl(event.code);
    }

    public handleKeyUp(event: KeyboardEvent): void {
        if (!this.isActive) return;
        this.keysPressed[event.code] = false;
    }

    private handleManualControl(code: string): void {
        // Just placeholders for your logic:
        if (this.rotationKeys().includes(code) || this.translationKeys().includes(code)) {
            // Thrusters keep firing while the key is down
        }
    }

    private handleAutopilotControl(code: string): void {
        this.log.debug('Handling autopilot control for key:', code);
        
        // Ensure autopilot is enabled
        if (!this.autopilot.getAutopilotEnabled()) {
            this.log.debug('Enabling autopilot');
            this.autopilot.setEnabled(true);
        }

        // Map keys to autopilot modes
        const keyModeMap: { [key: string]: () => void } = {
            'KeyT': () => {
                this.log.debug('Toggling orientationMatch');
                this.autopilot.orientationMatch();
            },
            'KeyY': () => {
                this.log.debug('Toggling pointToPosition');
                this.autopilot.pointToPosition();
            },
            'KeyR': () => {
                this.log.debug('Toggling cancelRotation');
                this.autopilot.cancelRotation();
            },
            'KeyG': () => {
                this.log.debug('Toggling cancelLinearMotion');
                this.autopilot.cancelLinearMotion();
            },
            'KeyB': () => {
                this.log.debug('Toggling goToPosition');
                this.autopilot.goToPosition();
            }
        };

        // Execute the corresponding mode toggle if key is mapped
        const modeToggle = keyModeMap[code];
        if (modeToggle) {
            this.log.debug('Executing mode toggle for key:', code);
            modeToggle();
            
            // Log the new autopilot state
            const activeAutopilots = this.autopilot.getActiveAutopilots();
            this.log.debug('New autopilot state:', activeAutopilots);
        }
    }

    /**
     * Called each frame or physics step with dt
     */
    public applyForces(dt: number = 1/60): boolean[] {
        // When docked, keep autopilots in sync across the cluster so both crafts
        // act as one. Leader mirrors its modes/targets into followers.
        this.syncDockedAutopilots();

        // no waypoint-following orchestration

        // 1) Manual forces from user
        const manualForces = this.calculateManualForces();

        // 2) Autopilot forces if autopilot is active
        const autopilotForces = this.autopilot.getAutopilotEnabled()
            ? this.autopilot.calculateAutopilotForces(dt)
            : (this.combinedForcesBuffer.fill(0), this.combinedForcesBuffer); // reuse buffer if disabled

        // 3) Combine
        // Combine into reusable buffer
        for (let i = 0; i < 24; i++) {
            this.combinedForcesBuffer[i] = (manualForces[i] || 0) + (autopilotForces[i] || 0);
        }
        const combined = this.combinedForcesBuffer;

        // 4) Apply
        const coneVisibility = this.applyForcesToThrusters(combined, dt);

        // 5) Update RCS particle system
        this.spacecraft.rcsVisuals.update(dt);

        // 6) Debug helpers
        this.updateHelpers(combined);

        return coneVisibility;
    }

    /**
     * If docked with other spacecraft, mirror this autopilot's active modes and targets
     * into the partner(s). The cluster then behaves like one craft using all thrusters.
     * We elect the cluster leader by smallest UUID to avoid double-driving.
     */
    private syncDockedAutopilots(): void {
        const partners = this.spacecraft.getDockedSpacecrafts?.() || [];
        if (!partners.length) return;

        // Build cluster and elect leader. Prefer the craft whose autopilot is enabled;
        // tie-break by smallest UUID for stability.
        const cluster = [this.spacecraft, ...partners];
        const enabledFirst = [...cluster].sort((a, b) => {
            const aEn = (a.spacecraftController?.autopilot?.getAutopilotEnabled?.() ? 1 : 0);
            const bEn = (b.spacecraftController?.autopilot?.getAutopilotEnabled?.() ? 1 : 0);
            if (aEn !== bEn) return bEn - aEn; // enabled before disabled
            return a.uuid.localeCompare(b.uuid);
        });
        const leader = enabledFirst[0];
        if (leader !== this.spacecraft) return; // only leader propagates

        // Update cluster-aware thrust scaling on all participants
        for (const craft of cluster) {
            const ctrl = craft.spacecraftController as SpacecraftController | undefined;
            ctrl?.updateClusterScaling(cluster);
        }

        const leaderAP = this.autopilot;
        if (!leaderAP?.getAutopilotEnabled()) return;

        // Snapshot leader's modes and targets
        const active = leaderAP.getActiveAutopilots();
        const targetPos = leaderAP.getTargetPosition?.();
        const targetQuat = leaderAP.getTargetOrientation?.();

        for (const craft of cluster.slice(1)) {
            const ctrl = craft.spacecraftController as SpacecraftController | undefined;
            const ap = ctrl?.autopilot;
            if (!ap) continue;
            // Ensure enabled
            ap.setEnabled(true);
            // Mirror targets
            if (targetPos) ap.setTargetPosition(targetPos.clone());
            if (targetQuat) ap.setTargetOrientation(targetQuat.clone());
            // Mirror modes
            ap.setMode('goToPosition', !!active.goToPosition);
            ap.setMode('orientationMatch', !!active.orientationMatch);
            ap.setMode('cancelLinearMotion', !!active.cancelLinearMotion);
            ap.setMode('cancelRotation', !!active.cancelRotation);
            ap.setMode('pointToPosition', !!active.pointToPosition);
        }
    }

    /**
     * Update scalar thrust/strength scaling to reflect docked cluster mass.
     * Keeps physical per-thruster caps unless user customized them.
     */
    private updateClusterScaling(cluster?: import('../core/spacecraft').Spacecraft[]): void {
        const partners = cluster ? cluster.slice(1) : (this.spacecraft.getDockedSpacecrafts?.() || []);
        const all = cluster ? cluster : [this.spacecraft, ...partners];
        // Compute mass ratio (total / self)
        let totalMass = 0;
        for (const s of all) totalMass += Math.max(1e-6, s.getMass?.() || 0);
        const selfMass = Math.max(1e-6, this.spacecraft.getMass?.() || 0);
        const scale = Math.max(1, totalMass / selfMass);

        // Scale thrust budget
        const newThrust = this.baseThrust * scale;
        if (Math.abs(newThrust - this.thrust) > 1e-6) this.setThrust(newThrust);

        // Do not scale per-thruster physical caps here; keep hardware limits.
    }

    /** Public entry to recompute cluster scaling immediately (e.g., on dock). */
    public applyClusterScalingNow(): void {
        this.updateClusterScaling();
    }

    private updateHelpers(thrustForces: number[]): void {
        // Skip all work if no helper is visible and trace is off
        const h = this.helpers;
        if (!h) return;
        const anyVisible = !!(
            h.autopilotArrow?.visible ||
            h.autopilotTorqueArrow?.visible ||
            h.rotationAxisArrow?.visible ||
            h.orientationArrow?.visible ||
            h.velocityArrow?.visible ||
            this.spacecraft?.showTraceLines ||
            h.pathLine?.visible || h.pathCarrot?.visible
        );
        if (!anyVisible) return;

        if (!this.autopilot?.getTargetOrientation()) return;

        const bodyPosition = this.spacecraft.getWorldPositionRef();

        // Compute only what is needed per visible helper
        if (h.velocityArrow?.visible) {
            const currentVelocity = this.spacecraft.getWorldVelocityRef();
            this.helpers.updateVelocityArrow(bodyPosition, currentVelocity);
        }

        if (h.rotationAxisArrow?.visible) {
            const currentAngularVelocity = this.spacecraft.getWorldAngularVelocityRef();
            this.helpers.updateRotationAxisArrow(bodyPosition, currentAngularVelocity);
        }

        if (h.orientationArrow?.visible) {
            const defaultForwardVector = new THREE.Vector3(0, 0, 1);
            const orientationVector = defaultForwardVector.applyQuaternion(this.spacecraft.getWorldOrientationRef());
            this.helpers.updateOrientationArrow(bodyPosition, orientationVector);
        }

        if (h.autopilotArrow?.visible) {
            const defaultForwardVector = new THREE.Vector3(0, 0, 1);
            const targetOrientationQuat = this.autopilot.getTargetOrientation();
            const targetOrientationVector = defaultForwardVector.applyQuaternion(targetOrientationQuat);
            this.helpers.updateAutopilotArrow(bodyPosition, targetOrientationVector);
        }

        if (h.autopilotTorqueArrow?.visible) {
            const pitchTorque = thrustForces[0] + thrustForces[3] + thrustForces[4] + thrustForces[7];
            const yawTorque   = thrustForces[8] + thrustForces[11] + thrustForces[12] + thrustForces[15];
            const rollTorque  = thrustForces[1] + thrustForces[2] + thrustForces[5] + thrustForces[6];
            const autopilotTorque = new THREE.Vector3(pitchTorque, yawTorque, rollTorque);
            this.helpers.updateAutopilotTorqueArrow(bodyPosition, autopilotTorque);
        }

        // Update path visualization when enabled
        if ((this.spacecraft as any)?.showPath && (h.pathLine?.visible || h.pathCarrot?.visible)) {
            try {
                const ap = this.autopilot;
                const pts = ap.getPathSamples?.();
                const carrot = ap.getPathCarrot?.();
                if (pts && pts.length >= 2) {
                    this.helpers.updatePath(pts, carrot || undefined);
                }
            } catch {}
        }
    }

    private applyForcesToThrusters(forces: number[], dt: number): boolean[] {
        const activationThresholdBase = this.activationThresholdFactor;
        const visibility = new Array(24).fill(false);
        const appliedForces: number[] = new Array(24).fill(0);

        for (let i = 0; i < 24; i++) {
            // clamp desired force
            const cap = this.thrusterMax[i] || this.thrust;
            const desired = Math.min(Math.max(forces[i] || 0, 0), cap);
            const activationThreshold = cap * activationThresholdBase;
            const desiredOn = desired >= activationThreshold;

            // advance timer
            this.thrusterLatchTimer[i] += dt;

            // state transition with min pulse width hysteresis
            const stateOn = this.thrusterOnLatch[i];
            if (desiredOn !== stateOn) {
                const minTime = stateOn ? this.minPulseOn : this.minPulseOff;
                if (this.thrusterLatchTimer[i] >= minTime) {
                    // toggle
                    this.thrusterOnLatch[i] = desiredOn;
                    this.thrusterLatchTimer[i] = 0;
                    if (desiredOn) {
                        this.thrusterLatchedForce[i] = desired; // start with desired
                    } else {
                        this.thrusterLatchedForce[i] = 0;
                    }
                }
            }

            // Smooth latched force when on
            if (this.thrusterOnLatch[i]) {
                // update toward desired
                const alpha = 0.8; // heavier smoothing
                this.thrusterLatchedForce[i] = this.thrusterLatchedForce[i] * alpha + desired * (1 - alpha);
                const f = Math.max(Math.min(this.thrusterLatchedForce[i], cap), activationThreshold);
                this.spacecraft.rcsVisuals.applyForce(i, f, dt);
                visibility[i] = true;
                appliedForces[i] = f;
            } else {
                visibility[i] = false;
                appliedForces[i] = 0;
            }
        }

        // Update cone mesh visibility
        this.spacecraft.rcsVisuals.getConeMeshes().forEach((coneMesh, index) => {
            coneMesh.visible = visibility[index];
        });

        // Compute latest force metrics for scientific gradient
        try {
            const thrusters = this.spacecraft.getThrusterConfigs?.() || [];
            let absSum = 0;
            const net = new THREE.Vector3(0, 0, 0);
            for (let i = 0; i < Math.min(24, appliedForces.length, thrusters.length); i++) {
                const f = appliedForces[i] || 0;
                absSum += Math.abs(f);
                const dir = thrusters[i]?.direction; // assume world-space unit
                if (dir && typeof dir.x === 'number') {
                    net.x += dir.x * f;
                    net.y += dir.y * f;
                    net.z += dir.z * f;
                }
            }
            const netMag = Math.sqrt(net.x * net.x + net.y * net.y + net.z * net.z);
            this.helpers.setLatestForceMetrics?.(absSum, netMag);
        } catch {}

        return visibility;
    }

    private rotationKeys(): string[] {
        return ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'];
    }

    private translationKeys(): string[] {
        return ['KeyU', 'KeyO', 'KeyK', 'KeyI', 'KeyJ', 'KeyL'];
    }

    private calculateManualForces(): number[] {
        const out = this.manualForcesBuffer;
        for (let i = 0; i < 24; i++) out[i] = 0;

        // 1) Build desired local translation vector
        // Semantics preserved: U (+Z fwd), O (-Z back), J (-X left), L (+X right), K (+Y up), I (-Y down)
        const lin = new THREE.Vector3(0, 0, 0);
        if (this.keysPressed['KeyU']) lin.z += 1; // forward
        if (this.keysPressed['KeyO']) lin.z -= 1; // back
        if (this.keysPressed['KeyJ']) lin.x -= 1; // left
        if (this.keysPressed['KeyL']) lin.x += 1; // right
        if (this.keysPressed['KeyK']) lin.y += 1; // up
        if (this.keysPressed['KeyI']) lin.y -= 1; // down

        // Scale to saturate per-axis groups (allocator clamps to group capacity)
        const linScale = this.thrust * 24; // large enough to reach clamp
        lin.multiplyScalar(linScale);

        // 2) Build desired rotational command vector (use autopilot's momentum-domain scaling)
        const rot = new THREE.Vector3(0, 0, 0);
        if (this.keysPressed['KeyW']) rot.x += 1; // pitch up
        if (this.keysPressed['KeyS']) rot.x -= 1; // pitch down
        if (this.keysPressed['KeyA']) rot.y += 1; // yaw left
        if (this.keysPressed['KeyD']) rot.y -= 1; // yaw right
        if (this.keysPressed['KeyQ']) rot.z += 1; // roll right
        if (this.keysPressed['KeyE']) rot.z -= 1; // roll left

        // Use Lcap so a unit command saturates thrusters per axis inside allocator
        const Lcap = Math.max(1e-6, this.autopilot.getConfig().limits.maxAngularMomentum);
        rot.multiplyScalar(Lcap);

        // 3) Allocate using the same distribution rules as the autopilot
        // Translation first, then add rotation on top
        this.manualAllocator.allocateTranslation(lin, out);
        const tmp = new Array(24).fill(0);
        this.manualAllocator.allocateRotation(rot, tmp);
        for (let i = 0; i < 24; i++) out[i] += tmp[i];

        return out;
    }

    public cleanup(): void {
        // No global listeners to remove here; BasicWorld manages input

        // Clean up autopilot
        if (this.autopilot) {
            this.autopilot.cleanup?.();
        }

        // Clean up helpers
        if (this.helpers) {
            this.helpers.cleanup();
        }
    }

    public getThrust(): number {
        return this.thrust;
    }

    public setThrust(value: number): void {
        this.thrust = value;
        try { this.autopilot?.setThrust?.(value); } catch {}
        try { this.manualAllocator?.setThrust?.(value); } catch {}
    }

    /**
     * Set per-thruster maximum strengths (N). Array length must be 24.
     * Updates local clamping and propagates to autopilot (main + worker).
     */
    public setThrusterStrengths(max: number[]): void {
        if (!Array.isArray(max) || max.length !== 24) return;
        this.thrusterMax = max.slice(0, 24);
        try { this.autopilot?.setThrusterStrengths(this.thrusterMax); } catch {}
        try { this.manualAllocator?.setThrusterMax(this.thrusterMax); } catch {}
    }

    /** Reset thrust to its pre-cluster value. */
    public resetClusterScalingToBase(): void {
        this.setThrust(this.baseThrust);
    }

    public getSpacecraft(): Spacecraft {
        return this.spacecraft;
    }

    public getAutopilot(): Autopilot {
        return this.autopilot;
    }

    public getTargetOrientation(): THREE.Quaternion {
        return this.autopilot.getTargetOrientation();
    }

    public setTargetOrientation(orientation: THREE.Quaternion): void {
        this.autopilot.setTargetOrientation(orientation);
    }

    public destroy(): void {
        // No-op; BasicWorld manages global listeners
    }

    // no waypoint utilities

    /**
     * Immediately clear any latched thruster outputs and hide RCS visuals.
     * Useful when external events (e.g., docking) require an abrupt stop.
     */
    public resetThrusterLatch(): void {
        for (let i = 0; i < 24; i++) {
            this.thrusterOnLatch[i] = false;
            this.thrusterLatchTimer[i] = 0;
            this.thrusterLatchedForce[i] = 0;
        }
        // Also clear any lingering visual effects
        try {
            this.spacecraft.rcsVisuals.getConeMeshes().forEach((cone) => (cone.visible = false));
        } catch {}
    }

    handleKeyPress(event: KeyboardEvent): void {
        if (event.key === 't' || event.key === 'T') {
            this.log.debug('Toggling orientationMatch');
            this.autopilot.orientationMatch();
        }
    }
} 

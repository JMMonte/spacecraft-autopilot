import * as THREE from 'three';
import type { Spacecraft } from '../core/spacecraft';
import type { ThrusterGroups } from '../config/spacecraftConfig';
import { computeThrusterGroups, type ThrusterConfig } from '../utils/utils';

/**
 * One thruster in the compound body, with position/direction in the
 * compound body's local frame (root spacecraft's frame).
 */
export interface CompoundThrusterEntry {
    /** Owning spacecraft. */
    spacecraft: Spacecraft;
    /** Index within that spacecraft's 24-thruster array. */
    localIndex: number;
    /** Compound-wide index (0..N*24-1). */
    compoundIndex: number;
    /** Position relative to compound body origin, in compound local frame. */
    position: THREE.Vector3;
    /** Thrust direction in compound local frame (unit vector). */
    direction: THREE.Vector3;
}

// Scratch vectors
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Builds a unified thruster table and ThrusterGroups for a compound body
 * from all docked spacecraft, with positions/directions in the root body's frame.
 */
export class CompoundThrusterTable {
    public entries: CompoundThrusterEntry[] = [];
    public totalThrusters = 0;
    public groups: ThrusterGroups = { forward: [[], []], up: [[], []], left: [[], []], pitch: [[], []], yaw: [[], []], roll: [[], []] };

    /**
     * Build the compound thruster table from a list of spacecraft.
     * The first spacecraft is the compound root (its frame = compound frame).
     */
    build(members: Spacecraft[]): void {
        this.entries = [];
        let compoundIdx = 0;
        const root = members[0];
        if (!root) return;

        // Root body orientation (compound frame)
        const rootQ = new THREE.Quaternion();
        const rq = root.objects.rigid?.getQuaternion();
        if (rq) rootQ.set(rq.x, rq.y, rq.z, rq.w);
        const rootQInv = rootQ.clone().invert();

        // Root body position
        const rootPos = new THREE.Vector3();
        const rp = root.objects.rigid?.getPosition();
        if (rp) rootPos.set(rp.x, rp.y, rp.z);

        // -----------------------------------------------------------
        // 1) Compute compound center of mass in compound-local frame
        // -----------------------------------------------------------
        const comLocal = new THREE.Vector3(0, 0, 0);
        let totalMass = 0;
        for (const craft of members) {
            const mass = Math.max(1e-6, craft.getMass?.() ?? 0);
            const craftWorldPos = craft.getWorldPosition();
            // craft position in compound local frame
            const localP = craftWorldPos.clone().sub(rootPos).applyQuaternion(rootQInv);
            comLocal.addScaledVector(localP, mass);
            totalMass += mass;
        }
        if (totalMass > 0) comLocal.multiplyScalar(1 / totalMass);

        // -----------------------------------------------------------
        // 2) Build thruster entries with positions relative to COM
        // -----------------------------------------------------------
        for (const craft of members) {
            const thrusterData = craft.rcsVisuals?.getThrusterData?.() ?? [];
            if (thrusterData.length === 0) continue;

            // Get this spacecraft's world position and orientation
            const craftWorldPos = craft.getWorldPosition();
            const craftWorldQ = craft.getWorldOrientation();

            for (let i = 0; i < 24; i++) {
                const td = thrusterData[i];
                if (!td) continue;

                // Thruster position in world → compound local → relative to COM
                const localPos = td.position;
                _pos.set(localPos[0], localPos[1], localPos[2])
                    .applyQuaternion(craftWorldQ)
                    .add(craftWorldPos)
                    .sub(rootPos)
                    .applyQuaternion(rootQInv)
                    .sub(comLocal); // offset to COM

                // Thruster direction in world → compound local
                _dir.set(0, 1, 0); // cone geometry fires along +Y
                const rot = td.rotation;
                if (rot) {
                    const thrusterQ = new THREE.Quaternion().setFromAxisAngle(rot.axis, rot.angle);
                    _dir.applyQuaternion(thrusterQ);
                }
                _dir.applyQuaternion(craftWorldQ)
                    .applyQuaternion(rootQInv)
                    .normalize();

                this.entries.push({
                    spacecraft: craft,
                    localIndex: i,
                    compoundIndex: compoundIdx,
                    position: _pos.clone(),
                    direction: _dir.clone(),
                });
                compoundIdx++;
            }
        }

        this.totalThrusters = compoundIdx;
        this.groups = this.classifyGroups();
    }

    /**
     * Classify compound thrusters using the same proven algorithm as solo spacecraft.
     * Converts entries to ThrusterConfig[] and delegates to computeThrusterGroups().
     */
    private classifyGroups(): ThrusterGroups {
        const configs: ThrusterConfig[] = this.entries.map(entry => ({
            position: entry.position.clone(),
            direction: entry.direction.clone(),
        }));
        return computeThrusterGroups(configs);
    }

    /** Get per-thruster max forces array for the compound. */
    getCompoundThrusterMax(defaultThrust: number): number[] {
        const max = new Array(this.totalThrusters).fill(defaultThrust);
        for (const entry of this.entries) {
            // Use the owning spacecraft's thrust setting
            const thrust = entry.spacecraft.spacecraftController?.getThrust?.() ?? defaultThrust;
            max[entry.compoundIndex] = thrust;
        }
        return max;
    }
}


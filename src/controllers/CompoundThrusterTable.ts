import * as THREE from 'three';
import type { Spacecraft } from '../core/spacecraft';
import type { ThrusterGroups } from '../config/spacecraftConfig';

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
const _tmpQ = new THREE.Quaternion();

/**
 * Builds a unified thruster table and ThrusterGroups for a compound body
 * from all docked spacecraft, with positions/directions in the root body's frame.
 */
export class CompoundThrusterTable {
    public entries: CompoundThrusterEntry[] = [];
    public totalThrusters = 0;
    public groups: ThrusterGroups = emptyGroups();

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

        for (const craft of members) {
            const configs = craft.rcsVisuals?.getThrusterConfigs?.() ?? [];
            const thrusterData = craft.rcsVisuals?.getThrusterData?.() ?? [];
            if (configs.length === 0 && thrusterData.length === 0) continue;

            // Get this spacecraft's world position and orientation
            const craftWorldPos = craft.getWorldPosition();
            const craftWorldQ = craft.getWorldOrientation();

            // Relative rotation: compound-local = rootQInv * craftWorldQ
            _tmpQ.copy(rootQInv).multiply(craftWorldQ);

            for (let i = 0; i < 24; i++) {
                const td = thrusterData[i];
                if (!td) continue;

                // Thruster position in world → compound local
                // World pos = craftWorldPos + craftWorldQ * localPos
                const localPos = td.position;
                _pos.set(localPos[0], localPos[1], localPos[2])
                    .applyQuaternion(craftWorldQ)
                    .add(craftWorldPos)
                    .sub(rootPos)
                    .applyQuaternion(rootQInv);

                // Thruster direction in world → compound local
                // The thruster fires along its local Y axis, rotated by the
                // thruster's rotation and the craft's world orientation.
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
     * Classify compound thrusters into ThrusterGroups based on their
     * direction and torque contribution in the compound frame.
     */
    private classifyGroups(): ThrusterGroups {
        const groups: ThrusterGroups = emptyGroups();
        const eps = 0.3; // direction threshold

        for (const entry of this.entries) {
            const d = entry.direction;
            const idx = entry.compoundIndex;

            // Translation groups: which direction does this thruster push?
            if (d.z < -eps) groups.forward[0].push(idx);  // fires -Z → pushes +Z (forward)
            if (d.z > eps)  groups.forward[1].push(idx);   // fires +Z → pushes -Z (backward)
            if (d.y < -eps) groups.up[0].push(idx);        // fires -Y → pushes +Y (up)
            if (d.y > eps)  groups.up[1].push(idx);        // fires +Y → pushes -Y (down)
            if (d.x > eps)  groups.left[0].push(idx);      // fires +X → pushes -X (left)
            if (d.x < -eps) groups.left[1].push(idx);      // fires -X → pushes +X (right)

            // Rotation groups: compute torque = position × direction
            const torque = new THREE.Vector3().crossVectors(entry.position, d);

            // Pitch (rotation around X): torque.x component
            if (torque.x > eps)  groups.pitch[0].push(idx); // pitch up
            if (torque.x < -eps) groups.pitch[1].push(idx); // pitch down

            // Yaw (rotation around Y): torque.y component
            if (torque.y > eps)  groups.yaw[0].push(idx);
            if (torque.y < -eps) groups.yaw[1].push(idx);

            // Roll (rotation around Z): torque.z component
            if (torque.z > eps)  groups.roll[0].push(idx);
            if (torque.z < -eps) groups.roll[1].push(idx);
        }

        return groups;
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

function emptyGroups(): ThrusterGroups {
    return {
        forward: [[], []], up: [[], []], left: [[], []],
        pitch: [[], []], yaw: [[], []], roll: [[], []],
    };
}

import * as THREE from 'three';
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import type { CapabilitySet } from './CapabilityCalculator';

/**
 * Distributes PID outputs to individual thrusters with smoothing and per-axis capping.
 * Handles both rotational (torque) and translational (force) allocation.
 */
export class ThrusterAllocator {
    private thrusterGroups: ThrusterGroups;
    private thrust: number;
    private thrusterMax: number[];
    private epsilon: number;
    private getCaps: () => CapabilitySet;
    // Smoothing state
    private lastRotCmd = new THREE.Vector3();
    private lastLinCmd = new THREE.Vector3();
    private rotSmoothAlpha: number = 0.4;
    private linSmoothAlpha: number = 0.5;
    private allocationScale: number = 1.0;
    // Scratch vector (shared between rotation/translation calls — never concurrent)
    private tmp = new THREE.Vector3();

    constructor(
        thrusterGroups: ThrusterGroups,
        thrust: number,
        thrusterMax: number[],
        epsilon: number,
        getCaps: () => CapabilitySet,
    ) {
        this.thrusterGroups = thrusterGroups;
        this.thrust = thrust;
        this.thrusterMax = thrusterMax;
        this.epsilon = epsilon;
        this.getCaps = getCaps;
    }

    setAllocationScale(scale: number): void {
        this.allocationScale = Math.max(0, Math.min(1, scale));
    }

    setRotSmoothAlpha(alpha: number): void { this.rotSmoothAlpha = alpha; }
    setLinSmoothAlpha(alpha: number): void { this.linSmoothAlpha = alpha; }

    setThrusterGroups(groups: ThrusterGroups): void { this.thrusterGroups = groups; }
    setThrust(value: number): void { this.thrust = value; }
    setThrusterMax(max: number[]): void { this.thrusterMax = max; }

    resetSmoothing(): void {
        this.lastRotCmd.set(0, 0, 0);
        this.lastLinCmd.set(0, 0, 0);
    }

    /** Allocate rotational PID output (torque-domain) to thrusters. Accumulates into `out`. */
    allocateRotation(pidOutput: THREE.Vector3, out: number[]): void {
        // Smooth: lastRotCmd = lastRotCmd * alpha + pidOutput * (1 - alpha)
        this.lastRotCmd.multiplyScalar(this.rotSmoothAlpha);
        this.tmp.copy(pidOutput).multiplyScalar(1 - this.rotSmoothAlpha);
        this.lastRotCmd.add(this.tmp);

        const eps = this.epsilon * 2.0;
        const caps = this.getCaps();

        // X axis (pitch)
        const x = this.lastRotCmd.x;
        if (Math.abs(x) > eps) {
            const tauAxisMax = Math.max(1e-6, caps.angTorque.x);
            const thrustFraction = Math.min(1.0, Math.abs(x) / tauAxisMax);
            const group = this.thrusterGroups.pitch[x >= 0 ? 1 : 0];
            const perThruster = this.thrust * thrustFraction * this.allocationScale;
            group.forEach((idx: number) => {
                const cap = this.thrusterMax[idx] || this.thrust;
                out[idx] += Math.min(cap, perThruster);
            });
        }

        // Y axis (yaw)
        const y = this.lastRotCmd.y;
        if (Math.abs(y) > eps) {
            const tauAxisMax = Math.max(1e-6, caps.angTorque.y);
            const thrustFraction = Math.min(1.0, Math.abs(y) / tauAxisMax);
            const group = this.thrusterGroups.yaw[y >= 0 ? 0 : 1];
            const perThruster = this.thrust * thrustFraction * this.allocationScale;
            group.forEach((idx: number) => {
                const cap = this.thrusterMax[idx] || this.thrust;
                out[idx] += Math.min(cap, perThruster);
            });
        }

        // Z axis (roll)
        const z = this.lastRotCmd.z;
        if (Math.abs(z) > eps) {
            const tauAxisMax = Math.max(1e-6, caps.angTorque.z);
            const thrustFraction = Math.min(1.0, Math.abs(z) / tauAxisMax);
            const group = this.thrusterGroups.roll[z >= 0 ? 0 : 1];
            const perThruster = this.thrust * thrustFraction * this.allocationScale;
            group.forEach((idx: number) => {
                const cap = this.thrusterMax[idx] || this.thrust;
                out[idx] += Math.min(cap, perThruster);
            });
        }
    }

    /** Allocate translational force (body-local) to thruster groups. Accumulates into `out`. */
    allocateTranslation(localForce: THREE.Vector3, out: number[]): void {
        // Smooth: lastLinCmd = lastLinCmd * alpha + localForce * (1 - alpha)
        this.lastLinCmd.multiplyScalar(this.linSmoothAlpha);
        this.tmp.copy(localForce).multiplyScalar(1 - this.linSmoothAlpha);
        this.lastLinCmd.add(this.tmp);

        const smoothed = this.lastLinCmd;
        const axes = [
            { axis: 'z' as keyof THREE.Vector3, groups: this.thrusterGroups.forward, positive: true },
            { axis: 'y' as keyof THREE.Vector3, groups: this.thrusterGroups.up, positive: true },
            { axis: 'x' as keyof THREE.Vector3, groups: this.thrusterGroups.left, positive: false },
        ];

        const epsilon = this.epsilon * 2.0;
        axes.forEach(({ axis, groups, positive }) => {
            const val = smoothed[axis] as number;
            if (Math.abs(val) <= epsilon) return;
            const thrusterGroup = val * (positive ? 1 : -1) > 0 ? groups[0] : groups[1];
            if (!thrusterGroup || thrusterGroup.length === 0) return;
            const sumCap = thrusterGroup.reduce((s: number, idx: number) => s + (this.thrusterMax[idx] || this.thrust), 0);
            const total = THREE.MathUtils.clamp(Math.abs(val), 0, sumCap);
            if (sumCap <= 1e-6) return;
            thrusterGroup.forEach((index: number) => {
                const cap = this.thrusterMax[index] || this.thrust;
                const share = total * (cap / sumCap);
                out[index] += Math.min(cap, share * this.allocationScale);
            });
        });
    }
}

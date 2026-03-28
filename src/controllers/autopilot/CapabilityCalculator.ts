import * as THREE from 'three';
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import type { AutopilotConfig } from './types';

/** Minimal spacecraft data needed for capability calculations. */
export interface SpacecraftData {
    getMass(): number;
    getMainBodyDimensions(): THREE.Vector3;
    getThrusterConfigs?(): Array<{ position: THREE.Vector3; direction: THREE.Vector3 }>;
}

export interface CapabilitySet {
    linForce: { x: number; y: number; z: number };
    linAccel: { x: number; y: number; z: number };
    inertia: { x: number; y: number; z: number };
    angTorque: { x: number; y: number; z: number };
    angAccel: { x: number; y: number; z: number };
}

/**
 * Computes and caches spacecraft dynamic capabilities:
 * linear force/accel per axis, angular torque/accel per axis, and inertia.
 * Signature-based caching avoids recomputation when geometry/mass are unchanged.
 */
export class CapabilityCalculator {
    private spacecraft: SpacecraftData;
    private config: AutopilotConfig;
    private thrusterGroups: ThrusterGroups;
    private thrust: number;
    private thrusterMax: number[];
    private cache?: CapabilitySet & { sig: string };
    // Pre-allocated scratch vectors for torque calculation
    private readonly scratchAxis = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
    ];
    private readonly scratchF = new THREE.Vector3();
    private readonly scratchTau = new THREE.Vector3();

    constructor(
        spacecraft: SpacecraftData,
        config: AutopilotConfig,
        thrusterGroups: ThrusterGroups,
        thrust: number,
        thrusterMax: number[],
    ) {
        this.spacecraft = spacecraft;
        this.config = config;
        this.thrusterGroups = thrusterGroups;
        this.thrust = thrust;
        this.thrusterMax = thrusterMax;
    }

    invalidate(): void {
        this.cache = undefined;
    }

    setThrusterGroups(groups: ThrusterGroups): void {
        this.thrusterGroups = groups;
        this.cache = undefined;
    }

    setThrust(value: number): void {
        this.thrust = value;
        this.cache = undefined;
    }

    setThrusterMax(max: number[]): void {
        this.thrusterMax = max;
        this.cache = undefined;
    }

    getDynamicCaps(): CapabilitySet {
        const dims = this.spacecraft.getMainBodyDimensions();
        const mass = this.spacecraft.getMass();
        const sig = `${dims.x.toFixed(3)}:${dims.y.toFixed(3)}:${dims.z.toFixed(3)}:m${mass.toFixed(3)}:t${this.thrust.toFixed(3)}`;
        if (this.cache && this.cache.sig === sig) {
            return this.cache;
        }

        const sumGroup = (arr?: number[]) => (arr || []).reduce((s, i) => s + (this.thrusterMax[i] || this.thrust), 0);
        const linForce = {
            x: Math.max(sumGroup(this.thrusterGroups.left?.[0]), sumGroup(this.thrusterGroups.left?.[1])),
            y: Math.max(sumGroup(this.thrusterGroups.up?.[0]),   sumGroup(this.thrusterGroups.up?.[1])),
            z: Math.max(sumGroup(this.thrusterGroups.forward?.[0]), sumGroup(this.thrusterGroups.forward?.[1])),
        };
        const linAccel = {
            x: linForce.x / Math.max(mass, 1e-6),
            y: linForce.y / Math.max(mass, 1e-6),
            z: linForce.z / Math.max(mass, 1e-6),
        };

        const inertia = this.calculateMomentOfInertiaByAxis();
        const thrusters = this.spacecraft.getThrusterConfigs?.() || [];
        const torqueForGroup = (indices: number[], axis: THREE.Vector3) => {
            let tau = 0;
            indices?.forEach((i) => {
                const t = thrusters[i];
                if (!t) return;
                const cap = this.thrusterMax[i] || this.thrust;
                this.scratchF.copy(t.direction).normalize().multiplyScalar(-cap);
                this.scratchTau.copy(t.position).cross(this.scratchF);
                tau += Math.abs(this.scratchTau.dot(axis));
            });
            return tau;
        };
        const pitchGroups = this.thrusterGroups.pitch || [[], []];
        const yawGroups = this.thrusterGroups.yaw || [[], []];
        const rollGroups = this.thrusterGroups.roll || [[], []];

        const tauX = Math.max(torqueForGroup(pitchGroups[0] || [], this.scratchAxis[0]), torqueForGroup(pitchGroups[1] || [], this.scratchAxis[0]));
        const tauY = Math.max(torqueForGroup(yawGroups[0] || [], this.scratchAxis[1]), torqueForGroup(yawGroups[1] || [], this.scratchAxis[1]));
        const tauZ = Math.max(torqueForGroup(rollGroups[0] || [], this.scratchAxis[2]), torqueForGroup(rollGroups[1] || [], this.scratchAxis[2]));

        const angTorque = { x: tauX, y: tauY, z: tauZ };
        const angAccel = {
            x: tauX / Math.max(inertia.x, 1e-6),
            y: tauY / Math.max(inertia.y, 1e-6),
            z: tauZ / Math.max(inertia.z, 1e-6),
        };

        this.cache = { sig, linForce, linAccel, inertia, angTorque, angAccel };
        return this.cache;
    }

    getDynamicAngularAccelCap(): { alphaMax: number; omegaMax: number } {
        const caps = this.getDynamicCaps();
        const angAccel = caps.angAccel;
        const alphaDyn = angAccel
            ? Math.max(1e-4, Math.min(angAccel.x, angAccel.y, angAccel.z)) * 0.6
            : this.config.limits.maxAngularAcceleration * 0.6;
        const alphaMax = Math.min(this.config.limits.maxAngularAcceleration, alphaDyn);
        const omegaFromAlpha = Math.sqrt(2 * alphaMax * 0.5);
        const omegaMax = Math.min(this.config.limits.maxAngularVelocity, Math.max(0.2, omegaFromAlpha));
        return { alphaMax, omegaMax };
    }

    getDynamicLinearAccelAlong(dirLocal: THREE.Vector3): number {
        const caps = this.getDynamicCaps();
        const nx = Math.abs(dirLocal.x);
        const ny = Math.abs(dirLocal.y);
        const nz = Math.abs(dirLocal.z);
        return nx * caps.linAccel.x + ny * caps.linAccel.y + nz * caps.linAccel.z;
    }

    calculateMomentOfInertia(): number {
        const mass = this.spacecraft.getMass();
        const size = this.spacecraft.getMainBodyDimensions();
        const w = size.x, h = size.y, d = size.z;
        const Ix = (1 / 12) * mass * (h * h + d * d);
        const Iy = (1 / 12) * mass * (w * w + d * d);
        const Iz = (1 / 12) * mass * (w * w + h * h);
        return Math.max(Ix, Iy, Iz);
    }

    calculateMomentOfInertiaByAxis(): { x: number; y: number; z: number } {
        if (this.config.customInertia) {
            return { ...this.config.customInertia };
        }
        const mass = this.spacecraft.getMass();
        const size = this.spacecraft.getMainBodyDimensions();
        const w = size.x, h = size.y, d = size.z;
        let k = 1 / 12;
        const mode = this.config.inertiaMode || 'solid';
        if (mode === 'hollow') k = 1 / 8;
        else if (mode === 'thin-shell') k = 1 / 6;
        const Ix = k * mass * (h * h + d * d);
        const Iy = k * mass * (w * w + d * d);
        const Iz = k * mass * (w * w + h * h);
        return { x: Ix, y: Iy, z: Iz };
    }

    getEffectiveInertiaAlongAxis(axisX: number, axisY: number, axisZ: number): number {
        const I = this.calculateMomentOfInertiaByAxis();
        const len = Math.sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
        if (len < 1e-10) return I.x;
        const nx = axisX / len, ny = axisY / len, nz = axisZ / len;
        return I.x * nx * nx + I.y * ny * ny + I.z * nz * nz;
    }
}

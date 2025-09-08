import * as THREE from 'three';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';

export interface AutopilotConfig {
    pid: {
        orientation: { kp: number; ki: number; kd: number; };
        position: { kp: number; ki: number; kd: number; };
        momentum: { kp: number; ki: number; kd: number; };
    };
    limits: {
        maxForce: number;
        epsilon: number;
        maxAngularMomentum: number; // limit rotational momentum |L|
        maxLinearMomentum: number;  // limit translational momentum |p|
        maxAngularVelocity: number; // rad/s cap for attitude profiles
        maxAngularAcceleration: number; // rad/s^2 cap for attitude profiles
        maxLinearVelocity?: number; // m/s cap for translation profiles (optional)
        maxLinearAcceleration?: number; // m/s^2 cap for translation profiles (optional)
    };
    damping: {
        factor: number;
    };
}

export abstract class AutopilotMode {
    protected spacecraft: Spacecraft;
    protected config: AutopilotConfig;
    protected thrusterGroups: any;
    protected thrust: number;
    protected thrusterMax: number[] = new Array(24).fill(0);
    protected pidController: PIDController;
    // Optional moving reference frame (e.g., target spacecraft)
    // Currently only velocity is needed by translation modes
    protected referenceVelocityWorld: THREE.Vector3 | null = null;
    // Simple output smoothing to reduce flicker near zero
    protected lastRotCmd: THREE.Vector3 = new THREE.Vector3();
    protected lastLinCmd: THREE.Vector3 = new THREE.Vector3();
    protected rotSmoothAlpha: number = 0.4; // lower alpha => more responsive rotation
    protected linSmoothAlpha: number = 0.5;
    // Scratch vectors to reduce allocations
    protected tmpVecA: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecB: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecC: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecD: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecE: THREE.Vector3 = new THREE.Vector3();
    protected tmpQuatA: THREE.Quaternion = new THREE.Quaternion();
    protected tmpQuatB: THREE.Quaternion = new THREE.Quaternion();
    private capsCache?: {
        sig: string;
        linForce: { x: number; y: number; z: number };
        linAccel: { x: number; y: number; z: number };
        inertia: { x: number; y: number; z: number };
        angTorque: { x: number; y: number; z: number };
        angAccel: { x: number; y: number; z: number };
    };

    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: any,
        thrust: number,
        pidController: PIDController,
        thrusterMax?: number[]
    ) {
        this.spacecraft = spacecraft;
        this.config = config;
        this.thrusterGroups = thrusterGroups;
        this.thrust = thrust;
        this.pidController = pidController;
        // Per-thruster max strengths (N). Defaults to uniform `thrust` when not provided
        this.thrusterMax = (thrusterMax && thrusterMax.length === 24) ? thrusterMax.slice(0, 24) : new Array(24).fill(thrust);
    }

    // Update per-thruster capacities at runtime and invalidate cached caps
    public setThrusterMax(max: number[]): void {
        if (Array.isArray(max) && max.length === 24) this.thrusterMax = max.slice(0, 24);
        else this.thrusterMax = new Array(24).fill(this.thrust);
        this.capsCache = undefined;
    }

    // Implementations should write into `out` when provided to avoid allocations
    abstract calculateForces(dt: number, out?: number[]): number[];

    public setReferenceVelocityWorld(v: THREE.Vector3 | null): void {
        if (v) {
            if (!this.referenceVelocityWorld) this.referenceVelocityWorld = new THREE.Vector3();
            this.referenceVelocityWorld.copy(v);
        } else {
            this.referenceVelocityWorld = null;
        }
    }

    protected applyPIDOutputToThrusters(pidOutput: THREE.Vector3): number[] {
        const out = Array(24).fill(0);
        this.applyPIDOutputToThrustersInPlace(pidOutput, out);
        return out;
    }

    protected applyPIDOutputToThrustersInPlace(pidOutput: THREE.Vector3, out: number[]): void {
        // lastRotCmd = lastRotCmd * alpha + pidOutput * (1 - alpha)
        this.lastRotCmd.multiplyScalar(this.rotSmoothAlpha);
        this.tmpVecA.copy(pidOutput).multiplyScalar(1 - this.rotSmoothAlpha);
        this.lastRotCmd.add(this.tmpVecA);

        // Revert to proven torque fraction mapping: normalize momentum by Lcap, then scale by axis capability.
        const eps = this.config.limits.epsilon * 2.0;
        const caps = this.getDynamicCaps();
        const Lcap = Math.max(1e-6, this.config.limits.maxAngularMomentum);

        // X axis (pitch)
        const x = this.lastRotCmd.x;
        if (Math.abs(x) > eps) {
            const tauAxisMax = Math.max(1e-6, caps.angTorque.x);
            const tauCmd = Math.min(tauAxisMax, Math.abs(x) / Lcap * tauAxisMax);
            const group = this.thrusterGroups.pitch[x >= 0 ? 1 : 0];
            const perThruster = Math.min(this.thrust, (tauCmd / tauAxisMax) * this.thrust);
            group.forEach((idx: number) => { out[idx] += perThruster; });
        }

        // Y axis (yaw)
        const y = this.lastRotCmd.y;
        if (Math.abs(y) > eps) {
            const tauAxisMax = Math.max(1e-6, caps.angTorque.y);
            const tauCmd = Math.min(tauAxisMax, Math.abs(y) / Lcap * tauAxisMax);
            const group = this.thrusterGroups.yaw[y >= 0 ? 0 : 1];
            const perThruster = Math.min(this.thrust, (tauCmd / tauAxisMax) * this.thrust);
            group.forEach((idx: number) => { out[idx] += perThruster; });
        }

        // Z axis (roll)
        const z = this.lastRotCmd.z;
        if (Math.abs(z) > eps) {
            const tauAxisMax = Math.max(1e-6, caps.angTorque.z);
            const tauCmd = Math.min(tauAxisMax, Math.abs(z) / Lcap * tauAxisMax);
            const group = this.thrusterGroups.roll[z >= 0 ? 0 : 1];
            const perThruster = Math.min(this.thrust, (tauCmd / tauAxisMax) * this.thrust);
            group.forEach((idx: number) => { out[idx] += perThruster; });
        }
    }

    protected applyTranslationalForcesToThrusterGroups(localForce: THREE.Vector3): number[] {
        const out = Array(24).fill(0);
        this.applyTranslationalForcesToThrusterGroupsInPlace(localForce, out);
        return out;
    }

    protected applyTranslationalForcesToThrusterGroupsInPlace(localForce: THREE.Vector3, out: number[]): void {
        // lastLinCmd = lastLinCmd * alpha + localForce * (1 - alpha)
        this.lastLinCmd.multiplyScalar(this.linSmoothAlpha);
        this.tmpVecA.copy(localForce).multiplyScalar(1 - this.linSmoothAlpha);
        this.lastLinCmd.add(this.tmpVecA);

        const smoothed = this.lastLinCmd;
        const axes = [
            { axis: 'z' as keyof THREE.Vector3, groups: this.thrusterGroups.forward, positive: true },
            { axis: 'y' as keyof THREE.Vector3, groups: this.thrusterGroups.up, positive: true },
            { axis: 'x' as keyof THREE.Vector3, groups: this.thrusterGroups.left, positive: false },
        ];

        const epsilon = this.config.limits.epsilon * 2.0;
        // (caps not needed here)
        axes.forEach(({ axis, groups, positive }) => {
            const val = smoothed[axis] as number; // desired total local force [N] along axis
            if (Math.abs(val) <= epsilon) return;
            const thrusterGroup = val * (positive ? 1 : -1) > 0 ? groups[0] : groups[1];
            if (!thrusterGroup || thrusterGroup.length === 0) return;
            // Group-specific capacity (sum of per-thruster caps)
            const sumCap = thrusterGroup.reduce((s: number, idx: number) => s + (this.thrusterMax[idx] || this.thrust), 0);
            const total = THREE.MathUtils.clamp(Math.abs(val), 0, sumCap);
            if (sumCap <= 1e-6) return;
            thrusterGroup.forEach((index: number) => {
                const cap = this.thrusterMax[index] || this.thrust;
                const share = total * (cap / sumCap);
                out[index] += Math.min(cap, share);
            });
        });
    }

    protected calculateMomentOfInertia(): number {
        const mass = this.spacecraft.getMass();
        const size = this.spacecraft.getMainBodyDimensions();

        const w = size.x;
        const h = size.y;
        const d = size.z;

        const Ix = (1 / 12) * mass * (h * h + d * d);
        const Iy = (1 / 12) * mass * (w * w + d * d);
        const Iz = (1 / 12) * mass * (w * w + h * h);
        return Math.max(Ix, Iy, Iz);
    }

    protected calculateMomentOfInertiaByAxis(): { x: number; y: number; z: number } {
        const mass = this.spacecraft.getMass();
        const size = this.spacecraft.getMainBodyDimensions();
        const w = size.x;
        const h = size.y;
        const d = size.z;
        const Ix = (1 / 12) * mass * (h * h + d * d);
        const Iy = (1 / 12) * mass * (w * w + d * d);
        const Iz = (1 / 12) * mass * (w * w + h * h);
        return { x: Ix, y: Iy, z: Iz };
    }

    protected getEffectiveInertiaAlongAxis(axis: THREE.Vector3): number {
        const I = this.calculateMomentOfInertiaByAxis();
        const a = this.tmpVecA.copy(axis).normalize();
        return I.x * a.x * a.x + I.y * a.y * a.y + I.z * a.z * a.z;
    }

    protected getDynamicCaps(): {
        linForce: { x: number; y: number; z: number };
        linAccel: { x: number; y: number; z: number };
        inertia: { x: number; y: number; z: number };
        angTorque: { x: number; y: number; z: number };
        angAccel: { x: number; y: number; z: number };
    } {
        // Build signature to cache across frames until geometry/parameters change
        const dims = this.spacecraft.getMainBodyDimensions();
        const mass = this.spacecraft.getMass();
        const sig = `${dims.x.toFixed(3)}:${dims.y.toFixed(3)}:${dims.z.toFixed(3)}:m${mass.toFixed(3)}:t${this.thrust.toFixed(3)}`;
        if (this.capsCache && this.capsCache.sig === sig) {
            return this.capsCache;
        }

        // Linear force/accel capability per principal axis (use per-thruster capacities)
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

        // Angular torque/accel capability (approx) using thruster geometry
        const inertia = this.calculateMomentOfInertiaByAxis();
        const thrusters = this.spacecraft.getThrusterConfigs?.() || [];
        const axisX = new THREE.Vector3(1, 0, 0);
        const axisY = new THREE.Vector3(0, 1, 0);
        const axisZ = new THREE.Vector3(0, 0, 1);
        const torqueForGroup = (indices: number[], axis: THREE.Vector3) => {
            let tau = 0;
            indices?.forEach((i) => {
                const t = thrusters[i];
                if (!t) return;
                const r = t.position; // local
                const dir = t.direction.clone().normalize();
                const cap = this.thrusterMax[i] || this.thrust;
                const F = dir.clone().multiplyScalar(-cap); // force is opposite to nozzle dir
                const tauVec = new THREE.Vector3().copy(r).cross(F);
                tau += Math.abs(tauVec.dot(axis));
            });
            return tau; // N·m approx
        };
        const pitchGroups = this.thrusterGroups.pitch || [[], []];
        const yawGroups = this.thrusterGroups.yaw || [[], []];
        const rollGroups = this.thrusterGroups.roll || [[], []];

        const tauX = Math.max(
            torqueForGroup(pitchGroups[0] || [], axisX),
            torqueForGroup(pitchGroups[1] || [], axisX)
        );
        const tauY = Math.max(
            torqueForGroup(yawGroups[0] || [], axisY),
            torqueForGroup(yawGroups[1] || [], axisY)
        );
        const tauZ = Math.max(
            torqueForGroup(rollGroups[0] || [], axisZ),
            torqueForGroup(rollGroups[1] || [], axisZ)
        );

        const angTorque = { x: tauX, y: tauY, z: tauZ };
        const angAccel = {
            x: tauX / Math.max(inertia.x, 1e-6),
            y: tauY / Math.max(inertia.y, 1e-6),
            z: tauZ / Math.max(inertia.z, 1e-6),
        };

        this.capsCache = { sig, linForce, linAccel, inertia, angTorque, angAccel };
        return this.capsCache;
    }

    protected getDynamicLinearAccelAlong(dirLocal: THREE.Vector3): number {
        const caps = this.getDynamicCaps();
        const nx = Math.abs(dirLocal.x);
        const ny = Math.abs(dirLocal.y);
        const nz = Math.abs(dirLocal.z);
        return nx * caps.linAccel.x + ny * caps.linAccel.y + nz * caps.linAccel.z;
    }

    protected getDynamicAngularAccelCap(): { alphaMax: number; omegaMax: number } {
        const caps = this.getDynamicCaps();
        // Conservative scalar cap as min across axes with a safety factor (brake earlier)
        const alphaDyn = Math.max(1e-4, Math.min(caps.angAccel.x, caps.angAccel.y, caps.angAccel.z)) * 0.6;
        const alphaMax = Math.min(this.config.limits.maxAngularAcceleration, alphaDyn);
        // Derive an omega cap from alpha (triangular rotate over ~0.5 rad)
        const omegaFromAlpha = Math.sqrt(2 * alphaMax * 0.5); // rad/s
        const omegaMax = Math.min(this.config.limits.maxAngularVelocity, Math.max(0.2, omegaFromAlpha));
        return { alphaMax, omegaMax };
    }

    protected calculateControlSignal(errorQuaternion: THREE.Quaternion): number {
        const orientationError = 2 * Math.acos(Math.abs(Math.min(1, Math.max(-1, errorQuaternion.w))));
        const normalizedError = orientationError / Math.PI;
        return Math.min(normalizedError, 0.2);
    }

    protected quaternionToAngularVelocity(quaternion: THREE.Quaternion): THREE.Vector3 {
        let angle = 2 * Math.acos(quaternion.w);
        let sinHalfAngle = Math.sqrt(1 - quaternion.w * quaternion.w);
        const axis = new THREE.Vector3(quaternion.x, quaternion.y, quaternion.z);

        if (sinHalfAngle > 0.01) {
            axis.normalize().multiplyScalar(angle / sinHalfAngle);
        } else {
            axis.set(0, 0, 0);
        }

        if (angle > Math.PI) {
            angle = 2 * Math.PI - angle;
            axis.negate();
        }
        return axis;
    }
} 

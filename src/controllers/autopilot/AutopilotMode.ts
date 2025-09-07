import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
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
    protected pidController: PIDController;
    // Simple output smoothing to reduce flicker near zero
    protected lastRotCmd: THREE.Vector3 = new THREE.Vector3();
    protected lastLinCmd: THREE.Vector3 = new THREE.Vector3();
    protected rotSmoothAlpha: number = 0.75; // higher alpha => heavier smoothing
    protected linSmoothAlpha: number = 0.5;
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
        pidController: PIDController
    ) {
        this.spacecraft = spacecraft;
        this.config = config;
        this.thrusterGroups = thrusterGroups;
        this.thrust = thrust;
        this.pidController = pidController;
    }

    abstract calculateForces(dt: number): number[];

    protected applyPIDOutputToThrusters(pidOutput: THREE.Vector3): number[] {
        // Smooth rotational command
        const smoothed = this.lastRotCmd.clone().multiplyScalar(this.rotSmoothAlpha)
            .add(pidOutput.clone().multiplyScalar(1 - this.rotSmoothAlpha));
        this.lastRotCmd.copy(smoothed);

        const thrusterForces = Array(24).fill(0);
        const forceMultiplier = 5.0;

        // Slightly higher activation threshold to avoid chatter
        const epsilon = this.config.limits.epsilon * 2.0;

        const pitchForce = Math.abs(smoothed.x) * this.thrust * forceMultiplier;
        const yawForce = Math.abs(smoothed.y) * this.thrust * forceMultiplier;
        const rollForce = Math.abs(smoothed.z) * this.thrust * forceMultiplier;

        if (Math.abs(smoothed.x) > epsilon) {
            const pitchGroup = this.thrusterGroups.pitch[smoothed.x >= 0 ? 1 : 0];
            const forcePerThruster = pitchForce / pitchGroup.length;
            pitchGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        if (Math.abs(smoothed.y) > epsilon) {
            const yawGroup = this.thrusterGroups.yaw[smoothed.y >= 0 ? 0 : 1];
            const forcePerThruster = yawForce / yawGroup.length;
            yawGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        if (Math.abs(smoothed.z) > epsilon) {
            const rollGroup = this.thrusterGroups.roll[smoothed.z >= 0 ? 0 : 1];
            const forcePerThruster = rollForce / rollGroup.length;
            rollGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        return thrusterForces;
    }

    protected applyTranslationalForcesToThrusterGroups(localForce: THREE.Vector3): number[] {
        // Smooth translational command
        const smoothed = this.lastLinCmd.clone().multiplyScalar(this.linSmoothAlpha)
            .add(localForce.clone().multiplyScalar(1 - this.linSmoothAlpha));
        this.lastLinCmd.copy(smoothed);

        const forces = Array(24).fill(0);
        const axes = [
            { axis: 'z' as keyof THREE.Vector3, groups: this.thrusterGroups.forward, positive: true },
            { axis: 'y' as keyof THREE.Vector3, groups: this.thrusterGroups.up, positive: true },
            { axis: 'x' as keyof THREE.Vector3, groups: this.thrusterGroups.left, positive: false },
        ];

        const epsilon = this.config.limits.epsilon * 2.0;
        axes.forEach(({ axis, groups, positive }) => {
            const val = smoothed[axis] as number;
            if (Math.abs(val) > epsilon) {
                const thrusterGroup =
                    val * (positive ? 1 : -1) > 0 ? groups[0] : groups[1];
                const thrusterForce = Math.min(Math.abs(val) / 4, this.thrust);
                thrusterGroup.forEach((index: number) => {
                    forces[index] = thrusterForce;
                });
            }
        });
        return forces;
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
        const a = axis.clone().normalize();
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

        // Linear force/accel capability per principal axis
        const countZ = Math.max(
            this.thrusterGroups.forward?.[0]?.length || 0,
            this.thrusterGroups.forward?.[1]?.length || 0
        );
        const countY = Math.max(
            this.thrusterGroups.up?.[0]?.length || 0,
            this.thrusterGroups.up?.[1]?.length || 0
        );
        const countX = Math.max(
            this.thrusterGroups.left?.[0]?.length || 0,
            this.thrusterGroups.left?.[1]?.length || 0
        );
        const linForce = {
            x: countX * this.thrust,
            y: countY * this.thrust,
            z: countZ * this.thrust,
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
                const F = dir.clone().multiplyScalar(-this.thrust); // force is opposite to nozzle dir
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
        // Conservative scalar cap as min across axes
        const alphaDyn = Math.max(1e-4, Math.min(caps.angAccel.x, caps.angAccel.y, caps.angAccel.z));
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

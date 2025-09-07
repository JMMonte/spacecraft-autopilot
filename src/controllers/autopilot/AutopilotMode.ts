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
        const thrusterForces = Array(24).fill(0);
        const forceMultiplier = 5.0;

        const pitchForce = Math.abs(pidOutput.x) * this.thrust * forceMultiplier;
        const yawForce = Math.abs(pidOutput.y) * this.thrust * forceMultiplier;
        const rollForce = Math.abs(pidOutput.z) * this.thrust * forceMultiplier;

        if (Math.abs(pidOutput.x) > this.config.limits.epsilon) {
            const pitchGroup = this.thrusterGroups.pitch[pidOutput.x >= 0 ? 1 : 0];
            const forcePerThruster = pitchForce / pitchGroup.length;
            pitchGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        if (Math.abs(pidOutput.y) > this.config.limits.epsilon) {
            const yawGroup = this.thrusterGroups.yaw[pidOutput.y >= 0 ? 0 : 1];
            const forcePerThruster = yawForce / yawGroup.length;
            yawGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        if (Math.abs(pidOutput.z) > this.config.limits.epsilon) {
            const rollGroup = this.thrusterGroups.roll[pidOutput.z >= 0 ? 0 : 1];
            const forcePerThruster = rollForce / rollGroup.length;
            rollGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        return thrusterForces;
    }

    protected applyTranslationalForcesToThrusterGroups(localForce: THREE.Vector3): number[] {
        const forces = Array(24).fill(0);
        const axes = [
            { axis: 'z' as keyof THREE.Vector3, groups: this.thrusterGroups.forward, positive: true },
            { axis: 'y' as keyof THREE.Vector3, groups: this.thrusterGroups.up, positive: true },
            { axis: 'x' as keyof THREE.Vector3, groups: this.thrusterGroups.left, positive: false },
        ];

        axes.forEach(({ axis, groups, positive }) => {
            const val = localForce[axis] as number;
            if (Math.abs(val) > this.config.limits.epsilon) {
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

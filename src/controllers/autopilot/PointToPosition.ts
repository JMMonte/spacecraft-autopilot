import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

export class PointToPosition extends AutopilotMode {
    private targetPosition: THREE.Vector3;
    private angleDeadbandEngaged: boolean = false;
    private angleDeadbandOnFactor: number = 1.0;
    private angleDeadbandOffFactor: number = 1.5;
    private telemetry: {
        angleDeg: number;
        alphaMax: number;
        omegaMax: number;
        Ieff: number;
        wDesMag: number;
        LErr: number;
        deadband: boolean;
    } | null = null;

    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: any,
        thrust: number,
        pidController: PIDController,
        targetPosition: THREE.Vector3
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController);
        this.targetPosition = targetPosition;
    }

    setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition = position;
    }

    calculateForces(dt: number): number[] {
        const q = this.spacecraft.getWorldOrientation();
        const currentAngularVelocity = this.spacecraft.getWorldAngularVelocity();
        const qInv = q.clone().invert();

        // Compute world-space direction to target
        const currentPosition = this.spacecraft.getWorldPosition();
        const dirWorld = this.targetPosition.clone().sub(currentPosition);
        if (dirWorld.lengthSq() < 1e-12) {
            // Already at target position; no pointing needed
            return Array(24).fill(0);
        }
        dirWorld.normalize();

        // Convert target direction into the spacecraft's local frame
        const dirLocal = dirWorld.clone().applyQuaternion(qInv).normalize();

        // Local forward axis is +Z for this spacecraft
        const forwardLocal = new THREE.Vector3(0, 0, 1);

        // Error quaternion expressed in local frame: rotate forward to desired local direction
        const errorQuaternion = new THREE.Quaternion().setFromUnitVectors(forwardLocal, dirLocal);

        // Convert angular velocity to local space
        const localAngularVelocity = currentAngularVelocity.clone().applyQuaternion(qInv);

        // Compute minimal angle-axis from error quaternion in local frame
        const wClamped = Math.min(1, Math.max(-1, errorQuaternion.w));
        let angle = 2 * Math.acos(wClamped);
        let sinHalf = Math.sqrt(1 - wClamped * wClamped);
        const axis = sinHalf > 1e-6
            ? new THREE.Vector3(errorQuaternion.x, errorQuaternion.y, errorQuaternion.z).multiplyScalar(1 / sinHalf).normalize()
            : new THREE.Vector3(0, 0, 0);
        if (angle > Math.PI) { angle = 2 * Math.PI - angle; axis.negate(); }

        // Deadband with hysteresis
        const eps = this.config.limits.epsilon;
        if (this.angleDeadbandEngaged) {
            if (angle > eps * this.angleDeadbandOffFactor) this.angleDeadbandEngaged = false;
        } else {
            if (angle < eps * this.angleDeadbandOnFactor) this.angleDeadbandEngaged = true;
        }
        const withinDeadband = this.angleDeadbandEngaged;

        // Time-optimal (bang–bang) target angular speed along error axis
        // Dynamic angular capability estimate
        const dyn = this.getDynamicAngularAccelCap();
        const alphaMax = Math.max(1e-3, dyn.alphaMax);
        const omegaMax = Math.max(1e-3, dyn.omegaMax);
        const kW = 2.0; // rad/s per rad near-linear region
        const wDesMag = withinDeadband ? 0 : Math.min(omegaMax, Math.sqrt(2 * alphaMax * angle), kW * angle);

        // Work in angular momentum domain along the axis to create accelerate-then-brake profile
        const Ieff = this.getEffectiveInertiaAlongAxis(axis);
        const desiredL = axis.clone().multiplyScalar(Ieff * wDesMag);
        const wAlong = localAngularVelocity.dot(axis);
        const currentLAlong = axis.clone().multiplyScalar(Ieff * wAlong);
        let angularMomentumError = desiredL.sub(currentLAlong);
        // Clamp by configured max |L|
        const maxL = this.config.limits.maxAngularMomentum;
        if (angularMomentumError.length() > maxL) {
            angularMomentumError.multiplyScalar(maxL / angularMomentumError.length());
        }

        // angularMomentumError computed above

        // Update telemetry snapshot
        this.telemetry = {
            angleDeg: angle * 180 / Math.PI,
            alphaMax,
            omegaMax,
            Ieff,
            wDesMag,
            LErr: angularMomentumError.length(),
            deadband: withinDeadband,
        };

        // Apply PID control
        const pidVector = this.pidController.update(angularMomentumError, dt);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        return this.applyPIDOutputToThrusters(pidVector);
    }

    public getTelemetry() {
        return this.telemetry;
    }
}

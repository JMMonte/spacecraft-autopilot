import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';
import type { ThrusterGroups } from '../../config/spacecraftConfig';

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
        thrusterGroups: ThrusterGroups,
        thrust: number,
        pidController: PIDController,
        targetPosition: THREE.Vector3,
        thrusterMax?: number[]
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController, thrusterMax);
        this.targetPosition = targetPosition;
        // Crisper rotation when pointing to a position
        this.rotSmoothAlpha = 0.25;
    }

    setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition = position;
    }

    calculateForces(dt: number, out: number[] = Array(24).fill(0)): number[] {
        const q = this.spacecraft.getWorldOrientationRef();
        const currentAngularVelocity = this.spacecraft.getWorldAngularVelocityRef();
        const qInv = this.tmpQuatA.copy(q).invert();

        // Compute world-space direction to target
        const currentPosition = this.spacecraft.getWorldPositionRef();
        const dirWorld = this.tmpVecA.copy(this.targetPosition).sub(currentPosition);
        if (dirWorld.lengthSq() < 1e-12) {
            // Already at target position; no pointing needed
            return out.fill(0);
        }
        dirWorld.normalize();

        // Convert target direction into the spacecraft's local frame
        const dirLocal = dirWorld.applyQuaternion(qInv).normalize();

        // Local forward axis is +Z for this spacecraft
        const forwardLocal = this.tmpVecB.set(0, 0, 1);

        // Error quaternion expressed in local frame: rotate forward to desired local direction
        const errorQuaternion = this.tmpQuatB.setFromUnitVectors(forwardLocal, dirLocal);

        // Convert angular velocity to local space
        const localAngularVelocity = this.tmpVecC.copy(currentAngularVelocity).applyQuaternion(qInv);

        // Compute minimal angle-axis from error quaternion in local frame
        const wClamped = Math.min(1, Math.max(-1, errorQuaternion.w));
        let angle = 2 * Math.acos(wClamped);
        let sinHalf = Math.sqrt(1 - wClamped * wClamped);
        const axis = sinHalf > 1e-6
            ? this.tmpVecD.set(errorQuaternion.x, errorQuaternion.y, errorQuaternion.z).multiplyScalar(1 / sinHalf).normalize()
            : this.tmpVecD.set(0, 0, 0);
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
        const kW = 1.2; // rad/s per rad near-linear region (reduce overshoot)
        const wDesMag = withinDeadband ? 0 : Math.min(omegaMax, Math.sqrt(2 * alphaMax * angle), kW * angle);

        // Work in angular momentum domain along the axis to create accelerate-then-brake profile
        const Ieff = this.getEffectiveInertiaAlongAxis(axis);
        const desiredL = this.tmpVecE.copy(axis).multiplyScalar(Ieff * wDesMag);
        const wAlong = localAngularVelocity.dot(axis);
        const currentLAlong = this.tmpVecB.copy(axis).multiplyScalar(Ieff * wAlong);
        const angularMomentumError = desiredL.sub(currentLAlong);
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

        // Apply PID control (momentum-domain)
        const pidVector = this.pidController.update(angularMomentumError, dt);

        this.applyPIDOutputToThrustersInPlace(pidVector, out);
        return out;
    }

    public getTelemetry() {
        return this.telemetry;
    }
}

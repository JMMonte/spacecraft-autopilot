import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

export class OrientationMatchAutopilot extends AutopilotMode {
    private targetOrientation: THREE.Quaternion;
    private targetSpacecraft: Spacecraft | null;
    private reverseAlign: boolean;
    private angleDeadbandEngaged: boolean = false;
    private angleDeadbandOnFactor: number = 1.0;  // engage when < epsilon * onFactor
    private angleDeadbandOffFactor: number = 1.5; // disengage when > epsilon * offFactor
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
        targetOrientation?: THREE.Quaternion,
        targetSpacecraft?: Spacecraft,
        reverseAlign: boolean = false
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController);
        this.targetOrientation = targetOrientation || new THREE.Quaternion();
        this.targetSpacecraft = targetSpacecraft || null;
        this.reverseAlign = reverseAlign;
    }

    setTargetOrientation(orientation: THREE.Quaternion): void {
        this.targetOrientation = orientation;
    }

    setTargetSpacecraft(spacecraft: Spacecraft | null, reverseAlign?: boolean): void {
        this.targetSpacecraft = spacecraft;
        if (reverseAlign !== undefined) {
            this.reverseAlign = reverseAlign;
        }
    }

    setReverseAlign(reverse: boolean): void {
        this.reverseAlign = reverse;
    }

    calculateForces(dt: number): number[] {
        // Current orientation and angular velocity in world space
        const q = this.spacecraft.getWorldOrientation();
        const worldAngularVel = this.spacecraft.getWorldAngularVelocity();
        const qInv = q.clone().invert();

        // Update target orientation if following a target spacecraft
        if (this.targetSpacecraft) {
            this.targetOrientation = this.targetSpacecraft.getWorldOrientation();
            if (this.reverseAlign) {
                // Rotate 180 degrees around the Y axis for reverse alignment
                const reverseRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
                this.targetOrientation.multiply(reverseRotation);
            }
        }

        // Error quaternion expressed in the spacecraft's local frame
        // qErrorLocal = inverse(current) * target
        const errorQuaternion = qInv.clone().multiply(this.targetOrientation.clone());

        // Convert world angular velocity to local space
        const localAngularVel = worldAngularVel.clone().applyQuaternion(qInv);

        // Extract minimal angle-axis from error quaternion in local frame
        const wClamped = Math.min(1, Math.max(-1, errorQuaternion.w));
        let angle = 2 * Math.acos(wClamped);
        let sinHalf = Math.sqrt(1 - wClamped * wClamped);
        const axis = sinHalf > 1e-6
            ? new THREE.Vector3(errorQuaternion.x, errorQuaternion.y, errorQuaternion.z).multiplyScalar(1 / sinHalf).normalize()
            : new THREE.Vector3(0, 0, 0);
        if (angle > Math.PI) { angle = 2 * Math.PI - angle; axis.negate(); }

        // Deadband with hysteresis to avoid micro-chatter
        const eps = this.config.limits.epsilon;
        if (this.angleDeadbandEngaged) {
            if (angle > eps * this.angleDeadbandOffFactor) this.angleDeadbandEngaged = false;
        } else {
            if (angle < eps * this.angleDeadbandOnFactor) this.angleDeadbandEngaged = true;
        }
        const withinDeadband = this.angleDeadbandEngaged;

        // Time-optimal (bang–bang) style target angular speed profile along the error axis
        // Dynamic angular capability estimate
        const dyn = this.getDynamicAngularAccelCap();
        const alphaMax = Math.max(1e-3, dyn.alphaMax);
        const omegaMax = Math.max(1e-3, dyn.omegaMax);
        const kW = 2.0; // rad/s per rad near-linear region
        const wDesMag = withinDeadband ? 0 : Math.min(omegaMax, Math.sqrt(2 * alphaMax * angle), kW * angle);

        // Desired angular momentum only along the error axis
        const Ieff = this.getEffectiveInertiaAlongAxis(axis);
        const desiredL = axis.clone().multiplyScalar(Ieff * wDesMag);
        const wAlong = localAngularVel.dot(axis);
        const currentLAlong = axis.clone().multiplyScalar(Ieff * wAlong);
        let angularMomentumError = desiredL.sub(currentLAlong);
        // Clamp by configured max |L|
        const maxL = this.config.limits.maxAngularMomentum;
        if (angularMomentumError.length() > maxL) {
            angularMomentumError.multiplyScalar(maxL / angularMomentumError.length());
        }

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

        // Apply PID control in local space
        const pidVector = this.pidController.update(angularMomentumError, dt);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        // Apply directly to thrusters since we're already in local space
        return this.applyPIDOutputToThrusters(pidVector);
    }

    public getTelemetry() {
        return this.telemetry;
    }
}

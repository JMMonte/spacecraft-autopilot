import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

export class OrientationMatchAutopilot extends AutopilotMode {
    private targetOrientation: THREE.Quaternion;
    private targetSpacecraft: Spacecraft | null;
    private reverseAlign: boolean;
    private readonly reverse180Y: THREE.Quaternion;
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
        reverseAlign: boolean = false,
        thrusterMax?: number[]
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController, thrusterMax);
        this.targetOrientation = targetOrientation || new THREE.Quaternion();
        this.targetSpacecraft = targetSpacecraft || null;
        this.reverseAlign = reverseAlign;
        // Precompute a 180° rotation about world Y for reverse docking alignment
        this.reverse180Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        // Crisper rotation for attitude tracking
        this.rotSmoothAlpha = 0.25;
    }

    setTargetOrientation(orientation: THREE.Quaternion): void {
        // Store a normalized copy to ensure stable angle/axis extraction later
        this.targetOrientation.copy(orientation).normalize();
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

    calculateForces(dt: number, out: number[] = Array(24).fill(0)): number[] {
        // Current orientation and angular velocity in world space
        const q = this.spacecraft.getWorldOrientationRef();
        const worldAngularVel = this.spacecraft.getWorldAngularVelocityRef();
        const qInv = this.tmpQuatA.copy(q).invert();

        // Resolve target orientation without mutating stored state
        // If following a target, use its current world orientation (optionally reversed)
        // Otherwise, use the last set targetOrientation.
        const targetQ = this.targetSpacecraft
            ? this.tmpQuatB.copy(this.targetSpacecraft.getWorldOrientation())
            : this.tmpQuatB.copy(this.targetOrientation);
        if (this.targetSpacecraft && this.reverseAlign) {
            targetQ.multiply(this.reverse180Y);
        }

        // Convert world angular velocity to local space (use qInv before mutating any scratch)
        const localAngularVel = this.tmpVecA.copy(worldAngularVel).applyQuaternion(qInv);

        // Error quaternion expressed in the spacecraft's local frame
        // qErrorLocal = inverse(current) * target (write into tmpQuatB; we no longer need targetQ)
        const errorQuaternion = this.tmpQuatB.multiplyQuaternions(qInv, targetQ);

        // Shortest-arc: flip sign if needed so w >= 0
        if (errorQuaternion.w < 0) {
            errorQuaternion.set(
                -errorQuaternion.x,
                -errorQuaternion.y,
                -errorQuaternion.z,
                -errorQuaternion.w
            );
        }
        // Robust axis-angle from quaternion
        const wClamped = Math.min(1, Math.max(-1, errorQuaternion.w));
        let angle = 2 * Math.acos(wClamped);
        let sinHalf = Math.sqrt(Math.max(0, 1 - wClamped * wClamped));
        const axis = sinHalf > 1e-6
            ? this.tmpVecB.set(errorQuaternion.x / sinHalf, errorQuaternion.y / sinHalf, errorQuaternion.z / sinHalf).normalize()
            : this.tmpVecB.set(1, 0, 0); // arbitrary axis when angle ~ 0

        // Deadband with hysteresis on angle
        const eps = this.config.limits.epsilon;
        if (this.angleDeadbandEngaged) {
            if (angle > eps * this.angleDeadbandOffFactor) this.angleDeadbandEngaged = false;
        } else {
            if (angle < eps * this.angleDeadbandOnFactor) this.angleDeadbandEngaged = true;
        }
        const withinDeadband = this.angleDeadbandEngaged;

        // Axis-aware time-optimal profile per principal axis
        // Project angle along body axes
        const ax = axis.x * angle;
        const ay = axis.y * angle;
        const az = axis.z * angle;
        const I = this.calculateMomentOfInertiaByAxis();
        const caps = this.getDynamicCaps();
        const alphaX = Math.max(1e-6, caps.angTorque.x) / Math.max(1e-6, I.x);
        const alphaY = Math.max(1e-6, caps.angTorque.y) / Math.max(1e-6, I.y);
        const alphaZ = Math.max(1e-6, caps.angTorque.z) / Math.max(1e-6, I.z);
        const omegaCap = Math.max(0.2, Math.min(this.config.limits.maxAngularVelocity, this.getDynamicAngularAccelCap().omegaMax));
        const kW = 1.6; // rad/s per rad

        const stopWX = Math.sqrt(2 * Math.max(1e-6, alphaX) * Math.abs(ax));
        const stopWY = Math.sqrt(2 * Math.max(1e-6, alphaY) * Math.abs(ay));
        const stopWZ = Math.sqrt(2 * Math.max(1e-6, alphaZ) * Math.abs(az));

        const wDesX = Math.sign(ax) * Math.min(omegaCap, stopWX, kW * Math.abs(ax));
        const wDesY = Math.sign(ay) * Math.min(omegaCap, stopWY, kW * Math.abs(ay));
        const wDesZ = Math.sign(az) * Math.min(omegaCap, stopWZ, kW * Math.abs(az));

        // L_err = I*(w_des - w_current)
        const Lx = I.x * (wDesX - localAngularVel.x);
        const Ly = I.y * (wDesY - localAngularVel.y);
        const Lz = I.z * (wDesZ - localAngularVel.z);
        const angularMomentumError = this.tmpVecC.set(Lx, Ly, Lz);
        if (withinDeadband) angularMomentumError.set(0, 0, 0);
        // Clamp by configured max |L|
        const LcapX = I.x * omegaCap;
        const LcapY = I.y * omegaCap;
        const LcapZ = I.z * omegaCap;
        angularMomentumError.set(
            Math.max(-LcapX, Math.min(LcapX, angularMomentumError.x)),
            Math.max(-LcapY, Math.min(LcapY, angularMomentumError.y)),
            Math.max(-LcapZ, Math.min(LcapZ, angularMomentumError.z))
        );

        // Update telemetry snapshot
        this.telemetry = {
            angleDeg: angle * 180 / Math.PI,
            alphaMax: Math.min(alphaX, alphaY, alphaZ),
            omegaMax: omegaCap,
            Ieff: this.getEffectiveInertiaAlongAxis(axis),
            wDesMag: Math.sqrt(wDesX*wDesX + wDesY*wDesY + wDesZ*wDesZ),
            LErr: angularMomentumError.length(),
            deadband: withinDeadband,
        };

        // Apply PID control in local space (momentum-domain)
        const pidVector = this.pidController.update(angularMomentumError, dt);

        // Apply directly to thrusters since we're already in local space
        this.applyPIDOutputToThrustersInPlace(pidVector, out);
        return out;
    }

    public getTelemetry() {
        return this.telemetry;
    }
}

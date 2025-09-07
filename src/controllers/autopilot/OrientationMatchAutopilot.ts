import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

export class OrientationMatchAutopilot extends AutopilotMode {
    private targetOrientation: THREE.Quaternion;
    private targetSpacecraft: Spacecraft | null;
    private reverseAlign: boolean;

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

        // Calculate control signal based on orientation error
        const controlSignal = this.calculateControlSignal(errorQuaternion);
        const desiredAngVel = this.quaternionToAngularVelocity(errorQuaternion);
        desiredAngVel.multiplyScalar(controlSignal);

        // Calculate angular momentum error (approx using scalar inertia)
        const momentOfInertia = this.calculateMomentOfInertia();
        const desiredAngularMomentum = desiredAngVel.multiplyScalar(momentOfInertia);
        const angularMomentumError = desiredAngularMomentum.sub(localAngularVel);

        // Apply PID control in local space
        const pidVector = this.pidController.update(angularMomentumError, dt);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        // Apply directly to thrusters since we're already in local space
        return this.applyPIDOutputToThrusters(pidVector);
    }
}

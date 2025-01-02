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
        const body = this.spacecraft.objects.boxBody;
        const currentQuaternion = body.quaternion;
        const currentAngularMomentum = body.angularVelocity;

        // Update target orientation if following a target spacecraft
        if (this.targetSpacecraft) {
            const targetQuat = this.targetSpacecraft.objects.boxBody.quaternion;
            this.targetOrientation = this.toThreeQuaternion(targetQuat);
            
            if (this.reverseAlign) {
                // Rotate 180 degrees around the Y axis for reverse alignment
                const reverseRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
                this.targetOrientation.multiply(reverseRotation);
            }
        }

        // Calculate error quaternion in global space
        const targetQuat = this.toCannonQuaternion(this.targetOrientation);
        const errorQuaternion = currentQuaternion.inverse().mult(targetQuat);

        // Convert to local space
        const localAngularMomentum = currentQuaternion.inverse().vmult(currentAngularMomentum);

        // Calculate orientation error axis and angle
        const threeErrorQuat = this.toThreeQuaternion(errorQuaternion);
        const angle = 2 * Math.acos(Math.abs(threeErrorQuat.w));
        const axis = new THREE.Vector3(threeErrorQuat.x, threeErrorQuat.y, threeErrorQuat.z);
        if (axis.lengthSq() > 0.001) {
            axis.normalize();
            axis.multiplyScalar(angle);
        }

        // Calculate desired angular momentum change
        const dampingFactor = this.config.damping.factor;
        const angularMomentumError = this.toCannonVec(axis).vsub(localAngularMomentum.scale(dampingFactor));

        // Apply PID control in local space
        const pidOut = this.pidController.update(
            angularMomentumError,
            dt
        );
        const pidVector = this.toThreeVector(pidOut);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        // Apply directly to thrusters since we're already in local space
        return this.applyPIDOutputToThrusters(pidVector);
    }
} 
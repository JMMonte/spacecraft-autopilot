import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

export class CancelAndAlign extends AutopilotMode {
    private targetOrientation: THREE.Quaternion;

    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: any,
        thrust: number,
        pidController: PIDController,
        targetOrientation: THREE.Quaternion
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController);
        this.targetOrientation = targetOrientation;
    }

    setTargetOrientation(orientation: THREE.Quaternion): void {
        this.targetOrientation = orientation;
    }

    calculateForces(dt: number): number[] {
        const body = this.spacecraft.objects.boxBody;
        const currentQuaternion = body.quaternion;
        const currentAngularMomentum = body.angularVelocity;

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
            dt,
            localAngularMomentum
        );
        const pidVector = this.toThreeVector(pidOut);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        // Apply directly to thrusters since we're already in local space
        return this.applyPIDOutputToThrusters(pidVector);
    }
} 
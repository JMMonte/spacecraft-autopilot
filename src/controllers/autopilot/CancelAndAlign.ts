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
        console.log('Local angular momentum:', localAngularMomentum.length());

        // Calculate control signal based on orientation error
        const threeErrorQuat = this.toThreeQuaternion(errorQuaternion);
        const controlSignal = this.calculateControlSignal(threeErrorQuat);
        const desiredAngVel = this.quaternionToAngularVelocity(threeErrorQuat);
        desiredAngVel.multiplyScalar(controlSignal);

        // Calculate angular momentum error
        const momentOfInertia = this.calculateMomentOfInertia();
        const desiredAngularMomentum = desiredAngVel.multiplyScalar(momentOfInertia);
        const angularMomentumError = this.toCannonVec(desiredAngularMomentum).vsub(localAngularMomentum);

        // Apply PID control
        const pidOut = this.pidController.update(
            angularMomentumError,
            dt,
            localAngularMomentum
        );
        const pidVector = this.toThreeVector(pidOut);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        return this.applyPIDOutputToThrusters(pidVector);
    }
} 
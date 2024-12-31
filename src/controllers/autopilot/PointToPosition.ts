import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class PointToPosition extends AutopilotMode {
    private targetPosition: THREE.Vector3;

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
        const body = this.spacecraft.objects.boxBody;
        const currentQuaternion = body.quaternion;
        const currentAngularMomentum = body.angularVelocity;

        // Calculate desired orientation
        const targetVec = this.toCannonVec(this.targetPosition);
        const currentPosition = body.position.clone();
        const direction = targetVec.vsub(currentPosition);
        direction.normalize();

        // Create quaternion that points spacecraft's forward direction at target
        const forward = new CANNON.Vec3(1, 0, 0); // Forward is along x-axis
        const errorQuaternion = new CANNON.Quaternion();
        errorQuaternion.setFromVectors(forward, direction);

        // Convert to local space
        const localAngularMomentum = currentQuaternion.inverse().vmult(currentAngularMomentum);

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
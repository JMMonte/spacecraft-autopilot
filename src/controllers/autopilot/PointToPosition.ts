import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

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

        // Calculate control signal based on orientation error
        const controlSignal = this.calculateControlSignal(errorQuaternion);
        const desiredAngVel = this.quaternionToAngularVelocity(errorQuaternion);
        desiredAngVel.multiplyScalar(controlSignal);

        // Calculate angular momentum error
        const momentOfInertia = this.calculateMomentOfInertia();
        const desiredAngularMomentum = desiredAngVel.multiplyScalar(momentOfInertia);
        const angularMomentumError = desiredAngularMomentum.sub(localAngularVelocity);

        // Apply PID control
        const pidVector = this.pidController.update(angularMomentumError, dt);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        return this.applyPIDOutputToThrusters(pidVector);
    }
}

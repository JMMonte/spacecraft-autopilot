import { AutopilotMode } from './AutopilotMode';

export class CancelRotation extends AutopilotMode {
    calculateForces(dt: number): number[] {
        const q = this.spacecraft.getWorldOrientation();
        const qInv = q.clone().invert();
        const worldAngularVel = this.spacecraft.getWorldAngularVelocity();

        // Convert global angular velocity to local space
        const localAngularVel = worldAngularVel.clone().applyQuaternion(qInv);

        // Calculate error in local space (drive to zero)
        const dampingFactor = 10.0;
        const angularVelError = localAngularVel.clone().multiplyScalar(-dampingFactor);

        // PID controller works in local space
        const pidVector = this.pidController.update(angularVelError, dt);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        // Apply directly to thrusters since we're already in local space
        return this.applyPIDOutputToThrusters(pidVector);
    }
} 

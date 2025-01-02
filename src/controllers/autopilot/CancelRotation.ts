import { AutopilotMode } from './AutopilotMode';

export class CancelRotation extends AutopilotMode {
    calculateForces(dt: number): number[] {
        const body = this.spacecraft.objects.boxBody;
        const currentQuaternion = body.quaternion;
        const currentAngularMomentum = body.angularVelocity;

        // Convert global angular momentum to local space
        const localAngularMomentum = currentQuaternion.inverse().vmult(currentAngularMomentum);

        // Calculate error in local space
        const dampingFactor = 10.0;
        const angularMomentumError = localAngularMomentum.clone().negate().scale(dampingFactor);

        // PID controller works in local space
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
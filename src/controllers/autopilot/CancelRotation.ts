import { AutopilotMode } from './AutopilotMode';

export class CancelRotation extends AutopilotMode {
    calculateForces(dt: number, out: number[] = Array(24).fill(0)): number[] {
        const q = this.spacecraft.getWorldOrientationRef();
        const qInv = this.tmpQuatA.copy(q).invert();
        const worldAngularVel = this.spacecraft.getWorldAngularVelocityRef();

        // Convert global angular velocity to local space (no allocations)
        const localAngularVel = this.tmpVecA.copy(worldAngularVel).applyQuaternion(qInv);

        // Work in angular momentum domain; target L = 0 (use axis-specific inertias)
        const Iax = this.calculateMomentOfInertiaByAxis();
        const currentL = this.tmpVecB.set(
            localAngularVel.x * Iax.x,
            localAngularVel.y * Iax.y,
            localAngularVel.z * Iax.z
        );
        // Limit corrective momentum to configured maximum
        const maxL = this.config.limits.maxAngularMomentum;
        const momentumError = currentL.multiplyScalar(-1);
        if (momentumError.length() > maxL) {
            momentumError.multiplyScalar(maxL / momentumError.length());
        }

        // PID controller works in local space using momentum error
        const pidVector = this.pidController.update(momentumError, dt);

        // Apply directly to thrusters since we're already in local space (accumulate)
        this.applyPIDOutputToThrustersInPlace(pidVector, out);
        return out;
    }
}

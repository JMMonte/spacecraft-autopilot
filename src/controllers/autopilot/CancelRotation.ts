import { AutopilotMode } from './AutopilotMode';
import * as THREE from 'three';

export class CancelRotation extends AutopilotMode {
    calculateForces(dt: number): number[] {
        const q = this.spacecraft.getWorldOrientation();
        const qInv = q.clone().invert();
        const worldAngularVel = this.spacecraft.getWorldAngularVelocity();

        // Convert global angular velocity to local space
        const localAngularVel = worldAngularVel.clone().applyQuaternion(qInv);

        // Work in angular momentum domain; target L = 0 (use axis-specific inertias)
        const Iax = this.calculateMomentOfInertiaByAxis();
        const currentL = new THREE.Vector3(
            localAngularVel.x * Iax.x,
            localAngularVel.y * Iax.y,
            localAngularVel.z * Iax.z
        );
        // Limit corrective momentum to configured maximum
        const maxL = this.config.limits.maxAngularMomentum;
        let momentumError = currentL.clone().multiplyScalar(-1);
        if (momentumError.length() > maxL) {
            momentumError.multiplyScalar(maxL / momentumError.length());
        }

        // PID controller works in local space using momentum error
        const pidVector = this.pidController.update(momentumError, dt);

        // Apply additional scaling to overcome inertia
        const inertiaCompensation = 5.0;
        pidVector.multiplyScalar(inertiaCompensation);

        // Apply directly to thrusters since we're already in local space
        return this.applyPIDOutputToThrusters(pidVector);
    }
}

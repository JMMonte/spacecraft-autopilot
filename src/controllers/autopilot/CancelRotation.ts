import { AutopilotMode } from './AutopilotMode';

export class CancelRotation extends AutopilotMode {
    constructor(
        spacecraft: any,
        config: any,
        thrusterGroups: any,
        thrust: number,
        pidController: any,
        thrusterMax?: number[]
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController, thrusterMax);
        // Make rotation response snappier for momentum nulling
        this.rotSmoothAlpha = 0.25;
    }
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
        let pidVector = this.pidController.update(momentumError, dt);

        // Light near-zero taper to avoid chatter but keep authority
        const Lmag = momentumError.length();
        const Lcap = Math.max(1e-6, this.config.limits.maxAngularMomentum);
        const fadeUpAt = 0.05 * Lcap; // reach full authority by 5% of cap
        const scale = Lmag >= fadeUpAt ? 1 : Math.sqrt(Math.max(0, Lmag / fadeUpAt));
        pidVector.multiplyScalar(scale);

        // Allocate using the shared rotational allocator (respects caps and latch behavior)
        this.applyPIDOutputToThrustersInPlace(pidVector, out);
        return out;
    }
}

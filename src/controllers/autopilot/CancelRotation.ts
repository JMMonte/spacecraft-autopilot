import { AutopilotMode } from './AutopilotMode';
import type { AutopilotConfig } from './types';
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';

export class CancelRotation extends AutopilotMode {
    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: ThrusterGroups,
        thrust: number,
        pidController: PIDController,
        thrusterMax?: number[]
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController, thrusterMax);
        // Disable smoothing for cancel rotation - we want instant response
        this.rotSmoothAlpha = 0.0; // No smoothing!
    }
    calculateForces(dt: number, out: number[] = Array(24).fill(0)): number[] {
        const q = this.spacecraft.getWorldOrientationRef();
        const qInv = this.tmpQuatA.copy(q).invert();
        const worldAngularVel = this.spacecraft.getWorldAngularVelocityRef();

        // Dynamic deadband: minimum angular velocity achievable in one physics frame
        // based on actual torque capability and inertia.
        const dyn = this.getDynamicAngularAccelCap();
        const omegaDeadband = Math.max(0.0005, dyn.alphaMax * (1 / 60) * 2);
        if (worldAngularVel.lengthSq() < omegaDeadband * omegaDeadband) {
            return out;
        }

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

        // Allocate using the shared rotational allocator (respects caps and latch behavior)
        this.applyPIDOutputToThrustersInPlace(pidVector, out);
        return out;
    }
}

import { AutopilotMode } from './AutopilotMode';
import type { AutopilotConfig } from './types';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import type { ThrusterGroups } from '../../config/spacecraftConfig';

export class CancelLinearMotion extends AutopilotMode {
    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: ThrusterGroups,
        thrust: number,
        momentumPidController: PIDController,
        thrusterMax?: number[]
    ) {
        super(spacecraft, config, thrusterGroups, thrust, momentumPidController, thrusterMax);
    }

    calculateForces(dt: number, out: number[] = Array(24).fill(0)): number[] {
        const q = this.spacecraft.getWorldOrientationRef();
        const currentVelocity = this.spacecraft.getWorldVelocityRef();
        // Relative to reference (if provided)
        const refVel = this.referenceVelocityWorld || this.tmpVecC.set(0, 0, 0);
        const relVelocity = this.tmpVecA.copy(currentVelocity).sub(refVel);

        // Dynamic deadband: minimum delta-v achievable in one physics frame
        // based on actual thruster capability and mass.
        const caps = this.getDynamicCaps();
        const minAccel = Math.min(caps.linAccel.x, caps.linAccel.y, caps.linAccel.z);
        const velocityDeadband = Math.max(0.002, minAccel * (1 / 60) * 2);
        if (relVelocity.lengthSq() < velocityDeadband * velocityDeadband) {
            return out;
        }

        const qInv = this.tmpQuatA.copy(q).invert();

        // Convert global velocity to local space
        const localVelocity = relVelocity.applyQuaternion(qInv);

        // Calculate error in local space (we want zero velocity)
        const dampingFactor = this.config.damping.factor;
        const velocityError = localVelocity.multiplyScalar(-dampingFactor);

        // PID controller works in local space
        const pidOut = this.pidController.update(velocityError, dt);

        // Calculate force in local space (F = ma)
        const mass = this.spacecraft.getMass();
        const localForce = this.tmpVecB.set(pidOut.x * mass, pidOut.y * mass, pidOut.z * mass);

        // Limit by configured max force and by momentum budget per step (|F|*dt <= maxLinearMomentum)
        const maxByForce = this.config.limits.maxForce;
        const maxByMomentum = this.config.limits.maxLinearMomentum / Math.max(dt, 1e-3);
        const maxAllowable = Math.min(maxByForce, maxByMomentum);
        if (localForce.length() > maxAllowable) {
            localForce.multiplyScalar(maxAllowable / localForce.length());
        }

        // Apply translational forces to thruster groups (accumulate)
        this.applyTranslationalForcesToThrusterGroupsInPlace(localForce, out);
        return out;
    }
} 

import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as CANNON from 'cannon-es';

export class CancelLinearMotion extends AutopilotMode {
    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: any,
        thrust: number,
        momentumPidController: PIDController
    ) {
        super(spacecraft, config, thrusterGroups, thrust, momentumPidController);
    }

    calculateForces(dt: number): number[] {
        const body = this.spacecraft.objects.boxBody;
        const currentQuaternion = body.quaternion;
        const currentVelocity = body.velocity;

        // Convert global velocity to local space
        const localVelocity = currentQuaternion.inverse().vmult(currentVelocity);

        // Calculate error in local space (we want zero velocity)
        const dampingFactor = this.config.damping.factor;
        const velocityError = localVelocity.clone().negate().scale(dampingFactor);

        // PID controller works in local space
        const pidOut = this.pidController.update(
            velocityError,
            dt
        );

        // Calculate force in local space (F = ma)
        const localForce = new CANNON.Vec3(
            pidOut.x * body.mass,
            pidOut.y * body.mass,
            pidOut.z * body.mass
        );

        // Limit maximum force
        if (localForce.length() > this.config.limits.maxForce) {
            localForce.scale(this.config.limits.maxForce / localForce.length());
        }

        // Apply translational forces to thruster groups
        return this.applyTranslationalForcesToThrusterGroups(localForce);
    }
} 
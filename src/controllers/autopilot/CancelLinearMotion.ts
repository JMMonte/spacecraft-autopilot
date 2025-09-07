import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

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
        const q = this.spacecraft.getWorldOrientation();
        const currentVelocity = this.spacecraft.getWorldVelocity();
        const qInv = q.clone().invert();

        // Convert global velocity to local space
        const localVelocity = currentVelocity.clone().applyQuaternion(qInv);

        // Calculate error in local space (we want zero velocity)
        const dampingFactor = this.config.damping.factor;
        const velocityError = localVelocity.clone().multiplyScalar(-dampingFactor);

        // PID controller works in local space
        const pidOut = this.pidController.update(velocityError, dt);

        // Calculate force in local space (F = ma)
        const mass = this.spacecraft.getMass();
        const localForce = new THREE.Vector3(pidOut.x * mass, pidOut.y * mass, pidOut.z * mass);

        // Limit maximum force
        if (localForce.length() > this.config.limits.maxForce) {
            localForce.multiplyScalar(this.config.limits.maxForce / localForce.length());
        }

        // Apply translational forces to thruster groups
        return this.applyTranslationalForcesToThrusterGroups(localForce);
    }
} 

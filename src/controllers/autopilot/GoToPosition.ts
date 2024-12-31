import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class GoToPosition extends AutopilotMode {
    private targetPosition: THREE.Vector3;
    private threshold: number = 0.2; // Default threshold
    private isApproachPhase: boolean = false;

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

    setThreshold(threshold: number): void {
        this.threshold = threshold;
        // Use more aggressive PID gains during approach phase (threshold > 0.5m)
        this.isApproachPhase = threshold > 0.5;
        if (this.isApproachPhase) {
            this.pidController.setGain('Kp', 0.3);  // More aggressive proportional gain
            this.pidController.setGain('Ki', 0.002); // Slightly more integral gain
            this.pidController.setGain('Kd', 1.0);  // More derivative gain for better damping
        } else {
            // Reset to default gentle gains for precise positioning
            this.pidController.setGain('Kp', 0.1);
            this.pidController.setGain('Ki', 0.001);
            this.pidController.setGain('Kd', 0.5);
        }
    }

    getThreshold(): number {
        return this.threshold;
    }

    calculateForces(dt: number): number[] {
        const body = this.spacecraft.objects.boxBody;
        const currentPosition = body.position;
        const currentVelocity = body.velocity;

        // Calculate position error in world space
        const targetVec = this.toCannonVec(this.targetPosition);
        const positionError = targetVec.vsub(currentPosition);

        // Convert to local space
        const localPositionError = body.quaternion.inverse().vmult(positionError);
        
        // Apply PID control
        const pidOut = this.pidController.update(localPositionError, dt, currentVelocity);

        // Calculate force in local space
        const localForce = new CANNON.Vec3(
            pidOut.x * body.mass,
            pidOut.y * body.mass,
            pidOut.z * body.mass
        );

        // Apply damping to current velocity
        const localVelocity = body.quaternion.inverse().vmult(currentVelocity);
        const dampingForce = localVelocity.scale(-this.config.damping.factor * body.mass);
        localForce.vadd(dampingForce, localForce);

        // Limit maximum force
        if (localForce.length() > this.config.limits.maxForce) {
            localForce.scale(this.config.limits.maxForce / localForce.length());
        }

        return this.applyTranslationalForcesToThrusterGroups(localForce);
    }
} 
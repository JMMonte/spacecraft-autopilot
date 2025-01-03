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

        // Convert position error to local space for PID control
        const localPositionError = body.quaternion.inverse().vmult(positionError);

        // Convert velocity to local space for damping
        const localVelocity = body.quaternion.inverse().vmult(currentVelocity);

        // Apply PID control in local space
        const pidOut = this.pidController.update(localPositionError.scale(this.config.damping.factor), dt);

        // Calculate force in local space
        const localForce = new CANNON.Vec3(
            pidOut.x * body.mass,
            pidOut.y * body.mass,
            pidOut.z * body.mass
        );

        // Apply damping to local velocity
        const dampingForce = localVelocity.scale(-this.config.damping.factor * body.mass);
        localForce.vadd(dampingForce, localForce);

        // Limit maximum force
        if (localForce.length() > this.config.limits.maxForce) {
            localForce.scale(this.config.limits.maxForce / localForce.length());
        }

        return this.applyTranslationalForcesToThrusterGroups(localForce);
    }

    protected applyTranslationalForcesToThrusterGroups(localForce: CANNON.Vec3): number[] {
        const thrusterForces = Array(24).fill(0);
        const forceMultiplier = 1.0;

        // Forward/Back translation (Z-axis)
        // Positive Z means we need back thrusters (index 1)
        if (Math.abs(localForce.z) > this.config.limits.epsilon) {
            const zGroup = this.thrusterGroups.forward[localForce.z >= 0 ? 0 : 1];
            const forcePerThruster = Math.min(Math.abs(localForce.z), this.thrust) * forceMultiplier / zGroup.length;
            zGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        // Up/Down translation (Y-axis)
        // Positive Y means we need up thrusters (index 0)
        if (Math.abs(localForce.y) > this.config.limits.epsilon) {
            const yGroup = this.thrusterGroups.up[localForce.y >= 0 ? 0 : 1];
            const forcePerThruster = Math.min(Math.abs(localForce.y), this.thrust) * forceMultiplier / yGroup.length;
            yGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        // Left/Right translation (X-axis)
        // Positive X means we need right thrusters (index 1)
        if (Math.abs(localForce.x) > this.config.limits.epsilon) {
            const xGroup = this.thrusterGroups.left[localForce.x >= 0 ? 1 : 0];
            const forcePerThruster = Math.min(Math.abs(localForce.x), this.thrust) * forceMultiplier / xGroup.length;
            xGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        return thrusterForces;
    }
} 
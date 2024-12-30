import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as CANNON from 'cannon-es';

export class CancelLinearMotion extends AutopilotMode {
    private referenceVelocity: CANNON.Vec3;

    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: any,
        thrust: number,
        pidController: PIDController
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController);
        // Default to global reference frame (zero velocity)
        this.referenceVelocity = new CANNON.Vec3(0, 0, 0);
    }

    public setReferenceFrame(velocity: CANNON.Vec3) {
        this.referenceVelocity = velocity.clone();
    }

    public calculateForces(dt: number): number[] {
        // Get current velocity in world space
        const worldVelocity = this.spacecraft.objects.boxBody.velocity;

        // Calculate relative velocity (subtract reference velocity)
        const relativeVelocity = new CANNON.Vec3(
            worldVelocity.x - this.referenceVelocity.x,
            worldVelocity.y - this.referenceVelocity.y,
            worldVelocity.z - this.referenceVelocity.z
        );

        // Convert relative velocity to local space using spacecraft's orientation
        const localVelocity = this.spacecraft.objects.boxBody.quaternion.inverse().vmult(relativeVelocity, new CANNON.Vec3());

        // Calculate error (desired relative velocity is zero)
        const velocityError = new CANNON.Vec3(
            -localVelocity.x,
            -localVelocity.y,
            -localVelocity.z
        );

        // Calculate PID output (force per unit mass)
        const pidOutput = this.pidController.update(velocityError, dt);

        // Scale by mass to get actual force
        const force = new CANNON.Vec3(
            pidOutput.x * this.spacecraft.objects.boxBody.mass,
            pidOutput.y * this.spacecraft.objects.boxBody.mass,
            pidOutput.z * this.spacecraft.objects.boxBody.mass
        );

        // Map forces to thrusters
        const forces = Array(24).fill(0);
        const axes = [
            { axis: 'z' as keyof CANNON.Vec3, groups: this.thrusterGroups.forward, positive: true },
            { axis: 'y' as keyof CANNON.Vec3, groups: this.thrusterGroups.up, positive: true },
            { axis: 'x' as keyof CANNON.Vec3, groups: this.thrusterGroups.left, positive: false }
        ];

        axes.forEach(({ axis, groups, positive }) => {
            const val = force[axis] as number;
            if (Math.abs(val) > 0.001) { // Small epsilon to avoid numerical noise
                const thrusterGroup = val * (positive ? 1 : -1) > 0 ? groups[0] : groups[1];
                const thrusterForce = Math.min(Math.abs(val) / 4, this.thrust);
                thrusterGroup.forEach((index: number) => {
                    forces[index] = thrusterForce;
                });
            }
        });

        return forces;
    }
} 
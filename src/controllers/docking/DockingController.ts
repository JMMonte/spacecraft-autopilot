import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Spacecraft } from '../../core/spacecraft';
import { Trajectory } from '../trajectory';
import { TrajectoryVisualizer } from '../visualization/TrajectoryVisualizer';
import { TrajectoryPlanner } from '../trajectory/TrajectoryPlanner';

type DockingPortId = 'front' | 'back';
type DockingPhase = 'idle' | 'approach' | 'precise_position' | 'stop_and_align' | 'final' | 'docked';

export class DockingController {
    private spacecraft: Spacecraft;
    private currentWaypointIndex: number = 0;
    public targetSpacecraft: Spacecraft | null = null;
    public ourPortId: DockingPortId | null = null;
    public targetPortId: DockingPortId | null = null;
    private trajectory: Trajectory | null = null;
    private phase: DockingPhase = 'idle';
    private trajectoryVisualizer: TrajectoryVisualizer;

    constructor(spacecraft: Spacecraft) {
        if (!spacecraft) {
            throw new Error('Spacecraft is required for DockingController');
        }
        this.spacecraft = spacecraft;
        
        // Get the scene from the spacecraft
        const scene = this.spacecraft.objects.box.parent;
        if (!scene || !(scene instanceof THREE.Scene)) {
            throw new Error('No scene available for trajectory visualization');
        }
        this.trajectoryVisualizer = new TrajectoryVisualizer(scene);
    }

    public getDockingPhase(): DockingPhase {
        return this.phase;
    }

    public startDocking(targetSpacecraft: Spacecraft, ourPortId: DockingPortId, targetPortId: DockingPortId): boolean {
        if (this.isDocking()) {
            this.cancelDocking();
        }

        // Validate ports
        if (!this.spacecraft.isDockingPortAvailable(ourPortId) || 
            !targetSpacecraft.isDockingPortAvailable(targetPortId)) {
            console.warn('One or both docking ports are not available:', {
                ourPort: this.spacecraft.isDockingPortAvailable(ourPortId),
                targetPort: targetSpacecraft.isDockingPortAvailable(targetPortId)
            });
            return false;
        }

        // First, cancel any existing rotation
        const autopilot = this.spacecraft.spacecraftController?.autopilot;
        if (autopilot) {
            autopilot.resetAllModes();
            autopilot.setMode('cancelRotation', true);
            autopilot.setMode('cancelLinearMotion', true);
            
            // Wait for motion to be cancelled before proceeding
            setTimeout(() => {
                this.targetSpacecraft = targetSpacecraft;
                this.ourPortId = ourPortId;
                this.targetPortId = targetPortId;
                
                // Always start with approach phase
                this.phase = 'approach';
                this.currentWaypointIndex = 0;

                // Initial trajectory planning
                this.updateTrajectory();
            }, 2000); // Give it 2 seconds to cancel motion
            
            return true;
        }

        return false;
    }

    public cancelDocking(): void {
        this.phase = 'idle';
        this.targetSpacecraft = null;
        this.ourPortId = null;
        this.targetPortId = null;
        this.trajectory = null;
        this.currentWaypointIndex = 0;

        // Clear visualization
        this.trajectoryVisualizer.clearDebugObjects();

        // Stop autopilot modes
        const autopilot = this.spacecraft.spacecraftController?.autopilot;
        if (autopilot) {
            autopilot.resetAllModes();
        }
    }

    public isDocking(): boolean {
        return this.phase !== 'idle' && this.phase !== 'docked';
    }

    private getWaypointThreshold(): number {
        switch (this.phase) {
            case 'approach':
                return 1.0;
            case 'precise_position':
                return 0.5;
            case 'stop_and_align':
            case 'final':
                return 0.2;
            default:
                return 1.0;
        }
    }

    private updateTrajectory(): void {
        if (!this.isDocking() || !this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return;

        console.log('Updating trajectory for phase:', this.phase);

        // Get positions and convert to THREE.Vector3 if needed
        const ourPort = this.spacecraft.getDockingPortWorldPosition(this.ourPortId);
        const targetPort = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);
        const ourDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId);
        const targetDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId);

        if (!ourPort || !targetPort || !ourDir || !targetDir) {
            console.warn('Missing port positions or directions');
            return;
        }

        // Get spacecraft dimensions and positions
        const ourShape = this.spacecraft.objects.boxBody.shapes[0] as CANNON.Box;
        const targetShape = this.targetSpacecraft.objects.boxBody.shapes[0] as CANNON.Box;
        const targetPos = new THREE.Vector3(
            this.targetSpacecraft.objects.boxBody.position.x,
            this.targetSpacecraft.objects.boxBody.position.y,
            this.targetSpacecraft.objects.boxBody.position.z
        );

        // Calculate safe distances based on spacecraft sizes
        const safeDistance = (ourShape.halfExtents.z + targetShape.halfExtents.z) * 2.0;

        // Initialize waypoints array
        const waypoints: THREE.Vector3[] = [];
        waypoints.push(ourPort.clone()); // Start at current position

        switch (this.phase) {
            case 'approach': {
                // Calculate approach point at safe distance
                const approachPoint = targetPort.clone().add(
                    targetDir.clone().multiplyScalar(safeDistance)
                );

                // Get avoidance waypoints
                const avoidancePoints = TrajectoryPlanner.calculateAvoidanceWaypoints(
                    ourPort,
                    approachPoint,
                    targetPos,
                    targetShape.halfExtents,
                    targetDir
                );

                // Add all waypoints
                waypoints.push(...avoidancePoints);
                break;
            }

            case 'precise_position':
            case 'stop_and_align':
            case 'final': {
                // Calculate final center of mass position
                const centerOfMassPosition = this.calculateFinalCenterOfMassPosition(targetPort);
                waypoints.push(centerOfMassPosition);
                break;
            }
        }

        // Create trajectory with timing based on phase
        const totalTime = this.phase === 'final' ? 120 : 60;
        this.trajectory = TrajectoryPlanner.createTrajectory(waypoints, totalTime);
        
        // Visualize the trajectory
        this.trajectoryVisualizer.visualizeTrajectory(
            waypoints,
            this.currentWaypointIndex,
            {
                targetPosition: targetPos,
                targetPortPosition: targetPort,
                targetPortDirection: targetDir,
                waypointThreshold: this.getWaypointThreshold()
            }
        );
    }

    private calculateFinalCenterOfMassPosition(targetPort: THREE.Vector3): THREE.Vector3 {
        if (!this.ourPortId || !this.targetSpacecraft) return targetPort.clone();

        // Get the offset from our docking port to our center of mass
        const ourPortOffset = this.spacecraft.getDockingPortWorldPosition(this.ourPortId)?.clone();
        if (!ourPortOffset) return targetPort.clone();

        const ourCenterOfMass = new THREE.Vector3(
            this.spacecraft.objects.boxBody.position.x,
            this.spacecraft.objects.boxBody.position.y,
            this.spacecraft.objects.boxBody.position.z
        );

        const offsetFromPortToCenter = ourCenterOfMass.clone().sub(ourPortOffset);

        // Calculate where our center of mass should be when docked
        return targetPort.clone().add(offsetFromPortToCenter);
    }

    public update(): void {
        if (!this.isDocking() || !this.trajectory || !this.targetSpacecraft) return;

        const autopilot = this.spacecraft.spacecraftController?.autopilot;
        if (!autopilot) return;

        // Get current positions and directions
        const ourPort = this.spacecraft.getDockingPortWorldPosition(this.ourPortId!);
        const targetPort = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId!);
        const ourDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId!);
        const targetDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId!);

        if (!ourPort || !targetPort || !ourDir || !targetDir) {
            console.warn('Missing port positions or directions');
            return;
        }

        // Get current waypoint and distances
        const waypoints = this.trajectory.getWaypoints();
        if (this.currentWaypointIndex >= waypoints.length) {
            console.warn('No more waypoints available');
            return;
        }

        const currentWaypoint = waypoints[this.currentWaypointIndex];
        const finalWaypoint = waypoints[waypoints.length - 1];
        
        // Use spacecraft's center of mass position for waypoint distance checks
        const ourPosition = new THREE.Vector3(
            this.spacecraft.objects.boxBody.position.x,
            this.spacecraft.objects.boxBody.position.y,
            this.spacecraft.objects.boxBody.position.z
        );
        const distanceToWaypoint = ourPosition.distanceTo(currentWaypoint);
        const distanceToFinal = ourPosition.distanceTo(finalWaypoint);
        const waypointThreshold = this.getWaypointThreshold();

        // Process based on current phase
        switch (this.phase) {
            case 'approach':
                this.handleApproachPhase(autopilot, currentWaypoint, waypointThreshold, distanceToWaypoint, distanceToFinal);
                break;

            case 'precise_position':
                this.handlePrecisePositionPhase(autopilot, finalWaypoint, waypointThreshold, distanceToFinal);
                break;

            case 'stop_and_align':
                this.handleStopAndAlignPhase(autopilot, targetDir);
                break;

            case 'final':
                this.handleFinalPhase(autopilot, finalWaypoint, waypointThreshold, distanceToFinal);
                break;
        }
    }

    private handleApproachPhase(
        autopilot: any,
        currentWaypoint: THREE.Vector3,
        waypointThreshold: number,
        distanceToWaypoint: number,
        distanceToFinal: number
    ): void {
        autopilot.resetAllModes();
        autopilot.setTargetPosition(currentWaypoint);
        if (autopilot.goToPositionMode) {
            autopilot.goToPositionMode.setThreshold(waypointThreshold);
        }
        autopilot.setMode('goToPosition', true);

        // Check if we've reached the current waypoint
        if (distanceToWaypoint < waypointThreshold) {
            // If there are more waypoints, move to the next one
            if (this.currentWaypointIndex < this.trajectory!.getWaypoints().length - 1) {
                this.currentWaypointIndex++;
                console.log('Moving to next waypoint:', this.currentWaypointIndex);
                this.updateTrajectory(); // Update visualization
            } else {
                // Only transition if we're at the final waypoint and close enough
                if (distanceToFinal < waypointThreshold) {
                    // Check if we're relatively stable
                    const velocity = new THREE.Vector3(
                        this.spacecraft.objects.boxBody.velocity.x,
                        this.spacecraft.objects.boxBody.velocity.y,
                        this.spacecraft.objects.boxBody.velocity.z
                    );

                    if (velocity.length() < 0.5) { // Less than 50cm/s
                        console.log('Approach complete, transitioning to precise positioning');
                        this.phase = 'precise_position';
                        this.currentWaypointIndex = 0;
                        this.updateTrajectory();
                    }
                }
            }
        }
    }

    private handlePrecisePositionPhase(
        autopilot: any,
        finalWaypoint: THREE.Vector3,
        waypointThreshold: number,
        distanceToFinal: number
    ): void {
        autopilot.resetAllModes();
        autopilot.setTargetPosition(finalWaypoint);
        if (autopilot.goToPositionMode) {
            autopilot.goToPositionMode.setThreshold(waypointThreshold);
        }
        autopilot.setMode('goToPosition', true);
        
        // Only transition when we're close enough to final position
        if (distanceToFinal < waypointThreshold) {
            const velocity = new THREE.Vector3(
                this.spacecraft.objects.boxBody.velocity.x,
                this.spacecraft.objects.boxBody.velocity.y,
                this.spacecraft.objects.boxBody.velocity.z
            );

            if (velocity.length() < 0.2) { // Less than 20cm/s
                this.phase = 'stop_and_align';
                this.updateTrajectory();
                // Enable motion cancellation
                autopilot.setMode('cancelLinearMotion', true);
                autopilot.setMode('cancelRotation', true);
            }
        }
    }

    private handleStopAndAlignPhase(autopilot: any, targetDir: THREE.Vector3): void {
        // Calculate target orientation
        const targetQuat = new THREE.Quaternion();
        targetQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), targetDir.clone().multiplyScalar(-1));
        
        // Set target orientation and enable alignment
        autopilot.setTargetOrientation(targetQuat);
        autopilot.setMode('cancelAndAlign', true);

        // Check if we're aligned and stable
        const currentQuat = this.spacecraft.getOrientation();
        const angleDiff = currentQuat.angleTo(targetQuat);
        
        const velocity = new THREE.Vector3(
            this.spacecraft.objects.boxBody.velocity.x,
            this.spacecraft.objects.boxBody.velocity.y,
            this.spacecraft.objects.boxBody.velocity.z
        );

        const angularVelocity = new THREE.Vector3(
            this.spacecraft.objects.boxBody.angularVelocity.x,
            this.spacecraft.objects.boxBody.angularVelocity.y,
            this.spacecraft.objects.boxBody.angularVelocity.z
        );

        if (angleDiff < 0.1 && // Less than ~6 degrees
            velocity.length() < 0.1 && // Less than 10cm/s
            angularVelocity.length() < 0.1) { // Low angular velocity
            console.log('Alignment complete, transitioning to final approach');
            this.phase = 'final';
            this.updateTrajectory();
        }
    }

    private handleFinalPhase(
        autopilot: any,
        finalWaypoint: THREE.Vector3,
        waypointThreshold: number,
        distanceToFinal: number
    ): void {
        // Keep alignment active
        autopilot.setMode('cancelAndAlign', true);
        
        // Very slow approach to final position
        autopilot.setTargetPosition(finalWaypoint);
        if (autopilot.goToPositionMode) {
            autopilot.goToPositionMode.setThreshold(waypointThreshold);
        }
        autopilot.setMode('goToPosition', true);

        // Check if we're close enough to dock
        if (distanceToFinal < 0.1) { // 10cm
            const velocity = new THREE.Vector3(
                this.spacecraft.objects.boxBody.velocity.x,
                this.spacecraft.objects.boxBody.velocity.y,
                this.spacecraft.objects.boxBody.velocity.z
            );

            if (velocity.length() < 0.05) { // Less than 5cm/s
                console.log('Final approach complete, attempting dock');
                this.completeDocking();
            }
        }
    }

    private completeDocking(): void {
        if (!this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return;

        // Attempt to dock
        if (this.spacecraft.dock(this.ourPortId, this.targetSpacecraft, this.targetPortId)) {
            console.log('Docking successful');
            this.phase = 'docked';
            
            // Clear visualization
            this.trajectoryVisualizer.clearDebugObjects();

            // Disable autopilot modes
            const autopilot = this.spacecraft.spacecraftController?.autopilot;
            if (autopilot) {
                autopilot.resetAllModes();
            }
        } else {
            console.warn('Docking failed');
            this.cancelDocking();
        }
    }

    public cleanup(): void {
        this.trajectoryVisualizer.cleanup();
    }
} 
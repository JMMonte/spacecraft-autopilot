import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Spacecraft } from '../../core/spacecraft';
import { TrajectoryPlanner } from '../trajectory/TrajectoryPlanner';
import { TrajectoryVisualizer } from '../visualization/TrajectoryVisualizer';
import { Trajectory } from '../trajectory';

export type DockingPhase = 'idle' | 'approach' | 'precise_position' | 'stop_and_align' | 'final' | 'docked';
export type DockingPortId = 'front' | 'back';

export class DockingController {
    private spacecraft: Spacecraft;
    private targetSpacecraft: Spacecraft | null = null;
    private _ourPortId: DockingPortId | null = null;
    private _targetPortId: DockingPortId | null = null;
    private phase: DockingPhase = 'idle';
    private trajectory: Trajectory | null = null;
    private currentWaypointIndex: number = 0;
    private trajectoryVisualizer: TrajectoryVisualizer;
    private visualSpacecraft: Spacecraft[] = [];  // For orange bounding boxes
    private collisionSpacecraft: Spacecraft[] = [];  // For collision avoidance

    constructor(spacecraft: Spacecraft, scene: THREE.Scene) {
        this.spacecraft = spacecraft;
        this.trajectoryVisualizer = new TrajectoryVisualizer(scene);

        // Set up sync with BasicWorld
        if (spacecraft.basicWorld) {
            // Initial sync
            this.updateSpacecraftLists(spacecraft.basicWorld.getSpacecraftList());
            
            // Subscribe to changes
            spacecraft.basicWorld.setSpacecraftListChangeCallback((version: number) => {
                if (spacecraft.basicWorld) {
                    console.log('Spacecraft list changed, version:', version);
                    this.updateSpacecraftLists(spacecraft.basicWorld.getSpacecraftList());
                }
            });
        }
    }

    private updateSpacecraftLists(allSpacecraft: Spacecraft[]): void {
        // Update visualization list (exclude active and target)
        this.visualSpacecraft = allSpacecraft.filter(s => 
            s !== this.spacecraft && 
            s !== this.targetSpacecraft
        );

        // Update collision list (include target, exclude active)
        this.collisionSpacecraft = allSpacecraft.filter(s => 
            s !== this.spacecraft
        );

        // Debug log to verify filtering
        console.log('Spacecraft lists updated:', {
            total: allSpacecraft.length,
            visual: this.visualSpacecraft.length,
            collision: this.collisionSpacecraft.length,
            active: this.spacecraft.name,
            target: this.targetSpacecraft?.name || 'none'
        });
    }

    public setOtherSpacecraft(spacecraft: Spacecraft[]): void {
        this.updateSpacecraftLists(spacecraft);
    }

    public startDocking(targetSpacecraft: Spacecraft, ourPortId: DockingPortId, targetPortId: DockingPortId): void {
        if (this.isDocking()) {
            this.cancelDocking();
        }

        // Set target spacecraft first
        this.targetSpacecraft = targetSpacecraft;
        this._ourPortId = ourPortId;
        this._targetPortId = targetPortId;

        // Update spacecraft lists to exclude new target from visualization
        if (this.spacecraft.basicWorld) {
            this.updateSpacecraftLists(this.spacecraft.basicWorld.getSpacecraftList());
        }

        // Then set phase and update trajectory
        this.phase = 'approach';
        this.currentWaypointIndex = 0;
        this.updateTrajectory();
    }

    public isDocking(): boolean {
        return this.phase !== 'idle' && this.phase !== 'docked';
    }

    public undock(): void {
        if (this.phase === 'docked' && this._ourPortId) {
            this.spacecraft.undock(this._ourPortId);
            this.cancelDocking();
        }
    }

    public cancelDocking(): void {
        this.phase = 'idle';
        // Clear target spacecraft first
        this.targetSpacecraft = null;
        this._ourPortId = null;
        this._targetPortId = null;
        this.trajectory = null;
        this.currentWaypointIndex = 0;

        // Update lists after clearing target
        if (this.spacecraft.basicWorld) {
            this.updateSpacecraftLists(this.spacecraft.basicWorld.getSpacecraftList());
        }

        this.trajectoryVisualizer.clearDebugObjects();
    }

    public get ourPortId(): DockingPortId | null {
        return this._ourPortId;
    }

    public get targetPortId(): DockingPortId | null {
        return this._targetPortId;
    }

    public getDockingPhase(): DockingPhase {
        return this.phase;
    }

    private getWaypointThreshold(): number {
        switch (this.phase) {
            case 'approach': {
                // Use a smaller threshold for the final waypoint in approach phase
                if (this.trajectory && 
                    this.currentWaypointIndex === this.trajectory.getWaypoints().length - 1) {
                    return 0.5; // Half the normal approach threshold
                }
                return 1.0;
            }
            case 'precise_position':
                return 0.5;
            case 'stop_and_align':
            case 'final':
                return 0.2;
            default:
                return 1.0;
        }
    }

    private getSpacecraftInfo() {
        if (!this.targetSpacecraft) return null;

        // Get docking port dimensions
        const portDimensions = new CANNON.Vec3(
            this.spacecraft.objects.dockingPortRadius,
            this.spacecraft.objects.dockingPortRadius,
            this.spacecraft.objects.dockingPortLength
        );

        // Calculate port offsets based on spacecraft dimensions
        const ourPortOffset = this.ourPortId === 'front' ? 
            this.spacecraft.objects.boxDepth / 2 + this.spacecraft.objects.dockingPortDepth :
            -this.spacecraft.objects.boxDepth / 2 - this.spacecraft.objects.dockingPortDepth;

        const targetPortOffset = this.targetPortId === 'front' ?
            this.targetSpacecraft.objects.boxDepth / 2 + this.targetSpacecraft.objects.dockingPortDepth :
            -this.targetSpacecraft.objects.boxDepth / 2 - this.targetSpacecraft.objects.dockingPortDepth;

        // Get port positions and directions
        const ourPortDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId!);
        const targetPortDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId!);

        // Calculate port positions including offset
        const ourPortPos = this.spacecraft.getWorldPosition().clone().add(
            ourPortDir!.clone().multiplyScalar(ourPortOffset)
        );
        const targetPortPos = this.targetSpacecraft.getWorldPosition().clone().add(
            targetPortDir!.clone().multiplyScalar(targetPortOffset)
        );

        return {
            target: {
                position: this.targetSpacecraft.getWorldPosition(),
                orientation: this.targetSpacecraft.getWorldOrientation(),
                size: this.targetSpacecraft.getMainBodyDimensions(),
                fullDimensions: this.targetSpacecraft.getFullDimensions()
            },
            our: {
                position: this.spacecraft.getWorldPosition(),
                orientation: this.spacecraft.getWorldOrientation(),
                size: this.spacecraft.getMainBodyDimensions(),
                fullDimensions: this.spacecraft.getFullDimensions()
            },
            ports: {
                dimensions: portDimensions,
                ourPosition: ourPortPos,
                ourDirection: ourPortDir,
                targetPosition: targetPortPos,
                targetDirection: targetPortDir
            },
            others: this.visualSpacecraft.map(s => {
                const mainDims = s.getMainBodyDimensions();
                const fullDims = s.getFullDimensions();
                return {
                    position: s.getWorldPosition(),
                    size: mainDims,
                    safetySize: new CANNON.Vec3(
                        fullDims.x * 1.5,
                        fullDims.y * 1.5,
                        fullDims.z * 1.5
                    ),
                    orientation: s.getWorldOrientation()
                };
            })
        };
    }

    private updateVisuals(): void {
        if (!this.trajectory) return;

        const info = this.getSpacecraftInfo();
        if (!info) return;

        // Clear ALL existing visualizations
        this.trajectoryVisualizer.clearDebugObjects();

        // Update visualization - let TrajectoryVisualizer handle ALL visualization
        this.trajectoryVisualizer.visualizeTrajectory(
            this.trajectory.getWaypoints(),
            this.currentWaypointIndex,
            {
                // Active spacecraft info
                ourPosition: info.our.position,
                ourSize: info.our.size,
                ourOrientation: info.our.orientation,
                ourPortPosition: info.ports.ourPosition,
                ourPortDirection: info.ports.ourDirection || undefined,

                // Target spacecraft info
                targetPosition: info.target.position,
                targetSize: info.target.size,
                targetOrientation: info.target.orientation,
                targetPortPosition: info.ports.targetPosition,
                targetPortDirection: info.ports.targetDirection || undefined,

                // Common info
                portDimensions: info.ports.dimensions,
                waypointThreshold: this.getWaypointThreshold(),

                // Other spacecraft info - only non-participating spacecraft
                otherSpacecraft: info.others
            }
        );
    }

    private getPhaseWaypoints(
        ourPort: THREE.Vector3,
        targetPort: THREE.Vector3,
        targetDir: THREE.Vector3,
        safeDistance: number
    ): THREE.Vector3[] {
        const waypoints: THREE.Vector3[] = [ourPort.clone()];

        switch (this.phase) {
            case 'approach': {
                // Use the collision list for avoidance
                const otherObjects = this.collisionSpacecraft.map(s => ({
                    position: s.getWorldPosition(),
                    size: s.getFullDimensions(),
                    isTarget: s === this.targetSpacecraft
                }));

                const approachPoint = targetPort.clone().add(
                    targetDir.clone().multiplyScalar(safeDistance)
                );

                waypoints.push(...TrajectoryPlanner.calculateAvoidanceWaypoints(
                    ourPort,
                    approachPoint,
                    otherObjects
                ));
                break;
            }

            case 'precise_position':
            case 'stop_and_align':
            case 'final': {
                waypoints.push(this.calculateFinalCenterOfMassPosition(targetPort, targetDir));
                break;
            }
        }

        return waypoints;
    }

    private updateTrajectory(): void {
        if (!this.isDocking() || !this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return;

        const info = this.getSpacecraftInfo();
        if (!info || !info.ports.ourDirection || !info.ports.targetDirection) {
            console.warn('Missing port positions or directions');
            return;
        }

        // Calculate safe distance
        const ourShape = this.spacecraft.objects.boxBody.shapes[0] as CANNON.Box;
        const targetShape = this.targetSpacecraft.objects.boxBody.shapes[0] as CANNON.Box;
        const safeDistance = (ourShape.halfExtents.z + targetShape.halfExtents.z) * 8.0;

        // Get waypoints for current phase
        const waypoints = this.getPhaseWaypoints(
            info.ports.ourPosition,
            info.ports.targetPosition,
            info.ports.targetDirection,
            safeDistance
        );

        // Create trajectory
        const totalTime = this.phase === 'final' ? 120 : 60;
        this.trajectory = TrajectoryPlanner.createTrajectory(waypoints, totalTime);

        // Update visuals
        this.updateVisuals();
    }

    private calculateFinalCenterOfMassPosition(targetPort: THREE.Vector3, targetDir: THREE.Vector3): THREE.Vector3 {
        if (!this.ourPortId || !this.targetSpacecraft || !this.targetPortId) return targetPort.clone();

        // Get our port direction
        const ourPortDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId);
        if (!ourPortDir) return targetPort.clone();

        // Get dimensions
        const ourBoxDepth = this.spacecraft.objects.boxDepth;
        const ourDockingPortDepth = this.spacecraft.objects.dockingPortDepth || 0.3;
        const ourDockingPortLength = this.spacecraft.objects.dockingPortLength || 0.1;

        // Calculate where the docking ports will touch
        // Start from target port position and move back along target direction by our port length
        // (because target port position is at the tip of the target's port)
        const dockingPoint = targetPort.clone().add(
            targetDir.clone().multiplyScalar(ourDockingPortLength)
        );

        // Calculate where our center of mass needs to be
        // Move back from docking point along our port direction by the distance from our port tip to our center of mass
        const finalPosition = dockingPoint.clone();

        // Calculate total offset from our port tip to our center of mass
        const ourPortOffset = this.ourPortId === 'front' ? 
            -(ourBoxDepth / 2 + ourDockingPortDepth + ourDockingPortLength) :  // Negative because we're moving back from port tip
            (ourBoxDepth / 2 + ourDockingPortDepth + ourDockingPortLength);    // Positive for back port

        // Move back from docking point to our center of mass position
        finalPosition.add(ourPortDir.clone().multiplyScalar(ourPortOffset));

        return finalPosition;
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

        // Always update visual elements to follow spacecraft motion
        this.updateVisuals();

        // Get current waypoint and distances
        const waypoints = this.trajectory.getWaypoints();
        if (this.currentWaypointIndex >= waypoints.length) {
            console.warn('No more waypoints available');
            return;
        }

        const currentWaypoint = waypoints[this.currentWaypointIndex];
        const finalWaypoint = waypoints[waypoints.length - 1];
        
        // Use spacecraft's center of mass position for waypoint distance checks
        const ourPosition = this.spacecraft.getWorldPosition();
        const distanceToWaypoint = ourPosition.distanceTo(currentWaypoint);
        const distanceToFinal = ourPosition.distanceTo(finalWaypoint);
        const waypointThreshold = this.getWaypointThreshold();

        // Process based on current phase
        switch (this.phase) {
            case 'approach':
                this.handleApproachPhase(autopilot, currentWaypoint, distanceToWaypoint, distanceToFinal);
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

    private isStable(maxVelocity: number = 0.1, maxAngularVelocity: number = 0.1): boolean {
        const velocity = this.spacecraft.getWorldVelocity();
        const angularVelocity = this.spacecraft.getWorldAngularVelocity();
        return velocity.length() < maxVelocity && angularVelocity.length() < maxAngularVelocity;
    }

    private transitionToNextPhase(nextPhase: DockingPhase): void {
        console.log(`Transitioning from ${this.phase} to ${nextPhase}`);
        this.phase = nextPhase;
        this.currentWaypointIndex = 0;
        this.updateTrajectory();
    }

    private configureAutopilot(
        autopilot: any,
        targetPosition?: THREE.Vector3,
        targetOrientation?: THREE.Quaternion,
        threshold?: number
    ): void {
        autopilot.resetAllModes();
        
        if (targetPosition) {
            autopilot.setTargetPosition(targetPosition);
            if (autopilot.goToPositionMode && threshold !== undefined) {
                autopilot.goToPositionMode.setThreshold(threshold);
            }
            autopilot.setMode('goToPosition', true);
        }

        if (targetOrientation) {
            autopilot.setTargetOrientation(targetOrientation);
            autopilot.setMode('cancelAndAlign', true);
        }
    }

    private handleApproachPhase(
        autopilot: any,
        currentWaypoint: THREE.Vector3,
        distanceToWaypoint: number,
        distanceToFinal: number
    ): void {
        this.configureAutopilot(autopilot, currentWaypoint);

        const ourPosition = this.spacecraft.getWorldPosition();
        const velocity = this.spacecraft.getWorldVelocity();
        const directionToWaypoint = new THREE.Vector3().subVectors(currentWaypoint, ourPosition).normalize();
        const approachVelocity = velocity.dot(directionToWaypoint);

        // Check for waypoint transition
        const waypoints = this.trajectory!.getWaypoints();
        const isLastWaypoint = this.currentWaypointIndex === waypoints.length - 1;
        const threshold = isLastWaypoint ? 0.5 : 1.0;

        const hasReachedWaypoint = (
            distanceToWaypoint < threshold && 
            Math.abs(approachVelocity) < 0.5
        ) || this.hasPassedWaypoint(currentWaypoint);

        if (hasReachedWaypoint) {
            if (!isLastWaypoint) {
                this.currentWaypointIndex++;
                this.updateTrajectory();
            } else if (distanceToFinal < threshold && Math.abs(approachVelocity) < 0.5) {
                this.transitionToNextPhase('precise_position');
            }
        }
    }

    private hasPassedWaypoint(waypoint: THREE.Vector3): boolean {
        const waypoints = this.trajectory!.getWaypoints();
        const nextWaypoint = this.currentWaypointIndex < waypoints.length - 1 
            ? waypoints[this.currentWaypointIndex + 1] 
            : null;

        if (!nextWaypoint) return false;

        const ourPosition = this.spacecraft.getWorldPosition();
        const directionToWaypoint = new THREE.Vector3().subVectors(waypoint, ourPosition).normalize();
        const directionToNextWaypoint = new THREE.Vector3().subVectors(nextWaypoint, ourPosition).normalize();
        const angle = directionToWaypoint.angleTo(directionToNextWaypoint);
        const velocity = this.spacecraft.getWorldVelocity();
        
        return angle > Math.PI / 2 && // More than 90 degrees means we've passed it
               ourPosition.distanceTo(nextWaypoint) < waypoint.distanceTo(nextWaypoint) &&
               Math.abs(velocity.dot(directionToWaypoint)) < 1.0;
    }

    private handlePrecisePositionPhase(
        autopilot: any,
        finalWaypoint: THREE.Vector3,
        waypointThreshold: number,
        distanceToFinal: number
    ): void {
        this.configureAutopilot(autopilot, finalWaypoint, undefined, waypointThreshold);
        
        if (distanceToFinal < waypointThreshold && this.isStable(0.2)) {
            this.transitionToNextPhase('stop_and_align');
            autopilot.setMode('cancelLinearMotion', true);
            autopilot.setMode('cancelRotation', true);
        }
    }

    private handleStopAndAlignPhase(autopilot: any, targetDir: THREE.Vector3): void {
        const targetQuat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            targetDir.clone().multiplyScalar(-1)
        );
        
        this.configureAutopilot(autopilot, undefined, targetQuat);

        const currentQuat = this.spacecraft.getWorldOrientation();
        const angleDiff = currentQuat.angleTo(targetQuat);
        
        if (angleDiff < 0.1 && this.isStable(0.1, 0.1)) {
            this.transitionToNextPhase('final');
        }
    }

    private handleFinalPhase(
        autopilot: any,
        finalWaypoint: THREE.Vector3,
        waypointThreshold: number,
        distanceToFinal: number
    ): void {
        this.configureAutopilot(autopilot, finalWaypoint, undefined, waypointThreshold);
        autopilot.setMode('cancelAndAlign', true);

        if (distanceToFinal < 0.1 && this.isStable(0.05)) {
            this.completeDocking();
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

    public getTrajectory(): Trajectory | null {
        return this.trajectory;
    }

    public getCurrentWaypointIndex(): number {
        return this.currentWaypointIndex;
    }

    public getCurrentWaypointThreshold(): number {
        return this.getWaypointThreshold();
    }

    public getDistanceToWaypoint(): number | null {
        if (!this.trajectory || this.currentWaypointIndex >= this.trajectory.getWaypoints().length) {
            return null;
        }

        const currentWaypoint = this.trajectory.getWaypoints()[this.currentWaypointIndex];
        return this.spacecraft.getWorldPosition().distanceTo(currentWaypoint);
    }
} 
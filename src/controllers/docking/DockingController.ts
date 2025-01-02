import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Spacecraft } from '../../core/spacecraft';
import { TrajectoryPlanner } from '../trajectory/TrajectoryPlanner';
import { TrajectoryVisualizer } from '../visualization/TrajectoryVisualizer';
import { Trajectory } from '../trajectory';

export type DockingPhase = 'idle' | 'approach' | 'align' | 'dock' | 'docked';
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
            this.updateSpacecraftLists(spacecraft.basicWorld.getSpacecraftList());
            spacecraft.basicWorld.setSpacecraftListChangeCallback(() => {
                if (spacecraft.basicWorld) {
                    this.updateSpacecraftLists(spacecraft.basicWorld.getSpacecraftList());
                }
            });
        }
    }

    private updateSpacecraftLists(allSpacecraft: Spacecraft[]): void {
        this.visualSpacecraft = allSpacecraft.filter(s => 
            s !== this.spacecraft && 
            s !== this.targetSpacecraft
        );
        this.collisionSpacecraft = allSpacecraft.filter(s => 
            s !== this.spacecraft
        );
    }

    public startDocking(targetSpacecraft: Spacecraft, ourPortId: DockingPortId, targetPortId: DockingPortId): void {
        if (this.isDocking()) {
            this.cancelDocking();
        }

        this.targetSpacecraft = targetSpacecraft;
        this._ourPortId = ourPortId;
        this._targetPortId = targetPortId;

        if (this.spacecraft.basicWorld) {
            this.updateSpacecraftLists(this.spacecraft.basicWorld.getSpacecraftList());
        }

        this.phase = 'approach';
        this.currentWaypointIndex = 0;
        this.updateTrajectory();
    }

    private getSpacecraftInfo() {
        if (!this.targetSpacecraft) return null;

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
            others: this.visualSpacecraft.map(s => ({
                position: s.getWorldPosition(),
                size: s.getMainBodyDimensions(),
                safetySize: new CANNON.Vec3(
                    s.getFullDimensions().x * 1.5,
                    s.getFullDimensions().y * 1.5,
                    s.getFullDimensions().z * 1.5
                ),
                orientation: s.getWorldOrientation()
            }))
        };
    }

    private calculateApproachPosition(targetPort: THREE.Vector3, targetDir: THREE.Vector3, safeDistance: number): THREE.Vector3 {
        // Calculate approach position that's safeDistance away from the target port
        // along the target port's direction vector (opposite to docking direction)
        return targetPort.clone().add(
            targetDir.clone().multiplyScalar(-safeDistance)  // Negative because we want to approach from opposite direction
        );
    }

    private calculateFinalPosition(targetPort: THREE.Vector3, targetDir: THREE.Vector3): THREE.Vector3 {
        if (!this.ourPortId || !this.targetSpacecraft || !this.targetPortId) return targetPort.clone();

        const ourPortDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId);
        if (!ourPortDir) return targetPort.clone();

        // Get dimensions
        const ourBoxDepth = this.spacecraft.objects.boxDepth;
        const ourDockingPortDepth = this.spacecraft.objects.dockingPortDepth || 0.3;
        const ourDockingPortLength = this.spacecraft.objects.dockingPortLength || 0.1;
        const targetDockingPortLength = this.targetSpacecraft.objects.dockingPortLength || 0.1;

        // Calculate docking point (where ports will touch)
        // Move back from target port by our port's length (they meet in the middle)
        const dockingPoint = targetPort.clone().add(
            targetDir.clone().multiplyScalar(-targetDockingPortLength)
        );

        // Calculate offset from docking point to our center of mass
        const ourPortOffset = this.ourPortId === 'front' ? 
            -(ourBoxDepth / 2 + ourDockingPortDepth + ourDockingPortLength) :
            (ourBoxDepth / 2 + ourDockingPortDepth + ourDockingPortLength);

        // Calculate final position by moving back from docking point along our port direction
        return dockingPoint.clone().add(ourPortDir.clone().multiplyScalar(ourPortOffset));
    }

    private updateTrajectory(): void {
        if (!this.isDocking() || !this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return;

        const info = this.getSpacecraftInfo();
        if (!info || !info.ports.ourDirection || !info.ports.targetDirection) return;

        // Calculate safe distance based on spacecraft dimensions plus extra margin
        const ourShape = this.spacecraft.objects.boxBody.shapes[0] as CANNON.Box;
        const targetShape = this.targetSpacecraft.objects.boxBody.shapes[0] as CANNON.Box;
        const safeDistance = (ourShape.halfExtents.z + targetShape.halfExtents.z) * 3.0;

        const waypoints: THREE.Vector3[] = [info.ports.ourPosition.clone()];

        if (this.phase === 'approach') {
            // Calculate approach position
            const approachPos = this.calculateApproachPosition(
                info.ports.targetPosition,
                info.ports.targetDirection,
                safeDistance
            );

            // Get collision-free path to approach position
            waypoints.push(...TrajectoryPlanner.calculateAvoidanceWaypoints(
                info.ports.ourPosition,
                approachPos,
                this.collisionSpacecraft.map(s => ({
                    position: s.getWorldPosition(),
                    size: s.getFullDimensions(),
                    isTarget: s === this.targetSpacecraft
                }))
            ));
        } else if (this.phase === 'dock') {
            // Direct path to final docking position
            waypoints.push(this.calculateFinalPosition(
                info.ports.targetPosition,
                info.ports.targetDirection
            ));
        }

        // Create trajectory with appropriate timing
        const totalTime = this.phase === 'dock' ? 180 : 60; // More time for final docking
        this.trajectory = TrajectoryPlanner.createTrajectory(waypoints, totalTime);

        // Update visualization
        this.updateVisuals();
    }

    private updateVisuals(): void {
        if (!this.trajectory) return;

        const info = this.getSpacecraftInfo();
        if (!info) return;

        this.trajectoryVisualizer.clearDebugObjects();
        this.trajectoryVisualizer.visualizeTrajectory(
            this.trajectory.getWaypoints(),
            this.currentWaypointIndex,
            {
                ourPosition: info.our.position,
                ourSize: info.our.size,
                ourOrientation: info.our.orientation,
                ourPortPosition: info.ports.ourPosition,
                ourPortDirection: info.ports.ourDirection || undefined,

                targetPosition: info.target.position,
                targetSize: info.target.size,
                targetOrientation: info.target.orientation,
                targetPortPosition: info.ports.targetPosition,
                targetPortDirection: info.ports.targetDirection || undefined,

                portDimensions: info.ports.dimensions,
                waypointThreshold: this.getWaypointThreshold(),

                otherSpacecraft: info.others
            }
        );
    }

    private getWaypointThreshold(): number {
        switch (this.phase) {
            case 'approach':
                return this.currentWaypointIndex === this.trajectory?.getWaypoints().length! - 1 ? 0.5 : 1.0;
            case 'align':
                return 0.5;
            case 'dock':
                return 0.2;
            default:
                return 1.0;
        }
    }

    public update(): void {
        if (!this.isDocking() || !this.trajectory || !this.targetSpacecraft) return;

        const autopilot = this.spacecraft.spacecraftController?.autopilot;
        if (!autopilot) return;

        const info = this.getSpacecraftInfo();
        if (!info || !info.ports.targetDirection || !info.ports.ourDirection) return;

        this.updateVisuals();

        const waypoints = this.trajectory.getWaypoints();
        if (this.currentWaypointIndex >= waypoints.length) return;

        const currentWaypoint = waypoints[this.currentWaypointIndex];
        const ourPosition = this.spacecraft.getWorldPosition();
        const distanceToWaypoint = ourPosition.distanceTo(currentWaypoint);
        const waypointThreshold = this.getWaypointThreshold();

        // Calculate target orientation for port alignment
        // We want our port direction to be opposite to the target port direction
        const targetQuat = new THREE.Quaternion();
        const ourPortDir = info.ports.ourDirection;
        const targetPortDir = info.ports.targetDirection;

        // Calculate the rotation needed to align our port with target port
        const rotationAxis = new THREE.Vector3().crossVectors(ourPortDir, targetPortDir.clone().multiplyScalar(-1)).normalize();
        const rotationAngle = ourPortDir.angleTo(targetPortDir.clone().multiplyScalar(-1));
        
        if (rotationAngle > 0.001) { // Only rotate if there's a significant angle difference
            targetQuat.setFromAxisAngle(rotationAxis, rotationAngle);
            targetQuat.multiply(this.spacecraft.getWorldOrientation()); // Apply to current orientation
        }

        switch (this.phase) {
            case 'approach': {
                autopilot.resetAllModes();
                autopilot.setTargetPosition(currentWaypoint);
                autopilot.setMode('goToPosition', true);
                
                // Always maintain orientation control
                autopilot.setTargetOrientation(targetQuat);
                autopilot.setMode('orientationMatch', true);

                if (distanceToWaypoint < waypointThreshold && this.isStable(0.2)) {
                    if (this.currentWaypointIndex < waypoints.length - 1) {
                        this.currentWaypointIndex++;
                    } else {
                        this.phase = 'align';
                        autopilot.setMode('cancelLinearMotion', true);
                    }
                }
                break;
            }

            case 'align': {
                autopilot.resetAllModes();
                autopilot.setTargetOrientation(targetQuat);
                autopilot.setMode('orientationMatch', true);
                autopilot.setMode('cancelLinearMotion', true); // Ensure we stay in place while aligning

                const currentQuat = this.spacecraft.getWorldOrientation();
                const angleDiff = currentQuat.angleTo(targetQuat);

                if (angleDiff < 0.05 && this.isStable(0.1, 0.05)) { // Tighter alignment requirements
                    this.phase = 'dock';
                    this.updateTrajectory();
                }
                break;
            }

            case 'dock': {
                autopilot.resetAllModes();
                autopilot.setTargetPosition(currentWaypoint);
                autopilot.setMode('goToPosition', true);
                
                // Maintain precise orientation control during final approach
                autopilot.setTargetOrientation(targetQuat);
                autopilot.setMode('orientationMatch', true);

                if (distanceToWaypoint < 0.05 && this.isStable(0.02, 0.02)) { // Tighter stability requirements for docking
                    this.completeDocking();
                }
                break;
            }
        }
    }

    private isStable(maxVelocity: number = 0.1, maxAngularVelocity: number = 0.1): boolean {
        const velocity = this.spacecraft.getWorldVelocity();
        const angularVelocity = this.spacecraft.getWorldAngularVelocity();
        return velocity.length() < maxVelocity && angularVelocity.length() < maxAngularVelocity;
    }

    private completeDocking(): void {
        if (!this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return;

        if (this.spacecraft.dock(this.ourPortId, this.targetSpacecraft, this.targetPortId)) {
            this.phase = 'docked';
            this.trajectoryVisualizer.clearDebugObjects();
            
            const autopilot = this.spacecraft.spacecraftController?.autopilot;
            if (autopilot) {
                autopilot.resetAllModes();
            }
        } else {
            this.cancelDocking();
        }
    }

    public isDocking(): boolean {
        return this.phase !== 'idle' && this.phase !== 'docked';
    }

    public getDockingPhase(): DockingPhase {
        return this.phase;
    }

    public get ourPortId(): DockingPortId | null {
        return this._ourPortId;
    }

    public get targetPortId(): DockingPortId | null {
        return this._targetPortId;
    }

    public undock(): void {
        if (this.phase === 'docked' && this._ourPortId) {
            this.spacecraft.undock(this._ourPortId);
            this.cancelDocking();
        }
    }

    public cancelDocking(): void {
        this.phase = 'idle';
        this.targetSpacecraft = null;
        this._ourPortId = null;
        this._targetPortId = null;
        this.trajectory = null;
        this.currentWaypointIndex = 0;

        if (this.spacecraft.basicWorld) {
            this.updateSpacecraftLists(this.spacecraft.basicWorld.getSpacecraftList());
        }

        this.trajectoryVisualizer.clearDebugObjects();
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

    public getRelativeVelocity(): THREE.Vector3 | null {
        if (!this.targetSpacecraft) return null;

        const ourVel = this.spacecraft.getWorldVelocity();
        const targetVel = this.targetSpacecraft.getWorldVelocity();
        return new THREE.Vector3().subVectors(ourVel, targetVel);
    }

    public getPortAlignmentInfo(): {
        portAlignmentError: number;
        rollError: number;
        pitchError: number;
        yawError: number;
        lateralOffset: THREE.Vector2;
    } | null {
        if (!this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return null;

        const ourPortDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId);
        const targetPortDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId);
        const ourPortPos = this.spacecraft.getDockingPortWorldPosition(this.ourPortId);
        const targetPortPos = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);

        if (!ourPortDir || !targetPortDir || !ourPortPos || !targetPortPos) return null;

        // Port alignment error (angle between port directions)
        const portAlignmentError = Math.acos(Math.min(1, Math.max(-1, ourPortDir.dot(targetPortDir.clone().negate()))));

        // Calculate relative position vector
        const relativePos = new THREE.Vector3().subVectors(targetPortPos, ourPortPos);

        // Calculate pitch error (rotation around X axis)
        const pitchPlaneNormal = new THREE.Vector3(1, 0, 0);
        const pitchProjected = ourPortDir.clone().projectOnPlane(pitchPlaneNormal).normalize();
        const targetPitchProjected = targetPortDir.clone().projectOnPlane(pitchPlaneNormal).normalize();
        const pitchError = Math.acos(Math.min(1, Math.max(-1, pitchProjected.dot(targetPitchProjected))));

        // Calculate yaw error (rotation around Y axis)
        const yawPlaneNormal = new THREE.Vector3(0, 1, 0);
        const yawProjected = ourPortDir.clone().projectOnPlane(yawPlaneNormal).normalize();
        const targetYawProjected = targetPortDir.clone().projectOnPlane(yawPlaneNormal).normalize();
        const yawError = Math.acos(Math.min(1, Math.max(-1, yawProjected.dot(targetYawProjected))));

        // Calculate roll error using up vectors
        const worldUp = new THREE.Vector3(0, 1, 0);
        const ourUp = new THREE.Vector3().crossVectors(ourPortDir, worldUp).normalize();
        const targetUp = new THREE.Vector3().crossVectors(targetPortDir, worldUp).normalize();
        const rollError = Math.acos(Math.min(1, Math.max(-1, ourUp.dot(targetUp))));

        // Calculate lateral offset (perpendicular to target port direction)
        const lateralOffset = new THREE.Vector3().copy(relativePos);
        const alongPort = targetPortDir.clone().multiplyScalar(relativePos.dot(targetPortDir));
        lateralOffset.sub(alongPort);

        return {
            portAlignmentError: THREE.MathUtils.radToDeg(portAlignmentError),
            rollError: THREE.MathUtils.radToDeg(rollError),
            pitchError: THREE.MathUtils.radToDeg(pitchError) * Math.sign(ourPortDir.y - targetPortDir.y),
            yawError: THREE.MathUtils.radToDeg(yawError) * Math.sign(ourPortDir.x - targetPortDir.x),
            lateralOffset: new THREE.Vector2(lateralOffset.x, lateralOffset.y)
        };
    }

    public getClosingSpeed(): number | null {
        if (!this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return null;

        const ourPortPos = this.spacecraft.getDockingPortWorldPosition(this.ourPortId);
        const targetPortPos = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);
        if (!ourPortPos || !targetPortPos) return null;

        const relativeVel = this.getRelativeVelocity();
        if (!relativeVel) return null;

        const rangeVector = new THREE.Vector3().subVectors(targetPortPos, ourPortPos).normalize();
        return relativeVel.dot(rangeVector);
    }

    public getRange(): number | null {
        if (!this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return null;

        const ourPortPos = this.spacecraft.getDockingPortWorldPosition(this.ourPortId);
        const targetPortPos = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);
        if (!ourPortPos || !targetPortPos) return null;

        return ourPortPos.distanceTo(targetPortPos);
    }
} 
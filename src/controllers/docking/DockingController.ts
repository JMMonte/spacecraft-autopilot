import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
import { canDockWithinThresholds } from './DockingUtils';
import { TrajectoryPlanner } from '../trajectory/TrajectoryPlanner';
import { TrajectoryVisualizer } from '../visualization/TrajectoryVisualizer';
import { Trajectory } from '../trajectory';
import { Autopilot } from '../autopilot/Autopilot';

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
    private _lastVisualUpdateMs: number = 0;
    private _visualUpdateIntervalMs: number = 100; // update visuals every 100ms
    
    // Thresholds moved to shared DockingUtils for reuse across systems

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

        const portDimensions = new THREE.Vector3(
            this.spacecraft.objects.dockingPortRadius,
            this.spacecraft.objects.dockingPortRadius,
            this.spacecraft.objects.dockingPortLength
        );

        // Get port positions and directions using spacecraft helpers (consistent frames)
        const ourPortDir = this.ourPortId ? this.spacecraft.getDockingPortWorldDirection(this.ourPortId) : null;
        const targetPortDir = this.targetPortId ? this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId) : null;
        const ourPortPos = this.ourPortId ? this.spacecraft.getDockingPortWorldPosition(this.ourPortId) : null;
        const targetPortPos = this.targetPortId ? this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId) : null;

        return {
            target: {
                position: this.targetSpacecraft.getWorldPosition(),
                orientation: this.targetSpacecraft.getWorldOrientation(),
                size: new THREE.Vector3(
                    this.targetSpacecraft.getMainBodyDimensions().x,
                    this.targetSpacecraft.getMainBodyDimensions().y,
                    this.targetSpacecraft.getMainBodyDimensions().z
                ),
                fullDimensions: this.targetSpacecraft.getFullDimensions()
            },
            our: {
                position: this.spacecraft.getWorldPosition(),
                orientation: this.spacecraft.getWorldOrientation(),
                size: new THREE.Vector3(
                    this.spacecraft.getMainBodyDimensions().x,
                    this.spacecraft.getMainBodyDimensions().y,
                    this.spacecraft.getMainBodyDimensions().z
                ),
                fullDimensions: this.spacecraft.getFullDimensions()
            },
            ports: {
                dimensions: portDimensions,
                ourPosition: ourPortPos!,
                ourDirection: ourPortDir!,
                targetPosition: targetPortPos!,
                targetDirection: targetPortDir!
            },
            others: this.visualSpacecraft.map(s => ({
                position: s.getWorldPosition(),
                size: new THREE.Vector3(s.getMainBodyDimensions().x, s.getMainBodyDimensions().y, s.getMainBodyDimensions().z),
                safetySize: new THREE.Vector3(
                    s.getFullDimensions().x * 1.5,
                    s.getFullDimensions().y * 1.5,
                    s.getFullDimensions().z * 1.5
                ),
                orientation: s.getWorldOrientation()
            }))
        };
    }

    private calculateApproachPosition(targetPort: THREE.Vector3, targetDir: THREE.Vector3, safeDistance: number, targetPortLength: number): THREE.Vector3 {
        // Place the approach point safeDistance in front of the TARGET PORT FACE (outward along the port axis)
        // The port center is at targetPort; the outer face is at +length/2 along targetDir for a front-facing port.
        // Using +offset keeps the approach point in front of the target, not behind it.
        const offsetFromCenter = safeDistance + (targetPortLength * 0.5);
        return targetPort.clone().add(targetDir.clone().multiplyScalar(+offsetFromCenter));
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

        // Calculate docking point at the TARGET PORT FACE (center-of-face)
        // The face lies at +length/2 along the target port direction from the port center.
        const dockingPoint = targetPort.clone().add(targetDir.clone().multiplyScalar(+targetDockingPortLength * 0.5));

        // Offset from docking point to OUR CENTER OF MASS so our FACE lands on dockingPoint
        const ourFaceToCOM = (ourBoxDepth / 2) + ourDockingPortDepth + (ourDockingPortLength * 0.5);

        // Move opposite our port direction by the face-to-COM distance
        return dockingPoint.clone().add(ourPortDir.clone().multiplyScalar(-ourFaceToCOM));
    }

    private updateTrajectory(): void {
        if (!this.isDocking() || !this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return;

        const info = this.getSpacecraftInfo();
        if (!info || !info.ports.ourDirection || !info.ports.targetDirection) return;

        // Calculate safe distance based on spacecraft dimensions plus extra margin
        const safeDistance = (info.our.fullDimensions.z + info.target.fullDimensions.z) * 3.0;

        const waypoints: THREE.Vector3[] = [info.ports.ourPosition.clone()];

        if (this.phase === 'approach') {
            // Calculate approach position
            const approachPos = this.calculateApproachPosition(
                info.ports.targetPosition,
                info.ports.targetDirection,
                safeDistance,
                this.targetSpacecraft.objects.dockingPortLength || 0.1
            );

            // Get collision-free path to approach position
            waypoints.push(...TrajectoryPlanner.calculateAvoidanceWaypoints(
                info.ports.ourPosition,
                approachPos,
                this.collisionSpacecraft.map(s => ({
                    position: s.getWorldPosition(),
                    size: new THREE.Vector3(s.getFullDimensions().x, s.getFullDimensions().y, s.getFullDimensions().z),
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

        // If the target is moving, override the current waypoint's position
        // so the threshold sphere and marker follow the target frame.
        let currentWaypointOverride: THREE.Vector3 | undefined;
        if (this.phase === 'approach') {
            const waypoints = this.trajectory.getWaypoints();
            const isLast = this.currentWaypointIndex === waypoints.length - 1;
            if (isLast && this.targetSpacecraft) {
                const safeDistance = (info.our.fullDimensions.z + info.target.fullDimensions.z) * 3.0;
                const targLen = this.targetSpacecraft.objects.dockingPortLength || 0.1;
                currentWaypointOverride = this.calculateApproachPosition(
                    info.ports.targetPosition,
                    info.ports.targetDirection,
                    safeDistance,
                    targLen
                );
            }
        } else if (this.phase === 'dock') {
            // During final closure, continuously point the current waypoint at the live docking pose
            currentWaypointOverride = this.calculateFinalPosition(
                info.ports.targetPosition,
                info.ports.targetDirection
            );
        }

        this.trajectoryVisualizer.clearDebugObjects();
        this.trajectoryVisualizer.visualizeTrajectory(
            this.trajectory.getWaypoints(),
            this.currentWaypointIndex,
            {
                currentWaypointOverride,
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
        // Only proceed if we have an active target and port selection
        if (!this.isDocking() || !this.targetSpacecraft || !this._ourPortId || !this._targetPortId) return;

        const autopilot = this.spacecraft.spacecraftController?.autopilot;
        // Always operate relative to the target spacecraft during docking
        if (autopilot) {
            autopilot.setReferenceObject(this.targetSpacecraft);
        }

        // Gather current info for guidance and physical checks
        const info = this.getSpacecraftInfo();
        if (!info || !info.ports.targetDirection || !info.ports.ourDirection) return;

        // Throttle visuals to reduce GC pressure (time-based)
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (now - this._lastVisualUpdateMs >= this._visualUpdateIntervalMs) {
            this._lastVisualUpdateMs = now;
            this.updateVisuals();
        }

        // If physical docking criteria are met, complete docking regardless of autopilot state
        if (this.shouldPhysicallyDock()) {
            this.completeDocking();
            return;
        }

        // Calculate full target orientation: align port axis AND roll with target port frame
        const targetQuat = this.computeTargetOrientationQuaternion();

        // Waypoint data (available only when trajectory exists)
        let currentWaypoint: THREE.Vector3 | null = null;
        let distanceToWaypoint = Infinity;
        let waypointThreshold = this.getWaypointThreshold();
        let waypoints: THREE.Vector3[] = [];
        if (this.trajectory) {
            waypoints = this.trajectory.getWaypoints();
            if (this.currentWaypointIndex < waypoints.length) {
                currentWaypoint = waypoints[this.currentWaypointIndex];
                const ourPosition = this.spacecraft.getWorldPosition();
                distanceToWaypoint = currentWaypoint ? ourPosition.distanceTo(currentWaypoint) : Infinity;
            }
        }

        switch (this.phase) {
            case 'approach': {
                if (!autopilot || !currentWaypoint) break;
                // If we're at the final approach waypoint, continuously rebase it on target motion
                const isLast = waypoints.length > 0 && (this.currentWaypointIndex === waypoints.length - 1);
                let targetForThisLeg = currentWaypoint;
                if (isLast) {
                    const approachPos = this.calculateApproachPosition(
                        info.ports.targetPosition,
                        info.ports.targetDirection,
                        (info.our.fullDimensions.z + info.target.fullDimensions.z) * 3.0,
                        this.targetSpacecraft.objects.dockingPortLength || 0.1
                    );
                    targetForThisLeg = approachPos;
                    distanceToWaypoint = this.spacecraft.getWorldPosition().distanceTo(approachPos);
                }
                this.driveAutopilot(autopilot, {
                    goToPosition: { enabled: true, position: targetForThisLeg },
                    orientationMatch: { enabled: !!targetQuat, orientation: targetQuat || undefined },
                    cancelLinearMotion: { enabled: false }
                });

                if (distanceToWaypoint < waypointThreshold && this.isStable(0.2)) {
                    if (this.currentWaypointIndex < waypoints.length - 1) {
                        this.currentWaypointIndex++;
                    } else {
                        this.phase = 'align';
                    }
                }
                break;
            }

            case 'align': {
                if (!autopilot) break;
                this.driveAutopilot(autopilot, {
                    goToPosition: { enabled: false },
                    orientationMatch: { enabled: !!targetQuat, orientation: targetQuat || undefined },
                    cancelLinearMotion: { enabled: true }
                });

                const currentQuat = this.spacecraft.getWorldOrientation();
                const angleDiff = targetQuat ? currentQuat.angleTo(targetQuat) : Infinity;

                if (angleDiff < 0.05 && this.isStable(0.1, 0.05)) { // Tighter alignment requirements
                    this.phase = 'dock';
                    this.updateTrajectory();
                }
                break;
            }

            case 'dock': {
                if (!autopilot) break;
                // Continuously recompute the ideal COM position so our port face meets theirs
                const finalPos = this.calculateFinalPosition(
                    info.ports.targetPosition,
                    info.ports.targetDirection
                );
                this.driveAutopilot(autopilot, {
                    goToPosition: { enabled: true, position: finalPos },
                    orientationMatch: { enabled: !!targetQuat, orientation: targetQuat || undefined },
                    cancelLinearMotion: { enabled: false }
                });

                // Completion handled only by shouldPhysicallyDock()
                break;
            }
        }
    }

    // Centralized bridge to Autopilot: toggles modes only when state changes,
    // and applies targets. Keeps concerns clean and avoids mode thrashing.
    private driveAutopilot(
        autopilot: Autopilot | undefined,
        opts: {
            goToPosition: { enabled: boolean; position?: THREE.Vector3 };
            orientationMatch: { enabled: boolean; orientation?: THREE.Quaternion };
            cancelLinearMotion: { enabled: boolean };
        }
    ): void {
        if (!autopilot) return;
        const current = autopilot.getActiveAutopilots();

        // Targets first
        if (opts.goToPosition.enabled && opts.goToPosition.position) {
            autopilot.setTargetPosition(opts.goToPosition.position);
        }
        if (opts.orientationMatch.enabled && opts.orientationMatch.orientation) {
            autopilot.setTargetOrientation(opts.orientationMatch.orientation);
        }

        // Toggle modes only if changed
        if (current.goToPosition !== opts.goToPosition.enabled) {
            autopilot.setMode('goToPosition', opts.goToPosition.enabled);
        }
        if (current.orientationMatch !== opts.orientationMatch.enabled) {
            autopilot.setMode('orientationMatch', opts.orientationMatch.enabled);
        }
        if (current.cancelLinearMotion !== opts.cancelLinearMotion.enabled) {
            autopilot.setMode('cancelLinearMotion', opts.cancelLinearMotion.enabled);
        }
    }

    // Build a world quaternion that aligns OUR selected port axis with the opposite of the TARGET port axis,
    // then matches roll using the target spacecraft's up projected into the port plane.
    private computeTargetOrientationQuaternion(): THREE.Quaternion | null {
        if (!this._ourPortId || !this._targetPortId || !this.targetSpacecraft) return null;

        const ourDir = this.spacecraft.getDockingPortWorldDirection(this._ourPortId);
        const targetPortDir = this.targetSpacecraft.getDockingPortWorldDirection(this._targetPortId);
        if (!ourDir || !targetPortDir) return null;

        // Guard against degenerate directions
        if (ourDir.lengthSq() < 1e-12 || targetPortDir.lengthSq() < 1e-12) return null;

        const zAim = targetPortDir.clone().multiplyScalar(-1);
        if (zAim.lengthSq() < 1e-12) return null;
        zAim.normalize(); // where our port axis must point
        const qCurr = this.spacecraft.getWorldOrientation();

        // Step 1: rotate our current port axis onto zAim (delta in world space)
        const ourDirN = ourDir.clone();
        if (ourDirN.lengthSq() < 1e-12) return null;
        ourDirN.normalize();
        const qAlign = new THREE.Quaternion().setFromUnitVectors(ourDirN, zAim);
        const qAfter = new THREE.Quaternion().multiplyQuaternions(qAlign, qCurr);

        // Step 2: roll about zAim to match target's "up" in the port plane
        const targetUpWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(this.targetSpacecraft.getWorldOrientation());
        const desiredUp = targetUpWorld.clone().sub(zAim.clone().multiplyScalar(targetUpWorld.dot(zAim)));
        if (desiredUp.lengthSq() < 1e-8) {
            // Fallback: choose an arbitrary up orthogonal to zAim
            const fallback = Math.abs(zAim.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
            desiredUp.copy(fallback.sub(zAim.clone().multiplyScalar(fallback.dot(zAim))));
        }
        if (desiredUp.lengthSq() > 1e-12) desiredUp.normalize();

        const ourUpAfter = new THREE.Vector3(0, 1, 0).applyQuaternion(qAfter);
        const ourUpProj = ourUpAfter.clone().sub(zAim.clone().multiplyScalar(ourUpAfter.dot(zAim)));
        if (ourUpProj.lengthSq() > 1e-12) ourUpProj.normalize(); else ourUpProj.copy(desiredUp);

        const dot = THREE.MathUtils.clamp(ourUpProj.dot(desiredUp), -1, 1);
        let roll = Math.acos(dot);
        const cross = new THREE.Vector3().crossVectors(ourUpProj, desiredUp);
        const sign = Math.sign(cross.dot(zAim));
        roll *= sign || 1;

        const qRoll = new THREE.Quaternion().setFromAxisAngle(zAim, roll);
        const qTarget = new THREE.Quaternion().multiplyQuaternions(qRoll, qAfter);
        return qTarget;
    }

    // Compute the world-space position of a port's outer face (tip of the cylinder)
    private getPortFacePosition(spacecraft: Spacecraft, portId: DockingPortId): THREE.Vector3 | null {
        const dir = spacecraft.getDockingPortWorldDirection(portId);
        if (!dir) return null;

        const base = spacecraft.getWorldPosition();
        const boxDepth = spacecraft.objects.boxDepth;
        const portDepth = spacecraft.objects.dockingPortDepth || 0.3;
        const portLength = spacecraft.objects.dockingPortLength || 0.1;

        // Distance from center of mass to port FACE (tip) is depth + half-length
        const distance = (boxDepth / 2) + portDepth + (portLength * 0.5);
        return base.clone().add(dir.clone().multiplyScalar(distance));
    }

    // Physical docking gate: requires alignment, proximity, low lateral offset and low relative motion
    private shouldPhysicallyDock(): boolean {
        if (!this.targetSpacecraft || !this._ourPortId || !this._targetPortId) return false;
        return canDockWithinThresholds(this.spacecraft, this._ourPortId, this.targetSpacecraft, this._targetPortId);
    }

    private isStable(maxVelocity: number = 0.1, maxAngularVelocity: number = 0.1): boolean {
        const velocity = this.spacecraft.getWorldVelocity();
        const angularVelocity = this.spacecraft.getWorldAngularVelocity();
        return velocity.length() < maxVelocity && angularVelocity.length() < maxAngularVelocity;
    }

    private completeDocking(): void {
        if (!this.targetSpacecraft || !this.ourPortId || !this.targetPortId) return;

        // Final physical guard to ensure docking only occurs under valid conditions
        if (!this.shouldPhysicallyDock()) {
            return;
        }

        if (this.spacecraft.dock(this.ourPortId, this.targetSpacecraft, this.targetPortId)) {
            this.phase = 'docked';
            this.trajectoryVisualizer.clearDebugObjects();
            
            const autopilot = this.spacecraft.spacecraftController?.autopilot;
            if (autopilot) {
                autopilot.resetAllModes();
                autopilot.setReferenceObject(null);
                autopilot.setEnabled(false);
                this.spacecraft.spacecraftController?.resetThrusterLatch?.();
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
            return;
        }

        // Fallback: allow undocking even if phase wasn't set by DockingController
        const occupied = (['front', 'back'] as const).find(pid => this.spacecraft.dockingPorts[pid].isOccupied);
        if (occupied) {
            this.spacecraft.undock(occupied);
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
        // Clear reference mode on autopilot if set
        const ap = this.spacecraft.spacecraftController?.autopilot;
        ap?.setReferenceObject(null);
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
        const pitchProjected = ourPortDir.clone().projectOnPlane(pitchPlaneNormal);
        if (pitchProjected.lengthSq() > 1e-12) pitchProjected.normalize(); else pitchProjected.set(1, 0, 0);
        const targetPitchProjected = targetPortDir.clone().projectOnPlane(pitchPlaneNormal);
        if (targetPitchProjected.lengthSq() > 1e-12) targetPitchProjected.normalize(); else targetPitchProjected.set(1, 0, 0);
        const pitchError = Math.acos(Math.min(1, Math.max(-1, pitchProjected.dot(targetPitchProjected))));

        // Calculate yaw error (rotation around Y axis)
        const yawPlaneNormal = new THREE.Vector3(0, 1, 0);
        const yawProjected = ourPortDir.clone().projectOnPlane(yawPlaneNormal);
        if (yawProjected.lengthSq() > 1e-12) yawProjected.normalize(); else yawProjected.set(0, 0, 1);
        const targetYawProjected = targetPortDir.clone().projectOnPlane(yawPlaneNormal);
        if (targetYawProjected.lengthSq() > 1e-12) targetYawProjected.normalize(); else targetYawProjected.set(0, 0, 1);
        const yawError = Math.acos(Math.min(1, Math.max(-1, yawProjected.dot(targetYawProjected))));

        // Calculate roll error using each craft's local "up" projected onto the port plane
        const ourWorldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.spacecraft.getWorldOrientation());
        const targetWorldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.targetSpacecraft.getWorldOrientation());
        const ourUpPort = ourWorldUp.clone().sub(ourPortDir.clone().multiplyScalar(ourWorldUp.dot(ourPortDir)));
        const targetUpPort = targetWorldUp.clone().sub(targetPortDir.clone().multiplyScalar(targetWorldUp.dot(targetPortDir)));
        if (ourUpPort.lengthSq() > 1e-8) ourUpPort.normalize();
        if (targetUpPort.lengthSq() > 1e-8) targetUpPort.normalize();
        const rollError = Math.acos(Math.min(1, Math.max(-1, ourUpPort.dot(targetUpPort))));

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

        const rangeVector = new THREE.Vector3().subVectors(targetPortPos, ourPortPos);
        if (rangeVector.lengthSq() > 1e-12) rangeVector.normalize(); else return 0;
        return relativeVel.dot(rangeVector);
    }

    public getRange(): number | null {
        // Face-to-face distance for clearer docking feedback
        if (!this.targetSpacecraft || !this._ourPortId || !this._targetPortId) return null;
        const a = this.getPortFacePosition(this.spacecraft, this._ourPortId);
        const b = this.getPortFacePosition(this.targetSpacecraft, this._targetPortId);
        if (!a || !b) return null;
        return a.distanceTo(b);
    }

    public getGuidanceStatus(): {
        phase: DockingPhase;
        intent: string;
        modes: { orientationMatch: boolean; cancelRotation: boolean; cancelLinearMotion: boolean; pointToPosition: boolean; goToPosition: boolean };
        ports: { our: DockingPortId | null; target: DockingPortId | null };
    } {
        const ap = this.spacecraft.spacecraftController?.autopilot;
        const modes = ap?.getActiveAutopilots() || {
            orientationMatch: false,
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            goToPosition: false
        };
        let intent = 'Idle';
        switch (this.phase) {
            case 'approach':
                intent = 'Approach: flying to standoff along port axis';
                break;
            case 'align':
                intent = 'Align: matching port axis and roll; holding position';
                break;
            case 'dock':
                intent = 'Dock: closing to contact at low speed';
                break;
            case 'docked':
                intent = 'Docked';
                break;
            default:
                intent = 'Idle';
        }
        return {
            phase: this.phase,
            intent,
            modes,
            ports: { our: this._ourPortId, target: this._targetPortId }
        };
    }
}

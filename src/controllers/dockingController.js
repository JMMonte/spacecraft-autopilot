import * as THREE from 'three';
import { Trajectory } from './trajectory';

export class DockingController {
    constructor(spacecraft) {
        if (!spacecraft) {
            throw new Error('Spacecraft is required for DockingController');
        }
        this.spacecraft = spacecraft;
        this.debugObjects = [];
        this.currentWaypointIndex = 0;
        this.waypointThreshold = 1.0; // Distance in meters to consider waypoint reached
        this.lastPortAlignmentError = 0; // For tracking error derivative
        this.alignmentErrorHistory = []; // Keep track of recent errors
        this.alignmentCheckInterval = 0.5; // Check every 0.5 seconds
        this.lastAlignmentCheck = 0;
        this.reset();
    }

    reset() {
        this.targetSpacecraft = null;
        this.ourPortId = null;
        this.targetPortId = null;
        this.trajectory = null;
        this.phase = 'idle';
        this.lastTrajectoryUpdate = 0;
        this.currentWaypointIndex = 0;
        this.lastPortAlignmentError = 0;
        this.alignmentErrorHistory = [];
        this.lastAlignmentCheck = 0;
        this.clearDebugObjects();
    }

    clearDebugObjects() {
        // Remove any existing debug objects from the scene
        this.debugObjects.forEach(obj => {
            if (obj.parent) {
                obj.parent.remove(obj);
            }
        });
        this.debugObjects = [];
    }

    createDebugSphere(position, color = 0x00ff00, size = 0.1) {
        const geometry = new THREE.SphereGeometry(size, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(position);
        return sphere;
    }

    createDebugLine(points, color = 0x00ff00) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color });
        return new THREE.Line(geometry, material);
    }

    visualizeTrajectory(waypoints) {
        this.clearDebugObjects();
        
        // Get the scene from the spacecraft
        const scene = this.spacecraft.objects.box.parent;
        if (!scene) {
            console.warn('No scene available for debug visualization');
            return;
        }

        // Create spheres for waypoints
        waypoints.forEach((point, index) => {
            const color = index === 0 ? 0x0000ff : // Start point blue
                         index === waypoints.length - 1 ? 0xff0000 : // End point red
                         0x00ff00; // Intermediate points green
            const sphere = this.createDebugSphere(point, color);
            scene.add(sphere);
            this.debugObjects.push(sphere);
        });

        // Create lines connecting waypoints
        const line = this.createDebugLine(waypoints);
        scene.add(line);
        this.debugObjects.push(line);

        // Visualize target spacecraft and its docking port
        if (this.targetSpacecraft && this.targetPortId) {
            // Target spacecraft center
            const targetPos = this.targetSpacecraft.objects.boxBody.position;
            const targetSphere = this.createDebugSphere(targetPos, 0xff00ff, 0.3); // Magenta, larger sphere
            scene.add(targetSphere);
            this.debugObjects.push(targetSphere);

            // Target docking port
            const targetPort = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);
            const portSphere = this.createDebugSphere(targetPort, 0xffff00, 0.2); // Yellow sphere
            scene.add(portSphere);
            this.debugObjects.push(portSphere);

            // Target docking port direction
            const targetDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId);
            const directionLength = 2.0; // Length of direction indicator
            const directionEnd = new THREE.Vector3()
                .copy(targetPort)
                .add(targetDir.multiplyScalar(directionLength));
            
            const directionLine = this.createDebugLine(
                [targetPort, directionEnd],
                0xffff00 // Yellow line
            );
            scene.add(directionLine);
            this.debugObjects.push(directionLine);
        }
    }

    isDocking() {
        return this.phase !== 'idle';
    }

    getDockingPhase() {
        return this.phase;
    }

    startDocking(targetSpacecraft, ourPortId, targetPortId) {
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
            
            // Wait for rotation to be cancelled before proceeding
            setTimeout(() => {
                this.targetSpacecraft = targetSpacecraft;
                this.ourPortId = ourPortId;
                this.targetPortId = targetPortId;
                this.phase = 'approach';

                // Initial trajectory planning
                this.updateTrajectory();
            }, 2000); // Give it 2 seconds to cancel rotation
            
            return true;
        }

        return false;
    }

    cancelDocking() {
        if (this.spacecraft.spacecraftController?.autopilot) {
            // Reset all autopilot modes first
            this.spacecraft.spacecraftController.autopilot.resetAllModes();
        }
        this.reset();
    }

    update(dt) {
        if (!this.isDocking()) return;

        // Get autopilot first to avoid reference errors
        const autopilot = this.spacecraft.spacecraftController?.autopilot;
        if (!autopilot || !this.trajectory) {
            console.warn('Missing autopilot or trajectory');
            return;
        }

        // Get current positions and orientations
        const ourPort = this.spacecraft.getDockingPortWorldPosition(this.ourPortId);
        const targetPort = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);
        const ourDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId);
        const targetDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId);

        // Calculate range and alignment
        const range = ourPort.distanceTo(targetPort);
        const portAlignmentError = Math.acos(ourDir.dot(targetDir.negate()));

        // Get current waypoint
        if (this.currentWaypointIndex >= this.trajectory.waypoints.length) {
            console.warn('No more waypoints available');
            return;
        }

        const currentWaypoint = this.trajectory.waypoints[this.currentWaypointIndex];
        const distanceToWaypoint = ourPort.distanceTo(currentWaypoint);

        // Check if we've reached the current waypoint
        if (distanceToWaypoint < this.waypointThreshold) {
            // Move to next waypoint if available
            if (this.currentWaypointIndex < this.trajectory.waypoints.length - 1) {
                this.currentWaypointIndex++;
                console.log('Moving to next waypoint:', this.currentWaypointIndex);
            }
        }

        // Clear any existing target object to prevent defaulting to center of mass
        autopilot.clearTargetObject();

        // State machine for docking phases
        switch (this.phase) {
            case 'approach':
                // Check if we've reached the final waypoint of the approach phase
                if (this.currentWaypointIndex === this.trajectory.waypoints.length - 1) {
                    const finalApproachPoint = this.trajectory.waypoints[this.trajectory.waypoints.length - 1];
                    const distanceToFinalPoint = ourPort.distanceTo(finalApproachPoint);
                    
                    // Only transition when we're at the final approach point and relatively stable
                    if (distanceToFinalPoint < this.waypointThreshold) {
                        console.log('Approach phase complete, transitioning to alignment', {
                            distanceToFinalPoint,
                            threshold: this.waypointThreshold
                        });
                        this.phase = 'alignment';
                        this.updateTrajectory();
                        this.currentWaypointIndex = 0;
                        break;
                    }
                }

                // Set approach controls
                const approachOrientation = new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 0, 1),
                    targetDir.clone().negate()
                );
                autopilot.targetOrientation.copy(approachOrientation);
                autopilot.targetPosition.copy(this.trajectory.waypoints[this.currentWaypointIndex]);
                autopilot.setMode('goToPosition', true);
                break;

            case 'alignment':
                const alignmentPoint = this.trajectory.waypoints[0]; // Only one waypoint during alignment
                const distanceToAlignmentPoint = ourPort.distanceTo(alignmentPoint);
                
                // Use target port's direction directly for orientation
                const targetOrientation = new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 0, 1),
                    targetDir.clone().negate() // We want to point opposite to the target port's direction
                );

                // In alignment phase, maintain fixed position while aligning orientation
                autopilot.resetAllModes();
                autopilot.targetPosition.copy(alignmentPoint);
                autopilot.targetOrientation.copy(targetOrientation);
                
                // Enable position holding first to maintain position
                autopilot.setMode('goToPosition', true);
                
                // Then enable orientation control with cancelAndAlign
                // This will use the targetOrientation we set above
                autopilot.setMode('cancelAndAlign', true);
                
                // Track alignment error history and check stability
                if (Date.now() - this.lastAlignmentCheck > this.alignmentCheckInterval * 1000) {
                    this.alignmentErrorHistory.push(portAlignmentError);
                    // Keep only last 5 samples
                    if (this.alignmentErrorHistory.length > 5) {
                        this.alignmentErrorHistory.shift();
                    }
                    this.lastAlignmentCheck = Date.now();
                }

                // Calculate error derivative (rate of change)
                const errorDerivative = (portAlignmentError - this.lastPortAlignmentError) / dt;
                this.lastPortAlignmentError = portAlignmentError;

                // Check if alignment is stable
                const isStable = this.alignmentErrorHistory.length >= 5 && 
                    this.alignmentErrorHistory.every(error => error < THREE.MathUtils.degToRad(1)) && // All recent errors < 1 degree
                    Math.abs(errorDerivative) < 0.01; // Rate of change near zero

                // Only proceed to final phase when position and orientation are stable
                if (distanceToAlignmentPoint < this.waypointThreshold && isStable) {
                    console.log('Alignment phase complete, transitioning to final', {
                        distanceToAlignmentPoint,
                        alignmentError: THREE.MathUtils.radToDeg(portAlignmentError),
                        errorDerivative,
                        isStable
                    });
                    this.phase = 'final';
                    this.updateTrajectory();
                    this.currentWaypointIndex = 0;
                }
                
                // Log alignment status
                console.log('Alignment status:', {
                    distanceToAlignmentPoint,
                    alignmentError: THREE.MathUtils.radToDeg(portAlignmentError),
                    errorDerivative,
                    isStable,
                    position: ourPort.toArray(),
                    targetPosition: alignmentPoint.toArray(),
                    targetPortPosition: targetPort.toArray(),
                    targetOrientation: targetOrientation.toArray()
                });
                break;

            case 'final':
                if (range < 0.1 && portAlignmentError < THREE.MathUtils.degToRad(2)) {
                    if (this.spacecraft.dock(this.ourPortId, this.targetSpacecraft, this.targetPortId)) {
                        console.log('Docking successful');
                        this.reset();
                        return;
                    }
                }

                // Set final approach controls
                const finalOrientation = new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 0, 1),
                    targetDir.clone().negate()
                );
                autopilot.targetOrientation.copy(finalOrientation);
                autopilot.targetPosition.copy(this.trajectory.waypoints[this.currentWaypointIndex]);
                autopilot.setMode('goToPosition', true);
                break;
        }

        // Log for debugging
        console.log('Following waypoint:', {
            phase: this.phase,
            waypointIndex: this.currentWaypointIndex,
            totalWaypoints: this.trajectory.waypoints.length,
            distanceToWaypoint,
            alignmentError: THREE.MathUtils.radToDeg(portAlignmentError),
            currentPos: ourPort.toArray(),
            targetPos: this.trajectory.waypoints[this.currentWaypointIndex].toArray()
        });
    }

    updateTrajectory() {
        if (!this.isDocking()) return;

        console.log('Updating trajectory for phase:', this.phase);

        // Get positions and convert to THREE.Vector3 if needed
        const ourPort = new THREE.Vector3().copy(this.spacecraft.getDockingPortWorldPosition(this.ourPortId));
        const targetPort = new THREE.Vector3().copy(this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId));
        const ourDir = new THREE.Vector3().copy(this.spacecraft.getDockingPortWorldDirection(this.ourPortId));
        const targetDir = new THREE.Vector3().copy(this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId));

        // Get spacecraft dimensions and positions
        const ourSize = this.spacecraft.objects.boxBody.shapes[0].halfExtents;
        const targetSize = this.targetSpacecraft.objects.boxBody.shapes[0].halfExtents;
        const ourPos = new THREE.Vector3().copy(this.spacecraft.objects.boxBody.position);
        const targetPos = new THREE.Vector3().copy(this.targetSpacecraft.objects.boxBody.position);

        // Calculate bounding box dimensions with safety margin
        const safetyMargin = 1.5;
        const maxDimension = Math.max(
            ourSize.x + ourSize.y + ourSize.z,
            targetSize.x + targetSize.y + targetSize.z
        ) * safetyMargin;

        // Safe distances for different phases
        const safeDistance = maxDimension * 2;
        const finalApproachDistance = maxDimension;

        // Determine if we're approaching the far-side port
        const targetToPort = new THREE.Vector3().subVectors(targetPort, targetPos);
        const targetToUs = new THREE.Vector3().subVectors(ourPos, targetPos);
        const isFarSidePort = targetToPort.dot(targetToUs) < 0;

        // Create approach vector aligned with target's docking port
        const approachVector = targetDir.clone(); // Points in the same direction as the port

        // Calculate waypoints based on current phase
        const waypoints = [];
        waypoints.push(ourPort.clone()); // Start at our current position

        switch (this.phase) {
            case 'approach':
                // 1. First move back from our port
                const backoffPoint = ourPort.clone().add(
                    ourDir.clone().multiplyScalar(maxDimension)
                );
                waypoints.push(backoffPoint);

                if (isFarSidePort) {
                    // For far-side port, we need to go around the target spacecraft
                    const up = new THREE.Vector3(0, 1, 0);
                    const right = new THREE.Vector3().crossVectors(approachVector, up).normalize();
                    
                    // Calculate which side to pass on based on current position
                    const rightOffset = right.dot(new THREE.Vector3().subVectors(ourPos, targetPort));
                    const sideDir = rightOffset > 0 ? right : right.clone().negate();
                    
                    // Create a wide path around the target
                    const sideOffset = maxDimension * 3; // Wider offset for safety
                    
                    // First intermediate point - move out to side
                    const sidePoint1 = targetPos.clone().add(
                        sideDir.clone().multiplyScalar(sideOffset)
                    );
                    waypoints.push(sidePoint1);
                    
                    // Second intermediate point - move past the target
                    const sidePoint2 = sidePoint1.clone().add(
                        approachVector.clone().multiplyScalar(sideOffset)
                    );
                    waypoints.push(sidePoint2);
                    
                    // Finally move to approach point
                    const approachPoint = targetPort.clone().add(
                        approachVector.clone().multiplyScalar(safeDistance)
                    );
                    waypoints.push(approachPoint);
                } else {
                    // For near-side port, direct approach is fine
                    const approachPoint = targetPort.clone().add(
                        approachVector.clone().multiplyScalar(safeDistance)
                    );
                    waypoints.push(approachPoint);
                }
                break;

            case 'alignment':
                // During alignment, stay at the approach vector position
                const alignmentPoint = targetPort.clone().add(
                    approachVector.clone().multiplyScalar(safeDistance)
                );
                this.trajectory = new Trajectory([alignmentPoint], 0); // Single point, no movement
                this.visualizeTrajectory([alignmentPoint]);
                return; // Exit early since we don't need the rest of the trajectory setup

            case 'final':
                // Create final approach point
                const finalApproachPoint = targetPort.clone().add(
                    approachVector.clone().multiplyScalar(finalApproachDistance)
                );
                waypoints.push(finalApproachPoint);
                waypoints.push(targetPort.clone());
                break;
        }

        // Create new trajectory with appropriate timing based on phase
        const baseTime = 60;
        const totalTime = this.phase === 'final' ? 
            baseTime * 0.5 : 
            baseTime * (waypoints.length - 1);
        
        this.trajectory = new Trajectory(waypoints, totalTime);
        
        // Visualize the trajectory
        this.visualizeTrajectory(waypoints);
        
        console.log('New trajectory created with', waypoints.length, 'waypoints', {
            isFarSidePort,
            phase: this.phase,
            numWaypoints: waypoints.length
        });
    }
}

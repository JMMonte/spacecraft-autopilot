/*******************************************
 * dockingController.js
 *******************************************/

import * as THREE from 'three';
import { Trajectory } from './trajectory';

export class DockingController {
    constructor(spacecraft, autopilot) {
        this.spacecraft = spacecraft;
        this.autopilot = autopilot;
        this.trajectory = new Trajectory();
        
        // Docking sequence phases
        this.PHASES = {
            IDLE: 'idle',
            APPROACH: 'approach',
            ALIGN: 'align',
            FINAL_APPROACH: 'final_approach',
            DOCKED: 'docked'
        };
        
        this.currentPhase = this.PHASES.IDLE;
        this.targetSpacecraft = null;
        this.ourPortId = null;
        this.targetPortId = null;
        
        // Docking parameters
        this.approachDistance = 10;    // Distance to start final approach from
        this.dockingSpeed = 0.5;       // Speed for final approach (m/s)
        this.alignmentThreshold = 0.01; // Radians
        this.positionThreshold = 0.1;   // Meters
        
        // Safety parameters
        this.minSafeDistance = 5;     // Minimum safe distance for approach
        this.collisionRadius = 2;     // Radius to check for collision avoidance
        this.avoidanceMargin = 1;     // Extra margin for avoidance maneuvers
    }

    /**
     * Start docking sequence with target spacecraft
     * @param {Spacecraft} targetSpacecraft - The spacecraft to dock with
     * @param {string} ourPortId - Our docking port ID ('front' or 'back')
     * @param {string} targetPortId - Target spacecraft's docking port ID
     */
    startDocking(targetSpacecraft, ourPortId = 'front', targetPortId = 'back') {
        if (!targetSpacecraft) {
            console.warn('No target spacecraft provided');
            return;
        }

        // Verify ports are available
        if (!this.spacecraft.isDockingPortAvailable(ourPortId)) {
            console.warn('Our docking port is not available');
            return;
        }
        if (!targetSpacecraft.isDockingPortAvailable(targetPortId)) {
            console.warn('Target docking port is not available');
            return;
        }

        this.targetSpacecraft = targetSpacecraft;
        this.ourPortId = ourPortId;
        this.targetPortId = targetPortId;
        this.currentPhase = this.PHASES.APPROACH;
        
        // Calculate approach point
        const approachPoint = this.calculateApproachPoint();
        
        // Set initial trajectory
        this.trajectory = new Trajectory([
            new THREE.Vector3().copy(this.spacecraft.objects.boxBody.position),
            approachPoint
        ]);

        // Start approach phase
        this.autopilot.setMode('goToPosition', true);
        this.autopilot.setTargetObject(targetSpacecraft, 'dockingPort');
    }

    /**
     * Update docking sequence
     */
    update(dt) {
        if (this.currentPhase === this.PHASES.IDLE) return;

        // Update target tracking
        if (this.targetSpacecraft) {
            this.autopilot.updateTargetFromObject();
        }

        // Check for collision risks
        if (this.checkCollisionRisk()) {
            this.performAvoidanceManeuver();
            return;
        }

        switch (this.currentPhase) {
            case this.PHASES.APPROACH:
                this.updateApproachPhase();
                break;
            case this.PHASES.ALIGN:
                this.updateAlignPhase();
                break;
            case this.PHASES.FINAL_APPROACH:
                this.updateFinalApproachPhase();
                break;
        }
    }

    /**
     * Calculate safe approach point based on target's docking port
     */
    calculateApproachPoint() {
        const targetPortPos = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);
        const targetPortDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId);
        
        // Calculate approach point at safe distance along port direction
        const approachPoint = targetPortPos.clone();
        approachPoint.add(targetPortDir.multiplyScalar(this.approachDistance));
        
        return approachPoint;
    }

    /**
     * Update approach phase
     */
    updateApproachPhase() {
        const currentPos = this.spacecraft.objects.boxBody.position;
        const approachPoint = this.calculateApproachPoint();
        const distanceToApproach = new THREE.Vector3().copy(currentPos).distanceTo(approachPoint);

        // Update trajectory target
        this.autopilot.targetPosition.copy(approachPoint);

        // Check if we've reached approach point
        if (distanceToApproach < this.positionThreshold) {
            this.currentPhase = this.PHASES.ALIGN;
            this.autopilot.setMode('pointToPosition', true);
        }
    }

    /**
     * Update alignment phase - align our port with target port
     */
    updateAlignPhase() {
        // Get port directions in world space
        const ourPortDir = this.spacecraft.getDockingPortWorldDirection(this.ourPortId);
        const targetPortDir = this.targetSpacecraft.getDockingPortWorldDirection(this.targetPortId);
        
        // Calculate desired orientation
        const desiredUp = new THREE.Vector3(0, 1, 0); // Keep spacecraft "upright"
        const desiredForward = targetPortDir.clone().negate(); // Point our port at their port
        
        // Create rotation matrix from desired orientation
        const matrix = new THREE.Matrix4();
        const right = new THREE.Vector3().crossVectors(desiredUp, desiredForward).normalize();
        const adjustedUp = new THREE.Vector3().crossVectors(desiredForward, right);
        matrix.makeBasis(right, adjustedUp, desiredForward);
        
        // Convert to quaternion
        const desiredQuaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
        this.autopilot.targetOrientation.copy(desiredQuaternion);
        
        // Calculate alignment error
        const currentQuat = this.spacecraft.objects.boxBody.quaternion;
        const errorQuat = new THREE.Quaternion().multiplyQuaternions(
            desiredQuaternion,
            new THREE.Quaternion().copy(currentQuat).invert()
        );
        const alignmentError = 2 * Math.acos(Math.abs(errorQuat.w));

        // Check if aligned
        if (alignmentError < this.alignmentThreshold) {
            this.currentPhase = this.PHASES.FINAL_APPROACH;
            this.autopilot.setMode('goToPosition', true);
        }
    }

    /**
     * Update final approach phase
     */
    updateFinalApproachPhase() {
        const ourPortPos = this.spacecraft.getDockingPortWorldPosition(this.ourPortId);
        const targetPortPos = this.targetSpacecraft.getDockingPortWorldPosition(this.targetPortId);
        const distanceToTarget = ourPortPos.distanceTo(targetPortPos);

        // Update target position to target port
        this.autopilot.targetPosition.copy(targetPortPos);

        // Calculate approach velocity
        const approachDir = new THREE.Vector3().subVectors(targetPortPos, ourPortPos).normalize();
        const approachVel = approachDir.multiplyScalar(this.dockingSpeed);
        
        // Apply velocity
        this.spacecraft.objects.boxBody.velocity.copy(approachVel);

        // Check if close enough to dock
        if (distanceToTarget < this.positionThreshold) {
            this.completeDocking();
        }
    }

    /**
     * Complete docking sequence
     */
    completeDocking() {
        // Perform physical docking
        const success = this.spacecraft.dock(
            this.ourPortId,
            this.targetSpacecraft,
            this.targetPortId
        );

        if (success) {
            this.currentPhase = this.PHASES.DOCKED;
            this.autopilot.setMode('cancelAndAlign', false);
            this.autopilot.setMode('goToPosition', false);
            console.log('Docking completed successfully!');
        } else {
            console.warn('Failed to complete docking');
            this.cancelDocking();
        }
    }

    /**
     * Check for collision risks
     */
    checkCollisionRisk() {
        if (!this.targetSpacecraft) return false;

        const currentPos = this.spacecraft.objects.boxBody.position;
        const targetPos = this.targetSpacecraft.objects.boxBody.position;
        const distance = currentPos.distanceTo(targetPos);

        // Check if we're too close and not in final approach
        if (distance < this.minSafeDistance && this.currentPhase !== this.PHASES.FINAL_APPROACH) {
            return true;
        }

        // Additional collision checks could be added here
        return false;
    }

    /**
     * Perform collision avoidance maneuver
     */
    performAvoidanceManeuver() {
        const currentPos = this.spacecraft.objects.boxBody.position;
        const targetPos = this.targetSpacecraft.objects.boxBody.position;
        
        // Calculate avoidance direction (perpendicular to approach vector)
        const approachVector = new THREE.Vector3().subVectors(targetPos, currentPos);
        const avoidanceVector = new THREE.Vector3(-approachVector.y, approachVector.x, 0)
            .normalize()
            .multiplyScalar(this.avoidanceMargin);
        
        // Set new target position for avoidance
        const avoidancePoint = new THREE.Vector3().copy(currentPos).add(avoidanceVector);
        this.autopilot.targetPosition.copy(avoidancePoint);
        
        // Enable position control
        this.autopilot.setMode('goToPosition', true);
    }

    /**
     * Cancel docking sequence
     */
    cancelDocking() {
        this.currentPhase = this.PHASES.IDLE;
        this.targetSpacecraft = null;
        this.ourPortId = null;
        this.targetPortId = null;
        this.autopilot.setMode('cancelAndAlign', false);
        this.autopilot.setMode('goToPosition', false);
        this.autopilot.clearTargetObject();
    }

    /**
     * Get current docking phase
     */
    getDockingPhase() {
        return this.currentPhase;
    }

    /**
     * Check if currently docking
     */
    isDocking() {
        return this.currentPhase !== this.PHASES.IDLE;
    }
} 
import * as THREE from 'three';
import * as CANNON from 'cannon';
import { PIDController } from './pidController';
import { applyQuaternionToVector } from './utils';

class Autopilot {
    constructor(spacecraft) {
        this.spacecraft = spacecraft;
        this.isEnabled = false;
        this.targetOrientation = new THREE.Quaternion(0, 0, 0, 1);
        this.pidController = new PIDController(5, 0.05, 2);
        this.orientationPidController = new PIDController(0.1, 0.01, 0.05); // Tuned for orientation correction
        this.autopilotThreshold = 0.01;
        this.maxAngularVelocity = 10; // Define based on your requirements
        this.minAngularMomentumMagnitude = 0.1; // Define based on your requirements
        this.phase = 0; // Start with the Initialization phase
    }

    toggleAutopilot() {
        this.isEnabled = !this.isEnabled;
        this.phase = 0; // Reset to Initialization phase
        if (this.isEnabled) {
            // Reset the target orientation to the current spacecraft orientation
            if (this.spacecraft?.objects.boxBody) {
                this.targetOrientation.copy(this.spacecraft.objects.boxBody.quaternion);
            } else {
                console.log('Spacecraft or body is undefined.');
            }
        }
    }

    calculateAutopilotForces() {
        console.log("this.phase: ", this.phase);
        // Update current state
        const currentQuaternion = new THREE.Quaternion().copy(this.spacecraft.objects.boxBody.quaternion).normalize();
        const targetQuaternion = this.targetOrientation.normalize();
        const errorQuaternion = targetQuaternion.clone().multiply(currentQuaternion.invert()).normalize();
        const orientationError = 2 * Math.acos(Math.min(1, Math.abs(errorQuaternion.w)));
        const currentAngularVelocity = new THREE.Vector3().copy(this.spacecraft.objects.boxBody.angularVelocity);
        const momentOfInertia = this.calculateMomentOfInertia();
        const currentAngularMomentum = currentAngularVelocity.clone().multiplyScalar(momentOfInertia);
        const currentAngularMomentumMagnitude = currentAngularMomentum.length();
    
        // Check if angular momentum is below a threshold and if orientation error is significant
        const angularMomentumIsLow = currentAngularMomentumMagnitude <= this.minAngularMomentumMagnitude;
        const orientationNeedsCorrection = orientationError > this.autopilotThreshold;
    
        // Phase control logic adjustments
        if (!angularMomentumIsLow && this.phase !== 3) {
            this.phase = 1; // Angular Momentum Cancellation phase
        } else if (angularMomentumIsLow && orientationNeedsCorrection) {
            this.phase = 3; // Orientation Correction phase
        } else if (angularMomentumIsLow && !orientationNeedsCorrection) {
            this.phase = 5; // Fine Alignment phase
        }
    
        // Handle phases explicitly
        if (this.phase === 1) {
            return this.applyDamping(currentAngularMomentum, currentQuaternion, momentOfInertia, true);
        } else if (this.phase === 3 || this.phase === 5) {
            return this.adjustAngularVelocityForOrientation(errorQuaternion, currentAngularMomentum, currentQuaternion, momentOfInertia, orientationError);
        }
    
        // Default return if none of the conditions are met
        return Array(24).fill(0);
    }
    
    
    applyDamping(currentAngularMomentum, currentQuaternion, momentOfInertia, fullDamp = false) {
        const dampingFactor = fullDamp ? 1.0 : 0.1; // Use stronger damping if fullDamp is true
        const angularMomentumError = currentAngularMomentum.clone().negate().multiplyScalar(dampingFactor);
        let pidOutput = this.pidController.update(new CANNON.Vec3(angularMomentumError.x, angularMomentumError.y, angularMomentumError.z), 1 / 60);
        let pidOutputVector = new THREE.Vector3(pidOutput.x, pidOutput.y, pidOutput.z);
        pidOutputVector = this.transformLocalToGlobal(pidOutputVector, currentQuaternion);
        return this.applyPIDOutputToThrusters(pidOutputVector);
    }
    
    adjustAngularVelocityForOrientation(errorQuaternion, currentAngularMomentum, currentQuaternion, momentOfInertia, orientationError) {
        let desiredAngularVelocity = this.quaternionToAngularVelocity(errorQuaternion, momentOfInertia);
        const reductionFactor = this.calculateReductionFactor(desiredAngularVelocity, orientationError);
        desiredAngularVelocity.divideScalar(reductionFactor);
        const desiredAngularMomentum = desiredAngularVelocity.multiplyScalar(momentOfInertia);
        const angularMomentumError = desiredAngularMomentum.sub(currentAngularMomentum);
        let pidOutput = this.pidController.update(new CANNON.Vec3(angularMomentumError.x, angularMomentumError.y, angularMomentumError.z), 1 / 60);
        let pidOutputVector = new THREE.Vector3(pidOutput.x, pidOutput.y, pidOutput.z);
    
        // Apply dynamic braking based on proximity to target orientation
        let currentAngularVelocity = this.spacecraft.objects.boxBody.angularVelocity;
        const brakingFactor = this.calculateBrakingFactor(orientationError, currentAngularVelocity);
        pidOutputVector.multiplyScalar(brakingFactor);
        pidOutputVector = this.transformLocalToGlobal(pidOutputVector, currentQuaternion);
        return this.applyPIDOutputToThrusters(pidOutputVector);
    }
    calculateReductionFactor(desiredAngularVelocity, orientationError) {
        let reductionFactor = 1; // Default reduction factor
        let someThresholdValue = 0.1; // Define based on your requirements
        let someAdjustmentFactor = 0.5; // Define based on your requirements
        
        // Adjust reduction based on orientation error and phase
        if (this.phase === 3) { // Orientation correction phase
            reductionFactor = Math.max(1, desiredAngularVelocity.length() / this.maxAngularVelocity);
        } else if (this.phase === 5) { // Fine alignment phase
            reductionFactor = Math.max(1, desiredAngularVelocity.length() / (this.maxAngularVelocity / 4));
        }
    
        // Optionally, further refine reduction factor based on orientation error
        // This can make the control action more conservative as the error decreases
        if (orientationError < someThresholdValue) {
            reductionFactor *= someAdjustmentFactor;
        }
    
        return reductionFactor;
    }
    
    calculateBrakingFactor(orientationError, currentAngularVelocity) {
        // Calculate braking factor based on orientation error and current angular velocity
        const errorFactor = Math.exp(-orientationError); // Decreases as error decreases, making braking more aggressive
        const velocityMagnitude = currentAngularVelocity.length();
        const velocityFactor = (velocityMagnitude > this.minAngularMomentumMagnitude) ? (1 - velocityMagnitude / this.maxAngularVelocity) : 1;
        return errorFactor * velocityFactor;
    }
    

    applyPIDOutputToThrusters(pidOutput) {
        const thrusterForces = Array(24).fill(0);
    
        const pitchForcePerThruster = this.calculateForcePerThruster(pidOutput.x, 'pitch');
        const yawForcePerThruster = this.calculateForcePerThruster(pidOutput.y, 'yaw');
        const rollForcePerThruster = this.calculateForcePerThruster(pidOutput.z, 'roll');
    
        this.applyForceToGroup(this.thrusterGroups.pitch[pidOutput.x >= 0 ? 1 : 0], pitchForcePerThruster, thrusterForces);
        this.applyForceToGroup(this.thrusterGroups.yaw[pidOutput.y >= 0 ? 0 : 1], yawForcePerThruster, thrusterForces);
        this.applyForceToGroup(this.thrusterGroups.roll[pidOutput.z >= 0 ? 0 : 1], rollForcePerThruster, thrusterForces);
    
        return thrusterForces;
    }

    calculateForcePerThruster(torqueComponent, controlAxis) {
        const numThrusters = this.thrusterGroups[controlAxis][0].length + this.thrusterGroups[controlAxis][1].length;
        return Math.abs(torqueComponent) * this.thrust / numThrusters;
    }

    calculateForcePerThruster(torqueComponent, controlAxis) {
        // Assuming equal distribution among thrusters in each group and using this.thrust as max thrust per thruster
        const numThrusters = this.thrusterGroups[controlAxis][0].length + this.thrusterGroups[controlAxis][1].length;
        return Math.abs(torqueComponent) * this.thrust / numThrusters;
    }

    applyForceToGroup(thrusterGroup, forcePerThruster, thrusterForces) {
        thrusterGroup.forEach(index => {
            thrusterForces[index] += Math.min(forcePerThruster, this.thrust);
        });
    }
}

export default Autopilot;

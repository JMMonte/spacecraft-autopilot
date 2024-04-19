import * as THREE from 'three';
import * as CANNON from 'cannon';
import { PIDController } from './pidController';
import { applyQuaternionToVector } from './utils';

export class SpacecraftController {
    constructor(spacecraft, currentTarget) {
        this.spacecraft = spacecraft;
        this.isAutopilotEnabled = false;
        this.keysPressed = {};
        this.targetOrientation = new THREE.Quaternion(0, 0, 0, 1);
        this.pidController = new PIDController(5, 0.05, 2);
        this.orientationPidController = new PIDController(0.1, 0.01, 0.05); // Tuned for orientation correction
        this.thrust = 1200;
        this.thrusterGroups = this.defineThrusterGroups();
        this.maxAngularMomentum = 100; // Define based on your requirements
        this.maxAngularVelocity = 10; // Define based on your requirements
        this.autopilotThreshold = 0.01;
        this.phase = 0; // Start with the Initialization phase
        this.lastAngularMomentumMagnitude = 0; // Track the last magnitude of angular momentum
        this.minAngularMomentumMagnitude = 0.1; // Define based on your requirements
        this.angularMomentumHysteresis = 0.1; // Example value, adjust as needed
        document.addEventListener('keydown', this.handleKeyDown.bind(this), false);
        document.addEventListener('keyup', this.handleKeyUp.bind(this), false);
        this.currentTarget = currentTarget.uuid;
        this.orientationCorrectionInProgress = false; // Reset the flag after alignment is achieved
        // this.autopilot = new Autopilot(spacecraft);
    }

    transformLocalToGlobal(localVector, currentQuaternion) {
        let globalVector = localVector.clone();
        globalVector.applyQuaternion(currentQuaternion);
        return globalVector;
    }

    handleKeyDown(event) {
        this.keysPressed[event.code] = true;
        if (event.code === 'KeyT') this.toggleAutopilot();
    }

    handleKeyUp(event) {
        this.keysPressed[event.code] = false;
    }

    toggleAutopilot() {
        this.isAutopilotEnabled = !this.isAutopilotEnabled;
        this.phase = 0; // Reset to Initialization phase
    
        if (this.isAutopilotEnabled) {
            // Reset the target orientation to the current spacecraft orientation
            if (this.spacecraft?.objects.boxBody) {
                this.targetOrientation.copy(this.spacecraft.objects.boxBody.quaternion);
            } else {
                console.log('Spacecraft or body is undefined.');
            }
        }
    
        document.dispatchEvent(new CustomEvent('autopilotStateChanged', { detail: this.isAutopilotEnabled }));
    }

    calculateAutopilotForces() {
        const currentQuaternion = new THREE.Quaternion().copy(this.spacecraft.objects.boxBody.quaternion).normalize();
        const targetQuaternion = this.targetOrientation.normalize();
        const errorQuaternion = targetQuaternion.clone().multiply(currentQuaternion.invert()).normalize();
        const orientationError = 2 * Math.acos(Math.min(1, Math.abs(errorQuaternion.w)));
        const currentAngularVelocity = new THREE.Vector3().copy(this.spacecraft.objects.boxBody.angularVelocity);
        const momentOfInertia = this.calculateMomentOfInertia();
        const currentAngularMomentum = currentAngularVelocity.clone().multiplyScalar(momentOfInertia);
        const currentAngularMomentumMagnitude = currentAngularMomentum.length();
    
        const angularMomentumIsLow = currentAngularMomentumMagnitude <= this.minAngularMomentumMagnitude;
        const orientationNeedsCorrection = orientationError > this.autopilotThreshold;
    
        // Implementing hysteresis for smoother phase transitions
        if (this.phase !== 3 && !angularMomentumIsLow) {
            this.phase = 1; // Angular momentum damping phase
        } else if (angularMomentumIsLow && orientationNeedsCorrection) {
            this.phase = 3; // Orientation correction phase
        }
    
        if (this.phase === 1) {
            return this.applyDamping(currentAngularMomentum, currentQuaternion, true);
        } else if (this.phase === 3) {
            return this.adjustAngularVelocityForOrientation(errorQuaternion, currentAngularMomentum, currentQuaternion, momentOfInertia);
        }
        return Array(24).fill(0); // No action if no conditions are met
    }

    applyDamping(currentAngularMomentum, currentQuaternion, fullDamp = false) {
        const dampingFactor = fullDamp ? 1.0 : 0.1; // Use stronger damping if fullDamp is true
        const angularMomentumError = currentAngularMomentum.clone().negate().multiplyScalar(dampingFactor);
        let pidOutput = this.pidController.update(new CANNON.Vec3(angularMomentumError.x, angularMomentumError.y, angularMomentumError.z), 1 / 60);
        let pidOutputVector = new THREE.Vector3(pidOutput.x, pidOutput.y, pidOutput.z);
        pidOutputVector = this.transformLocalToGlobal(pidOutputVector, currentQuaternion);
        return this.applyPIDOutputToThrusters(pidOutputVector);
    }

    adjustAngularVelocityForOrientation(errorQuaternion, currentAngularMomentum, currentQuaternion, momentOfInertia) {
        // Calculate the control signal using the error quaternion and current angular velocity
        const controlSignal = this.calculateControlSignal(errorQuaternion);
    
        // Convert the error quaternion to angular velocity, ensuring the shortest path
        let desiredAngularVelocity = this.quaternionToAngularVelocity(errorQuaternion, true);
    
        // Apply the control signal to modulate the desired angular velocity
        desiredAngularVelocity.multiplyScalar(controlSignal);
    
        // Calculate desired angular momentum
        const desiredAngularMomentum = desiredAngularVelocity.multiplyScalar(momentOfInertia);
    
        // Determine the angular momentum error
        const angularMomentumError = desiredAngularMomentum.sub(currentAngularMomentum);
    
        // Update the PID controller with the angular momentum error
        let pidOutput = this.pidController.update(new CANNON.Vec3(angularMomentumError.x, angularMomentumError.y, angularMomentumError.z), 1 / 60);
        let pidOutputVector = new THREE.Vector3(pidOutput.x, pidOutput.y, pidOutput.z);
    
        // Convert the PID output from local to global coordinates and apply to thrusters
        pidOutputVector = this.transformLocalToGlobal(pidOutputVector, currentQuaternion);
    
        return this.applyPIDOutputToThrusters(pidOutputVector);
    }

    calculateControlSignal(errorQuaternion) {
        // Convert errorQuaternion to an angle to quantify the orientation error
        let orientationError = 2 * Math.acos(Math.abs(errorQuaternion.w));
        
        // Normalize orientation error to [0, 1] range, assuming orientationError is in radians
        orientationError /= Math.PI;
        
        // Set a maximum control signal value
        const maxControlSignal = 0.5;
        const controlSignal = Math.min(orientationError, maxControlSignal);
        
        return controlSignal;
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

    // GENERAL

    applyForces() {
        const isCurrentTarget = this.currentTarget === this.spacecraft.objects.box.uuid;
        // console.log("Is current target: ", isCurrentTarget);
        if (!isCurrentTarget) { // Skip if the spacecraft is not the current target
            return Array(24).fill(false);
        } else {
            const manualForces = this.calculateManualForces();
            const autopilotForces = this.isAutopilotEnabled ? this.calculateAutopilotForces() : Array(24).fill(0);
            const combinedForces = manualForces.map((force, index) => force + autopilotForces[index]);
            const coneVisibility = this.applyForcesToThrusters(combinedForces);
    
            this.spacecraft.rcsVisuals.coneMeshes.forEach((coneMesh, index) => {
                coneMesh.visible = coneVisibility[index];
            });
    
            this.updateHelpers(combinedForces);
            return coneVisibility;
        }
    }

    applyForcesToThrusters(forces) {
        const coneVisibility = forces.map(force => force > 0);

        forces.forEach((force, index) => {
            const clampedForce = Math.min(Math.max(force, 0), this.thrust);
            if (clampedForce > 0) {
                this.spacecraft.rcsVisuals.applyForce(index, clampedForce);
            }
        });

        this.spacecraft.rcsVisuals.coneMeshes.forEach((coneMesh, index) => {
            coneMesh.visible = coneVisibility[index];
        });

        return coneVisibility;
    }

    calculateManualForces() {
        const forces = Array(24).fill(0);

        Object.entries(this.keyToThrusters()).forEach(([key, indices]) => {
            if (!this.keysPressed[key]) return;
            const forceMagnitude = this.rotationKeys().includes(key) ? this.thrust / 2 : this.thrust;
            indices.forEach(index => forces[index] = forceMagnitude);
        });

        return forces;
    }

    defineThrusterGroups() {
        return {
            pitch: [[0, 2, 5, 7, 8, 9, 14, 15], [1, 3, 4, 6, 10, 11, 12, 13]],
            yaw: [[0, 1, 6, 7, 16, 17, 22, 23], [2, 3, 4, 5, 18, 19, 20, 21]],
            roll: [[8, 11, 13, 14, 16, 18, 21, 23], [9, 10, 12, 15, 17, 19, 20, 22]],
            forward: [[0, 1, 2, 3], [4, 5, 6, 7]],
            up: [[12, 13, 14, 15], [8, 9, 10, 11]],
            left: [[16, 17, 18, 19], [20, 21, 22, 23]]
        };
    }

    keyToThrusters() {
        return {
            'KeyW': this.thrusterGroups.pitch[0],
            'KeyS': this.thrusterGroups.pitch[1],
            'KeyA': this.thrusterGroups.yaw[0],
            'KeyD': this.thrusterGroups.yaw[1],
            'KeyQ': this.thrusterGroups.roll[0],
            'KeyE': this.thrusterGroups.roll[1],
            'KeyU': this.thrusterGroups.forward[0],
            'KeyO': this.thrusterGroups.forward[1],
            'KeyK': this.thrusterGroups.up[0],
            'KeyI': this.thrusterGroups.up[1],
            'KeyJ': this.thrusterGroups.left[0],
            'KeyL': this.thrusterGroups.left[1]
        };
    }

    rotationKeys() {
        return ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'];
    }

    updateHelpers(thrustForces) {
        if (!this.spacecraft || !this.spacecraft.objects.boxBody || !this.targetOrientation) {
            console.warn('Skipping updateHelpers due to missing prerequisites.');
            return;
        }

        const currentAngularVelocity = this.spacecraft.objects.boxBody.angularVelocity;

        const pitchTorque = thrustForces[0] + thrustForces[3] + thrustForces[4] + thrustForces[7];
        const yawTorque = thrustForces[8] + thrustForces[11] + thrustForces[12] + thrustForces[15];
        const rollTorque = thrustForces[1] + thrustForces[2] + thrustForces[5] + thrustForces[6];

        const defaultForwardVector = { x: 0, y: 0, z: 1 };
        const targetOrientationVector = applyQuaternionToVector(this.targetOrientation, defaultForwardVector);
        const directionVector = new CANNON.Vec3(targetOrientationVector.x, targetOrientationVector.y, targetOrientationVector.z);

        const autopilotTorque = new CANNON.Vec3(pitchTorque, yawTorque, rollTorque);
        autopilotTorque.normalize();

        const rotationAxis = currentAngularVelocity.clone();
        rotationAxis.normalize();

        const orientationVector = this.spacecraft.objects.boxBody.quaternion.vmult(defaultForwardVector);
        const normalizedOrientationVector = new CANNON.Vec3(orientationVector.x, orientationVector.y, orientationVector.z);
        normalizedOrientationVector.normalize();

        this.spacecraft.world.helpers.updateAutopilotArrow(this.spacecraft.objects.boxBody.position, directionVector);
        this.spacecraft.world.helpers.updateAutopilotTorqueArrow(this.spacecraft.objects.boxBody.position, autopilotTorque);
        this.spacecraft.world.helpers.updateRotationAxisArrow(this.spacecraft.objects.boxBody.position, rotationAxis);
        this.spacecraft.world.helpers.updateOrientationArrow(this.spacecraft.objects.boxBody.position, normalizedOrientationVector);
    }
    updatePIDParameters(kp, ki, kd) {
        this.pidController.kp = kp;
        this.pidController.ki = ki;
        this.pidController.kd = kd;
    }

    calculateMomentOfInertia() {
        const mass = this.spacecraft.objects.boxBody.mass;
        const size = this.spacecraft.objects.boxBody.shapes[0].halfExtents;
        
        const w = size.x;
        const h = size.y;
        const d = size.z;
    
        // Calculate moment of inertia for each axis
        const Ix = (1/12) * mass * (h*h + d*d);
        const Iy = (1/12) * mass * (w*w + d*d);
        const Iz = (1/12) * mass * (w*w + h*h);
    
        // Using the maximum moment of inertia for safety
        return Math.max(Ix, Iy, Iz);
    }

    quaternionToAngularVelocity(quaternion, ensureShortestPath = false) {
        let angle = 2 * Math.acos(quaternion.w);
        let sinHalfAngle = Math.sqrt(1 - quaternion.w * quaternion.w);
        let axis = new THREE.Vector3(quaternion.x, quaternion.y, quaternion.z);
    
        if (sinHalfAngle > 0.01) {
            axis.normalize().multiplyScalar(angle / sinHalfAngle);
        } else {
            // When sinHalfAngle is very small, the axis direction becomes less relevant,
            // but the angle itself is very small too, so we can approximate to zero angular velocity.
            axis.set(0, 0, 0); // Essentially no rotation
        }
    
        if (ensureShortestPath && angle > Math.PI) {
            // Adjust for the shortest path
            angle = 2 * Math.PI - angle;
            axis.negate();
        }
    
        // Correct the calculation when ensuring the shortest path
        if (ensureShortestPath) {
            axis.multiplyScalar(sinHalfAngle > 0.001 ? angle / sinHalfAngle : 0);
        }
    
        return axis; // Angular velocity vector
    }
    

}
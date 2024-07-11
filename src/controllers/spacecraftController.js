import * as CANNON from 'cannon';
import { applyQuaternionToVector } from '../utils/utils';
import { Autopilot } from './autopilot';

export class SpacecraftController {
    constructor(spacecraft, currentTarget, helpers) {
        this.isActive = false; // Initialize isActive property
        this.initializeProperties(spacecraft, currentTarget, helpers);
    }

    initializeProperties(spacecraft, currentTarget, helpers) {
        this.spacecraft = spacecraft;
        this.currentTarget = currentTarget.uuid;
        this.keysPressed = {};
        this.thrusterGroups = this.defineThrusterGroups(); // Define thruster groups
        this.mass = spacecraft.objects.boxBody.mass; // Use spacecraft's mass
        const thrustFactor = 5; // Adjust this value to control the spacecraft's thrust
        this.thrust = this.mass / 24 * thrustFactor; // Calculate thrust per thruster
        this.autopilot = new Autopilot(spacecraft, this.thrusterGroups, this.thrust); // Pass thruster groups to Autopilot
        this.helpers = helpers; // Add helpers
    }

    handleKeyDown(event) {
        if (this.isActive) {
            this.keysPressed[event.code] = true;
            this.handleManualControl(event.code);
            this.handleAutopilotControl(event.code);
        }
    }

    handleKeyUp(event) {
        if (this.isActive) {
            this.keysPressed[event.code] = false;
        }
    }

    handleManualControl(code) {
        if (this.rotationKeys().includes(code) || this.translationKeys().includes(code)) {
            this.keysPressed[code] = true;
        }
    }

    handleAutopilotControl(code) {
        switch (code) {
            case 'KeyT':
                this.autopilot.isTrackingTarget = false;
                this.autopilot.setTargetOrientation();
                this.autopilot.cancelAndAlign();
                break;
            case 'KeyY':
                this.autopilot.pointToPosition();
                break;
            case 'KeyR':
                this.autopilot.cancelRotation();
                break;
            case 'KeyG':
                this.autopilot.cancelLinearMotion();
                break;
            case 'KeyB':
                this.autopilot.isTrackingTarget = false;
                this.autopilot.goToPosition();
                break;
            default:
                break;
        }
    }

    applyForces() {
        const manualForces = this.calculateManualForces();
        const autopilotForces = this.autopilot.isAutopilotEnabled ? this.autopilot.calculateAutopilotForces() : Array(24).fill(0);
        const combinedForces = manualForces.map((force, index) => force + autopilotForces[index]);
        const coneVisibility = this.applyForcesToThrusters(combinedForces);

        this.spacecraft.rcsVisuals.coneMeshes.forEach((coneMesh, index) => {
            coneMesh.visible = coneVisibility[index];
        });

        this.updateHelpers(combinedForces);
        return coneVisibility;
    }

    applyForcesToThrusters(forces) {
        const coneVisibility = forces.map(force => force > 0);

        forces.forEach((force, index) => {
            const clampedForce = Math.min(Math.max(force, 0), this.thrust); // Use spacecraftController's thrust
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
            const forceMagnitude = this.rotationKeys().includes(key) ? this.thrust / 2 : this.thrust; // Use spacecraftController's thrust
            indices.forEach(index => forces[index] = forceMagnitude);
        });

        return forces;
    }

    updateHelpers(thrustForces) {
        if (!this.spacecraft || !this.spacecraft.objects.boxBody || !this.autopilot.targetOrientation) {
            console.warn('Skipping updateHelpers due to missing prerequisites.');
            return;
        }

        const currentAngularVelocity = this.spacecraft.objects.boxBody.angularVelocity;
        const currentVelocity = this.spacecraft.objects.boxBody.velocity;

        const pitchTorque = thrustForces[0] + thrustForces[3] + thrustForces[4] + thrustForces[7];
        const yawTorque = thrustForces[8] + thrustForces[11] + thrustForces[12] + thrustForces[15];
        const rollTorque = thrustForces[1] + thrustForces[2] + thrustForces[5] + thrustForces[6];

        const defaultForwardVector = { x: 0, y: 0, z: 1 };
        const targetOrientationVector = applyQuaternionToVector(this.autopilot.targetOrientation, defaultForwardVector);
        const directionVector = new CANNON.Vec3(targetOrientationVector.x, targetOrientationVector.y, targetOrientationVector.z);

        const autopilotTorque = new CANNON.Vec3(pitchTorque, yawTorque, rollTorque);
        autopilotTorque.normalize();

        const rotationAxis = currentAngularVelocity.clone();
        rotationAxis.normalize();

        const orientationVector = this.spacecraft.objects.boxBody.quaternion.vmult(defaultForwardVector);
        const normalizedOrientationVector = new CANNON.Vec3(orientationVector.x, orientationVector.y, orientationVector.z);
        normalizedOrientationVector.normalize();

        this.helpers.updateAutopilotArrow(this.spacecraft.objects.boxBody.position, directionVector);
        this.helpers.updateAutopilotTorqueArrow(this.spacecraft.objects.boxBody.position, autopilotTorque);
        this.helpers.updateRotationAxisArrow(this.spacecraft.objects.boxBody.position, rotationAxis);
        this.helpers.updateOrientationArrow(this.spacecraft.objects.boxBody.position, normalizedOrientationVector);
        this.helpers.updateVelocityArrow(this.spacecraft.objects.boxBody.position, currentVelocity);
    }

    // Helper methods
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

    translationKeys() {
        return ['KeyU', 'KeyO', 'KeyK', 'KeyI', 'KeyJ', 'KeyL'];
    }
}

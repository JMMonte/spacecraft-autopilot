/*******************************************
 * spacecraftController.js
 *******************************************/

import * as CANNON from 'cannon-es';
import { applyQuaternionToVector } from '../utils/utils';
import { Autopilot } from './autopilot';

export class SpacecraftController {
    constructor(spacecraft, currentTarget, helpers) {
        this.isActive = false; // so we can enable/disable input handling
        this.initializeProperties(spacecraft, currentTarget, helpers);
    }

    initializeProperties(spacecraft, currentTarget, helpers) {
        this.spacecraft = spacecraft;
        this.currentTarget = currentTarget?.uuid || null;
        this.helpers = helpers;

        // For manual thruster control
        this.keysPressed = {};

        // Build 24-thruster group arrays
        this.thrusterGroups = this.defineThrusterGroups();

        // Derive a “thrust per thruster”
        this.mass = spacecraft.objects.boxBody.mass;
        const thrustFactor = 5;
        this.thrust = (this.mass / 24) * thrustFactor;

        // Create autopilot
        this.autopilot = new Autopilot(
            this.spacecraft,
            this.thrusterGroups,
            this.thrust
            // If you had dynamic thrusters => pass them as the 4th param
        );
    }

    handleKeyDown(event) {
        if (!this.isActive) return;

        this.keysPressed[event.code] = true;

        // 1) Manual thruster logic
        this.handleManualControl(event.code);

        // 2) Autopilot toggles
        this.handleAutopilotControl(event.code);
    }

    handleKeyUp(event) {
        if (!this.isActive) return;
        this.keysPressed[event.code] = false;
    }

    handleManualControl(code) {
        // Just placeholders for your logic:
        if (this.rotationKeys().includes(code) || this.translationKeys().includes(code)) {
            // Thrusters keep firing while the key is down
        }
    }

    handleAutopilotControl(code) {
        switch (code) {
            case 'KeyT':
                // Cancel & align => set autopilot target orientation
                this.autopilot.setTargetOrientation();  // <--- now valid
                this.autopilot.cancelAndAlign();
                break;
            case 'KeyY':
                // Point to position
                this.autopilot.pointToPosition();
                break;
            case 'KeyR':
                // Cancel rotation
                this.autopilot.cancelRotation();
                break;
            case 'KeyG':
                // Cancel linear motion
                this.autopilot.cancelLinearMotion();
                break;
            case 'KeyB':
                // Go to position
                this.autopilot.goToPosition();
                break;
            default:
                break;
        }
    }

    /**
     * Called each frame or physics step with dt
     */
    applyForces(dt = 1/60) {
        // 1) Manual forces from user
        const manualForces = this.calculateManualForces();

        // 2) Autopilot forces if autopilot is active
        const autopilotForces = this.autopilot.isAutopilotEnabled
            ? this.autopilot.calculateAutopilotForces(dt)
            : Array(24).fill(0);

        // 3) Combine
        const combined = manualForces.map((val, i) => val + autopilotForces[i]);

        // 4) Apply
        const coneVisibility = this.applyForcesToThrusters(combined);

        // 5) Debug helpers
        this.updateHelpers(combined);

        return coneVisibility;
    }

    applyForcesToThrusters(forces) {
        // Show/hide thruster cones
        const coneVisibility = forces.map(f => f > 0);

        forces.forEach((force, index) => {
            // clamp
            const clamped = Math.min(Math.max(force, 0), this.thrust);
            if (clamped > 0) {
                this.spacecraft.rcsVisuals.applyForce(index, clamped);
            }
        });

        // Also set cone mesh visibility
        this.spacecraft.rcsVisuals.coneMeshes.forEach((coneMesh, index) => {
            coneMesh.visible = coneVisibility[index];
        });

        return coneVisibility;
    }

    /**
     * Produce manual RCS thruster forces based on pressed keys.
     */
    calculateManualForces() {
        const forces = Array(24).fill(0);

        Object.entries(this.keyToThrusters()).forEach(([key, indices]) => {
            if (!this.keysPressed[key]) return;

            // rotation => half thrust
            const isRotation = this.rotationKeys().includes(key);
            const forceMag = isRotation ? this.thrust / 2 : this.thrust;

            indices.forEach(idx => {
                forces[idx] = forceMag;
            });
        });

        return forces;
    }

    updateHelpers(thrustForces) {
        if (!this.spacecraft?.objects?.boxBody || !this.autopilot?.targetOrientation) {
            return;
        }
        const body = this.spacecraft.objects.boxBody;
        const currentAngularVelocity = body.angularVelocity;
        const currentVelocity = body.velocity;

        // Example “torques” for debug
        // (You can refine how you compute these based on thruster geometry)
        const pitchTorque = thrustForces[0] + thrustForces[3] + thrustForces[4] + thrustForces[7];
        const yawTorque   = thrustForces[8] + thrustForces[11] + thrustForces[12] + thrustForces[15];
        const rollTorque  = thrustForces[1] + thrustForces[2] + thrustForces[5] + thrustForces[6];

        const defaultForwardVector = { x: 0, y: 0, z: 1 };
        const targetOrientationVector = applyQuaternionToVector(
            this.autopilot.targetOrientation,
            defaultForwardVector
        );
        const directionVector = new CANNON.Vec3(
            targetOrientationVector.x,
            targetOrientationVector.y,
            targetOrientationVector.z
        );

        const autopilotTorque = new CANNON.Vec3(pitchTorque, yawTorque, rollTorque).normalize();
        const rotationAxis = currentAngularVelocity.clone().normalize();

        const orientationVector = body.quaternion.vmult(defaultForwardVector);
        const normalizedOrientationVector = new CANNON.Vec3(
            orientationVector.x,
            orientationVector.y,
            orientationVector.z
        ).normalize();

        // Update your arrow helpers
        this.helpers.updateAutopilotArrow(body.position, directionVector);
        this.helpers.updateAutopilotTorqueArrow(body.position, autopilotTorque);
        this.helpers.updateRotationAxisArrow(body.position, rotationAxis);
        this.helpers.updateOrientationArrow(body.position, normalizedOrientationVector);
        this.helpers.updateVelocityArrow(body.position, currentVelocity);
    }

    defineThrusterGroups() {
        return {
            pitch: [
                [0, 2, 5, 7, 8, 9, 14, 15],
                [1, 3, 4, 6, 10, 11, 12, 13]
            ],
            yaw: [
                [0, 1, 6, 7, 16, 17, 22, 23],
                [2, 3, 4, 5, 18, 19, 20, 21]
            ],
            roll: [
                [8, 11, 13, 14, 16, 18, 21, 23],
                [9, 10, 12, 15, 17, 19, 20, 22]
            ],
            forward: [
                [0, 1, 2, 3],
                [4, 5, 6, 7]
            ],
            up: [
                [12, 13, 14, 15],
                [8, 9, 10, 11]
            ],
            left: [
                [16, 17, 18, 19],
                [20, 21, 22, 23]
            ]
        };
    }

    keyToThrusters() {
        return {
            KeyW: this.thrusterGroups.pitch[0],
            KeyS: this.thrusterGroups.pitch[1],
            KeyA: this.thrusterGroups.yaw[0],
            KeyD: this.thrusterGroups.yaw[1],
            KeyQ: this.thrusterGroups.roll[0],
            KeyE: this.thrusterGroups.roll[1],
            KeyU: this.thrusterGroups.forward[0],
            KeyO: this.thrusterGroups.forward[1],
            KeyK: this.thrusterGroups.up[0],
            KeyI: this.thrusterGroups.up[1],
            KeyJ: this.thrusterGroups.left[0],
            KeyL: this.thrusterGroups.left[1]
        };
    }

    rotationKeys() {
        return ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'];
    }

    translationKeys() {
        return ['KeyU', 'KeyO', 'KeyK', 'KeyI', 'KeyJ', 'KeyL'];
    }
}
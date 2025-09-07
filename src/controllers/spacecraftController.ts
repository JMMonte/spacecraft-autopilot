import * as THREE from 'three';
import { Spacecraft } from '../core/spacecraft';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { Autopilot } from './autopilot/Autopilot';
import { createLogger } from '../utils/logger';

interface KeyMap {
    [key: string]: boolean;
}

interface ThrusterMap {
    [key: string]: number[];
}

export class SpacecraftController {
    private log = createLogger('controllers:SpacecraftController');
    private isActive: boolean = false;
    private spacecraft!: Spacecraft;
    private currentTarget!: string | null;
    private helpers!: SceneHelpers;
    private keysPressed!: KeyMap;
    private mass!: number;
    private thrust!: number;
    public autopilot!: Autopilot;

    constructor(spacecraft: Spacecraft, currentTarget: { uuid: string } | null, helpers: SceneHelpers) {
        this.log.debug('SpacecraftController constructor called');
        this.initializeProperties(spacecraft, currentTarget, helpers);
        this.log.debug('SpacecraftController initialized, isActive:', this.isActive);
    }

    public getIsActive(): boolean {
        return this.isActive;
    }

    public setIsActive(value: boolean): void {
        this.log.debug('Setting isActive to:', value);
        this.isActive = value;
    }

    public getCurrentTarget(): string | null {
        return this.currentTarget;
    }

    public setCurrentTarget(target: { uuid: string } | null): void {
        this.currentTarget = target?.uuid || null;
    }

    private initializeProperties(spacecraft: Spacecraft, currentTarget: { uuid: string } | null, helpers: SceneHelpers): void {
        this.log.debug('Initializing SpacecraftController properties');
        this.spacecraft = spacecraft;
        this.currentTarget = currentTarget?.uuid || null;
        this.helpers = helpers;

        // For manual thruster control
        this.keysPressed = {};

        // Derive a "thrust per thruster"
        this.mass = spacecraft.getMass();
        const thrustFactor = 5;
        this.thrust = (this.mass / 24) * thrustFactor;

        // Create autopilot with correct parameters
        const thrusterGroups = this.getThrusterGroups();
        this.log.debug('Creating autopilot with thruster groups:', thrusterGroups);
        
        this.autopilot = new Autopilot(
            this.spacecraft,
            thrusterGroups,
            this.thrust,
            {
                pidGains: {
                    orientation: { kp: 0.05, ki: 0.0, kd: 0.02 },
                    position: { kp: 3.0, ki: 0.0005, kd: 4.0 },
                    momentum: { kp: 3.0, ki: 0.0, kd: 1.0 }
                },
                maxForce: this.thrust * 24,
                dampingFactor: 1.5
            }
        );

        // Enable autopilot by default
        this.autopilot.setEnabled(true);
        this.log.debug('Autopilot created and enabled with thrust:', this.thrust);
    }

    private getThrusterGroups() {
        return {
            forward: [
                [0, 1, 2, 3],     // Forward thrusters
                [4, 5, 6, 7]      // Back thrusters
            ],
            up: [
                [12, 13, 14, 15],  // Up thrusters (swapped)
                [8, 9, 10, 11]     // Down thrusters (swapped)
            ],
            left: [
                [16, 17, 18, 19], // Left thrusters
                [20, 21, 22, 23]  // Right thrusters
            ],
            pitch: [
                [0, 2, 5, 7, 8, 9, 14, 15],     // Pitch up
                [1, 3, 4, 6, 10, 11, 12, 13]    // Pitch down
            ],
            yaw: [
                [0, 1, 6, 7],     // Yaw left
                [2, 3, 4, 5]      // Yaw right
            ],
            roll: [
                [8, 11, 13, 14],  // Roll right
                [9, 10, 12, 15]   // Roll left
            ]
        };
    }

    public handleKeyDown(event: KeyboardEvent): void {
        if (!this.isActive) return;

        // Prevent handling the same key press multiple times
        if (this.keysPressed[event.code]) return;

        this.keysPressed[event.code] = true;

        // 1) Manual thruster logic
        this.handleManualControl(event.code);

        // 2) Autopilot toggles
        this.handleAutopilotControl(event.code);
    }

    public handleKeyUp(event: KeyboardEvent): void {
        if (!this.isActive) return;
        this.keysPressed[event.code] = false;
    }

    private handleManualControl(code: string): void {
        // Just placeholders for your logic:
        if (this.rotationKeys().includes(code) || this.translationKeys().includes(code)) {
            // Thrusters keep firing while the key is down
        }
    }

    private handleAutopilotControl(code: string): void {
        this.log.debug('Handling autopilot control for key:', code);
        
        // Ensure autopilot is enabled
        if (!this.autopilot.getAutopilotEnabled()) {
            this.log.debug('Enabling autopilot');
            this.autopilot.setEnabled(true);
        }

        // Map keys to autopilot modes
        const keyModeMap: { [key: string]: () => void } = {
            'KeyT': () => {
                this.log.debug('Toggling orientationMatch');
                this.autopilot.orientationMatch();
            },
            'KeyY': () => {
                this.log.debug('Toggling pointToPosition');
                this.autopilot.pointToPosition();
            },
            'KeyR': () => {
                this.log.debug('Toggling cancelRotation');
                this.autopilot.cancelRotation();
            },
            'KeyG': () => {
                this.log.debug('Toggling cancelLinearMotion');
                this.autopilot.cancelLinearMotion();
            },
            'KeyB': () => {
                this.log.debug('Toggling goToPosition');
                this.autopilot.goToPosition();
            }
        };

        // Execute the corresponding mode toggle if key is mapped
        const modeToggle = keyModeMap[code];
        if (modeToggle) {
            this.log.debug('Executing mode toggle for key:', code);
            modeToggle();
            
            // Log the new autopilot state
            const activeAutopilots = this.autopilot.getActiveAutopilots();
            this.log.debug('New autopilot state:', activeAutopilots);
        }
    }

    /**
     * Called each frame or physics step with dt
     */
    public applyForces(dt: number = 1/60): boolean[] {
        
        // 1) Manual forces from user
        const manualForces = this.calculateManualForces();

        // 2) Autopilot forces if autopilot is active
        const autopilotForces = this.autopilot.getAutopilotEnabled()
            ? this.autopilot.calculateAutopilotForces(dt)
            : Array(24).fill(0);

        // 3) Combine
        const combined = manualForces.map((val, i) => val + autopilotForces[i]);

        // 4) Apply
        const coneVisibility = this.applyForcesToThrusters(combined, dt);

        // 5) Debug helpers
        this.updateHelpers(combined);

        return coneVisibility;
    }

    private updateHelpers(thrustForces: number[]): void {
        if (!this.autopilot?.getTargetOrientation()) {
            return;
        }
        const bodyPosition = this.spacecraft.getWorldPosition();
        const currentAngularVelocity = this.spacecraft.getWorldAngularVelocity();
        const currentVelocity = this.spacecraft.getWorldVelocity();

        // Example "torques" for debug
        // (You can refine how you compute these based on thruster geometry)
        const pitchTorque = thrustForces[0] + thrustForces[3] + thrustForces[4] + thrustForces[7];
        const yawTorque   = thrustForces[8] + thrustForces[11] + thrustForces[12] + thrustForces[15];
        const rollTorque  = thrustForces[1] + thrustForces[2] + thrustForces[5] + thrustForces[6];

        const defaultForwardVector = new THREE.Vector3(0, 0, 1);
        const targetOrientationQuat = this.autopilot.getTargetOrientation();
        const targetOrientationVector = defaultForwardVector.clone().applyQuaternion(targetOrientationQuat);

        const autopilotTorque = new THREE.Vector3(pitchTorque, yawTorque, rollTorque);
        const rotationAxis = currentAngularVelocity.clone();

        const orientationVector = defaultForwardVector.clone().applyQuaternion(this.spacecraft.getWorldOrientation());

        // Update your arrow helpers
        this.helpers.updateAutopilotArrow(bodyPosition, targetOrientationVector);
        this.helpers.updateAutopilotTorqueArrow(bodyPosition, autopilotTorque);
        this.helpers.updateRotationAxisArrow(bodyPosition, rotationAxis);
        this.helpers.updateOrientationArrow(bodyPosition, orientationVector);
        this.helpers.updateVelocityArrow(bodyPosition, currentVelocity);
    }

    private applyForcesToThrusters(forces: number[], dt: number): boolean[] {
        // Show/hide thruster cones
        const coneVisibility = forces.map(f => f > 0);

        forces.forEach((force, index) => {
            // clamp
            const clamped = Math.min(Math.max(force, 0), this.thrust);
            if (clamped > 0) {
                this.spacecraft.rcsVisuals.applyForce(index, clamped, dt);
            }
        });

        // Also set cone mesh visibility
        this.spacecraft.rcsVisuals.getConeMeshes().forEach((coneMesh, index) => {
            coneMesh.visible = coneVisibility[index];
        });

        return coneVisibility;
    }

    private rotationKeys(): string[] {
        return ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'];
    }

    private translationKeys(): string[] {
        return ['KeyU', 'KeyO', 'KeyK', 'KeyI', 'KeyJ', 'KeyL'];
    }

    private keyToThrusters(): ThrusterMap {
        return {
            'KeyU': [0, 1, 2, 3],         // Forward
            'KeyO': [4, 5, 6, 7],         // Back
            'KeyJ': [16, 17, 18, 19],     // Left
            'KeyL': [20, 21, 22, 23],     // Right
            'KeyK': [8, 9, 10, 11],       // Up
            'KeyI': [12, 13, 14, 15],     // Down
            'KeyW': [0, 2, 5, 7, 8, 9, 14, 15],         // Pitch up
            'KeyS': [1, 3, 4, 6, 10, 11, 12, 13],       // Pitch down
            'KeyQ': [8, 11, 13, 14],      // Roll right
            'KeyE': [9, 10, 12, 15],      // Roll left
            'KeyA': [0, 1, 6, 7],         // Yaw left
            'KeyD': [2, 3, 4, 5]          // Yaw right
        };
    }

    private calculateManualForces(): number[] {
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

    public cleanup(): void {
        // No global listeners to remove here; BasicWorld manages input

        // Clean up autopilot
        if (this.autopilot) {
            this.autopilot.cleanup?.();
        }

        // Clean up helpers
        if (this.helpers) {
            this.helpers.cleanup();
        }
    }

    public getThrust(): number {
        return this.thrust;
    }

    public setThrust(value: number): void {
        this.thrust = value;
    }

    public getSpacecraft(): Spacecraft {
        return this.spacecraft;
    }

    public getAutopilot(): Autopilot {
        return this.autopilot;
    }

    public getTargetOrientation(): THREE.Quaternion {
        return this.autopilot.getTargetOrientation();
    }

    public setTargetOrientation(orientation: THREE.Quaternion): void {
        this.autopilot.setTargetOrientation(orientation);
    }

    public destroy(): void {
        // No-op; BasicWorld manages global listeners
    }

    handleKeyPress(event: KeyboardEvent): void {
        if (event.key === 't' || event.key === 'T') {
            this.log.debug('Toggling orientationMatch');
            this.autopilot.orientationMatch();
        }
    }
} 

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Spacecraft } from '../core/spacecraft';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { Autopilot } from './autopilot/Autopilot';

interface KeyMap {
    [key: string]: boolean;
}

interface ThrusterMap {
    [key: string]: number[];
}

export class SpacecraftController {
    private isActive: boolean = false;
    private spacecraft!: Spacecraft;
    private currentTarget!: string | null;
    private helpers!: SceneHelpers;
    private keysPressed!: KeyMap;
    private mass!: number;
    private thrust!: number;
    public autopilot!: Autopilot;
    private boundHandleKeyDown: (event: KeyboardEvent) => void;
    private boundHandleKeyUp: (event: KeyboardEvent) => void;

    constructor(spacecraft: Spacecraft, currentTarget: { uuid: string } | null, helpers: SceneHelpers) {
        console.log('SpacecraftController constructor called');
        // Bind event handlers
        this.boundHandleKeyDown = this.handleKeyDown.bind(this);
        this.boundHandleKeyUp = this.handleKeyUp.bind(this);

        this.initializeProperties(spacecraft, currentTarget, helpers);
        this.registerEventListeners();
        console.log('SpacecraftController initialized, isActive:', this.isActive);
    }

    private registerEventListeners(): void {
        console.log('Registering event listeners');
        document.addEventListener("keydown", this.boundHandleKeyDown);
        document.addEventListener("keyup", this.boundHandleKeyUp);
    }

    public getIsActive(): boolean {
        return this.isActive;
    }

    public setIsActive(value: boolean): void {
        console.log('Setting isActive to:', value);
        this.isActive = value;
    }

    public getCurrentTarget(): string | null {
        return this.currentTarget;
    }

    public setCurrentTarget(target: { uuid: string } | null): void {
        this.currentTarget = target?.uuid || null;
    }

    private initializeProperties(spacecraft: Spacecraft, currentTarget: { uuid: string } | null, helpers: SceneHelpers): void {
        console.log('Initializing SpacecraftController properties');
        this.spacecraft = spacecraft;
        this.currentTarget = currentTarget?.uuid || null;
        this.helpers = helpers;

        // For manual thruster control
        this.keysPressed = {};

        // Derive a "thrust per thruster"
        this.mass = spacecraft.objects.boxBody.mass;
        const thrustFactor = 5;
        this.thrust = (this.mass / 24) * thrustFactor;

        // Create autopilot with correct parameters
        const thrusterGroups = this.getThrusterGroups();
        console.log('Creating autopilot with thruster groups:', thrusterGroups);
        
        this.autopilot = new Autopilot(
            this.spacecraft,
            thrusterGroups,
            this.thrust,
            {
                pidGains: {
                    orientation: { kp: 0.05, ki: 0.0, kd: 0.02 },
                    position: { kp: 0.3, ki: 0.005, kd: 1.0 },
                    momentum: { kp: 3.0, ki: 0.0, kd: 1.0 }
                },
                maxForce: this.thrust * 24,
                dampingFactor: 1.5
            }
        );

        // Enable autopilot by default
        this.autopilot.setEnabled(true);
        console.log('Autopilot created and enabled with thrust:', this.thrust);
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
        console.log('Handling autopilot control for key:', code);
        
        // Ensure autopilot is enabled
        if (!this.autopilot.getAutopilotEnabled()) {
            console.log('Enabling autopilot');
            this.autopilot.setEnabled(true);
        }

        // Map keys to autopilot modes
        const keyModeMap: { [key: string]: () => void } = {
            'KeyT': () => {
                console.log('Toggling cancelAndAlign');
                this.autopilot.cancelAndAlign();
            },
            'KeyY': () => {
                console.log('Toggling pointToPosition');
                this.autopilot.pointToPosition();
            },
            'KeyR': () => {
                console.log('Toggling cancelRotation');
                this.autopilot.cancelRotation();
            },
            'KeyG': () => {
                console.log('Toggling cancelLinearMotion');
                this.autopilot.cancelLinearMotion();
            },
            'KeyB': () => {
                console.log('Toggling goToPosition');
                this.autopilot.goToPosition();
            }
        };

        // Execute the corresponding mode toggle if key is mapped
        const modeToggle = keyModeMap[code];
        if (modeToggle) {
            console.log('Executing mode toggle for key:', code);
            modeToggle();
            
            // Log the new autopilot state
            const activeAutopilots = this.autopilot.getActiveAutopilots();
            console.log('New autopilot state:', activeAutopilots);
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
        const coneVisibility = this.applyForcesToThrusters(combined);

        // 5) Debug helpers
        this.updateHelpers(combined);

        return coneVisibility;
    }

    private toCannonQuat(threeQuat: THREE.Quaternion): CANNON.Quaternion {
        return new CANNON.Quaternion(threeQuat.x, threeQuat.y, threeQuat.z, threeQuat.w);
    }

    private updateHelpers(thrustForces: number[]): void {
        if (!this.spacecraft?.objects?.boxBody || !this.autopilot?.getTargetOrientation()) {
            return;
        }
        const body = this.spacecraft.objects.boxBody;
        const currentAngularVelocity = body.angularVelocity;
        const currentVelocity = body.velocity;

        // Example "torques" for debug
        // (You can refine how you compute these based on thruster geometry)
        const pitchTorque = thrustForces[0] + thrustForces[3] + thrustForces[4] + thrustForces[7];
        const yawTorque   = thrustForces[8] + thrustForces[11] + thrustForces[12] + thrustForces[15];
        const rollTorque  = thrustForces[1] + thrustForces[2] + thrustForces[5] + thrustForces[6];

        const defaultForwardVector = new CANNON.Vec3(0, 0, 1);
        const targetOrientationQuat = this.toCannonQuat(this.autopilot.getTargetOrientation());
        const targetOrientationVector = new CANNON.Vec3(0, 0, 1);
        targetOrientationQuat.vmult(targetOrientationVector, targetOrientationVector);

        const autopilotTorque = new CANNON.Vec3(pitchTorque, yawTorque, rollTorque);
        const rotationAxis = new CANNON.Vec3(
            currentAngularVelocity.x,
            currentAngularVelocity.y,
            currentAngularVelocity.z
        );

        const orientationVector = body.quaternion.vmult(defaultForwardVector, new CANNON.Vec3());

        // Update your arrow helpers
        this.helpers.updateAutopilotArrow(body.position, targetOrientationVector);
        this.helpers.updateAutopilotTorqueArrow(body.position, autopilotTorque);
        this.helpers.updateRotationAxisArrow(body.position, rotationAxis);
        this.helpers.updateOrientationArrow(body.position, orientationVector);
        this.helpers.updateVelocityArrow(body.position, currentVelocity);
    }

    private applyForcesToThrusters(forces: number[]): boolean[] {
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
        // Clean up event listeners
        document.removeEventListener("keydown", this.boundHandleKeyDown);
        document.removeEventListener("keyup", this.boundHandleKeyUp);

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
        document.removeEventListener("keydown", this.boundHandleKeyDown);
        document.removeEventListener("keyup", this.boundHandleKeyUp);
    }
} 
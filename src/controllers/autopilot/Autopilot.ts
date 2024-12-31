import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import { AutopilotConfig } from './AutopilotMode';
import { CancelRotation } from './CancelRotation';
import { CancelLinearMotion } from './CancelLinearMotion';
import { PointToPosition } from './PointToPosition';
import { CancelAndAlign } from './CancelAndAlign';
import { GoToPosition } from './GoToPosition';

interface AutopilotModes {
    cancelAndAlign: boolean;
    cancelRotation: boolean;
    cancelLinearMotion: boolean;
    pointToPosition: boolean;
    goToPosition: boolean;
}

export class Autopilot {
    private spacecraft: Spacecraft;
    private config: AutopilotConfig;
    private thrusterGroups: any;
    private thrust: number;
    private isEnabled: boolean = false;
    private activeAutopilots: AutopilotModes;
    public targetPosition: THREE.Vector3;
    public targetOrientation: THREE.Quaternion;
    private targetObject: Spacecraft | null = null;
    private targetPoint: THREE.Vector3 = new THREE.Vector3();

    // Mode instances
    private cancelRotationMode!: CancelRotation;
    private cancelLinearMotionMode!: CancelLinearMotion;
    private pointToPositionMode!: PointToPosition;
    private cancelAndAlignMode!: CancelAndAlign;
    private goToPositionMode!: GoToPosition;

    // PID Controllers
    private orientationPidController: PIDController;
    private linearPidController: PIDController;

    constructor(
        spacecraft: Spacecraft,
        thrusterGroups: any,
        thrust: number,
        options: {
            pidGains?: {
                orientation?: { kp: number; ki: number; kd: number; };
                position?: { kp: number; ki: number; kd: number; };
                momentum?: { kp: number; ki: number; kd: number; };
            };
            maxForce?: number;
            dampingFactor?: number;
        } = {}
    ) {
        this.spacecraft = spacecraft;
        this.thrusterGroups = thrusterGroups;
        this.thrust = thrust;
        this.targetPosition = new THREE.Vector3();
        this.targetOrientation = new THREE.Quaternion();

        // Initialize config with default values
        const defaultPidGains = {
            orientation: { kp: 0.5, ki: 0.1, kd: 0.2 },    // For rotation control
            position: { kp: 0.1, ki: 0.001, kd: 0.5 },     // For GoToPosition - extremely gentle gains
            momentum: { kp: 6.0, ki: 0.2, kd: 2.0 }        // For CancelLinearMotion
        };

        this.config = {
            pid: {
                orientation: { ...defaultPidGains.orientation, ...options.pidGains?.orientation },
                position: { ...defaultPidGains.position, ...options.pidGains?.position },
                momentum: { ...defaultPidGains.momentum, ...options.pidGains?.momentum },
            },
            limits: {
                maxForce: options.maxForce ?? 1000,         // Reduced max force
                epsilon: 0.01,
            },
            damping: {
                factor: options.dampingFactor ?? 8.0,       // Much higher damping
            },
        };

        // Initialize PID controllers
        this.orientationPidController = new PIDController(
            this.config.pid.orientation.kp,
            this.config.pid.orientation.ki,
            this.config.pid.orientation.kd
        );

        this.linearPidController = new PIDController(
            this.config.pid.position.kp,
            this.config.pid.position.ki,
            this.config.pid.position.kd
        );
        
        // Configure additional PID parameters
        this.linearPidController.setMaxIntegral(0.1);      // Limit integral windup
        this.linearPidController.setDerivativeAlpha(0.95); // Smoother derivative

        // Initialize state
        this.activeAutopilots = {
            cancelAndAlign: false,
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            goToPosition: false
        };

        // Initialize modes
        this.initializeModes();
    }

    private initializeModes(): void {
        this.cancelRotationMode = new CancelRotation(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.orientationPidController
        );

        this.cancelLinearMotionMode = new CancelLinearMotion(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.linearPidController
        );

        this.pointToPositionMode = new PointToPosition(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.orientationPidController,
            this.targetPosition
        );

        this.cancelAndAlignMode = new CancelAndAlign(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.orientationPidController,
            this.targetOrientation
        );

        this.goToPositionMode = new GoToPosition(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.linearPidController,
            this.targetPosition
        );
    }

    public getTargetObject(): Spacecraft | null {
        return this.targetObject;
    }

    public setTargetObject(target: Spacecraft | null, targetPoint: 'center' | 'front' | 'back'): void {
        this.targetObject = target;
        if (target) {
            // Update target position and orientation based on the object
            if (targetPoint === 'center') {
                this.targetPosition.copy(target.objects.box.position);
            } else {
                const portPosition = target.getDockingPortWorldPosition(targetPoint);
                if (portPosition) {
                    this.targetPosition.copy(portPosition);
                } else {
                    this.targetPosition.copy(target.objects.box.position);
                }
            }
            this.targetOrientation.copy(target.objects.box.quaternion);
            
            // Update target point based on the selected port
            switch (targetPoint) {
                case 'front':
                    this.targetPoint.set(0, 0, 1);
                    break;
                case 'back':
                    this.targetPoint.set(0, 0, -1);
                    break;
                default:
                    this.targetPoint.set(0, 0, 0);
            }
        }
    }

    public getTargetPoint(): THREE.Vector3 {
        return this.targetPoint;
    }

    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        console.log('Autopilot enabled:', this.isEnabled);
    }

    public getAutopilotEnabled(): boolean {
        return this.isEnabled;
    }

    public cancelAndAlign(): void {
        this.setMode('cancelAndAlign', !this.activeAutopilots.cancelAndAlign);
    }

    public pointToPosition(): void {
        this.setMode('pointToPosition', !this.activeAutopilots.pointToPosition);
    }

    public cancelRotation(): void {
        this.setMode('cancelRotation', !this.activeAutopilots.cancelRotation);
    }

    public cancelLinearMotion(): void {
        this.setMode('cancelLinearMotion', !this.activeAutopilots.cancelLinearMotion);
    }

    public goToPosition(): void {
        this.setMode('goToPosition', !this.activeAutopilots.goToPosition);
    }

    public getActiveAutopilots(): AutopilotModes {
        return { ...this.activeAutopilots };
    }

    public calculateAutopilotForces(dt: number): number[] {
        if (!this.isEnabled) {
            return Array(24).fill(0);
        }

        let forces = Array(24).fill(0);

        if (this.activeAutopilots.cancelRotation) {
            forces = this.mergeForces(forces, this.cancelRotationMode.calculateForces(dt));
        }
        if (this.activeAutopilots.cancelLinearMotion) {
            forces = this.mergeForces(forces, this.cancelLinearMotionMode.calculateForces(dt));
        }
        if (this.activeAutopilots.pointToPosition) {
            forces = this.mergeForces(forces, this.pointToPositionMode.calculateForces(dt));
        }
        if (this.activeAutopilots.cancelAndAlign) {
            forces = this.mergeForces(forces, this.cancelAndAlignMode.calculateForces(dt));
        }
        if (this.activeAutopilots.goToPosition) {
            forces = this.mergeForces(forces, this.goToPositionMode.calculateForces(dt));
        }

        return forces;
    }

    private mergeForces(a: number[], b: number[]): number[] {
        return a.map((val, i) => val + b[i]);
    }

    public setMode(mode: keyof AutopilotModes, enabled: boolean = true): void {
        console.log('setMode called:', mode, enabled);
        const rotationModes = ['cancelAndAlign', 'cancelRotation', 'pointToPosition'];
        const translationModes = ['cancelLinearMotion', 'goToPosition'];

        if (enabled) {
            // Turn off other modes in the same group
            if (rotationModes.includes(mode)) {
                rotationModes.forEach((m) => {
                    if (m !== mode) this.activeAutopilots[m as keyof AutopilotModes] = false;
                });
            }
            if (translationModes.includes(mode)) {
                translationModes.forEach((m) => {
                    if (m !== mode) this.activeAutopilots[m as keyof AutopilotModes] = false;
                });
            }
        }

        this.activeAutopilots[mode] = enabled;
        this.updateAutopilotState();
    }

    private updateAutopilotState(): void {
        this.isEnabled = Object.values(this.activeAutopilots).some(v => v);
        console.log('Autopilot enabled:', this.isEnabled);
        document.dispatchEvent(
            new CustomEvent('autopilotStateChanged', {
                detail: {
                    enabled: this.isEnabled,
                    activeAutopilots: this.activeAutopilots,
                },
            })
        );
    }

    public getTargetOrientation(): THREE.Quaternion {
        return this.targetOrientation;
    }

    public setTargetOrientation(orientation: THREE.Quaternion): void {
        this.targetOrientation.copy(orientation);
        this.cancelAndAlignMode.setTargetOrientation(orientation);
    }

    public cleanup(): void {
        // Reset all modes
        this.activeAutopilots = {
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            cancelAndAlign: false,
            goToPosition: false
        };
        
        // Clear references
        this.targetPosition.set(0, 0, 0);
        this.targetOrientation.set(0, 0, 0, 1);
        this.targetObject = null;
    }

    public getTargetPosition(): THREE.Vector3 {
        return this.targetPosition;
    }

    public getOrientationPidController(): PIDController {
        return this.orientationPidController;
    }

    public getLinearPidController(): PIDController {
        return this.linearPidController;
    }

    public setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition.copy(position);
        // Clear any target object when setting a direct position
        this.targetObject = null;
    }

    public clearTargetObject(): void {
        this.targetObject = null;
        // Reset target position and orientation when clearing target
        this.targetPosition.set(0, 0, 0);
        this.targetOrientation.set(0, 0, 0, 1);
        this.targetPoint.set(0, 0, 0);
    }

    public resetAllModes(): void {
        // Turn off all autopilot modes
        Object.keys(this.activeAutopilots).forEach(mode => {
            this.setMode(mode as keyof AutopilotModes, false);
        });
    }
} 
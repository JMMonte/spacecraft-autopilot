import { Spacecraft } from '../core/spacecraft';

export interface PIDGains {
    kp: number;
    ki: number;
    kd: number;
}

export interface Autopilot {
    // Properties
    spacecraft: Spacecraft;
    thrusters: any[];
    numThrusters: number;

    // Methods
    update(dt: number): void;
    getAutopilotEnabled(): boolean;
    getTargetOrientation(): THREE.Quaternion;
    getTargetPosition(): THREE.Vector3;
    getTargetVelocity(): THREE.Vector3;
    getTargetAngularVelocity(): THREE.Vector3;
    setTargetOrientation(orientation: THREE.Quaternion): void;
    setTargetPosition(position: THREE.Vector3): void;
    setTargetVelocity(velocity: THREE.Vector3): void;
    setTargetAngularVelocity(angularVelocity: THREE.Vector3): void;
    setEnabled(enabled: boolean): void;
    allocateThrusters(desired6: number[]): number[];

    // Constructor
    constructor(
        spacecraft: Spacecraft,
        thrusters?: any[],
        options?: {
            pidGains?: {
                orientation?: PIDGains;
                linear?: PIDGains;
                general?: PIDGains;
            };
            maxForce?: number;
            dampingFactor?: number;
            derivativeAlpha?: number;
            maxIntegral?: number;
        }
    );
} 
import * as THREE from 'three';

export interface AutopilotParameters {
    targetPosition?: THREE.Vector3;
    targetOrientation?: THREE.Quaternion;
    targetVelocity?: THREE.Vector3;
    targetAngularVelocity?: THREE.Vector3;
    mode?: string;
    thrust?: number;
    damping?: {
        factor: number;
    };
    limits?: {
        maxForce: number;
    };
} 
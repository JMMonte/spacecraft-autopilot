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

/** Narrow callback interface for SpacecraftController to update visuals without importing scene layer. */
export interface VisualizationCallbacks {
    updateVelocityArrow?(position: THREE.Vector3, velocity: THREE.Vector3): void;
    updateRotationAxisArrow?(position: THREE.Vector3, angularVelocity: THREE.Vector3): void;
    updateOrientationArrow?(position: THREE.Vector3, direction: THREE.Vector3): void;
    updateAutopilotArrow?(position: THREE.Vector3, direction: THREE.Vector3): void;
    updateAutopilotTorqueArrow?(position: THREE.Vector3, torque: THREE.Vector3): void;
    updatePath?(points: THREE.Vector3[], carrot?: THREE.Vector3): void;
    setLatestForceMetrics?(absSum: number, netMag: number): void;
    cleanup?(): void;
    // Arrow visibility checks (read-only) — nullable to match THREE.js ArrowHelper | null
    autopilotArrow?: { visible: boolean } | null;
    autopilotTorqueArrow?: { visible: boolean } | null;
    rotationAxisArrow?: { visible: boolean } | null;
    orientationArrow?: { visible: boolean } | null;
    velocityArrow?: { visible: boolean } | null;
    pathLine?: { visible: boolean } | null;
    pathCarrot?: { visible: boolean } | null;
}
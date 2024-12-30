declare module 'three/examples/jsm/controls/OrbitControls' {
    import { Camera, Vector3 } from 'three';

    export class OrbitControls {
        constructor(camera: Camera, domElement?: HTMLElement);
        enableDamping: boolean;
        dampingFactor: number;
        screenSpacePanning: boolean;
        minDistance: number;
        maxDistance: number;
        maxPolarAngle: number;
        enableRotate: boolean;
        rotateSpeed: number;
        enableZoom: boolean;
        zoomSpeed: number;
        target: Vector3;
        update(): void;
        dispose(): void;
        addEventListener(event: string, callback: () => void): void;
    }
} 
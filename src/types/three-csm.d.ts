declare module 'three/examples/jsm/csm/CSM.js' {
    import { Camera, DirectionalLight, Material, Object3D, Vector3 } from 'three';

    type CSMMode = 'practical' | 'uniform' | 'logarithmic' | 'custom';

    interface CSMOptions {
        camera: Camera;
        parent: Object3D;
        cascades?: number;
        maxFar?: number;
        mode?: CSMMode;
        customSplitsCallback?: (cascades: number, near: number, far: number, target: number[]) => void;
        shadowMapSize?: number;
        shadowBias?: number;
        lightDirection?: Vector3;
        lightIntensity?: number;
        lightNear?: number;
        lightFar?: number;
        lightMargin?: number;
    }

    export class CSM {
        camera: Camera;
        parent: Object3D;
        cascades: number;
        maxFar: number;
        mode: CSMMode;
        shadowMapSize: number;
        shadowBias: number;
        lightDirection: Vector3;
        lightIntensity: number;
        lightNear: number;
        lightFar: number;
        lightMargin: number;
        fade: boolean;
        lights: DirectionalLight[];
        shaders: Map<Material, any>;
        constructor(data: CSMOptions);
        update(): void;
        updateFrustums(): void;
        setupMaterial(material: Material): void;
        remove(): void;
        dispose(): void;
    }
}

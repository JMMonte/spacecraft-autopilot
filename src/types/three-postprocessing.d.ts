declare module 'three/examples/jsm/postprocessing/EffectComposer' {
    import { WebGLRenderer, Scene, Camera } from 'three';

    export class EffectComposer {
        constructor(renderer: WebGLRenderer);
        addPass(pass: any): void;
        render(deltaTime?: number): void;
        setSize(width: number, height: number): void;
        dispose(): void;
    }
}

declare module 'three/examples/jsm/postprocessing/RenderPass' {
    import { Scene, Camera } from 'three';

    export class RenderPass {
        constructor(scene: Scene, camera: Camera);
        enabled: boolean;
    }
}

declare module 'three/examples/jsm/postprocessing/SSAOPass' {
    import { Scene, Camera } from 'three';

    export class SSAOPass {
        static OUTPUT: {
            Default: number;
            SSAO: number;
            Blur: number;
            Beauty: number;
            Depth: number;
            Normal: number;
        };
        constructor(scene: Scene, camera: Camera, width?: number, height?: number);
        enabled: boolean;
        output: number;
        opacity: number;
        kernelRadius: number;
        minDistance: number;
        maxDistance: number;
    }
}

declare module 'three/examples/jsm/postprocessing/OutputPass' {
    export class OutputPass {
        constructor();
        enabled: boolean;
        toneMappingExposure: number;
    }
} 
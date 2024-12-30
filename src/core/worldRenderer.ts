import * as THREE from 'three';

export class WorldRenderer {
    public renderer: THREE.WebGLRenderer;

    constructor(canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            logarithmicDepthBuffer: true
        });
        
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        // Handle window resize
        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    public setupPostProcessing(_scene: THREE.Scene, _camera: THREE.Camera): void {
        // Post-processing disabled
    }

    public onWindowResize(): void {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public render(scene: THREE.Scene, camera: THREE.Camera): void {
        this.renderer.render(scene, camera);
    }

    public dispose(): void {
        this.renderer.dispose();
        window.removeEventListener('resize', this.onWindowResize);
    }
} 
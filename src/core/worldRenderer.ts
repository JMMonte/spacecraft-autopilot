import * as THREE from 'three';

export class WorldRenderer {
    public renderer: THREE.WebGLRenderer;

    constructor(canvas: HTMLCanvasElement) {
        // Create a robust WebGL2 renderer without alpha/premultiply to avoid
        // texImage3D warnings on some drivers when Three uploads 3D textures.
        // Logarithmic depth buffer can trigger extra internal texture paths;
        // disable by default to keep driver warnings quiet unless required.
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
            premultipliedAlpha: false,
            powerPreference: 'high-performance',
            logarithmicDepthBuffer: false
        });
        
        this.updateSize();
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        // Ensure unpack flags are sane at startup (3D textures disallow these)
        try {
            const gl = this.renderer.getContext();
            // @ts-ignore: constants exist on WebGL contexts
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            // @ts-ignore
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        } catch {}
    }

    public setupPostProcessing(_scene: THREE.Scene, _camera: THREE.Camera): void {
        // Post-processing disabled
    }

    public render(scene: THREE.Scene, camera: THREE.Camera): void {
        this.renderer.render(scene, camera);
    }

    public dispose(): void {
        this.renderer.dispose();
    }

    public updateSize(): { width: number; height: number } {
        const canvas = this.renderer.domElement as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.renderer.setPixelRatio(dpr);
        // Do not modify canvas style dimensions here; assume CSS controls it
        this.renderer.setSize(width, height, false);
        return { width, height };
    }
}

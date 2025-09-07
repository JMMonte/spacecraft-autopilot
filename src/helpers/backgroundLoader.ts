import * as THREE from 'three';

export class BackgroundLoader {
    private scene: THREE.Scene;
    private onLoadComplete?: () => void;
    private texture: THREE.Texture | null = null;

    constructor(scene: THREE.Scene, _camera: THREE.Camera, onLoadComplete?: () => void) {
        this.scene = scene;
        this.onLoadComplete = onLoadComplete;
        this.loadBackground();
    }

    private loadBackground(): void {
        const loader = new THREE.TextureLoader();
        loader.load(
            '/images/textures/starmap_2020_4k.jpg',
            (tex) => {
                tex.mapping = THREE.EquirectangularReflectionMapping;
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.generateMipmaps = true;

                this.scene.background = tex;
                this.texture = tex;
                this.onLoadComplete?.();
            },
            undefined,
            (err) => {
                console.error('Failed to load background texture', err);
                this.onLoadComplete?.();
            }
        );
    }

    public dispose(): void {
        if (this.texture) {
            if (this.scene.background === this.texture) {
                this.scene.background = null;
            }
            this.texture.dispose();
            this.texture = null;
        }
    }
}

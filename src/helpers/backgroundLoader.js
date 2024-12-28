import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

export class BackgroundLoader {
    constructor(scene, renderer, onLoadComplete) {
        this.scene = scene;
        this.renderer = renderer;
        this.onLoadComplete = onLoadComplete;
        this.loadBackground();
    }

    loadBackground() {
        // Use the default loading manager
        const loader = new EXRLoader();
        
        loader.load(
            '/images/panoramas/spacePanorama-caspianSea.exr',
            (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                this.scene.background = texture;
                this.scene.environment = texture;
                this.onLoadComplete?.();
            },
            undefined, // Progress is handled by DefaultLoadingManager
            (error) => {
                console.error('Error loading background:', error);
                this.onLoadComplete?.();
            }
        );
    }
}

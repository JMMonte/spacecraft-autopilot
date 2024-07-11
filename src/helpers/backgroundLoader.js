import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import panoramaImage from '../images/spacePanorama-caspianSea.exr';

export class BackgroundLoader {
    constructor(scene, renderer, onLoadComplete, onProgress) {
        this.scene = scene;
        this.renderer = renderer;
        this.onLoadComplete = onLoadComplete;
        this.onProgress = onProgress;
        this.loadBackground();
    }

    loadBackground() {
        const manager = new THREE.LoadingManager();
        manager.onStart = () => console.log('Loading started');
        manager.onLoad = () => {
            console.log('Loading complete');
            if (this.onLoadComplete) {
                this.onLoadComplete();
            }
        };
        manager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const progress = itemsLoaded / itemsTotal;
            console.log('Loading progress:', progress * 100, '%');
            if (this.onProgress) {
                this.onProgress(progress);
            }
        };
        

        new EXRLoader(manager).load(panoramaImage, (texture) => {
            const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
            pmremGenerator.compileEquirectangularShader();
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            pmremGenerator.dispose();

            this.scene.environment = envMap;
            this.scene.background = envMap;
        }, undefined, (error) => {
            console.error('An error occurred while loading the EXR background:', error);
        });
    }
}

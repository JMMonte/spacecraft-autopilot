import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import panoramaImage from '../images/spacePanorama-caspianSea.exr';

export class BackgroundLoader {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.loadBackground();
    }

    loadBackground() {
        new EXRLoader().load(panoramaImage, (texture) => {
            const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
            pmremGenerator.compileEquirectangularShader();
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            pmremGenerator.dispose();
            
            this.scene.environment = envMap;
            this.scene.background = envMap;
        }, undefined, function (error) {
            console.error('An error occurred while loading the EXR background:', error);
        });
    }
}
import * as THREE from 'three';

export class WorldRenderer {
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
        });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    onWindowResize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render(scene, camera) {
        this.renderer.render(scene, camera);
    }
}

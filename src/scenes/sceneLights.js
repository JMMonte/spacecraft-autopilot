import * as THREE from 'three';

export class SceneLights {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.lights = [];
        this.setupLights();
    }

    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.25);
        this.scene.add(ambientLight);
        this.lights.push(ambientLight);

        // Directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);
        this.lights.push(directionalLight);

        // Add a hemisphere light for better ambient lighting
        const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
        this.scene.add(hemisphereLight);
        this.lights.push(hemisphereLight);
    }

    getLight() {
        return this.lights[1]; // Return the directional light for helpers
    }

    update() {
        // Update light positions or intensities if needed
    }

    cleanup() {
        this.lights.forEach(light => {
            this.scene.remove(light);
            light.dispose?.();
        });
        this.lights = [];
    }
}
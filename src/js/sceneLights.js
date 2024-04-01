import * as THREE from 'three';

export class SceneLights {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        // Lighting
        // Add a Directional light
        this.light = new THREE.DirectionalLight(0xffffff, 5);
        this.light.position.copy(camera.position);
        this.light.position.add(new THREE.Vector3(-200, 100, 200));
        this.light.castShadow = true;

        // Fixed direction vector
        this.direction = new THREE.Vector3(0, -1, -2);

        // Set light initial target position
        this.light.target.position.copy(camera.position);
        this.light.target.position.add(this.direction);

        // Adjust shadow size
        this.light.shadow.mapSize.width = 2048 * 4;
        this.light.shadow.mapSize.height = 2048 * 4;

        // Adjust shadow camera properties
        this.light.shadow.camera.left = -20;
        this.light.shadow.camera.right = 20;
        this.light.shadow.camera.top = 20;
        this.light.shadow.camera.bottom = -20;
        this.light.shadow.camera.near = 0.5;
        this.light.shadow.camera.far = 500;

        scene.add(this.light);

        this.offset = new THREE.Vector3(-200, 100, 200); // Fixed offset from the camera
    }

    getLight() {
        return this.light;
    }

    update() {
        // Update the light position to follow the camera, maintaining the offset
        this.light.position.copy(this.camera.position).add(this.offset);

        // Optionally adjust the light's target to maintain a fixed direction relative to the camera
        // This is useful if your light direction should change as the camera rotates
        // For a fixed direction in the world space, you might not need to adjust the target every frame
        this.light.target.position.copy(this.camera.position).add(this.direction);

        // Don't forget to update the matrix of the target object, as it's not part of the scene
        this.light.target.updateMatrixWorld();
    }
}
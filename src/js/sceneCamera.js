import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneCamera {
    constructor(renderer) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(2, 2, 5);
        this.camera.lookAt(0, 0, 0);
        this.orbit = new OrbitControls(this.camera, renderer.domElement);
        this.orbit.enableDamping = false; // Optionally enable damping for smoother transitions
        this.orbit.update();
        this.targetPosition = new THREE.Vector3();
        window.addEventListener('resize', this.onWindowResize.bind(this), false);

        // Spherical coordinates
        this.spherical = new THREE.Spherical();
        this.updateSphericalFromCamera();

        // Listen to orbit control changes to update the spherical coordinates
        this.orbit.addEventListener('change', () => {
            this.updateSphericalFromCamera();
        });
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }

    update() {
        if (this.needsSmoothTransition) {
            // Smoothly interpolate the orbit target to the new position
            this.orbit.target.lerp(this.targetPosition, 0.05); // Adjust the lerp factor (0.05) as needed
    
            // Check if the transition is close enough to be considered complete
            if (this.orbit.target.distanceTo(this.targetPosition) < 0.01) {
                this.orbit.target.copy(this.targetPosition);
                this.needsSmoothTransition = false;
            }
        }
        this.orbit.update();
    }
    

    focusOnObject(object) {
        // Assuming 'object' is a Three.js Mesh
        const box = new THREE.Box3().setFromObject(object);
        const center = new THREE.Vector3();
        box.getCenter(center);
    
        // Smoothly transition the orbit target to the new center
        this.targetPosition = center; // Target position to smoothly transition to
        // this.needsSmoothTransition = true; // Flag to indicate a smooth transition is needed

    }
    

    updateOrbitTarget(position) {
        this.orbit.target.copy(position);
        const newPosition = new THREE.Vector3().setFromSpherical(this.spherical).add(this.orbit.target);
        this.camera.position.copy(newPosition);
        this.orbit.update();
    }

    updateSphericalFromCamera() {
        // Update spherical coordinates based on the current camera position relative to the orbit target
        this.spherical.setFromVector3(this.camera.position.clone().sub(this.orbit.target));
    }
}

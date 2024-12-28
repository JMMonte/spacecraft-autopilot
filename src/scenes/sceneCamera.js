import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneCamera {
    constructor(renderer, world) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.world = world;
        
        // Store relative camera position
        this.relativePosition = new THREE.Vector3(0, 5, 10);
        this.initializeControls(renderer);
    }

    initializeControls(renderer) {
        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 50;
        this.controls.maxPolarAngle = Math.PI;
        
        // Enable smooth rotation
        this.controls.enableRotate = true;
        this.controls.rotateSpeed = 0.5;
        
        // Enable smooth zooming
        this.controls.enableZoom = true;
        this.controls.zoomSpeed = 1.0;

        // Listen for control changes to update relative position
        this.controls.addEventListener('change', () => {
            this.relativePosition.copy(this.camera.position).sub(this.controls.target);
        });
    }

    updateOrbitTarget(position) {
        if (this.controls && position) {
            // Update target position
            this.controls.target.copy(position);
            
            // Update camera position to maintain relative position
            const newCameraPos = position.clone().add(this.relativePosition);
            this.camera.position.copy(newCameraPos);
            
            this.controls.update();
        }
    }

    cleanup() {
        if (this.controls) {
            this.controls.removeEventListener('change');
            this.controls.dispose();
        }
    }
}

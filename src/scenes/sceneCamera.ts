import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { BasicWorld } from '../core/BasicWorld';

export class SceneCamera {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public controls!: OrbitControls;
    private relativePosition: THREE.Vector3;
    private mode: 'follow' | 'free' = 'follow';

    constructor(renderer: THREE.WebGLRenderer, _world: BasicWorld) {
        this.scene = new THREE.Scene();
        const size = new THREE.Vector2();
        renderer.getSize(size);
        const aspect = size.y > 0 ? size.x / size.y : 1;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000000000000);
        
        // Store relative camera position
        this.relativePosition = new THREE.Vector3(0, 5, 10);
        this.initializeControls(renderer);
    }

    private initializeControls(renderer: THREE.WebGLRenderer): void {
        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 50000;
        this.controls.maxPolarAngle = Math.PI;
        
        // Enable smooth rotation
        this.controls.enableRotate = true;
        this.controls.rotateSpeed = 0.5;
        
        // Enable smooth zooming
        this.controls.enableZoom = true;
        this.controls.zoomSpeed = 1.0;

        // Listen for control changes to update relative position
        this.controls.addEventListener('change', () => {
            // Calculate the relative position directly
            this.relativePosition.set(
                this.camera.position.x - this.controls.target.x,
                this.camera.position.y - this.controls.target.y,
                this.camera.position.z - this.controls.target.z
            );
        });
    }

    public updateOrbitTarget(target: THREE.Vector3): void {
        if (this.mode !== 'follow') return;
        // Update the orbit controls target
        this.controls.target.set(target.x, target.y, target.z);
        
        // Update camera position relative to target
        this.camera.position.set(
            target.x + this.relativePosition.x,
            target.y + this.relativePosition.y,
            target.z + this.relativePosition.z
        );
    }

    // Immediately align the orbit target to a position while
    // preserving current camera world position (no jump).
    public snapFollowTarget(target: THREE.Vector3): void {
        // Set controls target to the desired point
        this.controls.target.set(target.x, target.y, target.z);
        // Recompute relative offset from camera to target
        this.relativePosition.set(
            this.camera.position.x - target.x,
            this.camera.position.y - target.y,
            this.camera.position.z - target.z
        );
    }

    public setCameraMode(mode: 'follow' | 'free'): void {
        this.mode = mode;
        if (mode === 'free') {
            // Allow unrestricted exploration
            this.controls.screenSpacePanning = true;
            this.controls.minDistance = 0.1;
            this.controls.maxDistance = Infinity;
            // Keep current target/position as-is; user can pan/orbit freely
        } else {
            // Restore sane follow constraints
            this.controls.screenSpacePanning = false;
            this.controls.minDistance = 5;
            this.controls.maxDistance = 50000;
            // Do not force-reset relativePosition to preserve user framing
        }
    }

    public cleanup(): void {
        // Dispose of Three.js resources
        this.controls.dispose();
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            }
        });
    }
} 

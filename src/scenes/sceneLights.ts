import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

export class SceneLights {
    private scene: THREE.Scene;
    private lights: THREE.Light[];
    private sunLight!: THREE.DirectionalLight;
    private mainCamera: THREE.Camera;
    private shadowDistance: number = 100;

    constructor(scene: THREE.Scene, camera: THREE.Camera) {
        this.scene = scene;
        this.lights = [];
        this.mainCamera = camera;
        this.setupLights();
    }

    private setupLights(): void {
        // Scene-scale distances for lighting
        const direction = new THREE.Vector3(-1, 0.5, 1).normalize();
        const SUN_DISTANCE = this.shadowDistance * 6; // ~600 units by default
        const shadowSize = this.shadowDistance;

        // Sun light (directional with lens flare)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
        this.sunLight.position.copy(direction.clone().multiplyScalar(SUN_DISTANCE));

        // Balanced shadow settings
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = this.shadowDistance * 8;
        this.sunLight.shadow.camera.left = -shadowSize;
        this.sunLight.shadow.camera.right = shadowSize;
        this.sunLight.shadow.camera.top = shadowSize;
        this.sunLight.shadow.camera.bottom = -shadowSize;
        this.sunLight.shadow.bias = -0.0001;
        this.sunLight.shadow.normalBias = 0.01;
        this.sunLight.shadow.radius = 0.8;

        this.scene.add(this.sunLight);
        this.lights.push(this.sunLight);

        // Secondary fill light (dim, lighter shadows)
        const secondaryLight = new THREE.DirectionalLight(0x4466ff, 0.25);
        secondaryLight.position.copy(direction.clone().multiplyScalar(-SUN_DISTANCE));
        secondaryLight.castShadow = true;
        secondaryLight.shadow.mapSize.width = 1024;
        secondaryLight.shadow.mapSize.height = 1024;
        secondaryLight.shadow.camera.near = 1;
        secondaryLight.shadow.camera.far = this.shadowDistance * 4;
        secondaryLight.shadow.camera.left = -shadowSize;
        secondaryLight.shadow.camera.right = shadowSize;
        secondaryLight.shadow.camera.top = shadowSize;
        secondaryLight.shadow.camera.bottom = -shadowSize;
        secondaryLight.shadow.bias = -0.00001;
        secondaryLight.shadow.normalBias = 0.02;
        secondaryLight.shadow.radius = 0.8;

        this.scene.add(secondaryLight);
        this.lights.push(secondaryLight);

        // Add subtle ambient fill to replace BasicWorld's ambient
        const ambient = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambient);
        this.lights.push(ambient);

        // Create lens flare
        const textureLoader = new THREE.TextureLoader();
        const lensflare = new Lensflare();
        
        // Load all flare textures
        Promise.all([
            textureLoader.loadAsync('/images/effects/lensflare0.png'),
            textureLoader.loadAsync('/images/effects/lensflare1.png'),
            textureLoader.loadAsync('/images/effects/lensflare2.png'),
            textureLoader.loadAsync('/images/effects/lensflare3.png'),
            textureLoader.loadAsync('/images/effects/lensflare0_alpha.png'),
        ]).then(([texture0, texture1, texture2, texture3, texture0Alpha]) => {
            // Configure all textures
            [texture0, texture1, texture2, texture3, texture0Alpha].forEach(texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.format = THREE.RGBAFormat;
            });

            // Single sun with glow
            lensflare.addElement(new LensflareElement(texture0Alpha, 1500, 0, new THREE.Color(0xfff5f2)));
            lensflare.addElement(new LensflareElement(texture0, 60, 0.001));
            
            // Subtle flares
            lensflare.addElement(new LensflareElement(texture2, 40, 0.3, new THREE.Color(0xff8800)));
            lensflare.addElement(new LensflareElement(texture2, 20, 0.6, new THREE.Color(0xff0000)));
            
            this.sunLight.add(lensflare);
        }).catch(error => {
            console.error('Error loading lens flare textures:', error);
        });
    }

    public getLight(): THREE.DirectionalLight {
        return this.sunLight;
    }

    public update(): void {
        if (!this.mainCamera || !this.sunLight) return;
        const sunDirection = new THREE.Vector3(-1, 0.5, 1).normalize();
        const SUN_DISTANCE = this.shadowDistance * 6;

        // Maintain sun position in scene scale and look towards camera for pleasing speculars
        this.sunLight.position.copy(sunDirection.clone().multiplyScalar(SUN_DISTANCE));
        this.sunLight.target.position.copy(this.mainCamera.position);
        this.sunLight.updateMatrixWorld(false);
        this.sunLight.target.updateMatrixWorld(false);
    }

    public cleanup(): void {
        this.lights.forEach(light => {
            // Clean up lens flare if present
            const lensflare = light.children?.find(child => child instanceof Lensflare);
            if (lensflare instanceof Lensflare) {
                lensflare.dispose();
                light.remove(lensflare);
            }
            
            this.scene.remove(light);
            if ('dispose' in light) {
                (light as any).dispose?.();
            }
        });
        this.lights = [];
    }
} 

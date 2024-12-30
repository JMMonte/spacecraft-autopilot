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
        // Sun light (directional light with lens flare)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 5.0);
        
        // Position sun at approximately 150 million km (1 AU)
        const SUN_DISTANCE = 1.496e11; // meters
        const direction = new THREE.Vector3(-1, 0.5, 1).normalize();
        this.sunLight.position.copy(direction.multiplyScalar(SUN_DISTANCE));
        
        // Setup shadows with high resolution
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 4096;
        this.sunLight.shadow.mapSize.height = 4096;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = this.shadowDistance * 4;
        
        const shadowSize = this.shadowDistance / 2;
        this.sunLight.shadow.camera.left = -shadowSize;
        this.sunLight.shadow.camera.right = shadowSize;
        this.sunLight.shadow.camera.top = shadowSize;
        this.sunLight.shadow.camera.bottom = -shadowSize;
        
        // Improve shadow quality
        this.sunLight.shadow.bias = -0.00001;
        this.sunLight.shadow.normalBias = 0.02;
        this.sunLight.shadow.radius = 1.5;
        this.sunLight.intensity = 3.0;
        
        this.scene.add(this.sunLight);
        this.lights.push(this.sunLight);

        // Add secondary blue light on the opposite side
        const secondaryLight = new THREE.DirectionalLight(0x4466ff, 0.3);  // Dim blue light
        const oppositeDirection = direction.clone().multiplyScalar(-1);
        secondaryLight.position.copy(oppositeDirection.multiplyScalar(SUN_DISTANCE));
        
        // Setup shadows for secondary light
        secondaryLight.castShadow = true;
        secondaryLight.shadow.mapSize.width = 4096;
        secondaryLight.shadow.mapSize.height = 4096;
        secondaryLight.shadow.camera.near = 1;
        secondaryLight.shadow.camera.far = this.shadowDistance * 4;
        secondaryLight.shadow.camera.left = -shadowSize;
        secondaryLight.shadow.camera.right = shadowSize;
        secondaryLight.shadow.camera.top = shadowSize;
        secondaryLight.shadow.camera.bottom = -shadowSize;
        secondaryLight.shadow.bias = -0.00001;
        secondaryLight.shadow.normalBias = 0.02;
        secondaryLight.shadow.radius = 1.5;
        
        this.scene.add(secondaryLight);
        this.lights.push(secondaryLight);

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

    public getLight(): THREE.Light {
        return this.sunLight;
    }

    public update(): void {
        if (this.mainCamera && this.sunLight) {
            const cameraPos = this.mainCamera.position;
            const sunDirection = new THREE.Vector3(-1, 0.5, 1).normalize();
            
            const lightDistance = this.shadowDistance * 2;
            const shadowCameraPos = new THREE.Vector3()
                .copy(cameraPos)
                .add(sunDirection.multiplyScalar(lightDistance));
            
            this.sunLight.position.copy(shadowCameraPos);
            this.sunLight.target.position.copy(cameraPos);

            this.sunLight.shadow.camera.position.copy(shadowCameraPos);
            this.sunLight.shadow.camera.lookAt(cameraPos);
            
            this.sunLight.updateMatrixWorld(true);
            this.sunLight.target.updateMatrixWorld(true);
            this.sunLight.shadow.camera.updateMatrixWorld(true);
            this.sunLight.shadow.camera.updateProjectionMatrix();
        }
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
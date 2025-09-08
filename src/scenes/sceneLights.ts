import * as THREE from 'three';
// Nicer lens flare: custom shader-based full-screen effect
import fragmentShader from '../shaders/lensFlare.frag?raw';
import vertexShader from '../shaders/lensFlare.vert?raw';
import { DEFAULT_LENS_FLARE_UNIFORMS, LENS_FLARE_LAYER } from '../effects/lensFlareConfig';
import { calculateOcclusion, calculateDistanceOpacity, isSunVisible } from '../effects/lensFlareUtils';

export class SceneLights {
    private scene: THREE.Scene;
    private lights: THREE.Light[];
    private sunLight!: THREE.DirectionalLight;
    private mainCamera: THREE.Camera;
    private shadowDistance: number = 100;

    // Shader lens flare state
    private lensFlareMaterial: THREE.ShaderMaterial | null = null;
    private lensFlareMesh: THREE.Mesh | null = null;
    private lensPosition = new THREE.Vector2(0, 0);
    private lensTime = 0;
    private internalOpacity = 0;
    private lastOcclusionOpacity = 0;
    private frameCounter = 0;
    private raycaster = new THREE.Raycaster();
    private projectedPosition = new THREE.Vector3();
    private screenCoords = new THREE.Vector2();

    // Physical sun visualization
    private sunMesh: THREE.Mesh | null = null;
    private readonly AU = 149_597_870_000; // meters
    private readonly SUN_RADIUS = 696_340_000; // meters

    constructor(scene: THREE.Scene, camera: THREE.Camera) {
        this.scene = scene;
        this.lights = [];
        this.mainCamera = camera;
        this.setupLights();
    }

    private setupLights(): void {
        // Scene-scale distances for lighting
        // Aim the sun toward the camera's default forward (-Z) so flares are visible
        const direction = new THREE.Vector3(1, 0.5, -1).normalize();
        const SUN_DISTANCE = this.shadowDistance * 6; // ~600 units by default
        const shadowSize = this.shadowDistance;

        // Sun light (directional with lens flare)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 10.0);
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

        // Removed bluish deep-space fill to keep neutral lighting

        // Add subtle ambient fill; reduced as environment IBL now provides ambient
        const ambient = new THREE.AmbientLight(0xFFFFFF, 0.5);
        this.scene.add(ambient);
        this.lights.push(ambient);

        // Physical Sun sphere at 1 AU (visual only)
        const sunGeometry = new THREE.SphereGeometry(this.SUN_RADIUS, 32, 16);
        const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2cc });
        this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
        this.sunMesh.name = 'Sun';
        (this.sunMesh as any).userData = { ...(this.sunMesh as any).userData, lensflare: 'no-occlusion' };
        this.sunMesh.matrixAutoUpdate = true;
        this.sunMesh.frustumCulled = true;
        this.scene.add(this.sunMesh);

        // Nicer lens flare: add shader-based full-screen mesh
        // Geometry spans clip-space (-1..1); vertex shader writes position directly
        const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
        this.lensFlareMaterial = new THREE.ShaderMaterial({
            uniforms: {
                ...DEFAULT_LENS_FLARE_UNIFORMS,
                enabled: { value: true },
                opacity: { value: 0.0 },
                iResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                lensPosition: { value: this.lensPosition },
                colorGain: { value: new THREE.Color(13, 11, 10) },
            },
            fragmentShader,
            vertexShader,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            name: 'LensFlareShader',
        });
        this.lensFlareMesh = new THREE.Mesh(geometry, this.lensFlareMaterial);
        this.lensFlareMesh.renderOrder = 1000;
        this.lensFlareMesh.frustumCulled = false; // screen-space quad
        // Render only on the lens flare layer so auxiliary cameras can opt out
        this.lensFlareMesh.layers.set(LENS_FLARE_LAYER);
        // Avoid accidental interactions
        (this.lensFlareMesh as any).raycast = () => {};
        this.scene.add(this.lensFlareMesh);
    }

    public getLight(): THREE.DirectionalLight {
        return this.sunLight;
    }

    public update(): void {
        if (!this.mainCamera || !this.sunLight) return;
        const cameraPos = (this.mainCamera as THREE.PerspectiveCamera).position;

        // Determine sun direction using actual sun position (if available)
        const fallbackDir = new THREE.Vector3(1, 0.5, -1).normalize();
        const sunWorldPos = this.sunMesh ? this.sunMesh.position : fallbackDir;

        // Direction of light rays (from Sun toward the camera)
        const sunToCameraDir = new THREE.Vector3()
            .subVectors(cameraPos, sunWorldPos)
            .normalize();

        // Keep the light a fixed distance behind the camera along the light direction
        const FOLLOW_DISTANCE = this.shadowDistance * 6; // same scale as initial SUN_DISTANCE
        this.sunLight.position.copy(cameraPos).sub(sunToCameraDir.clone().multiplyScalar(FOLLOW_DISTANCE));
        this.sunLight.target.position.copy(cameraPos);

        // Ensure matrices are current so shadow camera tracks correctly
        this.sunLight.updateMatrixWorld(false);
        this.sunLight.target.updateMatrixWorld(false);
        (this.sunLight.shadow.camera as THREE.OrthographicCamera).updateProjectionMatrix();

        // Update physical Sun sphere position at 1 AU along a stable direction for visuals
        if (this.sunMesh) {
            const visualDir = fallbackDir; // stable visual direction for the sun sphere
            this.sunMesh.position.copy(visualDir).multiplyScalar(this.AU);
            this.sunMesh.updateMatrixWorld(false);
        }

        // Update lens flare shader uniforms
        if (this.lensFlareMaterial) {
            this.frameCounter++;
            this.lensTime += 1 / 60; // approx; world has fixed dt

            // Project Sun sphere position (fallback to light if missing)
            const sunPos = this.sunMesh ? this.sunMesh.position : this.sunLight.position;
            this.projectedPosition.copy(sunPos).project(this.mainCamera);
            const visible = isSunVisible(this.projectedPosition);

            if (visible) {
                // Set lens position (NDC)
                this.lensPosition.set(this.projectedPosition.x, this.projectedPosition.y);

                // Distance-based effects (use scene scale)
                const cam = this.mainCamera as THREE.PerspectiveCamera;
                const sunDistance = cam.position.distanceTo(sunPos);
                const distanceOpacity = calculateDistanceOpacity(sunDistance);

                // Throttled occlusion testing
                if (this.frameCounter % 3 === 0) {
                    this.screenCoords.set(this.projectedPosition.x, this.projectedPosition.y);
                    this.raycaster.setFromCamera(this.screenCoords, this.mainCamera as THREE.Camera);

                    let intersects = this.raycaster.intersectObjects(
                        this.scene.children.filter((child) => (
                            (child as any).userData?.lensflare !== 'no-occlusion' &&
                            !(child instanceof THREE.GridHelper)
                        )),
                        true
                    );
                    // Only real meshes should occlude; skip lines/helpers
                    intersects = intersects.filter(it => it.object instanceof THREE.Mesh);
                    this.lastOcclusionOpacity = intersects.length > 0 ? calculateOcclusion(intersects) : 0;
                }

                // Combine opacities (worst case)
                const targetOpacity = Math.max(this.lastOcclusionOpacity, distanceOpacity);

                // Smooth opacity interpolation
                const currentOpacity = (this.lensFlareMaterial.uniforms.opacity.value as number) ?? 0;
                this.internalOpacity = THREE.MathUtils.lerp(currentOpacity, targetOpacity, 0.1);
                this.lensFlareMaterial.uniforms.opacity.value = this.internalOpacity;

                // Screen-quad should remain unscaled
                if (this.lensFlareMesh) this.lensFlareMesh.scale.setScalar(1);
            } else {
                // Sun not visible
                this.internalOpacity = 1.0;
                this.lensFlareMaterial.uniforms.opacity.value = this.internalOpacity;
            }

            // Always advance time and update toggles
            this.lensFlareMaterial.uniforms.iTime.value = this.lensTime;
            this.lensFlareMaterial.uniforms.enabled.value = true;
        }
    }

    public cleanup(): void {
        this.lights.forEach(light => {
            
            this.scene.remove(light);
            if ('dispose' in light) {
                (light as any).dispose?.();
            }
        });
        this.lights = [];

        if (this.lensFlareMesh) {
            this.scene.remove(this.lensFlareMesh);
            this.lensFlareMesh.geometry.dispose();
            (this.lensFlareMesh.material as THREE.Material).dispose();
            this.lensFlareMesh = null;
        }
        this.lensFlareMaterial = null;
    }

    // Allow external resize hook to update shader resolution
    public updateResolution(width: number, height: number): void {
        if (this.lensFlareMaterial) {
            const res = this.lensFlareMaterial.uniforms.iResolution.value as THREE.Vector2;
            res.set(width, height);
        }
    }
}

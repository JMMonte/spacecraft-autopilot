import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
// Nicer lens flare: custom shader-based full-screen effect
import fragmentShader from '../shaders/lensFlare.frag?raw';
import vertexShader from '../shaders/lensFlare.vert?raw';
import { DEFAULT_LENS_FLARE_UNIFORMS, LENS_FLARE_LAYER } from '../effects/lensFlareConfig';
import { calculateOcclusion, calculateDistanceOpacity, isSunVisible } from '../effects/lensFlareUtils';

export class SceneLights {
    private scene: THREE.Scene;
    private lights: THREE.Light[];
    private csm: CSM | null = null;
    private sunLight!: THREE.DirectionalLight;
    private mainCamera: THREE.Camera;
    private shadowDistance: number = 100;
    private cascadeFar: number = 0;
    private readonly cascadeCount = 4;
    private readonly cascadeBreakDistances = [80, 320, 1250];
    private readonly cascadeMapSizes = [4096, 2048, 1024, 1024];
    private readonly csmRescanInterval = 20;
    private pendingMaterialRescan = true;
    private readonly csmMaterialCache = new WeakSet<THREE.Material>();
    private sunIntensity = 10.0;

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
        // Aim the sun toward the camera's default forward (-Z) so flares are visible
        const direction = new THREE.Vector3(1, 0.5, -1).normalize();
        this.cascadeFar = this.shadowDistance * 22; // extended reach for far cascades

        // Cascaded shadow maps keep resolution high up close while covering distance
        this.csm = new CSM({
            camera: this.mainCamera,
            parent: this.scene,
            cascades: this.cascadeCount,
            maxFar: this.cascadeFar,
            mode: 'custom',
            customSplitsCallback: (cascades: number, near: number, far: number, target: number[]) => {
                const breakDistances = this.cascadeBreakDistances;
                target.length = 0;
                let previous = near / far;
                for (let i = 0; i < cascades - 1; i++) {
                    const cutoff = breakDistances[i] ?? far;
                    const normalized = Math.min(Math.max(cutoff, near), far) / far;
                    const clamped = Math.max(previous, normalized);
                    target.push(clamped);
                    previous = clamped;
                }
                target.push(1);
            },
            shadowMapSize: this.cascadeMapSizes[0],
            shadowBias: -0.00008,
            lightDirection: direction.clone(),
            lightIntensity: this.sunIntensity,
            lightNear: 1,
            lightFar: this.cascadeFar,
            lightMargin: this.shadowDistance * 3,
        });
        this.csm.fade = true;
        this.sunLight = this.csm.lights[0];

        this.csm.lights.forEach((light, index) => {
            const resolution = this.cascadeMapSizes[Math.min(index, this.cascadeMapSizes.length - 1)] ?? this.cascadeMapSizes[0];
            light.castShadow = true;
            light.shadow.mapSize.set(resolution, resolution);
            light.shadow.bias = -0.00008;
            light.shadow.normalBias = 0.01 + index * 0.006;
            light.shadow.radius = index === 0 ? 1.2 : 1.0;
        });
        this.pendingMaterialRescan = true;

        // Add subtle ambient fill; reduced as environment IBL now provides ambient
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
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
        this.lensFlareMesh.layers.set(LENS_FLARE_LAYER);
        (this.lensFlareMesh as any).raycast = () => {};
        this.scene.add(this.lensFlareMesh);
    }

    public getLight(): THREE.DirectionalLight {
        return this.sunLight;
    }

    public markMaterialsDirty(): void {
        this.pendingMaterialRescan = true;
    }

    public update(): void {
        if (!this.mainCamera) return;
        this.frameCounter++;

        const cameraPos = (this.mainCamera as THREE.PerspectiveCamera).position;
        const fallbackDir = new THREE.Vector3(1, 0.5, -1).normalize();
        const sunWorldPos = this.sunMesh ? this.sunMesh.position : fallbackDir;

        const sunToCameraDir = new THREE.Vector3()
            .subVectors(cameraPos, sunWorldPos)
            .normalize();

        if (this.csm) {
            if (this.csm.lights.length > 0) {
                this.sunLight = this.csm.lights[0];
            }
            this.csm.lightDirection.copy(sunToCameraDir);
            this.csm.maxFar = this.cascadeFar;
            this.csm.update();
        } else if (this.sunLight) {
            const followDistance = this.shadowDistance * 6;
            this.sunLight.position.copy(cameraPos).sub(sunToCameraDir.clone().multiplyScalar(followDistance));
            this.sunLight.target.position.copy(cameraPos);
            this.sunLight.updateMatrixWorld(false);
            this.sunLight.target.updateMatrixWorld(false);
            (this.sunLight.shadow.camera as THREE.OrthographicCamera).updateProjectionMatrix();
        }

        if (this.pendingMaterialRescan || (this.csm && this.frameCounter % this.csmRescanInterval === 0)) {
            this.refreshCSMMaterials(this.pendingMaterialRescan);
            this.pendingMaterialRescan = false;
        }

        if (this.sunMesh) {
            const visualDir = fallbackDir;
            this.sunMesh.position.copy(visualDir).multiplyScalar(this.AU);
            this.sunMesh.updateMatrixWorld(false);
        }

        if (this.lensFlareMaterial) {
            this.lensTime += 1 / 60; // approx; world has fixed dt

            const sunPos = this.sunMesh ? this.sunMesh.position : this.sunLight.position;
            this.projectedPosition.copy(sunPos).project(this.mainCamera);
            const visible = isSunVisible(this.projectedPosition);

            if (visible) {
                this.lensPosition.set(this.projectedPosition.x, this.projectedPosition.y);

                const cam = this.mainCamera as THREE.PerspectiveCamera;
                const sunDistance = cam.position.distanceTo(sunPos);
                const distanceOpacity = calculateDistanceOpacity(sunDistance);

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
                    intersects = intersects.filter(it => it.object instanceof THREE.Mesh);
                    this.lastOcclusionOpacity = intersects.length > 0 ? calculateOcclusion(intersects) : 0;
                }

                const targetOpacity = Math.max(this.lastOcclusionOpacity, distanceOpacity);

                const currentOpacity = (this.lensFlareMaterial.uniforms.opacity.value as number) ?? 0;
                this.internalOpacity = THREE.MathUtils.lerp(currentOpacity, targetOpacity, 0.1);
                this.lensFlareMaterial.uniforms.opacity.value = this.internalOpacity;

                if (this.lensFlareMesh) this.lensFlareMesh.scale.setScalar(1);
            } else {
                this.internalOpacity = 1.0;
                this.lensFlareMaterial.uniforms.opacity.value = this.internalOpacity;
            }

            this.lensFlareMaterial.uniforms.iTime.value = this.lensTime;
            this.lensFlareMaterial.uniforms.enabled.value = true;
        }
    }

    private refreshCSMMaterials(force: boolean): void {
        if (!this.csm) return;
        if (!force && this.frameCounter % this.csmRescanInterval !== 0) return;

        this.scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                if (!material || this.csmMaterialCache.has(material)) return;
                this.csm?.setupMaterial(material);
                this.csmMaterialCache.add(material);
            });
        });
    }

    public cleanup(): void {
        if (this.csm) {
            this.csm.remove();
            this.csm.dispose();
            this.csm = null;
        }

        this.lights.forEach(light => {
            this.scene.remove(light);
            if ('dispose' in light) {
                (light as any).dispose?.();
            }
        });
        this.lights = [];

        if (this.sunMesh) {
            this.scene.remove(this.sunMesh);
            this.sunMesh.geometry.dispose();
            (this.sunMesh.material as THREE.Material).dispose();
            this.sunMesh = null;
        }

        if (this.lensFlareMesh) {
            this.scene.remove(this.lensFlareMesh);
            this.lensFlareMesh.geometry.dispose();
            (this.lensFlareMesh.material as THREE.Material).dispose();
            this.lensFlareMesh = null;
        }
        this.lensFlareMaterial = null;
    }

    // Allow external resize hook to update shader resolution and rebalance cascades
    public updateResolution(width: number, height: number): void {
        if (this.lensFlareMaterial) {
            const res = this.lensFlareMaterial.uniforms.iResolution.value as THREE.Vector2;
            res.set(width, height);
        }
        if (this.csm) {
            this.csm.updateFrustums();
            this.pendingMaterialRescan = true;
        }
    }
}

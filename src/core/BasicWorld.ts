import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { createPhysicsEngine, PhysicsEngine } from '../physics';
import { SceneLights } from '../scenes/sceneLights';
import { LENS_FLARE_LAYER } from '../effects/lensFlareConfig';
import { SceneCamera } from '../scenes/sceneCamera';
import { WorldRenderer } from './worldRenderer';
import { Spacecraft } from './spacecraft';
import { SpacecraftController } from '../controllers/spacecraftController';
import { BackgroundLoader } from '../helpers/backgroundLoader';
import { ProceduralAsteroid } from '../objects/ProceduralAsteroid';
import { AsteroidSystem, AsteroidSystemConfig } from '../objects/AsteroidSystem';
import { createLogger } from '../utils/logger';

interface WorldConfig {
    debug?: boolean;
    physicsEngine?: 'rapier';
    initialSpacecraft?: Array<{
        position: { x: number; y: number; z: number };
        width: number;
        height: number;
        depth: number;
        initialConeVisibility: boolean;
        name: string;
    }>;
    initialFocus?: number;
    asteroids?: Array<{
        position: { x: number; y: number; z: number };
        size?: number;
    }>;
    asteroidSystem?: AsteroidSystemConfig;
}

interface LoadingQueueItem {
    loaded: number;
    total: number;
}

interface ThreeScene extends THREE.Scene {
    userData: {
        camera: THREE.PerspectiveCamera;
        light: THREE.DirectionalLight;
    };
}

export class BasicWorld {
    private log = createLogger('core:BasicWorld');
    private config: WorldConfig;
    private canvas: HTMLCanvasElement;
    private spacecraft: Spacecraft[];
    private spacecraftControllers: SpacecraftController[];
    private activeSpacecraft: Spacecraft | null;
    private keysPressed: { [key: string]: boolean };
    private dt: number;
    private onLoadProgress: (progress: number) => void;
    private onLoadStatus: (status: string) => void;
    private spacecraftListVersion: number;
    private onSpacecraftListChange: ((version: number) => void) | null;
    private onActiveSpacecraftChange: ((spacecraft: Spacecraft) => void) | null;
    private loadingQueue: Map<string, LoadingQueueItem>;
    private currentFile: string;
    private backgroundLoader!: BackgroundLoader;
    private asteroid: ProceduralAsteroid | null = null;
    private asteroids: ProceduralAsteroid[] = [];
    private asteroidSystem: AsteroidSystem | null = null;

    // Three.js components
    public renderer!: WorldRenderer;
    public camera!: SceneCamera;
    public lights!: SceneLights;
    private physics!: PhysicsEngine;
    private rafId: number | null = null;
    private running: boolean = false;
    private stats: Stats | null = null;

    constructor(config: WorldConfig = {}, canvas: HTMLCanvasElement) {
        this.config = config;
        this.canvas = canvas;
        this.spacecraft = [];
        this.spacecraftControllers = [];
        this.activeSpacecraft = null;
        this.keysPressed = {};
        this.dt = 1.0 / 60.0;
        this.onLoadProgress = () => {};
        this.onLoadStatus = () => {};
        this.spacecraftListVersion = 0;
        this.onSpacecraftListChange = null;
        this.onActiveSpacecraftChange = null;
        this.loadingQueue = new Map();
        this.currentFile = '';

        // Configure Three.js loading manager
        this.configureLoadingManager();
    }

    private configureLoadingManager(): void {
        THREE.DefaultLoadingManager.onStart = (url: string) => {
            this.log.debug('Started loading:', url);
            this.currentFile = url;
            this.loadingQueue.set(url, { loaded: 0, total: 0 });
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onProgress = (url: string, loaded: number, total: number) => {
            if (!total) return;
            
            this.loadingQueue.set(url, { loaded, total });
            this.currentFile = url;
            
            const progress = Math.round((loaded / total) * 100);
            this.log.debug(`Loading ${url}: ${loaded}/${total} (${progress}%)`);
            
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onLoad = () => {
            this.log.debug('Batch complete');
            this.loadingQueue.clear();
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onError = (url: string) => {
            this.log.error('Error loading:', url);
            this.loadingQueue.delete(url);
            this.updateLoadingStatus();
        };
    }

    private updateLoadingStatus(): void {
        let totalProgress = 0;
        let totalFiles = 0;

        this.loadingQueue.forEach(({ loaded, total }) => {
            if (total > 0) {
                totalProgress += loaded / total;
                totalFiles++;
            }
        });

        const progress = totalFiles > 0 ? (totalProgress / totalFiles) * 100 : 100;
        this.onLoadProgress(progress);
        
        if (this.currentFile) {
            this.onLoadStatus(`Loading ${this.currentFile}...`);
        }
    }

    public async initializeWorld(): Promise<void> {
        this.onLoadProgress(0);
        this.onLoadStatus('Initializing scene...');

        // Initialize renderer and scene
        this.renderer = new WorldRenderer(this.canvas);
        this.renderer.renderer.shadowMap.enabled = true;
        this.renderer.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft shadows
        
        this.camera = new SceneCamera(this.renderer.renderer, this);
        this.camera.camera.position.set(0, 5, 10);
        this.camera.camera.lookAt(0, 0, 0);
        // Ensure main camera renders the global lens flare overlay
        this.camera.camera.layers.enable(LENS_FLARE_LAYER);
        this.resize();

        // Setup performance stats overlay (bottom-left)
        // Use the stable ESM module from three/examples
        const enableStats = this.config.debug !== false; // default on unless explicitly disabled
        if (enableStats) {
            this.stats = new Stats();
            this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
            const dom = this.stats.dom as HTMLDivElement;
            dom.style.position = 'fixed';
            dom.style.left = '8px';
            dom.style.bottom = '8px';
            dom.style.top = 'auto';
            dom.style.zIndex = '1000';
            dom.style.pointerEvents = 'none';
            document.body.appendChild(dom);
            this.log.debug('Stats overlay attached');
        }

        // Initialize background
        this.backgroundLoader = new BackgroundLoader(this.camera.scene, this.camera.camera, () => {
            this.onLoadProgress(100);
            this.onLoadStatus('Ready');
        });

        // Initialize lights (centralized in SceneLights)
        this.lights = new SceneLights(this.camera.scene as ThreeScene, this.camera.camera);

        // Store camera and light in scene's userData for access by other components
        (this.camera.scene as ThreeScene).userData.camera = this.camera.camera;
        (this.camera.scene as ThreeScene).userData.light = this.lights.getLight();

        // Initialize post-processing
        this.renderer.setupPostProcessing(this.camera.scene, this.camera.camera);

        // Initialize physics via abstraction
        const engineName = this.config.physicsEngine ?? 'rapier';
        this.physics = await createPhysicsEngine(engineName, { gravity: { x: 0, y: 0, z: 0 } });

        // Add grid helper
        const gridHelper = new THREE.GridHelper(100, 100);
        // Prevent grid from occluding lens flares
        (gridHelper as any).userData = { ...(gridHelper as any).userData, lensflare: 'no-occlusion' };
        this.camera.scene.add(gridHelper);

        // Prefer realistic asteroid system when configured
        if (this.config.asteroidSystem) {
            this.asteroidSystem = new AsteroidSystem(this.camera.scene, this.physics, this.config.asteroidSystem);
        } else {
            // Add asteroids from config if provided; otherwise create a default one
            const asteroidConfigs = this.config.asteroids || [];
            if (asteroidConfigs.length > 0) {
                asteroidConfigs.forEach((cfg, idx) => {
                    const pos = new THREE.Vector3(cfg.position.x, cfg.position.y, cfg.position.z);
                    const size = cfg.size ?? 200;
                    const asteroid = new ProceduralAsteroid(
                        this.camera.scene,
                        {} as any,
                        pos,
                        size,
                        false,
                        idx % 6,
                        this.physics,
                        true // use explicit position/size
                    );
                    this.asteroids.push(asteroid);
                });
            } else {
                // Backwards-compatible single asteroid
                this.asteroid = new ProceduralAsteroid(
                    this.camera.scene,
                    {} as any,
                    new THREE.Vector3(0, 0, 0),
                    200,
                    false,
                    0,
                    this.physics,
                    false
                );
            }
        }

        // Initialize spacecraft after scene and physics are ready
        const initialSpacecraft = this.config.initialSpacecraft || [];
        if (initialSpacecraft.length > 0) {
            await Promise.all(initialSpacecraft.map(async spacecraftConfig => {
                const initialPosition = new THREE.Vector3(
                    spacecraftConfig.position.x,
                    spacecraftConfig.position.y,
                    spacecraftConfig.position.z
                );
                return this.addSpacecraft(
                    initialPosition,
                    spacecraftConfig.width,
                    spacecraftConfig.height,
                    spacecraftConfig.depth,
                    spacecraftConfig.initialConeVisibility,
                    spacecraftConfig.name
                );
            }));
        } else {
            await this.addSpacecraft(new THREE.Vector3(0, 0, 2));
        }

        // Initialize active spacecraft
        const initialFocusIndex = this.config.initialFocus || 0;
        if (this.spacecraft[initialFocusIndex]) {
            this.setActiveSpacecraft(this.spacecraft[initialFocusIndex]);
        }

        this.onLoadProgress(100);
        this.onLoadStatus('Ready');
    }

    private isPositionOverlapping(position: THREE.Vector3, width: number, height: number, depth: number): boolean {
        // Check if the new position would overlap with any existing spacecraft
        // Add a small buffer distance between spacecraft
        const buffer = 0.5;
        
        for (const existingSpacecraft of this.spacecraft) {
            const existingPos = existingSpacecraft.objects.box.position;
            const existingDimensions = existingSpacecraft.getMainBodyDimensions();
            
            // Check if boxes overlap in all dimensions
            if (Math.abs(position.x - existingPos.x) < (width + existingDimensions.x) / 2 + buffer &&
                Math.abs(position.y - existingPos.y) < (height + existingDimensions.y) / 2 + buffer &&
                Math.abs(position.z - existingPos.z) < (depth + existingDimensions.z) / 2 + buffer) {
                return true;
            }
        }
        return false;
    }

    public createNewSpacecraft(): Spacecraft {
        const maxAttempts = 50;
        let attempt = 0;
        let randomPosition: THREE.Vector3;
        const width = 1, height = 1, depth = 2;
        const defaultRange = 20; // Increased from 10 and made symmetric

        // Keep trying new positions until we find one that doesn't overlap
        do {
            randomPosition = new THREE.Vector3(
                (Math.random() - 0.5) * defaultRange,  // x between -10 and 10
                (Math.random() - 0.5) * defaultRange,  // y between -10 and 10
                (Math.random() - 0.5) * defaultRange   // z also between -10 and 10, no longer forcing positive
            );
            attempt++;

            // If we can't find a non-overlapping position after many attempts,
            // gradually increase the placement area
            if (attempt > maxAttempts) {
                const scale = 1 + (attempt - maxAttempts) / 10;
                randomPosition.x *= scale;
                randomPosition.y *= scale;
                randomPosition.z *= scale;
            }
        } while (this.isPositionOverlapping(randomPosition, width, height, depth) && attempt < maxAttempts * 2);

        this.log.debug('Creating new spacecraft at position:', randomPosition);
        const newSpacecraft = this.addSpacecraft(
            randomPosition,
            width, height, depth,
            false,
            `Spacecraft ${this.spacecraft.length + 1}`
        );
        
        return newSpacecraft;
    }

    public setActiveSpacecraft(spacecraft: Spacecraft): void {
        if (this.activeSpacecraft === spacecraft) return;

        // Deactivate current spacecraft controller
        const currentController = this.spacecraftControllers.find(controller => controller.getIsActive());
        if (currentController) {
            currentController.setIsActive(false);
        }

        // Activate new spacecraft controller
        const newController = this.spacecraftControllers.find(
            controller => controller === spacecraft.spacecraftController
        );
        if (newController) {
            newController.setIsActive(true);
        }

        this.activeSpacecraft = spacecraft;
        
        if (this.onActiveSpacecraftChange) {
            this.onActiveSpacecraftChange(spacecraft);
        }
    }

    public addSpacecraft(
        initialPosition: THREE.Vector3,
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        initialConeVisibility: boolean = false,
        name: string = 'Spacecraft'
    ): Spacecraft {
        const spacecraft = new Spacecraft(
            {},
            this.camera.scene as ThreeScene,
            initialPosition,
            width,
            height,
            depth,
            this,
            this.physics
        );
        spacecraft.name = name;
        
        if (initialConeVisibility) {
            spacecraft.rcsVisuals.showCones();
        }
        this.spacecraft.push(spacecraft);
        this.spacecraftControllers.push(spacecraft.spacecraftController);
        
        if (!this.activeSpacecraft) {
            this.setActiveSpacecraft(spacecraft);
        }
        
        this.spacecraftListVersion++;
        if (this.onSpacecraftListChange) {
            this.onSpacecraftListChange(this.spacecraftListVersion);
        }
        
        return spacecraft;
    }

    public deleteSpacecraft(spacecraftToDelete: Spacecraft): void {
        if (!spacecraftToDelete || spacecraftToDelete === this.activeSpacecraft) return;
        
        const index = this.spacecraft.indexOf(spacecraftToDelete);
        if (index > -1) {
            this.spacecraft.splice(index, 1);
            spacecraftToDelete.cleanup?.();
            
            this.spacecraftListVersion++;
            if (this.onSpacecraftListChange) {
                this.onSpacecraftListChange(this.spacecraftListVersion);
            }
        }
    }

    public getSpacecraftList(): Spacecraft[] {
        return this.spacecraft;
    }

    public getActiveSpacecraft(): Spacecraft | null {
        return this.activeSpacecraft;
    }

    public setLoadingCallbacks(
        onProgress: (progress: number) => void,
        onStatus: (status: string) => void
    ): void {
        this.onLoadProgress = onProgress || (() => {});
        this.onLoadStatus = onStatus || (() => {});
    }

    public setSpacecraftListChangeCallback(callback: (version: number) => void): void {
        this.onSpacecraftListChange = callback;
    }

    public setActiveSpacecraftChangeCallback(callback: (spacecraft: Spacecraft) => void): void {
        this.onActiveSpacecraftChange = callback;
    }

    // Public wrappers so React can forward events without global listeners
    public onKeyDown(event: KeyboardEvent): void {
        this.keysPressed[event.code] = true;
        const activeController = this.spacecraftControllers.find(controller => controller.getIsActive());
        if (activeController) {
            activeController.handleKeyDown(event);
        }
    }

    public onKeyUp(event: KeyboardEvent): void {
        this.keysPressed[event.code] = false;
        const activeController = this.spacecraftControllers.find(controller => controller.getIsActive());
        if (activeController) {
            activeController.handleKeyUp(event);
        }
    }

    public onDoubleClick(event: MouseEvent): void {
        event.preventDefault();

        const mouse = new THREE.Vector2();
        const rect = this.renderer.renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera.camera);

        const clickableObjects = this.spacecraft.flatMap(spacecraft => spacecraft.getThreeObjects());
        const intersects = raycaster.intersectObjects(clickableObjects, true);

        if (intersects.length > 0) {
            const newTarget = intersects[0].object;
            const spacecraft = this.spacecraft.find(spacecraft => spacecraft.objects.box === newTarget);
            if (spacecraft) {
                this.setActiveSpacecraft(spacecraft);
            }
        }
    }

    public resize(): void {
        if (!this.renderer || !this.camera) return;
        const { width, height } = this.renderer.updateSize();
        this.camera.camera.aspect = width / height;
        this.camera.camera.updateProjectionMatrix();
        // Propagate resolution to effects (e.g., lens flare)
        if (this.lights && 'updateResolution' in this.lights) {
            (this.lights as any).updateResolution(width, height);
        }
    }

    public startRenderLoop(): void {
        if (this.running) return;
        this.running = true;
        const animate = () => {
            if (!this.running) return;
            this.rafId = requestAnimationFrame(animate);

            // Begin performance measurement
            this.stats?.begin();

            const deltaTime = this.dt;
            this.physics.step(deltaTime);

            // Update asteroids
            if (this.asteroid) this.asteroid.update();
            this.asteroids.forEach(a => a.update());
            if (this.asteroidSystem) {
                // Keep an internal elapsed time in seconds for orbital updates
                (this as any)._t = ((this as any)._t ?? 0) + deltaTime;
                this.asteroidSystem.update((this as any)._t);
            }

            // Update lights
            if (this.lights) {
                this.lights.update();
            }

            // Update spacecraft
            this.spacecraft.forEach(spacecraft => spacecraft.update());

            // Update spacecraft controllers
            this.spacecraftControllers.forEach(controller => {
                if (controller.getIsActive()) {
                    controller.applyForces(deltaTime);
                }
            });

            // Update camera to follow active spacecraft
            const activeSpacecraft = this.spacecraft.find(s => s.spacecraftController.getIsActive());
            if (activeSpacecraft) {
                this.camera.updateOrbitTarget(activeSpacecraft.objects.box.position);
                this.camera.controls.update();
            }

            // Render the scene
            this.renderer.render(this.camera.scene, this.camera.camera);

            // End performance measurement
            this.stats?.end();
        };

        animate();
    }

    public cleanup(): void {
        // Stop loop
        this.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        // Dispose Three.js resources
        this.renderer.renderer.dispose();
        this.camera.cleanup();
        this.lights.cleanup();
        this.backgroundLoader.dispose();

        // Cleanup spacecraft
        this.spacecraft.forEach(spacecraft => {
            spacecraft.cleanup();
        });

        if (this.asteroid) {
            this.asteroid.dispose();
            this.asteroid = null;
        }
        this.asteroids.forEach(a => a.dispose());
        this.asteroids = [];
        if (this.asteroidSystem) {
            this.asteroidSystem.dispose();
            this.asteroidSystem = null;
        }

        // Remove stats overlay
        if (this.stats) {
            const dom = this.stats.dom as HTMLElement | null;
            if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
            this.stats = null;
        }
    }
} 

import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { createPhysicsEngine, PhysicsEngine } from '../physics';
import { SceneLights } from '../scenes/sceneLights';
import { LENS_FLARE_LAYER } from '../effects/lensFlareConfig';
import { SceneCamera } from '../scenes/sceneCamera';
import { WorldRenderer } from './worldRenderer';
import { Spacecraft, type SpacecraftOptions } from './spacecraft';
import type { SpacecraftBlueprint } from '../scenes/modules/SpacecraftBlueprint';
import { createMoverBlueprint } from '../scenes/modules/blueprints';
import { SpacecraftListNotifier } from './spacecraftListNotifier';
import { removeSpacecraftAndController } from './spacecraftLifecycle';
import { SpacecraftController } from '../controllers/spacecraftController';
import { DockingOrchestrator } from './DockingOrchestrator';
import { InputRouter } from './InputRouter';
import { BackgroundLoader } from '../helpers/backgroundLoader';
import { AsteroidModel, AsteroidModelId } from '../objects/AsteroidModel';
import { AsteroidSystem, AsteroidSystemConfig } from '../objects/AsteroidSystem';
import { createLogger } from '../utils/logger';
import { InfiniteGrid } from '../scenes/objects/InfiniteGrid';
import type { SpacecraftRegistry } from '../domain/spacecraftRegistry';
import {
    noopSimulationRuntimeStatePort,
    SimulationRuntimeStatePort,
} from '../domain/runtimeStatePort';

interface WorldConfig {
    debug?: boolean;
    physicsEngine?: 'rapier';
    asteroids?: Array<{
        position: { x: number; y: number; z: number };
        diameter: number; // required: visual diameter (world units)
        model: AsteroidModelId; // required: which FBX to load
    }>;
    asteroidSystem?: AsteroidSystemConfig;
    initialSpacecraft?: Array<{
        position: { x: number; y: number; z: number };
        width: number;
        height: number;
        depth: number;
        initialConeVisibility: boolean;
        name: string;
        thrusterStrengths?: number[]; // optional 24-entry per-thruster max (N)
    }>;
    initialFocus?: number;
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

export class BasicWorld implements SpacecraftRegistry {
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
    private spacecraftListNotifier: SpacecraftListNotifier;
    private onActiveSpacecraftChange: ((spacecraft: Spacecraft) => void) | null;
    private loadingQueue: Map<string, LoadingQueueItem>;
    private currentFile: string;
    private backgroundLoader!: BackgroundLoader;
    private asteroids: AsteroidModel[] = [];
    private asteroidSystem: AsteroidSystem | null = null;

    // Three.js components
    public renderer!: WorldRenderer;
    public camera!: SceneCamera;
    public lights!: SceneLights;
    private physics!: PhysicsEngine;
    private rafId: number | null = null;
    private running: boolean = false;
    private stats: Stats | null = null;
    private grid: InfiniteGrid | null = null;
    private runtimeState: SimulationRuntimeStatePort;
    private dockingOrchestrator = new DockingOrchestrator();
    private inputRouter!: InputRouter;

    constructor(
        config: WorldConfig = {},
        canvas: HTMLCanvasElement,
        runtimeState: SimulationRuntimeStatePort = noopSimulationRuntimeStatePort
    ) {
        this.config = config;
        this.canvas = canvas;
        this.runtimeState = runtimeState;
        this.spacecraft = [];
        this.spacecraftControllers = [];
        this.activeSpacecraft = null;
        this.keysPressed = {};
        this.dt = 1.0 / 60.0;
        this.onLoadProgress = () => {};
        this.onLoadStatus = () => {};
        this.spacecraftListNotifier = new SpacecraftListNotifier();
        this.onActiveSpacecraftChange = null;
        this.loadingQueue = new Map();
        this.currentFile = '';

        // Configure Three.js loading manager
        this.configureLoadingManager();

        // Initialize input router (lazily wired after initializeWorld sets up renderer/camera)
        this.inputRouter = new InputRouter(
            () => this.spacecraftControllers,
            () => this.spacecraft,
            () => this.camera?.camera,
            () => this.renderer?.renderer?.domElement,
            (s) => this.setActiveSpacecraft(s),
        );
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

    private markShadowMaterialsDirty(): void {
        if (this.lights && typeof (this.lights as any).markMaterialsDirty === 'function') {
            try { (this.lights as any).markMaterialsDirty(); } catch {}
        }
    }

    private emitSpacecraftListChanged(): void {
        this.spacecraftListNotifier.emit();
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

        // Initialize UI-driven camera/grid state and subscribe to changes
        try {
            const ui = this.runtimeState.getUiState();
            this.camera.setCameraMode(ui.cameraMode ?? 'follow');
            (this as any)._prevCamMode = ui.cameraMode ?? 'follow';
            const unsubUi = this.runtimeState.subscribeUiState((uiNow) => {
                const prevMode = (this as any)._prevCamMode;
                if (this.camera && uiNow.cameraMode) {
                    // On transition to follow, snap target to active spacecraft without jumping
                    if (uiNow.cameraMode === 'follow' && prevMode !== 'follow') {
                        const activeSpacecraft = this.spacecraft.find(s => s.spacecraftController.getIsActive());
                        if (activeSpacecraft) {
                            this.camera.snapFollowTarget(activeSpacecraft.objects.box.position);
                        }
                    }
                    this.camera.setCameraMode(uiNow.cameraMode);
                    (this as any)._prevCamMode = uiNow.cameraMode;
                }
            });
            (this as any)._storeUnsubs = (this as any)._storeUnsubs || [];
            (this as any)._storeUnsubs.push(unsubUi);
        } catch {}

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

        // Add infinite-looking shader grid (drei-like)
        this.grid = new InfiniteGrid({
            cellSize: 1,
            sectionSize: 10,
            color1: '#404040',
            color2: '#808080',
            thickness1: 1.0,
            thickness2: 2.0,
            fadeDistance: 300,
            fadeStrength: 1.25,
            followCamera: true,
        });
        this.grid.addTo(this.camera.scene);
        // Initialize grid visibility from global UI store and subscribe to changes
        try {
            const initialVisible = this.runtimeState.getUiState().gridVisible ?? true;
            this.grid.mesh.visible = initialVisible;
            const unsub = this.runtimeState.subscribeUiState((ui) => {
                const visible = (ui.gridVisible ?? true);
                if (this.grid) this.grid.mesh.visible = visible;
            });
            (this as any)._storeUnsubs = (this as any)._storeUnsubs || [];
            (this as any)._storeUnsubs.push(unsub);
        } catch {}

        // Prefer asteroid system if provided; else spawn standalone asteroids
        if (this.config.asteroidSystem) {
            this.asteroidSystem = new AsteroidSystem(this.camera.scene, this.physics, this.config.asteroidSystem);
            this.markShadowMaterialsDirty();
        } else {
            const asteroidConfigs = this.config.asteroids || [];
            if (asteroidConfigs.length > 0) {
                asteroidConfigs.forEach((cfg) => {
                    // Defensive runtime validation even though types require these
                    if (typeof cfg.diameter !== 'number') {
                        this.log.error('Asteroid entry missing diameter:', cfg);
                        return;
                    }
                    if (!cfg.model) {
                        this.log.error('Asteroid entry missing model id:', cfg);
                        return;
                    }
                    const pos = new THREE.Vector3(cfg.position.x, cfg.position.y, cfg.position.z);
                    const asteroid = new AsteroidModel(this.camera.scene, { position: pos, diameter: cfg.diameter, model: cfg.model, physics: this.physics });
                    // Give standalone asteroids a gentle spin (random axis, ~12h period)
                    const axis = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
                    const spinPeriod = 12 * 3600; // seconds
                    asteroid.setSpin(axis, (2 * Math.PI) / spinPeriod);
                    this.asteroids.push(asteroid);
                });
                this.markShadowMaterialsDirty();
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
                const bp = createMoverBlueprint(
                    spacecraftConfig.name ?? 'Spacecraft',
                    spacecraftConfig.width, spacecraftConfig.height, spacecraftConfig.depth,
                );
                const sc = this.addSpacecraftFromBlueprint(bp, initialPosition);
                if (spacecraftConfig.initialConeVisibility) {
                    sc.rcsVisuals.showCones();
                }
                // Apply per-thruster strengths when provided
                if (Array.isArray(spacecraftConfig.thrusterStrengths) && spacecraftConfig.thrusterStrengths.length === 24) {
                    try { sc.spacecraftController?.setThrusterStrengths(spacecraftConfig.thrusterStrengths); } catch {}
                }
                return sc;
            }));
        } else {
            this.addSpacecraftFromBlueprint(createMoverBlueprint('Alpha'), new THREE.Vector3(0, 0, 2));
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
        const name = `Spacecraft ${this.spacecraft.length + 1}`;
        const bp = createMoverBlueprint(name);
        const newSpacecraft = this.addSpacecraftFromBlueprint(bp);
        
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
                this.physics,
                this.runtimeState
            );
        spacecraft.name = name;
        spacecraft.registry = this;

        if (initialConeVisibility) {
            spacecraft.rcsVisuals.showCones();
        }
        this.spacecraft.push(spacecraft);
        this.spacecraftControllers.push(spacecraft.spacecraftController);
        this.markShadowMaterialsDirty();
        
        if (!this.activeSpacecraft) {
            this.setActiveSpacecraft(spacecraft);
        }
        
        this.emitSpacecraftListChanged();
        
        return spacecraft;
    }

    /**
     * Create a node module with 2, 4, or 6 docking ports and no thrusters.
     * - 2 ports: front + back (inline coupler)
     * - 4 ports: front + back + left + right (cross junction)
     * - 6 ports: all faces (full hub)
     */
    public addNodeSpacecraft(position?: THREE.Vector3, portCount: 2 | 4 | 6 = 4): Spacecraft {
        const size = 1;
        // Random non-overlapping position if none provided (same logic as createNewSpacecraft)
        let pos: THREE.Vector3;
        if (position) {
            pos = position;
        } else {
            const defaultRange = 20;
            const maxAttempts = 50;
            let attempt = 0;
            do {
                pos = new THREE.Vector3(
                    (Math.random() - 0.5) * defaultRange,
                    (Math.random() - 0.5) * defaultRange,
                    (Math.random() - 0.5) * defaultRange,
                );
                attempt++;
                if (attempt > maxAttempts) {
                    const scale = 1 + (attempt - maxAttempts) / 10;
                    pos.multiplyScalar(scale);
                }
            } while (this.isPositionOverlapping(pos, size, size, size) && attempt < maxAttempts * 2);
        }
        const d = size / 2;
        const allPorts: Array<{ id: string; position: THREE.Vector3; direction: THREE.Vector3 }> = [
            { id: 'front', position: new THREE.Vector3(0, 0, d), direction: new THREE.Vector3(0, 0, 1) },
            { id: 'back', position: new THREE.Vector3(0, 0, -d), direction: new THREE.Vector3(0, 0, -1) },
            { id: 'right', position: new THREE.Vector3(d, 0, 0), direction: new THREE.Vector3(1, 0, 0) },
            { id: 'left', position: new THREE.Vector3(-d, 0, 0), direction: new THREE.Vector3(-1, 0, 0) },
            { id: 'top', position: new THREE.Vector3(0, d, 0), direction: new THREE.Vector3(0, 1, 0) },
            { id: 'bottom', position: new THREE.Vector3(0, -d, 0), direction: new THREE.Vector3(0, -1, 0) },
        ];
        const portConfigs = allPorts.slice(0, portCount);
        const label = portCount === 2 ? 'Coupler' : portCount === 6 ? 'Hub' : 'Node';
        const options: SpacecraftOptions = {
            ports: portConfigs,
            includeThrusters: false,
            name: label,
        };
        const spacecraft = new Spacecraft(
            {},
            this.camera.scene as ThreeScene,
            pos,
            size, size, size,
            this, this.physics, this.runtimeState,
            options
        );
        spacecraft.registry = this;

        this.spacecraft.push(spacecraft);
        this.spacecraftControllers.push(spacecraft.spacecraftController);
        this.markShadowMaterialsDirty();

        if (!this.activeSpacecraft) {
            this.setActiveSpacecraft(spacecraft);
        }

        this.emitSpacecraftListChanged();

        return spacecraft;
    }

    /**
     * Create a spacecraft from a blueprint (module system).
     * This is the preferred way to create spacecraft with custom modules
     * like solar panels, antennas, etc.
     */
    public addSpacecraftFromBlueprint(
        blueprint: SpacecraftBlueprint,
        position?: THREE.Vector3,
    ): Spacecraft {
        let pos: THREE.Vector3;
        if (position) {
            pos = position;
        } else {
            const defaultRange = 20;
            const maxAttempts = 50;
            let attempt = 0;
            do {
                pos = new THREE.Vector3(
                    (Math.random() - 0.5) * defaultRange,
                    (Math.random() - 0.5) * defaultRange,
                    (Math.random() - 0.5) * defaultRange,
                );
                attempt++;
                if (attempt > maxAttempts) {
                    const scale = 1 + (attempt - maxAttempts) / 10;
                    pos.multiplyScalar(scale);
                }
            } while (this.isPositionOverlapping(pos, blueprint.width, blueprint.height, blueprint.depth) && attempt < maxAttempts * 2);
        }

        const hasRcs = blueprint.modules.some(m => m.type === 'rcs');
        const options: SpacecraftOptions = {
            includeThrusters: hasRcs,
            name: blueprint.name,
            blueprint,
        };

        const spacecraft = new Spacecraft(
            {},
            this.camera.scene as ThreeScene,
            pos,
            blueprint.width, blueprint.height, blueprint.depth,
            this, this.physics, this.runtimeState,
            options,
        );
        spacecraft.registry = this;

        if (hasRcs) {
            spacecraft.rcsVisuals.showCones();
        }

        this.spacecraft.push(spacecraft);
        this.spacecraftControllers.push(spacecraft.spacecraftController);
        this.markShadowMaterialsDirty();

        if (!this.activeSpacecraft) {
            this.setActiveSpacecraft(spacecraft);
        }

        this.emitSpacecraftListChanged();

        return spacecraft;
    }

    public deleteSpacecraft(spacecraftToDelete: Spacecraft): void {
        if (!spacecraftToDelete || spacecraftToDelete === this.activeSpacecraft) return;

        if (removeSpacecraftAndController(
            this.spacecraft,
            this.spacecraftControllers,
            spacecraftToDelete,
            () => spacecraftToDelete.cleanup?.()
        )) {
            this.emitSpacecraftListChanged();
        }
    }

    public getSpacecraftList(): Spacecraft[] {
        return this.spacecraft;
    }

    // Provide asteroid obstacles as AABBs (using radius as half-extent)
    public getAsteroidObstacles(): Array<{ position: THREE.Vector3; size: THREE.Vector3 }> {
        const out: Array<{ position: THREE.Vector3; size: THREE.Vector3 }> = [];
        if (this.asteroidSystem) {
            try {
                const primary = this.asteroidSystem.primary;
                const pPos = primary.getPosition();
                if (pPos) {
                    const r = primary.getRadius?.() ?? 1;
                    out.push({ position: pPos.clone(), size: new THREE.Vector3(r, r, r) });
                }
                for (const m of this.asteroidSystem.moons) {
                    const pos = m.asteroid.getPosition();
                    const r = m.asteroid.getRadius?.() ?? 1;
                    if (pos) out.push({ position: pos.clone(), size: new THREE.Vector3(r, r, r) });
                }
            } catch {}
        } else if (this.asteroids && this.asteroids.length) {
            for (const a of this.asteroids) {
                const pos = a.getPosition();
                const r = a.getRadius?.() ?? 1;
                if (pos) out.push({ position: pos.clone(), size: new THREE.Vector3(r, r, r) });
            }
        }
        return out;
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
        this.spacecraftListNotifier.setVersionListener(callback);
    }

    /** SpacecraftRegistry implementation: subscribe to list changes, returns unsubscribe fn. */
    public onSpacecraftListChanged(callback: () => void): () => void {
        return this.spacecraftListNotifier.subscribe(callback);
    }

    public setActiveSpacecraftChangeCallback(callback: (spacecraft: Spacecraft) => void): void {
        this.onActiveSpacecraftChange = callback;
    }

    // Public wrappers so React can forward events without global listeners
    public onKeyDown(event: KeyboardEvent): void {
        this.keysPressed[event.code] = true;
        this.inputRouter.onKeyDown(event);
    }

    public onKeyUp(event: KeyboardEvent): void {
        this.keysPressed[event.code] = false;
        this.inputRouter.onKeyUp(event);
    }

    public onDoubleClick(event: MouseEvent): void {
        this.inputRouter.onDoubleClick(event);
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

            // Update asteroids / asteroid system
            if (this.asteroidSystem) {
                (this as any)._t = ((this as any)._t ?? 0) + deltaTime;
                this.asteroidSystem.update((this as any)._t);
            } else {
                // Advance spins then sync from physics
                this.asteroids.forEach(a => { a.advance(deltaTime); a.update(); });
            }

            // Update spacecraft
            this.spacecraft.forEach(spacecraft => spacecraft.update(deltaTime));

            // Update spacecraft controllers
            // Apply forces (manual + autopilot) for all spacecraft so
            // autopilots continue running regardless of active selection
            this.spacecraftControllers.forEach(controller => {
                controller.applyForces(deltaTime);
            });

            // Passive auto-docking: no UI mode required
            this.dockingOrchestrator.performPassiveDocking(this.spacecraft);

            // Update camera to follow active spacecraft when in 'follow' mode
            const ui = this.runtimeState.getUiState();
            if (ui.cameraMode !== 'free') {
                const activeSpacecraft = this.spacecraft.find(s => s.spacecraftController.getIsActive());
                if (activeSpacecraft) {
                    this.camera.updateOrbitTarget(activeSpacecraft.objects.box.position);
                }
            }

            // Apply latest orbit controls before camera-dependent effects
            this.camera.controls.update();

            // Update lights after camera controls
            if (this.lights) {
                this.lights.update();
            }

            // Update grid following camera (after controls to avoid 1-frame lag)
            if (this.grid) {
                this.grid.update(this.camera.camera);
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

        if (this.grid) {
            this.camera.scene.remove(this.grid.mesh);
            this.grid.dispose();
            this.grid = null;
        }

        // Unsubscribe any store subscriptions
        const unsubs: Array<() => void> = (this as any)._storeUnsubs || [];
        unsubs.forEach(u => { try { u(); } catch {} });
        (this as any)._storeUnsubs = [];

        // Cleanup spacecraft
        this.spacecraft.forEach(spacecraft => {
            spacecraft.cleanup();
        });

        if (this.asteroidSystem) {
            this.asteroidSystem.dispose();
            this.asteroidSystem = null;
        }
        this.asteroids.forEach(a => a.dispose());
        this.asteroids = [];

        // Remove stats overlay
        if (this.stats) {
            const dom = this.stats.dom as HTMLElement | null;
            if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
            this.stats = null;
        }
    }

    // Programmatic API to add an asteroid (no config/system)
    public addAsteroid(position: THREE.Vector3, diameter: number, model: AsteroidModelId = '2b'): AsteroidModel {
        const asteroid = new AsteroidModel(this.camera.scene, { position, diameter, model, physics: this.physics });
        this.asteroids.push(asteroid);
        return asteroid;
    }

    // Grid visibility controls for UI
    public setGridVisible(visible: boolean): void {
        if (this.grid) this.grid.mesh.visible = visible;
    }

    public getGridVisible(): boolean {
        return !!this.grid?.mesh.visible;
    }
}

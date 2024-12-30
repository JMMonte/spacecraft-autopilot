import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SceneLights } from '../scenes/sceneLights';
import { SceneCamera } from '../scenes/sceneCamera';
import { WorldRenderer } from './worldRenderer';
import { CannonDebugRenderer } from '../helpers/cannonDebugRenderer';
import { Spacecraft } from './spacecraft';
import { SpacecraftController } from '../controllers/spacecraftController';
import { BackgroundLoader } from '../helpers/backgroundLoader';
import { ProceduralAsteroid } from '../objects/ProceduralAsteroid';

interface WorldConfig {
    debug?: boolean;
    initialSpacecraft?: Array<{
        position: { x: number; y: number; z: number };
        width: number;
        height: number;
        depth: number;
        initialConeVisibility: boolean;
        name: string;
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

export class BasicWorld {
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

    // Three.js and Cannon.js components
    public renderer!: WorldRenderer;
    public camera!: SceneCamera;
    public lights!: SceneLights;
    public world!: CANNON.World;
    private cannonDebugRenderer?: CannonDebugRenderer;

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
            console.log('Started loading:', url);
            this.currentFile = url;
            this.loadingQueue.set(url, { loaded: 0, total: 0 });
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onProgress = (url: string, loaded: number, total: number) => {
            if (!total) return;
            
            this.loadingQueue.set(url, { loaded, total });
            this.currentFile = url;
            
            const progress = Math.round((loaded / total) * 100);
            console.log(`Loading ${url}: ${loaded}/${total} (${progress}%)`);
            
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onLoad = () => {
            console.log('Batch complete');
            this.loadingQueue.clear();
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onError = (url: string) => {
            console.error('Error loading:', url);
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

        // Initialize background
        this.backgroundLoader = new BackgroundLoader(this.camera.scene, this.camera.camera, () => {
            this.onLoadProgress(100);
            this.onLoadStatus('Ready');
        });

        // Initialize lights
        this.lights = new SceneLights(this.camera.scene as ThreeScene, this.camera.camera);
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(5, 10, 7.5);
        light.castShadow = true;
        
        // Configure shadow properties
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 500;
        light.shadow.camera.left = -50;
        light.shadow.camera.right = 50;
        light.shadow.camera.top = 50;
        light.shadow.camera.bottom = -50;
        light.shadow.bias = -0.0001;
        
        this.camera.scene.add(light);
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.camera.scene.add(ambientLight);

        // Store camera and light in scene's userData for access by other components
        (this.camera.scene as ThreeScene).userData.camera = this.camera.camera;
        (this.camera.scene as ThreeScene).userData.light = light;

        // Initialize post-processing
        this.renderer.setupPostProcessing(this.camera.scene, this.camera.camera);

        // Initialize physics
        const world = new CANNON.World({
            gravity: new CANNON.Vec3(0, 0, 0)
        });
        world.broadphase = new CANNON.NaiveBroadphase();
        (world.solver as any).iterations = 7;
        this.world = world;

        // Add grid helper
        const gridHelper = new THREE.GridHelper(100, 100);
        this.camera.scene.add(gridHelper);

        // Add procedural asteroid
        this.asteroid = new ProceduralAsteroid(
            this.camera.scene,
            this.world,
            new THREE.Vector3(0, 0, 0), // Center position, the constructor will adjust Y to be below
            200 // Larger radius for a more expansive surface
        );

        // Initialize spacecraft after scene and physics are ready
        const initialSpacecraft = this.config.initialSpacecraft || [];
        if (initialSpacecraft.length > 0) {
            await Promise.all(initialSpacecraft.map(async spacecraftConfig => {
                const initialPosition = new CANNON.Vec3(
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
            await this.addSpacecraft(new CANNON.Vec3(0, 0, 2));
        }

        // Initialize active spacecraft
        const initialFocusIndex = this.config.initialFocus || 0;
        if (this.spacecraft[initialFocusIndex]) {
            this.setActiveSpacecraft(this.spacecraft[initialFocusIndex]);
        }

        // Debug renderer (optional)
        if (this.config.debug) {
            this.cannonDebugRenderer = new CannonDebugRenderer(
                this.camera.scene,
                this.world
            );
        }

        this.setupEventListeners();

        this.onLoadProgress(100);
        this.onLoadStatus('Ready');
    }

    public createNewSpacecraft(): Spacecraft {
        // Create a random position near the origin
        const randomPosition = new CANNON.Vec3(
            (Math.random() - 0.5) * 10,  // x between -5 and 5
            (Math.random() - 0.5) * 10,  // y between -5 and 5
            Math.abs(Math.random() * 5) + 2  // z between 2 and 7 (always positive)
        );

        console.log('Creating new spacecraft at position:', randomPosition);
        const newSpacecraft = this.addSpacecraft(
            randomPosition,
            1, 1, 2,
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
        initialPosition: CANNON.Vec3,
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        initialConeVisibility: boolean = false,
        name: string = 'Spacecraft'
    ): Spacecraft {
        const spacecraft = new Spacecraft(
            this.world,
            this.camera.scene as ThreeScene,
            initialPosition,
            width,
            height,
            depth,
            this
        );
        spacecraft.name = name;
        spacecraft.world = this.world;
        
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

    private setupEventListeners(): void {
        document.addEventListener("keydown", this.handleKeyDown.bind(this));
        document.addEventListener("keyup", this.handleKeyUp.bind(this));
        document.addEventListener('dblclick', this.onDoubleClick.bind(this));
        window.addEventListener('resize', this.handleWindowResize.bind(this));
    }

    private handleKeyDown(event: KeyboardEvent): void {
        this.keysPressed[event.code] = true;
        const activeController = this.spacecraftControllers.find(controller => controller.getIsActive());
        if (activeController) {
            activeController.handleKeyDown(event);
        }
    }

    private handleKeyUp(event: KeyboardEvent): void {
        this.keysPressed[event.code] = false;
        const activeController = this.spacecraftControllers.find(controller => controller.getIsActive());
        if (activeController) {
            activeController.handleKeyUp(event);
        }
    }

    private onDoubleClick(event: MouseEvent): void {
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

    private handleWindowResize(): void {
        this.camera.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.camera.updateProjectionMatrix();
        this.renderer.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    public startRenderLoop(): void {
        const animate = () => {
            requestAnimationFrame(animate);
            
            const deltaTime = this.dt;
            this.world.step(deltaTime);

            // Update asteroid
            if (this.asteroid) {
                this.asteroid.update(performance.now() * 0.001);
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
            
            // Update debug renderer if enabled
            if (this.cannonDebugRenderer) {
                this.cannonDebugRenderer.update();
            }
            
            // Render the scene
            this.renderer.render(this.camera.scene, this.camera.camera);
        };

        animate();
    }

    public cleanup(): void {
        // Remove event listeners
        document.removeEventListener("keydown", this.handleKeyDown);
        document.removeEventListener("keyup", this.handleKeyUp);
        document.removeEventListener('dblclick', this.onDoubleClick);
        window.removeEventListener('resize', this.handleWindowResize);

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
    }
} 
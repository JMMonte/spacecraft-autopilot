import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RCSVisuals } from '../ui/rcsVisuals';
import { BackgroundLoader } from '../helpers/backgroundLoader';
import { SceneLights } from '../scenes/sceneLights';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { SceneCamera } from '../scenes/sceneCamera';
import { WorldRenderer } from './worldRenderer';
import { SceneObjects } from '../scenes/sceneObjects';
import { SpacecraftController } from '../controllers/spacecraftController';
import { CannonDebugRenderer } from '../helpers/cannonDebugRenderer';
import { initializeCockpit } from '../components/CockpitRoot';

export class Spacecraft {
    constructor(world, initialPosition = new CANNON.Vec3(0, 0, 2), width = 1, height = 1, depth = 2, initialConeVisibility = false, name = 'Spacecraft') {
        this.world = world;
        this.initialPosition = initialPosition;
        this.name = name;

        this.objects = new SceneObjects(world.camera.scene, world.world, width, height, depth);
        this.rcsVisuals = new RCSVisuals(this.objects, this.objects.boxBody, world.world, world.camera.scene, initialConeVisibility);
        this.objects.rcsVisuals = this.rcsVisuals;

        this.objects.boxBody.position.copy(initialPosition);

        this.helpers = new SceneHelpers(world.camera.scene, world.lights.getLight(), world.camera.camera);
        this.helpers.disableHelpers();

        this.spacecraftController = new SpacecraftController(this, this.objects.box, this.helpers);
    }

    update() {
        this.objects.update();
        this.spacecraftController.applyForces();
    }

    getThreeObjects() {
        return [this.objects.box];
    }

    cleanup() {
        this.objects.cleanup?.();
        this.rcsVisuals.cleanup?.();
        this.helpers.cleanup?.();
        this.spacecraftController.cleanup?.();
    }
}

export class BasicWorld {
    constructor(config = {}, canvas) {
        this.config = config || {};
        this.canvas = canvas;
        this.spacecraft = [];
        this.spacecraftControllers = [];
        this.keysPressed = {};
        this.dt = 1.0 / 60.0;
        this.onLoadProgress = () => {};
        this.onLoadStatus = () => {};

        // Track loading state
        this.loadingQueue = new Map(); // url -> {loaded, total}
        this.currentFile = '';

        // Configure the default Three.js loading manager to track ALL assets
        THREE.DefaultLoadingManager.onStart = (url) => {
            console.log('Started loading:', url);
            this.currentFile = url;
            this.loadingQueue.set(url, { loaded: 0, total: 0 });
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => {
            if (!total) return;
            
            // Update progress for this file
            this.loadingQueue.set(url, { loaded, total });
            this.currentFile = url;
            
            // Log progress
            const progress = Math.round((loaded / total) * 100);
            console.log(`Loading ${url}: ${loaded}/${total} (${progress}%)`);
            
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onLoad = () => {
            console.log('Batch complete');
            this.loadingQueue.clear();
            this.updateLoadingStatus();
        };

        THREE.DefaultLoadingManager.onError = (url) => {
            console.error('Error loading:', url);
            this.loadingQueue.delete(url);
            this.updateLoadingStatus();
        };
    }

    updateLoadingStatus() {
        if (this.loadingQueue.size === 0) {
            this.onLoadProgress(100);
            this.onLoadStatus('Ready');
            return;
        }

        // Get current file info
        const current = this.loadingQueue.get(this.currentFile);
        if (!current) return;

        // Calculate total progress across all files
        let totalLoaded = 0;
        let totalSize = 0;
        this.loadingQueue.forEach(({ loaded, total }) => {
            totalLoaded += loaded;
            totalSize += total;
        });

        // Update progress
        const progress = Math.round((totalLoaded / totalSize) * 100);
        this.onLoadProgress(progress);

        // Show detailed status for current file
        const filename = this.currentFile.split('/').pop();
        if (this.currentFile.includes('.exr')) {
            const loadedMB = (current.loaded / (1024 * 1024)).toFixed(1);
            const totalMB = (current.total / (1024 * 1024)).toFixed(1);
            this.onLoadStatus(`Loading ${filename} (${loadedMB}MB / ${totalMB}MB)`);
        } else {
            const fileProgress = Math.round((current.loaded / current.total) * 100);
            this.onLoadStatus(`Loading ${filename} (${fileProgress}%)`);
        }
    }

    addSpacecraft(initialPosition, width = 1, height = 1, depth = 2, initialConeVisibility = false, name = 'Spacecraft') {
        const spacecraft = new Spacecraft(this, initialPosition, width, height, depth, initialConeVisibility, name);
        this.spacecraft.push(spacecraft);
        this.spacecraftControllers.push(spacecraft.spacecraftController);
        return spacecraft;
    }

    createNewSpacecraft() {
        // Create a random position near the origin
        const randomPosition = new CANNON.Vec3(
            (Math.random() - 0.5) * 10,  // x between -5 and 5
            (Math.random() - 0.5) * 10,  // y between -5 and 5
            Math.abs(Math.random() * 5) + 2  // z between 2 and 7 (always positive)
        );

        const newSpacecraft = this.addSpacecraft(
            randomPosition,
            1, 1, 2,
            false,
            `Spacecraft ${this.spacecraft.length + 1}`
        );

        return newSpacecraft;
    }

    async loadAssets() {
        return new Promise((resolve, reject) => {
            try {
                // Start loading background
                new BackgroundLoader(
                    this.camera.scene,
                    this.renderer.renderer,
                    () => {
                        // Don't resolve yet, wait for all assets
                        console.log('Background loaded');
                    }
                );

                // Create a check interval to monitor all loading
                const checkInterval = setInterval(() => {
                    if (!THREE.DefaultLoadingManager.isLoading) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            } catch (error) {
                reject(error);
            }
        });
    }

    async initializeWorld() {
        this.onLoadProgress(0);
        this.onLoadStatus('Initializing scene...');

        // Initialize renderer and scene
        this.renderer = new WorldRenderer(this.canvas);
        this.camera = new SceneCamera(this.renderer.renderer, this);
        this.camera.camera.position.set(0, 5, 10);
        this.camera.camera.lookAt(0, 0, 0);

        // Initialize lights
        this.lights = new SceneLights(this.camera.scene, this.camera.camera);
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(5, 10, 7.5);
        this.camera.scene.add(light);
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.camera.scene.add(ambientLight);

        // Initialize physics
        this.world = new CANNON.World();
        this.world.gravity.set(0, 0, 0);
        this.world.broadphase = new CANNON.NaiveBroadphase();
        this.world.solver.iterations = 7;

        // Add grid helper
        const gridHelper = new THREE.GridHelper(100, 100);
        this.camera.scene.add(gridHelper);

        // Load all assets and wait for everything to complete
        await this.loadAssets();

        // Initialize spacecraft
        if (this.config.initialSpacecraft?.length > 0) {
            await Promise.all(this.config.initialSpacecraft.map(async spacecraftConfig => {
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

    setActiveSpacecraft(spacecraft) {
        // Deactivate all spacecraft controllers
        this.spacecraftControllers.forEach(controller => {
            controller.isActive = false;
        });

        // Activate the selected spacecraft
        spacecraft.spacecraftController.isActive = true;
        this.currentTarget = spacecraft.objects.box;

        // Update camera target
        if (this.camera) {
            this.camera.updateOrbitTarget(spacecraft.objects.box.position);
        }

        // Notify listeners of the change
        if (this.onSpacecraftChange) {
            this.onSpacecraftChange();
        }
    }

    setupEventListeners() {
        document.addEventListener("keydown", this.handleKeyDown.bind(this));
        document.addEventListener("keyup", this.handleKeyUp.bind(this));
        document.addEventListener('dblclick', this.onDoubleClick.bind(this));
        window.addEventListener('resize', this.handleWindowResize.bind(this));
    }

    handleKeyDown(event) {
        this.keysPressed[event.code] = true;
        const activeController = this.spacecraftControllers.find(controller => controller.isActive);
        if (activeController) {
            activeController.handleKeyDown(event);
        }
    }

    handleKeyUp(event) {
        this.keysPressed[event.code] = false;
        const activeController = this.spacecraftControllers.find(controller => controller.isActive);
        if (activeController) {
            activeController.handleKeyUp(event);
        }
    }

    handleWindowResize() {
        this.camera.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.camera.updateProjectionMatrix();
        this.renderer.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    startRenderLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            
            // Update physics
            this.world.step(this.dt);
            
            // Update spacecraft
            this.spacecraft.forEach(spacecraft => spacecraft.update());
            
            // Update camera to follow active spacecraft
            const activeSpacecraft = this.spacecraft.find(s => s.spacecraftController.isActive);
            if (activeSpacecraft) {
                this.camera.updateOrbitTarget(activeSpacecraft.objects.box.position);
                this.camera.controls.update(); // Update controls for smooth damping
            }
            
            // Update debug renderer if enabled
            if (this.cannonDebugRenderer) {
                this.cannonDebugRenderer.update();
            }
            
            // Render
            this.renderer.renderer.render(this.camera.scene, this.camera.camera);
        };
        animate();
    }

    onDoubleClick(event) {
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

    cleanup() {
        // Remove event listeners
        document.removeEventListener("keydown", this.handleKeyDown);
        document.removeEventListener("keyup", this.handleKeyUp);
        document.removeEventListener('dblclick', this.onDoubleClick);
        window.removeEventListener('resize', this.handleWindowResize);

        // Dispose Three.js resources
        this.renderer.renderer.dispose();
        this.camera.cleanup?.();
        this.lights.cleanup?.();

        // Cleanup spacecraft
        this.spacecraft.forEach(spacecraft => {
            spacecraft.cleanup?.();
        });

        // Cleanup React components
        this.cockpitInstance?.cleanup();
    }

    onBackgroundLoadProgress(progress) {
        const progressBar = document.getElementById('loading-progress');
        if (progressBar) {
            progressBar.style.width = `${progress * 100}%`;
        }
    }

    onBackgroundLoadComplete() {
        const progressBar = document.getElementById('loading-progress');
        const loadingBar = document.getElementById('loading-bar');
        if (progressBar && loadingBar) {
            progressBar.style.width = '100%';
            setTimeout(() => {
                loadingBar.style.display = 'none';
            }, 500);
        }
    }

    initializeReactComponents() {
        const activeSpacecraft = this.spacecraft.find(s => s.spacecraftController.isActive);
        if (activeSpacecraft) {
            this.cockpitInstance = initializeCockpit(
                activeSpacecraft,
                activeSpacecraft.spacecraftController
            );
        }
    }

    setLoadingCallbacks(onProgress, onStatus) {
        this.onLoadProgress = onProgress;
        this.onLoadStatus = onStatus;
    }
} 
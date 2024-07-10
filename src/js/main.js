import * as THREE from 'three';
import * as CANNON from 'cannon';
import { RCSVisuals } from './rcsVisuals';
import { BackgroundLoader } from './backgroundLoader';
import { SceneLights } from './sceneLights';
import { SceneHelpers } from './sceneHelpers';
import { GUIControls } from './guiControls';
import { SceneCamera } from './sceneCamera';
import { WorldRenderer } from './worldRenderer';
import { SceneObjects } from './sceneObjects';
import { SpacecraftController } from './spacecraftController';
import { CannonDebugRenderer } from './cannonDebugRenderer';

// Configuration JSON object
const config = {
    initialSpacecraft: [
        {
            position: { x: 0, y: 0, z: 2 },
            width: 1,
            height: 1,
            depth: 2,
            initialConeVisibility: false,
        },
        {
            position: { x: 2, y: 2, z: 2 },
            width: 1,
            height: 1,
            depth: 1,
            initialConeVisibility: false,
        },
    ],
    initialFocus: 0,
};

class Spacecraft {
    constructor(world, initialPosition = new CANNON.Vec3(0, 0, 2), width = 1, height = 1, depth = 2, initialConeVisibility = false) {
        this.world = world;
        this.initialPosition = initialPosition;

        this.objects = new SceneObjects(world.camera.scene, world.world, width, height, depth);
        this.rcsVisuals = new RCSVisuals(this.objects, this.objects.boxBody, world.world, world.camera.scene, initialConeVisibility);
        this.objects.rcsVisuals = this.rcsVisuals;

        this.objects.boxBody.position.copy(initialPosition);

        this.helpers = new SceneHelpers(world.camera.scene, world.lights.getLight(), world.camera.camera); // Add helpers
        this.helpers.disableHelpers(); // Ensure helpers are off at start

        this.spacecraftController = new SpacecraftController(this, this.objects.box, this.helpers); // Pass helpers
    }

    update() {
        this.objects.update();
        this.spacecraftController.applyForces(); // Always apply forces, including autopilot
    }

    getThreeObjects() {
        return [this.objects.box];
    }
}

class BasicWorld {
    constructor(config) {
        this.dt = 1.0 / 60.0;
        this.renderer = new WorldRenderer();
        this.camera = new SceneCamera(this.renderer.renderer, this);
        this.lights = new SceneLights(this.camera.scene, this.camera.camera);
        this.world = new CANNON.World();
        this.world.gravity.set(0, 0, 0);

        this.spacecraft = [];
        this.spacecraftControllers = [];

        config.initialSpacecraft.forEach(spacecraftConfig => {
            const initialPosition = new CANNON.Vec3(
                spacecraftConfig.position.x,
                spacecraftConfig.position.y,
                spacecraftConfig.position.z
            );
            this.addSpacecraft(initialPosition, spacecraftConfig.width, spacecraftConfig.height, spacecraftConfig.depth, spacecraftConfig.initialConeVisibility);
        });

        this.keysPressed = {};
        document.addEventListener("keydown", this.handleKeyDown.bind(this), false);
        document.addEventListener("keyup", this.handleKeyUp.bind(this), false);
        document.addEventListener('dblclick', this.onDoubleClick.bind(this), false);

        document.addEventListener('DOMContentLoaded', () => {
            this.controls = new GUIControls(
                this.spacecraft[config.initialFocus].objects,
                this.spacecraft[config.initialFocus].rcsVisuals,
                this.spacecraft[config.initialFocus],
                this.spacecraft[config.initialFocus].spacecraftController,
                this.spacecraft[config.initialFocus].helpers
            );
            this.setActiveSpacecraft(this.spacecraft[config.initialFocus]); // Set the initial focus as active spacecraft
            this.startRenderLoop();
        });
        this.background = new BackgroundLoader(
            this.camera.scene,
            this.renderer.renderer,
            this.onBackgroundLoadComplete.bind(this),
            this.onBackgroundLoadProgress.bind(this)
        );
        this.simulateProgress();

        // Debugger
        this.cannonDebugRenderer = new CannonDebugRenderer(this.camera.scene, this.world);
        this.handleWindowResize();

        this.currentTarget = this.spacecraft[config.initialFocus].objects.box; // Set initial focus
        this.currentTargetPosition = null; // Initialize currentTargetPosition
    }

    simulateProgress() {
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5; // Increment by 5%
            if (progress > 95) progress = 95; // Cap progress at 95% to avoid reaching 100% prematurely
            this.onBackgroundLoadProgress(progress / 100);
        }, 1000); // Update every second
    
        this.onBackgroundLoadComplete = () => {
            clearInterval(interval); // Stop simulation
            this.onBackgroundLoadProgress(1); // Jump to 100%
            setTimeout(this.onBackgroundLoadComplete, 500); // Ensure final update visibility
        };
    }
    
    onBackgroundLoadProgress(progress) {
        document.getElementById('loading-progress').style.width = `${progress * 100}%`;
    }
    
    onBackgroundLoadComplete() {
        const progressBar = document.getElementById('loading-progress');
        progressBar.style.animation = 'none'; // Stop the animation
        progressBar.style.width = '100%'; // Instantly set to 100%
        setTimeout(() => {
            document.getElementById('loading-bar').style.display = 'none'; // Hide after a delay to show completion
        }, 500);
    }

    addSpacecraft(initialPosition, width = 1, height = 1, depth = 2, initialConeVisibility = false) {
        const spacecraft = new Spacecraft(this, initialPosition, width, height, depth, initialConeVisibility);
        this.spacecraft.push(spacecraft);
        this.spacecraftControllers.push(spacecraft.spacecraftController);
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
        this.stepPhysicsWorld();
        
        this.lights.update();
        this.updateObjects();
        
        this.spacecraft.forEach(spacecraft => {
            spacecraft.update();
        });

        if (this.controls) {
            this.controls.updateVelocityDisplays();
            this.controls.updateAngularVelocityDisplays();
        }

        this.updateCameraTarget();
        this.camera.update();

        // Debugger
        // this.cannonDebugRenderer.update();

        this.renderer.render(this.camera.scene, this.camera.camera);
        requestAnimationFrame(this.startRenderLoop.bind(this));
    }

    updateCameraTarget() {
        if (this.currentTarget && (!this.currentTargetPosition || !this.currentTarget.position.equals(this.currentTargetPosition))) {
            this.currentTargetPosition = this.currentTarget.position.clone();
            this.camera.updateOrbitTarget(this.currentTargetPosition);
        }
    }

    stepPhysicsWorld() {
        this.world.step(this.dt);
    }

    updateObjects() {
        this.spacecraft.forEach(spacecraft => spacecraft.update());
    }

    updateConeMeshes(coneMeshes, coneVisibility) {
        coneMeshes.forEach((coneMesh, index) => {
            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            coneMesh.getWorldPosition(position);
            coneMesh.getWorldQuaternion(quaternion);
            coneMesh.visible = coneVisibility[index];
        });
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
            this.camera.focusOnObject(newTarget);
            this.currentTarget = newTarget;
            const spacecraft = this.spacecraft.find(spacecraft => spacecraft.objects.box === newTarget);
            console.log("Spacecraft of current target: ", spacecraft);
            if (spacecraft) {
                this.setActiveSpacecraft(spacecraft);
            }
        }
    }

    setActiveSpacecraft(spacecraft) {
        this.spacecraftControllers.forEach(controller => {
            controller.isActive = controller.spacecraft === spacecraft;
        });

        if (this.controls) {
            this.controls.gui.destroy(); // Destroy the existing GUI before creating a new one
        }

        const activeController = this.spacecraftControllers.find(controller => controller.isActive);
        if (activeController) {
            this.controls = new GUIControls(spacecraft.objects, spacecraft.rcsVisuals, spacecraft, activeController, spacecraft.helpers);
        }
    }
}

const world = new BasicWorld(config);

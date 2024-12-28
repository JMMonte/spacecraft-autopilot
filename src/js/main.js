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
import { Cockpit } from '../components/Cockpit';
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';

// Configuration JSON object (example structure)
let config = {};

// Function to load config.json
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error('Could not load config.json');
        return await response.json();
    } catch (error) {
        console.error('Error loading config:', error);
        return {};
    }
}

class Spacecraft {
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
}

class BasicWorld {
    constructor(config = {}, canvas) {
        this.config = config;
        this.canvas = canvas;
        this.spacecraft = [];

        this.initializeWorld();
        this.initializeScene();
        this.initializeSpacecraft();
        this.initializeReactComponents();
        this.setupEventListeners();
    }

    initializeWorld() {
        // Initialize Three.js scene
        this.world = new CANNON.World();
        this.world.gravity.set(0, 0, 0); // Space has no gravity
        this.world.broadphase = new CANNON.NaiveBroadphase();
        this.world.solver.iterations = 7;

        // Initialize camera and lights
        this.camera = new SceneCamera(this.canvas);
        this.lights = new SceneLights();

        // Initialize renderer
        this.renderer = new WorldRenderer(this.canvas);

        // Initialize background
        this.backgroundLoader = new BackgroundLoader(
            this.camera.scene,
            () => this.onBackgroundLoadProgress(),
            () => this.onBackgroundLoadComplete()
        );

        // Debug renderer (optional)
        if (this.config.debug) {
            this.cannonDebugRenderer = new CannonDebugRenderer(
                this.camera.scene,
                this.world
            );
        }
    }

    initializeSpacecraft() {
        // Create spacecraft
        const spacecraft = new Spacecraft(this);
        this.spacecraft.push(spacecraft);
        spacecraft.spacecraftController.isActive = true;
    }

    initializeReactComponents() {
        const cockpitContainer = document.createElement('div');
        cockpitContainer.id = 'cockpit-root';
        document.body.appendChild(cockpitContainer);

        const root = createRoot(cockpitContainer);
        const activeSpacecraft = this.spacecraft.find(s => s.spacecraftController.isActive);
        
        root.render(
            <Cockpit
                spacecraft={activeSpacecraft}
                spacecraftController={activeSpacecraft?.spacecraftController}
            />
        );
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
    }

    onWindowResize() {
        this.camera.onWindowResize();
        this.renderer.onWindowResize();
    }

    startRenderLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            this.update();
            this.render();
        };
        animate();
    }

    update() {
        const deltaTime = 1.0 / 60.0;
        this.world.step(deltaTime);

        // Update all spacecraft
        this.spacecraft.forEach(spacecraft => spacecraft.update());

        // Update camera
        this.camera.update();

        // Update debug renderer if enabled
        if (this.cannonDebugRenderer) {
            this.cannonDebugRenderer.update();
        }
    }

    render() {
        this.renderer.render(this.camera.scene, this.camera.camera);
    }

    cleanup() {
        // Clean up Three.js resources
        this.renderer.dispose();
        this.camera.dispose();
        this.lights.dispose();

        // Clean up event listeners
        window.removeEventListener('resize', () => this.onWindowResize());

        // Clean up GUI if it exists
        this.controls?.gui.destroy();
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
}

export { BasicWorld, Spacecraft };

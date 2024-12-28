import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RCSVisuals } from '../ui/rcsVisuals';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { SceneObjects } from '../scenes/sceneObjects';
import { SpacecraftController } from '../controllers/spacecraftController';

export class Spacecraft {
    constructor(world, scene, initialPosition = new CANNON.Vec3(0, 0, 2), width = 1, height = 1, depth = 2) {
        this.world = world;
        this.initialPosition = initialPosition;

        this.objects = new SceneObjects(scene, world, width, height, depth);
        this.rcsVisuals = new RCSVisuals(this.objects, this.objects.boxBody, world, scene);
        this.objects.rcsVisuals = this.rcsVisuals;

        this.objects.boxBody.position.copy(initialPosition);

        this.helpers = new SceneHelpers(scene);
        this.helpers.disableHelpers();

        this.spacecraftController = new SpacecraftController(this, this.objects.box, this.helpers);
    }

    update() {
        this.objects.update();
        this.spacecraftController.applyForces();
    }

    cleanup() {
        this.objects.cleanup?.();
        this.rcsVisuals.cleanup?.();
        this.helpers.cleanup?.();
        this.spacecraftController.cleanup?.();
    }
}

export async function initializeSpacecraft({ physicsWorld, scene }) {
    // Create default spacecraft
    const spacecraft = new Spacecraft(
        physicsWorld,
        scene,
        new CANNON.Vec3(0, 0, 2),
        1, // width
        1, // height
        2  // depth
    );

    return {
        spacecraft,
        controller: spacecraft.spacecraftController
    };
}
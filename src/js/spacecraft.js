import { SceneObjects } from '../scenes/sceneObjects';
import { SpacecraftController } from '../controllers/spacecraftController';
import { RCSVisuals } from '../ui/rcsVisuals';
import { SceneHelpers } from '../scenes/sceneHelpers';

export class Spacecraft {
    constructor(world, initialPosition = new CANNON.Vec3(0, 0, 2), width = 1, height = 1, depth = 2, initialConeVisibility = false, name = 'Spacecraft') {
        this.world = world;
        this.initialPosition = initialPosition;
        this.name = name;

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
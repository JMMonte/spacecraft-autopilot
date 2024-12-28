import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RCSVisuals } from '../ui/rcsVisuals';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { SceneObjects } from '../scenes/sceneObjects';
import { SpacecraftController } from '../controllers/spacecraftController';
import { DockingController } from '../controllers/dockingController';

export class Spacecraft {
    constructor(world, scene, initialPosition = new CANNON.Vec3(0, 0, 2), width = 1, height = 1, depth = 2) {
        this.world = world;
        this.initialPosition = initialPosition;

        this.objects = new SceneObjects(scene, world, width, height, depth);
        this.rcsVisuals = new RCSVisuals(this.objects, this.objects.boxBody, world, scene);
        this.objects.rcsVisuals = this.rcsVisuals;

        this.objects.boxBody.position.copy(initialPosition);

        // Get the camera from the scene
        const camera = scene.userData.camera;
        this.helpers = new SceneHelpers(scene, scene.userData.light, camera);
        this.helpers.disableHelpers();

        this.spacecraftController = new SpacecraftController(this, this.objects.box, this.helpers);
        this.dockingController = new DockingController(this, this.spacecraftController.autopilot);

        // Initialize docking ports
        this.dockingPorts = {
            front: {
                position: new THREE.Vector3(0, 0, depth/2), // Front of spacecraft
                direction: new THREE.Vector3(0, 0, 1),      // Points forward
                isOccupied: false,
                dockedTo: null
            },
            back: {
                position: new THREE.Vector3(0, 0, -depth/2), // Back of spacecraft
                direction: new THREE.Vector3(0, 0, -1),      // Points backward
                isOccupied: false,
                dockedTo: null
            }
        };
    }

    update() {
        this.objects.update();
        this.spacecraftController.applyForces();
        this.dockingController.update(1/60); // Assuming 60fps
    }

    cleanup() {
        this.objects.cleanup?.();
        this.rcsVisuals.cleanup?.();
        this.helpers.cleanup?.();
        this.spacecraftController.cleanup?.();
    }

    /**
     * Get all Three.js objects that can be clicked to select this spacecraft
     * @returns {THREE.Object3D[]} Array of clickable objects
     */
    getThreeObjects() {
        return [this.objects.box];
    }

    /**
     * Get the world position of a docking port
     * @param {string} portId - 'front' or 'back'
     * @returns {THREE.Vector3} World position of the docking port
     */
    getDockingPortWorldPosition(portId) {
        const port = this.dockingPorts[portId];
        if (!port) return null;

        const worldPos = port.position.clone();
        worldPos.applyQuaternion(this.objects.boxBody.quaternion);
        worldPos.add(new THREE.Vector3().copy(this.objects.boxBody.position));
        return worldPos;
    }

    /**
     * Get the world direction of a docking port
     * @param {string} portId - 'front' or 'back'
     * @returns {THREE.Vector3} World direction the docking port is facing
     */
    getDockingPortWorldDirection(portId) {
        const port = this.dockingPorts[portId];
        if (!port) return null;

        const worldDir = port.direction.clone();
        worldDir.applyQuaternion(this.objects.boxBody.quaternion);
        return worldDir;
    }

    /**
     * Check if a docking port is available
     * @param {string} portId - 'front' or 'back'
     * @returns {boolean} Whether the port is available for docking
     */
    isDockingPortAvailable(portId) {
        const port = this.dockingPorts[portId];
        return port && !port.isOccupied;
    }

    /**
     * Dock with another spacecraft
     * @param {string} ourPortId - Our docking port ID ('front' or 'back')
     * @param {Spacecraft} otherSpacecraft - The spacecraft to dock with
     * @param {string} theirPortId - Their docking port ID
     */
    dock(ourPortId, otherSpacecraft, theirPortId) {
        const ourPort = this.dockingPorts[ourPortId];
        const theirPort = otherSpacecraft.dockingPorts[theirPortId];

        if (!ourPort || !theirPort) return false;
        if (ourPort.isOccupied || theirPort.isOccupied) return false;

        // Mark ports as occupied
        ourPort.isOccupied = true;
        theirPort.isOccupied = true;
        ourPort.dockedTo = { spacecraft: otherSpacecraft, port: theirPortId };
        theirPort.dockedTo = { spacecraft: this, port: ourPortId };

        // Create a physical constraint between the spacecraft
        const constraint = new CANNON.LockConstraint(
            this.objects.boxBody,
            otherSpacecraft.objects.boxBody
        );
        this.world.addConstraint(constraint);

        return true;
    }

    /**
     * Undock from a specific port
     * @param {string} portId - The port to undock from
     */
    undock(portId) {
        const port = this.dockingPorts[portId];
        if (!port || !port.isOccupied || !port.dockedTo) return false;

        const otherSpacecraft = port.dockedTo.spacecraft;
        const otherPort = port.dockedTo.port;

        // Clear docking information
        port.isOccupied = false;
        otherSpacecraft.dockingPorts[otherPort].isOccupied = false;
        port.dockedTo = null;
        otherSpacecraft.dockingPorts[otherPort].dockedTo = null;

        // Remove physical constraint (you'll need to track the constraint when creating it)
        // this.world.removeConstraint(constraint);

        return true;
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
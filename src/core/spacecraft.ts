import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RCSVisuals } from '../scenes/objects/rcsVisuals';
import { SpacecraftModel } from '../scenes/objects/spacecraftModel';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { SpacecraftController } from '../controllers/spacecraftController';
import { DockingController } from '../controllers/docking/DockingController';
import { BasicWorld } from './BasicWorld';

interface DockingPortInfo {
    position: THREE.Vector3;
    direction: THREE.Vector3;
    isOccupied: boolean;
    dockedTo: {
        spacecraft: Spacecraft;
        port: string;
    } | null;
}

interface DockingPorts {
    front: DockingPortInfo;
    back: DockingPortInfo;
}

export class Spacecraft {
    public world: CANNON.World;
    public basicWorld: BasicWorld;
    public initialPosition: CANNON.Vec3;
    public objects: SpacecraftModel;
    public rcsVisuals: RCSVisuals;
    public helpers: SceneHelpers;
    public spacecraftController: SpacecraftController;
    public dockingController: DockingController;
    public showVelocityArrow: boolean;
    public showAngularVelocityArrow: boolean;
    public dockingPorts: DockingPorts;
    public name: string;
    public uuid: string;
    private debugObjects: THREE.Object3D[] = [];

    constructor(
        world: CANNON.World,
        scene: THREE.Scene & { userData: { camera: THREE.Camera; light: THREE.Light } },
        initialPosition: CANNON.Vec3 = new CANNON.Vec3(0, 0, 2),
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        basicWorld?: BasicWorld
    ) {
        this.uuid = THREE.MathUtils.generateUUID();
        this.world = world;
        this.basicWorld = basicWorld as BasicWorld;
        this.initialPosition = initialPosition;

        this.objects = new SpacecraftModel(scene, world, width, height, depth);
        this.rcsVisuals = new RCSVisuals(this.objects, this.objects.boxBody, world);
        this.objects.rcsVisuals = this.rcsVisuals;

        this.objects.boxBody.position.copy(initialPosition);

        // Get the camera from the scene
        const camera = scene.userData.camera;
        this.helpers = new SceneHelpers(scene, scene.userData.light, camera);
        this.helpers.disableHelpers();

        this.spacecraftController = new SpacecraftController(this, this.objects.box, this.helpers);
        this.dockingController = new DockingController(this, scene);

        // Initialize helper arrow visibility
        this.showVelocityArrow = false;
        this.showAngularVelocityArrow = false;

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

        this.name = 'Spacecraft';

        // Add a listener for RCS visuals updates
        this.objects.onRCSVisualsUpdate = (newRcsVisuals: RCSVisuals) => {
            this.rcsVisuals = newRcsVisuals;
        };
    }

    public update(): void {
        this.objects.update();
        this.spacecraftController.applyForces();
        this.dockingController.update();
    }

    public cleanup(): void {
        this.objects.cleanup?.();
        this.rcsVisuals.cleanup?.();
        this.helpers.cleanup?.();
        this.spacecraftController.cleanup?.();
    }

    /**
     * Convert a CANNON.Vec3 to THREE.Vector3
     */
    public static toThreeVec3(cannonVec: CANNON.Vec3): THREE.Vector3 {
        return new THREE.Vector3(cannonVec.x, cannonVec.y, cannonVec.z);
    }

    /**
     * Convert a THREE.Vector3 to CANNON.Vec3
     */
    public static toCannonVec3(threeVec: THREE.Vector3): CANNON.Vec3 {
        return new CANNON.Vec3(threeVec.x, threeVec.y, threeVec.z);
    }

    /**
     * Convert a CANNON.Quaternion to THREE.Quaternion
     */
    public static toThreeQuat(cannonQuat: CANNON.Quaternion): THREE.Quaternion {
        return new THREE.Quaternion(cannonQuat.x, cannonQuat.y, cannonQuat.z, cannonQuat.w);
    }

    /**
     * Convert a THREE.Quaternion to CANNON.Quaternion
     */
    public static toCannonQuat(threeQuat: THREE.Quaternion): CANNON.Quaternion {
        return new CANNON.Quaternion(threeQuat.x, threeQuat.y, threeQuat.z, threeQuat.w);
    }

    /**
     * Get the world position of the spacecraft's center
     */
    public getWorldPosition(): THREE.Vector3 {
        return new THREE.Vector3(
            this.objects.boxBody.position.x,
            this.objects.boxBody.position.y,
            this.objects.boxBody.position.z
        );
    }

    /**
     * Get all Three.js objects that can be clicked to select this spacecraft
     */
    public getThreeObjects(): THREE.Object3D[] {
        return [this.objects.box];
    }

    /**
     * Get the world position of a docking port
     */
    public getDockingPortWorldPosition(portId: keyof DockingPorts): THREE.Vector3 | null {
        const port = this.dockingPorts[portId];
        if (!port) return null;

        const worldPos = port.position.clone();
        worldPos.applyQuaternion(Spacecraft.toThreeQuat(this.objects.boxBody.quaternion));
        worldPos.add(Spacecraft.toThreeVec3(this.objects.boxBody.position));
        return worldPos;
    }

    /**
     * Get the world direction of a docking port
     */
    public getDockingPortWorldDirection(portId: keyof DockingPorts): THREE.Vector3 | null {
        const port = this.dockingPorts[portId];
        if (!port) return null;

        const worldDir = port.direction.clone();
        worldDir.applyQuaternion(Spacecraft.toThreeQuat(this.objects.boxBody.quaternion));
        return worldDir;
    }

    /**
     * Check if a docking port is available
     */
    public isDockingPortAvailable(portId: keyof DockingPorts): boolean {
        const port = this.dockingPorts[portId];
        return port && !port.isOccupied;
    }

    /**
     * Dock with another spacecraft
     */
    public dock(
        ourPortId: keyof DockingPorts,
        otherSpacecraft: Spacecraft,
        theirPortId: keyof DockingPorts
    ): boolean {
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

        // Add the constraint to both spacecraft's worlds
        if (this.world) {
            this.world.addConstraint(constraint);
            
            // Zero out relative velocities
            const relativeVelocity = new CANNON.Vec3().copy(this.objects.boxBody.velocity).vsub(otherSpacecraft.objects.boxBody.velocity);
            const relativeAngularVelocity = new CANNON.Vec3().copy(this.objects.boxBody.angularVelocity).vsub(otherSpacecraft.objects.boxBody.angularVelocity);
            
            // Apply impulses to cancel out relative motion
            this.objects.boxBody.velocity.vsub(relativeVelocity.scale(0.5), this.objects.boxBody.velocity);
            otherSpacecraft.objects.boxBody.velocity.vadd(relativeVelocity.scale(0.5), otherSpacecraft.objects.boxBody.velocity);
            
            this.objects.boxBody.angularVelocity.vsub(relativeAngularVelocity.scale(0.5), this.objects.boxBody.angularVelocity);
            otherSpacecraft.objects.boxBody.angularVelocity.vadd(relativeAngularVelocity.scale(0.5), otherSpacecraft.objects.boxBody.angularVelocity);
        }

        return true;
    }

    /**
     * Undock from a specific port
     */
    public undock(portId: keyof DockingPorts): boolean {
        const port = this.dockingPorts[portId];
        if (!port || !port.isOccupied || !port.dockedTo) return false;

        const otherSpacecraft = port.dockedTo.spacecraft;
        const otherPort = port.dockedTo.port as keyof DockingPorts;

        // Clear docking information
        port.isOccupied = false;
        otherSpacecraft.dockingPorts[otherPort].isOccupied = false;
        port.dockedTo = null;
        otherSpacecraft.dockingPorts[otherPort].dockedTo = null;

        // Remove the physical constraint if it exists
        if (this.world) {
            // Find and remove the constraint between the two bodies
            const constraints = this.world.constraints;
            for (let i = constraints.length - 1; i >= 0; i--) {
                const constraint = constraints[i];
                if ((constraint.bodyA === this.objects.boxBody && constraint.bodyB === otherSpacecraft.objects.boxBody) ||
                    (constraint.bodyA === otherSpacecraft.objects.boxBody && constraint.bodyB === this.objects.boxBody)) {
                    this.world.removeConstraint(constraint);
                }
            }
        }

        return true;
    }

    /**
     * Toggle visibility of helper arrows
     */
    public toggleArrow(arrowType: 'velocity' | 'angularVelocity', visible: boolean): void {
        if (!this.helpers) return;

        switch (arrowType) {
            case 'velocity':
                this.showVelocityArrow = visible;
                if (this.helpers.velocityArrow) {
                    this.helpers.velocityArrow.visible = visible;
                }
                break;
            case 'angularVelocity':
                this.showAngularVelocityArrow = visible;
                if (this.helpers.rotationAxisArrow) {
                    this.helpers.rotationAxisArrow.visible = visible;
                }
                break;
        }
    }

    public getVelocity(): THREE.Vector3 {
        return Spacecraft.toThreeVec3(this.objects.boxBody.velocity);
    }

    public getAngularVelocity(): THREE.Vector3 {
        return Spacecraft.toThreeVec3(this.objects.boxBody.angularVelocity);
    }

    public getOrientation(): THREE.Quaternion {
        return Spacecraft.toThreeQuat(this.objects.boxBody.quaternion);
    }

    public getMass(): number {
        return this.objects.boxBody.mass;
    }

    public getThrusterStatus(): boolean[] {
        return this.rcsVisuals.getConeMeshes().map(cone => cone.visible);
    }

    public getThrusterConfigs() {
        const thrustersData = this.rcsVisuals.getThrusterData();
        return thrustersData.map(data => {
            const direction = new THREE.Vector3(0, 1, 0);
            direction.applyAxisAngle(data.rotation.axis, data.rotation.angle);
            return {
                position: new THREE.Vector3(...data.position),
                direction: direction
            };
        });
    }

    public getMainBodyDimensions(): CANNON.Vec3 {
        const shape = this.objects.boxBody.shapes[0] as CANNON.Box;
        return shape.halfExtents;
    }

    public getFullDimensions(): CANNON.Vec3 {
        const mainBody = this.getMainBodyDimensions();
        const portDepth = this.objects.dockingPortDepth || 0.3;
        const portLength = this.objects.dockingPortLength || 0.1;
        const extraDepth = portDepth + portLength;

        return new CANNON.Vec3(
            mainBody.x,
            mainBody.y,
            mainBody.z + extraDepth // Add docking port depth to each end
        );
    }

    public getPortDimensions(): CANNON.Vec3 {
        return new CANNON.Vec3(
            this.objects.dockingPortRadius || 0.3,
            this.objects.dockingPortRadius || 0.3,
            this.objects.dockingPortLength || 0.1
        );
    }

    public getPortOffset(portId: keyof DockingPorts): number {
        const boxDepth = this.objects.boxDepth;
        const dockingPortDepth = this.objects.dockingPortDepth || 0.3;
        
        return portId === 'front' ? 
            boxDepth / 2 + dockingPortDepth :
            -boxDepth / 2 - dockingPortDepth;
    }

    public getWorldOrientation(): THREE.Quaternion {
        return new THREE.Quaternion(
            this.objects.boxBody.quaternion.x,
            this.objects.boxBody.quaternion.y,
            this.objects.boxBody.quaternion.z,
            this.objects.boxBody.quaternion.w
        );
    }

    public getWorldVelocity(): THREE.Vector3 {
        return new THREE.Vector3(
            this.objects.boxBody.velocity.x,
            this.objects.boxBody.velocity.y,
            this.objects.boxBody.velocity.z
        );
    }

    public getWorldAngularVelocity(): THREE.Vector3 {
        return new THREE.Vector3(
            this.objects.boxBody.angularVelocity.x,
            this.objects.boxBody.angularVelocity.y,
            this.objects.boxBody.angularVelocity.z
        );
    }

    public visualizeDebugObjects(scene: THREE.Scene): void {
        // Create debug objects for visualization
        const debugObjects: THREE.Object3D[] = [];

        // Create spacecraft center sphere
        const centerSphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.3),
            new THREE.MeshBasicMaterial({
                color: 0xff8800,
                transparent: true,
                opacity: 0.5,
                depthTest: false,
                depthWrite: false
            })
        );
        centerSphere.position.copy(this.getWorldPosition());
        scene.add(centerSphere);
        debugObjects.push(centerSphere);

        // Create bounding box
        const size = this.getFullDimensions();
        const boxGeometry = new THREE.BoxGeometry(size.x * 2, size.y * 2, size.z * 2);
        const boxMaterial = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            wireframe: true,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
            depthWrite: false
        });
        const box = new THREE.Mesh(boxGeometry, boxMaterial);
        box.position.copy(this.getWorldPosition());
        box.quaternion.copy(this.getWorldOrientation());
        scene.add(box);
        debugObjects.push(box);

        // Store debug objects for cleanup
        this.debugObjects = debugObjects;
    }

    public clearDebugObjects(): void {
        if (this.debugObjects) {
            this.debugObjects.forEach(obj => {
                if (obj instanceof THREE.Mesh) {
                    obj.geometry.dispose();
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
                obj.parent?.remove(obj);
            });
            this.debugObjects = [];
        }
    }
}

interface InitializeSpacecraftParams {
    physicsWorld: CANNON.World;
    scene: THREE.Scene & { userData: { camera: THREE.Camera; light: THREE.Light } };
}

export async function initializeSpacecraft({ physicsWorld, scene }: InitializeSpacecraftParams): Promise<{
    spacecraft: Spacecraft;
    controller: SpacecraftController;
}> {
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
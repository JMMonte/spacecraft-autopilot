import * as THREE from 'three';
import { RCSVisuals } from '../scenes/objects/rcsVisuals';
import { SpacecraftModel } from '../scenes/objects/spacecraftModel';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { SpacecraftController } from '../controllers/spacecraftController';
import { DockingController } from '../controllers/docking/DockingController';
import { BasicWorld } from './BasicWorld';
import type { PhysicsEngine } from '../physics';

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
    public basicWorld: BasicWorld;
    public initialPosition: THREE.Vector3 | { x: number; y: number; z: number };
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
    private physics?: import('../physics').PhysicsEngine;
    private dockingHandle?: unknown;

    constructor(
        world: any,
        scene: THREE.Scene & { userData: { camera: THREE.Camera; light: THREE.Light } },
        initialPosition: THREE.Vector3 | { x: number; y: number; z: number } = new THREE.Vector3(0, 0, 2),
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        basicWorld?: BasicWorld,
        physics?: PhysicsEngine
    ) {
        this.uuid = THREE.MathUtils.generateUUID();
        this.basicWorld = basicWorld as BasicWorld;
        this.physics = physics;
        this.initialPosition = initialPosition;

        this.objects = new SpacecraftModel(scene, world, width, height, depth, undefined, physics);
        if (this.objects.rigid) {
            this.rcsVisuals = new RCSVisuals(this.objects, this.objects.rigid);
        } else {
            this.rcsVisuals = new RCSVisuals(this.objects, {
                setPosition: (x: number, y: number, z: number) => { this.objects.boxBody.position.set(x, y, z); },
                setQuaternion: (x: number, y: number, z: number, w: number) => { this.objects.boxBody.quaternion.set(x, y, z, w); },
                getPosition: () => this.objects.boxBody.position as unknown as { x: number; y: number; z: number },
                getQuaternion: () => this.objects.boxBody.quaternion as unknown as { x: number; y: number; z: number; w: number },
                setMass: (m: number) => { this.objects.boxBody.mass = m; },
                getMass: () => this.objects.boxBody.mass,
                setDamping: () => {},
                applyForce: () => {},
                getLinearVelocity: () => this.objects.boxBody.velocity as unknown as { x: number; y: number; z: number },
                setLinearVelocity: (v: { x: number; y: number; z: number }) => { this.objects.boxBody.velocity.set(v.x, v.y, v.z); },
                getAngularVelocity: () => this.objects.boxBody.angularVelocity as unknown as { x: number; y: number; z: number },
                setAngularVelocity: (v: { x: number; y: number; z: number }) => { this.objects.boxBody.angularVelocity.set(v.x, v.y, v.z); },
                getNative: <T>() => this.objects.boxBody as unknown as T,
            } as any);
        }
        this.objects.rcsVisuals = this.rcsVisuals;

        // Set initial position through model (supports engine abstraction)
        if (this.objects.rigid) {
            const p = initialPosition as any;
            this.objects.rigid.setPosition(p.x, p.y, p.z);
        } else {
            const p = initialPosition as any;
            this.objects.boxBody.position.set(p.x, p.y, p.z);
        }

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
        this.dockingController.update();
    }

    public cleanup(): void {
        this.objects.cleanup?.();
        this.rcsVisuals.cleanup?.();
        this.helpers.cleanup?.();
        this.spacecraftController.cleanup?.();
    }

    // Conversion helpers removed; all math uses THREE types

    /**
     * Get the world position of the spacecraft's center
     */
    public getWorldPosition(): THREE.Vector3 {
        if (this.objects.rigid) {
            const p = this.objects.rigid.getPosition();
            return new THREE.Vector3(p.x, p.y, p.z);
        }
        return new THREE.Vector3(this.objects.boxBody.position.x, this.objects.boxBody.position.y, this.objects.boxBody.position.z);
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
        worldPos.applyQuaternion(this.getWorldOrientation());
        worldPos.add(this.getWorldPosition());
        return worldPos;
    }

    /**
     * Get the world direction of a docking port
     */
    public getDockingPortWorldDirection(portId: keyof DockingPorts): THREE.Vector3 | null {
        const port = this.dockingPorts[portId];
        if (!port) return null;

        const worldDir = port.direction.clone();
        worldDir.applyQuaternion(this.getWorldOrientation());
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
        // Create a fixed joint via physics engine if available (works with Rapier)
        if (this.physics && this.objects.rigid && otherSpacecraft.objects.rigid) {
            this.dockingHandle = this.physics.createFixedConstraint(this.objects.rigid, otherSpacecraft.objects.rigid);
            
            // Zero out relative velocities
            const vA = this.objects.rigid.getLinearVelocity();
            const vB = otherSpacecraft.objects.rigid.getLinearVelocity();
            const relV = { x: (vA.x - vB.x) * 0.5, y: (vA.y - vB.y) * 0.5, z: (vA.z - vB.z) * 0.5 };
            this.objects.rigid.setLinearVelocity({ x: vA.x - relV.x, y: vA.y - relV.y, z: vA.z - relV.z });
            otherSpacecraft.objects.rigid.setLinearVelocity({ x: vB.x + relV.x, y: vB.y + relV.y, z: vB.z + relV.z });

            const wA = this.objects.rigid.getAngularVelocity();
            const wB = otherSpacecraft.objects.rigid.getAngularVelocity();
            const relW = { x: (wA.x - wB.x) * 0.5, y: (wA.y - wB.y) * 0.5, z: (wA.z - wB.z) * 0.5 };
            this.objects.rigid.setAngularVelocity({ x: wA.x - relW.x, y: wA.y - relW.y, z: wA.z - relW.z });
            otherSpacecraft.objects.rigid.setAngularVelocity({ x: wB.x + relW.x, y: wB.y + relW.y, z: wB.z + relW.z });
        } else {
            console.warn('Docking: constraints not supported in current physics engine. Visual docking only.');
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
        if (this.physics && this.dockingHandle) {
            this.physics.removeConstraint(this.dockingHandle);
            this.dockingHandle = undefined;
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
        return this.getWorldVelocity();
    }

    public getAngularVelocity(): THREE.Vector3 {
        return this.getWorldAngularVelocity();
    }

    public getOrientation(): THREE.Quaternion {
        return this.getWorldOrientation();
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

    public getMainBodyDimensions(): THREE.Vector3 {
        const shape: any = this.objects.boxBody.shapes[0];
        const he = shape?.halfExtents || { x: 0.5, y: 0.5, z: 1 };
        return new THREE.Vector3(he.x, he.y, he.z);
    }

    public getFullDimensions(): THREE.Vector3 {
        const mainBody = this.getMainBodyDimensions();
        const portDepth = this.objects.dockingPortDepth || 0.3;
        const portLength = this.objects.dockingPortLength || 0.1;
        const extraDepth = portDepth + portLength;

        return new THREE.Vector3(
            mainBody.x,
            mainBody.y,
            mainBody.z + extraDepth // Add docking port depth to each end
        );
    }

    public getPortDimensions(): THREE.Vector3 {
        return new THREE.Vector3(
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

    public getDockingPortCamera(portId: keyof DockingPorts): THREE.PerspectiveCamera | undefined {
        if (portId !== 'front' && portId !== 'back') return undefined as any;
        return this.objects.getDockingPortCamera(portId as 'front' | 'back');
    }

    public getDockingPortCameras(): Partial<Record<'front' | 'back', THREE.PerspectiveCamera>> {
        return this.objects.getDockingPortCameras();
    }

    public getWorldOrientation(): THREE.Quaternion {
        if (this.objects.rigid) {
            const q = this.objects.rigid.getQuaternion();
            return new THREE.Quaternion(q.x, q.y, q.z, q.w);
        }
        return new THREE.Quaternion(this.objects.boxBody.quaternion.x, this.objects.boxBody.quaternion.y, this.objects.boxBody.quaternion.z, this.objects.boxBody.quaternion.w);
    }

    public getWorldVelocity(): THREE.Vector3 {
        if (this.objects.rigid) {
            const v = this.objects.rigid.getLinearVelocity();
            return new THREE.Vector3(v.x, v.y, v.z);
        }
        return new THREE.Vector3(this.objects.boxBody.velocity.x, this.objects.boxBody.velocity.y, this.objects.boxBody.velocity.z);
    }

    public getWorldAngularVelocity(): THREE.Vector3 {
        if (this.objects.rigid) {
            const w = this.objects.rigid.getAngularVelocity();
            return new THREE.Vector3(w.x, w.y, w.z);
        }
        return new THREE.Vector3(this.objects.boxBody.angularVelocity.x, this.objects.boxBody.angularVelocity.y, this.objects.boxBody.angularVelocity.z);
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

// initializeSpacecraft helper removed (engine-driven creation now lives in BasicWorld)

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
    public showTraceLines: boolean;
    public dockingPorts: DockingPorts;
    public name: string;
    public uuid: string;
    public dockingLights: { front: boolean; back: boolean } = { front: false, back: false };
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
        this.showTraceLines = false;
        this.dockingLights = { front: false, back: false };

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
        // Update trace line regardless of autopilot state
        if (this.helpers) {
            this.helpers.updateTrace(this.getWorldPosition(), this.getWorldVelocity());
        }
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
        // Read from the rendered transform to avoid querying Rapier during stepping
        return this.objects.box.position.clone();
    }

    /**
     * Zero-allocation reference accessors for hot paths (autopilots, rendering).
     * Callers MUST treat the returned objects as read-only snapshots for the frame.
     */
    public getWorldPositionRef(): THREE.Vector3 {
        return this.objects.box.position;
    }

    /**
     * Get all Three.js objects that can be clicked to select this spacecraft
     */
    public getThreeObjects(): THREE.Object3D[] {
        return [this.objects.box];
    }

    /**
     * Get the world position of a docking port center (at the base of the port cylinder).
     * Uses forward axis with proper offset so it stays consistent with visual geometry.
     */
    public getDockingPortWorldPosition(portId: keyof DockingPorts): THREE.Vector3 | null {
        const dir = this.getDockingPortWorldDirection(portId);
        if (!dir) return null;
        const offset = this.getPortOffset(portId);
        return this.getWorldPosition().clone().add(dir.multiplyScalar(offset));
    }

    /**
     * Get the world direction of a docking port axis.
     * Front port is +Z in local space, back port is -Z.
     */
    public getDockingPortWorldDirection(portId: keyof DockingPorts): THREE.Vector3 | null {
        const q = this.getWorldOrientation();
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
        return portId === 'front' ? forward : forward.clone().multiplyScalar(-1);
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

        // Create a physical constraint between the spacecraft using port-face anchors
        // Use joint frames positioned at each port face and oriented to lock the relative pose at creation.
        if (this.physics && this.objects.rigid && otherSpacecraft.objects.rigid) {
            // Compute local anchor positions at each port face
            const ourSign = ourPortId === 'front' ? 1 : -1;
            const theirSign = theirPortId === 'front' ? 1 : -1;
            const ourFaceDist = (this.objects.boxDepth / 2) + (this.objects.dockingPortDepth || 0.3) + (this.objects.dockingPortLength || 0.1) * 0.5;
            const theirFaceDist = (otherSpacecraft.objects.boxDepth / 2) + (otherSpacecraft.objects.dockingPortDepth || 0.3) + (otherSpacecraft.objects.dockingPortLength || 0.1) * 0.5;
            const localA = { x: 0, y: 0, z: ourSign * ourFaceDist };
            const localB = { x: 0, y: 0, z: theirSign * theirFaceDist };

            // Choose joint frame rotations to preserve current relative orientation (no sudden torque)
            const qA = this.getWorldOrientation();
            const qB = otherSpacecraft.getWorldOrientation();
            const qAinv = new THREE.Quaternion(qA.x, qA.y, qA.z, qA.w).invert();
            const qBinv = new THREE.Quaternion(qB.x, qB.y, qB.z, qB.w).invert();

            // Soften initial impulses: zero relative velocities first
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

            // Create the joint with frames
            this.dockingHandle = this.physics.createFixedConstraint(this.objects.rigid, otherSpacecraft.objects.rigid, {
                frameA: { position: localA, rotation: { x: qAinv.x, y: qAinv.y, z: qAinv.z, w: qAinv.w } },
                frameB: { position: localB, rotation: { x: qBinv.x, y: qBinv.y, z: qBinv.z, w: qBinv.w } },
            });
        } else {
            console.warn('Docking: constraints not supported in current physics engine. Visual docking only.');
        }

        // After creating the hard constraint, ensure both crafts' autopilots are quiescent.
        // This avoids fighting the joint with stale guidance modes or references.
        try {
            const apA = this.spacecraftController?.autopilot;
            const apB = otherSpacecraft.spacecraftController?.autopilot;
            if (apA) {
                apA.resetAllModes();
                apA.setReferenceObject(null);
                apA.setEnabled(false);
            }
            if (apB) {
                apB.resetAllModes();
                apB.setReferenceObject(null);
                apB.setEnabled(false);
            }
            // Clear any latched RCS pulses on both controllers
            this.spacecraftController?.resetThrusterLatch?.();
            otherSpacecraft.spacecraftController?.resetThrusterLatch?.();
        } catch {}

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

    /**
     * Toggle visibility of trace lines helper
     */
    public toggleTraceLines(visible: boolean): void {
        this.showTraceLines = visible;
        if (this.helpers) {
            this.helpers.setTraceVisible(visible);
        }
    }

    /** Clear the accumulated trace line points */
    public clearTraceLines(): void {
        if (this.helpers) {
            this.helpers.resetTrace();
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
        // Param kept for API compatibility; not used (direction carries sign)
        void portId;
        // Return a positive distance from the spacecraft center to the base of the port.
        // The port axis direction (front/back) already carries the sign; combining a signed
        // direction with a signed offset would cancel out and always place both ports on the same side.
        const boxDepth = this.objects.boxDepth;
        const dockingPortDepth = this.objects.dockingPortDepth || 0.3;
        return (boxDepth / 2) + dockingPortDepth;
    }

    public getDockingPortCamera(portId: keyof DockingPorts): THREE.PerspectiveCamera | undefined {
        if (portId !== 'front' && portId !== 'back') return undefined as any;
        return this.objects.getDockingPortCamera(portId as 'front' | 'back');
    }

    public getDockingPortCameras(): Partial<Record<'front' | 'back', THREE.PerspectiveCamera>> {
        return this.objects.getDockingPortCameras();
    }

    /**
     * Return a list of spacecraft currently docked to any of our ports.
     */
    public getDockedSpacecrafts(): Spacecraft[] {
        const partners: Spacecraft[] = [];
        (['front', 'back'] as const).forEach((pid) => {
            const p = this.dockingPorts[pid];
            if (p?.isOccupied && p.dockedTo?.spacecraft) {
                partners.push(p.dockedTo.spacecraft);
            }
        });
        // Deduplicate in case multiple ports connect to the same craft
        const seen = new Set<string>();
        return partners.filter((s) => {
            if (seen.has(s.uuid)) return false;
            seen.add(s.uuid);
            return true;
        });
    }

    /** True when any docking port is occupied. */
    public isDocked(): boolean {
        return (this.dockingPorts.front?.isOccupied === true) || (this.dockingPorts.back?.isOccupied === true);
    }

    public setDockingLights(enabled: boolean): void {
        this.dockingLights.front = enabled;
        this.dockingLights.back = enabled;
        this.objects.setDockingLightsEnabled(enabled);
    }

    public setDockingLight(portId: 'front' | 'back', enabled: boolean): void {
        this.dockingLights[portId] = enabled;
        this.objects.setDockingLightEnabled(portId, enabled);
    }

    public isDockingLightOn(portId: 'front' | 'back'): boolean {
        return !!this.dockingLights[portId];
    }

    public getDockingLightParams(): { intensity: number; angle: number; distance: number; decay: number; penumbra: number } | null {
        return this.objects.getDockingLightParams();
    }

    /**
     * Adjust docking flashlight parameters for both ports on this craft.
     * angle is in radians (Three.js SpotLight half-angle).
     */
    public setDockingLightParams(params: Partial<{ intensity: number; angle: number; distance: number; decay: number; penumbra: number }>): void {
        this.objects.setDockingLightParams(params);
    }

    public getWorldOrientation(): THREE.Quaternion {
        // Read from the rendered transform to avoid querying Rapier during stepping
        return this.objects.box.quaternion.clone();
    }

    public getWorldOrientationRef(): THREE.Quaternion {
        return this.objects.box.quaternion;
    }

    public getWorldVelocity(): THREE.Vector3 {
        // Synced in SpacecraftModel.update()
        return this.objects.boxBody.velocity.clone();
    }

    public getWorldVelocityRef(): THREE.Vector3 {
        return this.objects.boxBody.velocity;
    }

    public getWorldAngularVelocity(): THREE.Vector3 {
        // Synced in SpacecraftModel.update()
        return this.objects.boxBody.angularVelocity.clone();
    }

    public getWorldAngularVelocityRef(): THREE.Vector3 {
        return this.objects.boxBody.angularVelocity;
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

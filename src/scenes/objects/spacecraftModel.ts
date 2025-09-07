import * as THREE from 'three';
import { RCSVisuals } from './rcsVisuals';
import { SceneObjectsConfig } from './types';
import { MaterialManager } from './materials';
import { TrussManager } from './truss';
import { DockingPortManager } from './dockingPort';
import { FuelTankManager } from './fuelTank';
import type { PhysicsEngine } from '../../physics';
import type { RigidBody } from '../../physics/types';

type BoxBodyFacade = {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    velocity: THREE.Vector3;
    angularVelocity: THREE.Vector3;
    mass: number;
    shapes: Array<{ halfExtents: { x: number; y: number; z: number } }>;
    updateBoundingRadius?: () => void;
    updateMassProperties?: () => void;
};

export class SpacecraftModel {
    public boxWidth: number;
    public boxHeight: number;
    public boxDepth: number;
    public box!: THREE.Mesh;
    public boxBody!: BoxBodyFacade; // Engine-agnostic facade for consumers
    public rigid?: RigidBody;
    public rcsVisuals!: RCSVisuals;
    public onRCSVisualsUpdate?: (newRcsVisuals: RCSVisuals) => void;

    private scene: THREE.Scene;
    // no direct physics world reference
    private physics?: PhysicsEngine;
    private materialManager: MaterialManager;
    private trussManager: TrussManager;
    private dockingPortManager: DockingPortManager;
    private fuelTankManager: FuelTankManager;
    private aluminumDensity: number;
    private carbonFiberDensity: number;
    private fuelDensity: number;
    private panelThickness: number;
    private trussRadius: number;
    private trussLength: number;
    private numberOfTrusses: number;
    private numberOfDockingPorts: number;
    private tankThickness: number;
    private readonly defaultDockingPortRadius: number = 0.3;
    private readonly defaultDockingPortLength: number = 0.1;
    private readonly defaultDockingPortDepth: number = 0.3;

    // Add getters for docking port dimensions
    public get dockingPortRadius(): number {
        return this.dockingPortManager?.dockingPortRadius ?? this.defaultDockingPortRadius;
    }

    public get dockingPortLength(): number {
        return this.dockingPortManager?.dockingPortLength ?? this.defaultDockingPortLength;
    }

    public get dockingPortDepth(): number {
        return this.dockingPortManager?.dockingPortDepth ?? this.defaultDockingPortDepth;
    }

    public getDockingPortCamera(id: 'front' | 'back'): THREE.PerspectiveCamera | undefined {
        return this.dockingPortManager?.cameras?.[id];
    }

    public getDockingPortCameras(): Partial<Record<'front' | 'back', THREE.PerspectiveCamera>> {
        return this.dockingPortManager?.cameras ?? {};
    }

    constructor(
        scene: THREE.Scene,
        _world: unknown,
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        config?: SceneObjectsConfig,
        physics?: PhysicsEngine
    ) {
        this.scene = scene;
        // world unused; physics engine manages bodies
        this.boxWidth = width;
        this.boxHeight = height;
        this.boxDepth = depth;
        this.physics = physics;

        // Initialize default values or use config if provided
        this.aluminumDensity = config?.materials.aluminumDensity ?? 2700;
        this.carbonFiberDensity = config?.materials.carbonFiberDensity ?? 1600;
        this.fuelDensity = config?.materials.fuelDensity ?? 1000;
        this.panelThickness = config?.panelThickness ?? 0.01;
        this.trussRadius = config?.truss.radius ?? 0.05;
        this.trussLength = config?.truss.length ?? 1;
        this.numberOfTrusses = config?.truss.numberOfTrusses ?? 12;
        this.numberOfDockingPorts = config?.dockingPort.numberOfDockingPorts ?? 2;
        this.tankThickness = config?.tank.thickness ?? 0.01;

        const dockingPortRadius = config?.dockingPort.radius ?? this.defaultDockingPortRadius;
        const dockingPortLength = config?.dockingPort.length ?? this.defaultDockingPortLength;
        const dockingPortDepth = config?.dockingPort.depth ?? this.defaultDockingPortDepth;

        // Initialize managers
        this.materialManager = new MaterialManager(config?.materialProperties);
        this.trussManager = new TrussManager(
            this.boxWidth,
            this.boxHeight,
            this.boxDepth,
            this.trussRadius,
            dockingPortRadius
        );
        this.dockingPortManager = new DockingPortManager(
            this.boxDepth,
            dockingPortRadius,
            dockingPortLength,
            dockingPortDepth
        );
        this.fuelTankManager = new FuelTankManager(
            this.boxWidth,
            this.boxHeight,
            this.boxDepth,
            this.trussRadius,
            dockingPortDepth
        );

        // Initialize spacecraft components
        this.createBox();
        this.trussManager.addTrussToBox(this.box, this.materialManager.getMaterial('truss'));
        this.fuelTankManager.manageFuelTank(this.box, this.materialManager.getMaterial('fuelTank'));
        this.dockingPortManager.updateDockingPorts(
            this.box,
            this.boxBody,
            this.materialManager.getMaterial('dockingPort'),
            this.rigid ?? null,
            this.physics ?? null
        );
        this.trussManager.updateEndStructure(
            this.box,
            this.materialManager.getMaterial('endStructure'),
            {
                margin: 0.1,
                structureDepth: dockingPortDepth,
                endWidth: dockingPortRadius,
                endHeight: dockingPortRadius
            }
        );
    }

    private createBox(): void {
        const boxGeometry = new THREE.BoxGeometry(this.boxWidth, this.boxHeight, this.boxDepth);
        this.box = new THREE.Mesh(boxGeometry, this.materialManager.getBoxMaterials());
        this.box.castShadow = true;
        this.box.receiveShadow = true;
        
        // Ensure all child meshes also cast and receive shadows
        this.box.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        this.scene.add(this.box);

        const boxMass = this.calculateMass();
        if (this.physics) {
            const rb = this.physics.createBoxBody(
                { x: this.boxWidth / 2, y: this.boxHeight / 2, z: this.boxDepth / 2 },
                boxMass
            );
            rb.setDamping(0, 0);
            this.rigid = rb;
        }
        // Build facade (used by UI and controllers)
        const shape = { halfExtents: { x: this.boxWidth / 2, y: this.boxHeight / 2, z: this.boxDepth / 2 } };
        this.boxBody = {
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            mass: boxMass,
            shapes: [shape],
            updateBoundingRadius: () => {},
            updateMassProperties: () => {},
        };
    }

    private calculateMass(): number {
        return (
            this.calculatePanelMass() +
            this.calculateTrussMass() +
            this.calculateDockingPortMass() +
            this.calculateFuelTankMass(
                Math.max(Math.min(this.boxWidth, this.boxHeight) / 2 - this.trussRadius - 0.01, 0.1),
                Math.max(this.boxDepth - 0.2, 0.1)
            )
        );
    }

    private calculatePanelMass(): number {
        const sideAreas = 2 * (this.boxHeight * this.boxDepth) + 2 * (this.boxWidth * this.boxDepth);
        return this.aluminumDensity * sideAreas * this.panelThickness;
    }

    private calculateTrussMass(): number {
        const volumePerTruss = Math.PI * Math.pow(this.trussRadius, 2) * this.trussLength;
        return this.aluminumDensity * volumePerTruss * this.numberOfTrusses;
    }

    private calculateDockingPortMass(): number {
        const volumePerPort = Math.PI * Math.pow(this.dockingPortRadius, 2) * this.dockingPortLength;
        return this.aluminumDensity * volumePerPort * this.numberOfDockingPorts;
    }

    private calculateFuelTankMass(radius: number, depth: number): number {
        const cylVolume = Math.PI * Math.pow(radius, 2) * depth;
        const capVolume = (4 / 3) * Math.PI * Math.pow(radius, 3);
        const totalVolume = cylVolume + capVolume;
        const surfaceArea = 2 * Math.PI * radius * depth + 4 * Math.PI * Math.pow(radius, 2);

        const massFuel = this.fuelDensity * totalVolume;
        const massTank = this.carbonFiberDensity * surfaceArea * this.tankThickness;
        return massFuel + massTank;
    }

    public updateBox(width: number, height: number, depth: number): void {
        width = Math.max(width, 1);
        height = Math.max(height, 1);
        depth = Math.max(depth, 1.2);

        // Clean up old RCS visuals if they exist
        if (this.rcsVisuals) {
            this.rcsVisuals.cleanup();
            this.rcsVisuals = null as any;
        }

        this.box.geometry.dispose();
        this.box.geometry = new THREE.BoxGeometry(width, height, depth);
        this.boxWidth = width;
        this.boxHeight = height;
        this.boxDepth = depth;

        // Update managers with new dimensions
        this.trussManager = new TrussManager(
            width,
            height,
            depth,
            this.trussRadius,
            this.dockingPortRadius
        );
        this.dockingPortManager = new DockingPortManager(depth, this.dockingPortRadius, this.dockingPortLength, this.dockingPortDepth);
        this.fuelTankManager = new FuelTankManager(width, height, depth, this.trussRadius, this.dockingPortDepth);

        // Update components
        this.trussManager.removeTrussFromBox(this.box);
        this.trussManager.addTrussToBox(this.box, this.materialManager.getMaterial('truss'));
        this.dockingPortManager.updateDockingPorts(
            this.box,
            this.boxBody,
            this.materialManager.getMaterial('dockingPort'),
            this.rigid ?? null,
            this.physics ?? null
        );
        this.fuelTankManager.manageFuelTank(
            this.box,
            this.materialManager.getMaterial('fuelTank'),
            Math.max(Math.min(width, height) / 2 - this.trussRadius - 0.01, 0.1),
            Math.max(depth - 0.2, 0.1)
        );

        this.trussManager.updateEndStructure(
            this.box,
            this.materialManager.getMaterial('endStructure'),
            {
                margin: 0.1,
                structureDepth: this.dockingPortDepth,
                endWidth: this.dockingPortRadius,
                endHeight: this.dockingPortRadius
            }
        );

        // Update facade for dimensions and mass
        this.boxBody.shapes[0].halfExtents = { x: width / 2, y: height / 2, z: depth / 2 };
        this.boxBody.mass = this.calculateMass();
        if (this.rigid) this.rigid.setMass(this.boxBody.mass);

        // Create new RCS visuals with fresh state
        const newRcsVisuals = this.rigid ? new RCSVisuals(this, this.rigid) : new RCSVisuals(this, {
            setPosition: (x: number, y: number, z: number) => { this.boxBody.position.set(x, y, z); },
            setQuaternion: (x: number, y: number, z: number, w: number) => { this.boxBody.quaternion.set(x, y, z, w); },
            getPosition: () => this.boxBody.position as unknown as { x: number; y: number; z: number },
            getQuaternion: () => this.boxBody.quaternion as unknown as { x: number; y: number; z: number; w: number },
            setMass: (m: number) => { this.boxBody.mass = m; },
            getMass: () => this.boxBody.mass,
            setDamping: () => {},
            applyForce: () => {},
            applyImpulse: () => {},
            getLinearVelocity: () => this.boxBody.velocity as unknown as { x: number; y: number; z: number },
            setLinearVelocity: (v: { x: number; y: number; z: number }) => { this.boxBody.velocity.set(v.x, v.y, v.z); },
            getAngularVelocity: () => this.boxBody.angularVelocity as unknown as { x: number; y: number; z: number },
            setAngularVelocity: (v: { x: number; y: number; z: number }) => { this.boxBody.angularVelocity.set(v.x, v.y, v.z); },
            getNative: <T>() => this.boxBody as unknown as T,
        } as unknown as RigidBody);
        
        // Copy over any active thruster states from the old visuals if they exist
        if (this.rcsVisuals) {
            const oldThrusterStates = this.rcsVisuals.getConeMeshes().map(mesh => mesh?.visible || false);
            oldThrusterStates.forEach((isActive, index) => {
                if (isActive) {
                    // Recreate visual effect without adding physics impulse
                    newRcsVisuals.applyForce(index, 100, 0);
                }
            });
        }
        
        this.rcsVisuals = newRcsVisuals;
        
        if (this.onRCSVisualsUpdate) {
            this.onRCSVisualsUpdate(newRcsVisuals);
        }
    }

    public update(): void {
        if (this.rigid) {
            const p = this.rigid.getPosition();
            const q = this.rigid.getQuaternion();
            this.box.position.set(p.x, p.y, p.z);
            this.box.quaternion.set(q.x, q.y, q.z, q.w);
            // Sync facade
            this.boxBody.position.set(p.x, p.y, p.z);
            this.boxBody.quaternion.set(q.x, q.y, q.z, q.w);
            const lv = this.rigid.getLinearVelocity();
            const av = this.rigid.getAngularVelocity();
            this.boxBody.velocity.set(lv.x, lv.y, lv.z);
            this.boxBody.angularVelocity.set(av.x, av.y, av.z);
        } else {
            this.box.position.copy(this.boxBody.position as unknown as THREE.Vector3);
            this.box.quaternion.copy(this.boxBody.quaternion as unknown as THREE.Quaternion);
        }
    }

    public cleanup(): void {
        // Clean up Three.js objects
        this.box.geometry.dispose();
        if (Array.isArray(this.box.material)) {
            this.box.material.forEach(m => m.dispose());
        } else {
            this.box.material.dispose();
        }

        // Clean up managers
        this.materialManager.cleanup();
        this.fuelTankManager.cleanup();

        // Remove from scene
        this.scene.remove(this.box);

        // No physics body removal here; engine manages rigid bodies' lifetime
    }
} 

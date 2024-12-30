import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RCSVisuals } from '../../ui/rcsVisuals';
import { SceneObjectsConfig } from './types';
import { MaterialManager } from './materials';
import { TrussManager } from './truss';
import { DockingPortManager } from './dockingPort';
import { FuelTankManager } from './fuelTank';

export class SpacecraftModel {
    public boxWidth: number;
    public boxHeight: number;
    public boxDepth: number;
    public box!: THREE.Mesh;
    public boxBody!: CANNON.Body;
    public rcsVisuals!: RCSVisuals;
    public onRCSVisualsUpdate?: (newRcsVisuals: RCSVisuals) => void;

    private scene: THREE.Scene;
    private world: CANNON.World;
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
    private dockingPortRadius: number;
    private dockingPortLength: number;
    private dockingPortDepth: number;
    private numberOfTrusses: number;
    private numberOfDockingPorts: number;
    private tankThickness: number;

    constructor(
        scene: THREE.Scene,
        world: CANNON.World,
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        config?: SceneObjectsConfig
    ) {
        this.scene = scene;
        this.world = world;
        this.boxWidth = width;
        this.boxHeight = height;
        this.boxDepth = depth;

        // Initialize default values or use config if provided
        this.aluminumDensity = config?.materials.aluminumDensity ?? 2700;
        this.carbonFiberDensity = config?.materials.carbonFiberDensity ?? 1600;
        this.fuelDensity = config?.materials.fuelDensity ?? 1000;
        this.panelThickness = config?.panelThickness ?? 0.01;
        this.trussRadius = config?.truss.radius ?? 0.05;
        this.trussLength = config?.truss.length ?? 1;
        this.dockingPortRadius = config?.dockingPort.radius ?? 0.3;
        this.dockingPortLength = config?.dockingPort.length ?? 0.1;
        this.dockingPortDepth = config?.dockingPort.depth ?? 0.3;
        this.numberOfTrusses = config?.truss.numberOfTrusses ?? 12;
        this.numberOfDockingPorts = config?.dockingPort.numberOfDockingPorts ?? 2;
        this.tankThickness = config?.tank.thickness ?? 0.01;

        // Initialize managers
        this.materialManager = new MaterialManager(config?.materialProperties);
        this.trussManager = new TrussManager(
            this.boxWidth,
            this.boxHeight,
            this.boxDepth,
            this.trussRadius,
            this.dockingPortRadius
        );
        this.dockingPortManager = new DockingPortManager(
            this.boxDepth,
            this.dockingPortRadius,
            this.dockingPortLength,
            this.dockingPortDepth
        );
        this.fuelTankManager = new FuelTankManager(
            this.boxWidth,
            this.boxHeight,
            this.boxDepth,
            this.trussRadius,
            this.dockingPortDepth
        );

        // Initialize spacecraft components
        this.createBox();
        this.trussManager.addTrussToBox(this.box, this.materialManager.getMaterial('truss'));
        this.fuelTankManager.manageFuelTank(this.box, this.materialManager.getMaterial('fuelTank'));
        this.dockingPortManager.updateDockingPorts(this.box, this.boxBody, this.materialManager.getMaterial('dockingPort'));
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
        const boxShape = new CANNON.Box(new CANNON.Vec3(this.boxWidth / 2, this.boxHeight / 2, this.boxDepth / 2));
        this.boxBody = new CANNON.Body({
            mass: boxMass,
            shape: boxShape,
            material: new CANNON.Material()
        });
        this.boxBody.linearDamping = 0;
        this.boxBody.angularDamping = 0;
        this.world.addBody(this.boxBody);
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
        this.dockingPortManager.updateDockingPorts(this.box, this.boxBody, this.materialManager.getMaterial('dockingPort'));
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

        if (this.boxBody) {
            const shape = this.boxBody.shapes[0] as CANNON.Box;
            shape.halfExtents.set(width / 2, height / 2, depth / 2);
            shape.updateConvexPolyhedronRepresentation();
            this.boxBody.updateBoundingRadius();
            this.boxBody.mass = this.calculateMass();
            this.boxBody.updateMassProperties();
        }

        // Create new RCS visuals with fresh state
        const newRcsVisuals = new RCSVisuals(this, this.boxBody, this.world);
        
        // Copy over any active thruster states from the old visuals if they exist
        if (this.rcsVisuals) {
            const oldThrusterStates = this.rcsVisuals.getConeMeshes().map(mesh => mesh?.visible || false);
            oldThrusterStates.forEach((isActive, index) => {
                if (isActive) {
                    newRcsVisuals.applyForce(index, 100);
                }
            });
        }
        
        this.rcsVisuals = newRcsVisuals;
        
        if (this.onRCSVisualsUpdate) {
            this.onRCSVisualsUpdate(newRcsVisuals);
        }
    }

    public update(): void {
        this.box.position.copy(this.boxBody.position as unknown as THREE.Vector3);
        this.box.quaternion.copy(this.boxBody.quaternion as unknown as THREE.Quaternion);
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

        // Clean up physics body
        this.world.removeBody(this.boxBody);
    }
} 
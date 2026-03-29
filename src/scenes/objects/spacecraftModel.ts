import * as THREE from 'three';
import { RCSVisuals } from './rcsVisuals';
import { SceneObjectsConfig } from './types';
import { MaterialManager } from './materials';
import { TrussManager } from './truss';
import { DockingPortManager, type PortConfig } from './dockingPort';
import { FuelTankManager } from './fuelTank';
import type { PhysicsEngine } from '../../physics';
import type { RigidBody } from '../../physics/types';
import type { SpacecraftModule, ModuleBuildContext } from '../modules/SpacecraftModule';
import type { SpacecraftBlueprint } from '../modules/SpacecraftBlueprint';
import { createModule } from '../modules/ModuleRegistry';
import { TrussModule } from '../modules/TrussModule';
import { FuelTankModule } from '../modules/FuelTankModule';
import { DockingPortModule } from '../modules/DockingPortModule';

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

export interface SpacecraftModelOptions {
    includeThrusters?: boolean;
    includeFuelTank?: boolean;
}

export class SpacecraftModel {
    public boxWidth: number;
    public boxHeight: number;
    public boxDepth: number;
    public box!: THREE.Mesh;
    public boxBody!: BoxBodyFacade; // Engine-agnostic facade for consumers
    public rigid?: RigidBody;
    public rcsVisuals!: RCSVisuals;
    public onRCSVisualsUpdate?: (newRcsVisuals: RCSVisuals) => void;
    public modelOptions: SpacecraftModelOptions;

    /** Modules attached to this spacecraft (blueprint path only). */
    public modules: SpacecraftModule[] = [];
    /** Total module mass contribution. */
    public moduleMass = 0;
    /** Current body material preset name. */
    public bodyPreset: string = 'blue-gold';

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
    private readonly defaultDockingPortLength: number = 0.07;
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

    public getDockingPortCamera(id: string): THREE.PerspectiveCamera | undefined {
        return this.dockingPortManager?.cameras?.[id];
    }

    public getDockingPortCameras(): Record<string, THREE.PerspectiveCamera> {
        return this.dockingPortManager?.cameras ?? {};
    }

    public setDockingLightsEnabled(enabled: boolean): void {
        this.dockingPortManager?.setDockingLightsEnabled(enabled);
    }

    public setDockingLightEnabled(id: string, enabled: boolean): void {
        this.dockingPortManager?.setDockingLightEnabled(id, enabled);
    }

    public getDockingLightParams(): { intensity: number; angle: number; distance: number; decay: number; penumbra: number } | null {
        return this.dockingPortManager?.getDockingLightParams?.() ?? null;
    }

    public setDockingLightParams(params: Partial<{ intensity: number; angle: number; distance: number; decay: number; penumbra: number }>): void {
        this.dockingPortManager?.setDockingLightParams?.(params);
    }

    /**
     * Set custom docking port configurations and rebuild ports.
     * Must be called after construction if non-default ports are desired.
     */
    public setPortConfigs(configs: PortConfig[]): void {
        if (!this.dockingPortManager) return;
        this.dockingPortManager.setPortConfigs(configs);
        this.dockingPortManager.updateDockingPorts(
            this.box,
            this.boxBody,
            this.materialManager.getMaterial('dockingPort'),
            this.rigid ?? null,
            this.physics ?? null
        );
        // Remove old front/back end-structure trusses and rebuild for all ports
        this.trussManager.removeAllEndStructureTrusses(this.box);
        this.trussManager.updateEndStructureForPorts(
            this.box,
            this.materialManager.getMaterial('endStructure'),
            configs,
            {
                margin: 0.1,
                structureDepth: this.dockingPortDepth,
                endWidth: this.dockingPortRadius,
                endHeight: this.dockingPortRadius
            }
        );
    }

    constructor(
        scene: THREE.Scene,
        _world: unknown,
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        config?: SceneObjectsConfig,
        physics?: PhysicsEngine,
        modelOptions?: SpacecraftModelOptions
    ) {
        this.scene = scene;
        this.modelOptions = {
            includeThrusters: modelOptions?.includeThrusters !== false,
            includeFuelTank: modelOptions?.includeFuelTank !== false,
        };
        // world unused; physics engine manages bodies
        this.boxWidth = width;
        this.boxHeight = height;
        this.boxDepth = depth;
        this.physics = physics;

        // Initialize default values or use config if provided
        // Material densities
        this.aluminumDensity = config?.materials.aluminumDensity ?? 2700;
        this.carbonFiberDensity = config?.materials.carbonFiberDensity ?? 1600;
        this.fuelDensity = config?.materials.fuelDensity ?? 1000; // hydrazine ~1000 kg/m³
        // Hull panels: 2mm aluminum honeycomb sandwich (effective ~30% solid density)
        this.panelThickness = config?.panelThickness ?? 0.002;
        this.trussRadius = config?.truss.radius ?? 0.05;
        this.trussLength = config?.truss.length ?? 1;
        this.numberOfTrusses = config?.truss.numberOfTrusses ?? 12;
        this.numberOfDockingPorts = config?.dockingPort.numberOfDockingPorts ?? 2;
        // Tank shell: 3mm carbon fiber composite
        this.tankThickness = config?.tank.thickness ?? 0.003;

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
            dockingPortDepth,
            this.aluminumDensity
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
        if (this.modelOptions.includeFuelTank) {
            this.fuelTankManager.manageFuelTank(this.box, this.materialManager.getMaterial('fuelTank'));
        }
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

    // ── Fuel tank toggle ──────────────────────────────────────────

    /** Toggle the legacy fuel tank on/off and rebuild geometry. */
    public setFuelTankEnabled(enabled: boolean): void {
        this.modelOptions.includeFuelTank = enabled;
        if (enabled) {
            this.fuelTankManager.manageFuelTank(
                this.box,
                this.materialManager.getMaterial('fuelTank'),
                Math.max(Math.min(this.boxWidth, this.boxHeight) / 2 - this.trussRadius - 0.01, 0.1),
                Math.max(this.boxDepth - 0.2, 0.1),
            );
        } else {
            this.fuelTankManager.cleanup();
        }
    }

    public isFuelTankEnabled(): boolean {
        return this.modelOptions.includeFuelTank ?? false;
    }

    // ── Runtime configuration ─────────────────────────────────────

    /**
     * Set the body material preset and apply to the box mesh.
     * Presets: 'blue-gold' (default), 'gold-silver', 'silver', 'white'
     */
    public setBodyPreset(preset: string): void {
        this.bodyPreset = preset;
        this.box.material = this.materialManager.getBoxMaterialsByPreset(preset);
        // Rebuild trusses to match the new body preset
        this.rebuildTrusses();
    }

    /** Get the current truss shape. */
    public getTrussShape(): import('../objects/truss').TrussShape {
        return this.trussManager.trussShape;
    }

    /** Set the truss shape and rebuild all trusses. */
    public setTrussShape(shape: import('../objects/truss').TrussShape): void {
        this.trussManager.trussShape = shape;
        this.rebuildTrusses();
    }

    /** Rebuild all trusses with current shape, using the body-preset-aware truss material. */
    private rebuildTrusses(): void {
        this.trussManager.removeTrussFromBox(this.box);
        this.trussManager.removeAllEndStructureTrusses(this.box);
        const trussMat = this.getTrussMaterialForPreset();
        this.trussManager.addTrussToBox(this.box, trussMat);
        this.trussManager.updateEndStructure(
            this.box,
            trussMat,
            {
                margin: 0.1,
                structureDepth: this.dockingPortDepth,
                endWidth: this.dockingPortRadius,
                endHeight: this.dockingPortRadius,
            },
        );
        // Reapply body material preset
        if (this.bodyPreset !== 'blue-gold') {
            this.box.material = this.materialManager.getBoxMaterialsByPreset(this.bodyPreset);
        }
    }

    /** Get a truss material that matches the current body preset. */
    private getTrussMaterialForPreset(): THREE.Material {
        switch (this.bodyPreset) {
            case 'gold-silver':
            case 'silver':
                return this.materialManager.getMaterial('truss'); // silver
            case 'gold':
                return this.materialManager.getMaterial('gold');
            case 'white':
                return this.materialManager.getMaterial('truss');
            default:
                return this.materialManager.getMaterial('truss');
        }
    }

    // ── Blueprint factory ─────────────────────────────────────────

    /**
     * Build a SpacecraftModel from a blueprint, using the module system.
     * The model's box + physics are created normally; modules are then
     * instantiated from the blueprint declarations and built in order.
     */
    static fromBlueprint(
        scene: THREE.Scene,
        blueprint: SpacecraftBlueprint,
        physics?: PhysicsEngine,
    ): SpacecraftModel {
        const model = new SpacecraftModel(
            scene, {}, blueprint.width, blueprint.height, blueprint.depth,
            undefined, physics, {
                // If blueprint has an RCS module, include thrusters
                includeThrusters: blueprint.modules.some(m => m.type === 'rcs'),
                includeFuelTank: blueprint.modules.some(m => m.type === 'fuelTank'),
            },
        );

        // Create modules from declarations
        const modules: SpacecraftModule[] = [];
        for (const decl of blueprint.modules) {
            modules.push(createModule(decl, blueprint.depth));
        }
        model.modules = modules;

        // Build context
        const ctx: ModuleBuildContext = {
            box: model.box,
            boxWidth: model.boxWidth,
            boxHeight: model.boxHeight,
            boxDepth: model.boxDepth,
            scene,
            getMaterial: (name: string) => model.materialManager.getMaterial(name),
            physics: physics ?? null,
            rigid: model.rigid ?? null,
        };

        // Wire cross-module dependencies before build
        const trussModule = modules.find((m): m is TrussModule => m.type === 'truss');
        const dockingModule = modules.find((m): m is DockingPortModule => m.type === 'dockingPorts');
        const fuelTankModule = modules.find((m): m is FuelTankModule => m.type === 'fuelTank');

        if (trussModule && dockingModule) {
            trussModule.setDockingPortRadius(dockingModule.dockingPortRadius);
        }
        if (fuelTankModule && dockingModule) {
            fuelTankModule.setDependencies(0.05, dockingModule.dockingPortDepth);
        }

        // Initialize the fuel tank module's fuel state even though legacy constructor
        // built the geometry. The module needs to know tank volume for fuel tracking.
        if (fuelTankModule) {
            fuelTankModule.initFuelState(
                model.boxWidth, model.boxHeight, model.boxDepth,
                0.05, dockingModule?.dockingPortDepth ?? 0.3,
            );
        }

        // Build all modules (skip truss/fuelTank/dockingPorts — those were built by the legacy constructor).
        // Only build genuinely new module types.
        let totalModuleMass = 0;
        for (const mod of modules) {
            // Skip types already handled by legacy constructor
            if (mod.type === 'truss' || mod.type === 'fuelTank' || mod.type === 'dockingPorts' || mod.type === 'rcs') {
                continue;
            }
            const result = mod.build(ctx);
            totalModuleMass += result.mass;
        }
        model.moduleMass = totalModuleMass;

        // Swap hull materials if solar panels are present
        if (modules.some(m => m.type === 'solarPanel')) {
            model.setBodyPreset('gold-silver');
        }

        return model;
    }

    /** Get the build context for this model (used by Spacecraft to build modules post-construction). */
    public getModuleBuildContext(): ModuleBuildContext {
        return {
            box: this.box,
            boxWidth: this.boxWidth,
            boxHeight: this.boxHeight,
            boxDepth: this.boxDepth,
            scene: this.scene,
            getMaterial: (name: string) => this.materialManager.getMaterial(name),
            physics: this.physics ?? null,
            rigid: this.rigid ?? null,
        };
    }

    /** Update all modules that have an update method. */
    public updateModules(dt: number): void {
        for (const mod of this.modules) {
            mod.update?.(dt);
        }
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

        // Split mass between main chassis (box collider) and docking ports (their own colliders)
        const totalMass = this.calculateMass();
        const dockingMass = this.calculateDockingPortMass();
        const baseMass = Math.max(totalMass - dockingMass, 1e-4);
        if (this.physics) {
            const rb = this.physics.createBoxBody(
                { x: this.boxWidth / 2, y: this.boxHeight / 2, z: this.boxDepth / 2 },
                baseMass
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
            mass: totalMass,
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
        // Honeycomb sandwich panels: effective density ~800 kg/m³ (not solid aluminum)
        const honeycombDensity = 800;
        const sideAreas = 2 * (this.boxHeight * this.boxDepth) + 2 * (this.boxWidth * this.boxDepth);
        return honeycombDensity * sideAreas * this.panelThickness;
    }

    private calculateTrussMass(): number {
        // Hollow tube: outer radius R, wall thickness t = 2mm
        const t = 0.002;
        const R = this.trussRadius;
        const innerR = Math.max(R - t, 0);
        const volumePerTruss = Math.PI * (R * R - innerR * innerR) * this.trussLength;
        return this.aluminumDensity * volumePerTruss * this.numberOfTrusses;
    }

    private calculateDockingPortMass(): number {
        // Hollow cylinder: wall thickness 3mm
        const t = 0.003;
        const R = this.dockingPortRadius;
        const innerR = Math.max(R - t, 0);
        const volumePerPort = Math.PI * (R * R - innerR * innerR) * this.dockingPortLength;
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
        width = Math.max(width, 0.1);
        height = Math.max(height, 0.1);
        depth = Math.max(depth, 0.1);
        const activeThrusters = this.rcsVisuals?.getConeMeshes().map((mesh) => mesh?.visible || false) ?? [];

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

        // Preserve truss shape across manager recreation
        const prevTrussShape = this.trussManager.trussShape;

        // Update managers with new dimensions
        this.trussManager = new TrussManager(
            width,
            height,
            depth,
            this.trussRadius,
            this.dockingPortRadius
        );
        this.trussManager.trussShape = prevTrussShape;
        this.dockingPortManager.removeDockingPorts(this.box, this.boxBody, this.physics);
        this.dockingPortManager = new DockingPortManager(depth, this.dockingPortRadius, this.dockingPortLength, this.dockingPortDepth, this.aluminumDensity);
        this.fuelTankManager.cleanup();
        this.fuelTankManager = new FuelTankManager(width, height, depth, this.trussRadius, this.dockingPortDepth);

        // Remove ALL old trusses (both main and end-structure) before rebuilding
        this.trussManager.removeTrussFromBox(this.box);
        this.trussManager.removeAllEndStructureTrusses(this.box);

        // Rebuild components
        const trussMat = this.getTrussMaterialForPreset();
        this.trussManager.addTrussToBox(this.box, trussMat);
        this.dockingPortManager.updateDockingPorts(
            this.box,
            this.boxBody,
            this.materialManager.getMaterial('dockingPort'),
            this.rigid ?? null,
            this.physics ?? null
        );
        if (this.modelOptions.includeFuelTank) {
            this.fuelTankManager.manageFuelTank(
                this.box,
                this.materialManager.getMaterial('fuelTank'),
                Math.max(Math.min(width, height) / 2 - this.trussRadius - 0.01, 0.1),
                Math.max(depth - 0.2, 0.1)
            );
        }

        this.trussManager.updateEndStructure(
            this.box,
            trussMat,
            {
                margin: 0.1,
                structureDepth: this.dockingPortDepth,
                endWidth: this.dockingPortRadius,
                endHeight: this.dockingPortRadius
            }
        );

        // Rebuild all modules with the new dimensions
        const ctx = this.getModuleBuildContext();
        for (const mod of this.modules) {
            // Skip types handled by legacy managers above
            if (mod.type === 'truss' || mod.type === 'fuelTank' || mod.type === 'dockingPorts' || mod.type === 'rcs') continue;
            mod.rebuild?.(ctx);
        }

        // Reapply body material preset (box geometry replacement resets materials)
        if (this.bodyPreset !== 'blue-gold') {
            this.box.material = this.materialManager.getBoxMaterialsByPreset(this.bodyPreset);
        }

        // Update facade for dimensions and mass
        this.boxBody.shapes[0].halfExtents = { x: width / 2, y: height / 2, z: depth / 2 };
        const totalMass = this.calculateMass();
        const dockingMass = this.calculateDockingPortMass();
        const baseMass = Math.max(totalMass - dockingMass, 1e-4);
        this.boxBody.mass = totalMass;
        if (this.rigid) this.rigid.setMass(baseMass);

        // Create new RCS visuals with fresh state (skip if thrusters disabled)
        if (this.modelOptions.includeThrusters) {
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

            activeThrusters.forEach((isActive, index) => {
                if (isActive) {
                    // Restore the visual-only firing state without applying an impulse.
                    newRcsVisuals.applyForce(index, 100, 0);
                }
            });
            this.rcsVisuals = newRcsVisuals;

            if (this.onRCSVisualsUpdate) {
                this.onRCSVisualsUpdate(newRcsVisuals);
            }
        }
    }

    public update(): void {
        if (this.rigid) {
            // Prevent Rapier from sleeping player-controlled bodies.
            // Skip for redirected (guest) bodies in compound docking — their
            // original native body should stay disabled.
            if (!this.rigid.isRedirected?.()) {
                try { (this.rigid.getNative<any>())?.wakeUp?.(); } catch {}
            }

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
        // Clean up modules
        for (const mod of this.modules) {
            mod.cleanup();
        }
        this.modules = [];

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

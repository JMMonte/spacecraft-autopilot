import type { SpacecraftModule, ModuleBuildContext, ModuleBuildResult } from './SpacecraftModule';
import { FuelTankManager } from '../objects/fuelTank';
import type { FuelTankModuleParams } from './SpacecraftBlueprint';
import { FUEL_TYPES, type FuelType } from './SpacecraftBlueprint';

const CARBON_FIBER_DENSITY = 1600;
const TANK_THICKNESS = 0.003; // 3mm carbon fiber composite

/**
 * Specific impulse (seconds) by fuel type.
 * Isp determines fuel efficiency: higher = less fuel consumed per Newton-second.
 */
const FUEL_ISP: Record<FuelType, number> = {
    'hydrazine': 220,   // monopropellant
    'mmh-nto':   310,   // bipropellant
    'xenon':     3000,  // ion thruster
    'lox-lh2':   450,   // cryogenic
};

const G0 = 9.80665; // standard gravity (m/s²)

export class FuelTankModule implements SpacecraftModule {
    readonly type = 'fuelTank' as const;
    private manager: FuelTankManager | null = null;
    private readonly radiusOverride?: number;
    private trussRadius = 0.05;
    private dockingPortDepth = 0.3;
    private _fuelType: FuelType;
    private lastBuildCtx: ModuleBuildContext | null = null;

    /** Tank internal volume in m³. */
    private _tankVolume = 0;
    /** Maximum fuel mass in kg (volume × density). */
    private _fuelCapacity = 0;
    /** Current fuel mass in kg. */
    private _fuelMass = 0;

    constructor(params?: FuelTankModuleParams) {
        this.radiusOverride = params?.radius;
        this._fuelType = params?.fuelType ?? 'hydrazine';
    }

    // ── Getters ─────────────────────────────────────────────

    get fuelType(): FuelType { return this._fuelType; }
    get fuelDensity(): number { return FUEL_TYPES[this._fuelType].density; }
    get fuelLabel(): string { return FUEL_TYPES[this._fuelType].label; }
    get isp(): number { return FUEL_ISP[this._fuelType]; }

    /** Current fuel mass in kg. */
    get fuelMass(): number { return this._fuelMass; }
    /** Max fuel capacity in kg. */
    get fuelCapacity(): number { return this._fuelCapacity; }
    /** Fuel level 0..1. */
    get fuelLevel(): number { return this._fuelCapacity > 0 ? this._fuelMass / this._fuelCapacity : 0; }
    /** Whether the tank is empty. */
    get isEmpty(): boolean { return this._fuelMass <= 0; }

    /** Let other modules feed dimensions the tank depends on. */
    setDependencies(trussRadius: number, dockingPortDepth: number): void {
        this.trussRadius = trussRadius;
        this.dockingPortDepth = dockingPortDepth;
    }

    /**
     * Initialize fuel state from box dimensions without rebuilding geometry.
     * Used when the legacy constructor already built the tank visual.
     */
    initFuelState(boxW: number, boxH: number, boxD: number, trussR: number, dockDepth: number): void {
        this.trussRadius = trussR;
        this.dockingPortDepth = dockDepth;
        const radius = this.radiusOverride ??
            Math.max(Math.min(boxW, boxH) / 2 - trussR - 0.01, 0.1);
        const depth = Math.max(boxD - 0.2, 0.1);
        const cylVolume = Math.PI * radius ** 2 * depth;
        const capVolume = (4 / 3) * Math.PI * radius ** 3;
        this._tankVolume = cylVolume + capVolume;
        this._fuelCapacity = this._tankVolume * this.fuelDensity;
        if (this._fuelMass <= 0) this._fuelMass = this._fuelCapacity;
    }

    /** Change the fuel type and recalculate capacity (preserves fill fraction). */
    setFuelType(fuelType: FuelType): void {
        const prevLevel = this.fuelLevel;
        this._fuelType = fuelType;
        this._fuelCapacity = this._tankVolume * this.fuelDensity;
        this._fuelMass = this._fuelCapacity * prevLevel;
        if (this.lastBuildCtx) {
            this.rebuild(this.lastBuildCtx);
        }
    }

    /** Refuel to a specific fraction (0..1). Default: full. */
    refuel(fraction = 1): void {
        this._fuelMass = this._fuelCapacity * Math.min(Math.max(fraction, 0), 1);
    }

    /**
     * Consume fuel for a given total thrust force over dt seconds.
     * Uses the Tsiolkovsky fuel consumption: dm = F·dt / (Isp·g0)
     * Returns the actual force that could be applied (may be less if fuel runs out).
     */
    consumeFuel(totalForce: number, dt: number): number {
        if (this._fuelMass <= 0 || totalForce <= 0 || dt <= 0) return 0;

        const massFlow = totalForce / (this.isp * G0); // kg/s
        const fuelNeeded = massFlow * dt; // kg

        if (fuelNeeded <= this._fuelMass) {
            this._fuelMass -= fuelNeeded;
            return totalForce; // full force applied
        } else {
            // Partial: only burn remaining fuel
            const availableForce = (this._fuelMass / dt) * this.isp * G0;
            this._fuelMass = 0;
            return availableForce;
        }
    }

    // ── Lifecycle ────────────────────────────────────────────

    build(ctx: ModuleBuildContext): ModuleBuildResult {
        this.lastBuildCtx = ctx;
        this.manager = new FuelTankManager(
            ctx.boxWidth, ctx.boxHeight, ctx.boxDepth,
            this.trussRadius, this.dockingPortDepth,
        );
        const radius = this.radiusOverride ??
            Math.max(Math.min(ctx.boxWidth, ctx.boxHeight) / 2 - this.trussRadius - 0.01, 0.1);
        const depth = Math.max(ctx.boxDepth - 0.2, 0.1);
        this.manager.manageFuelTank(ctx.box, ctx.getMaterial('fuelTank'), radius, depth);

        // Compute tank volume and fuel capacity
        const cylVolume = Math.PI * radius ** 2 * depth;
        const capVolume = (4 / 3) * Math.PI * radius ** 3;
        this._tankVolume = cylVolume + capVolume;
        this._fuelCapacity = this._tankVolume * this.fuelDensity;
        // Start full if this is a fresh build (fuelMass == 0)
        if (this._fuelMass <= 0) this._fuelMass = this._fuelCapacity;

        const mass = this.computeMass();
        return { mass };
    }

    cleanup(): void {
        this.manager?.cleanup();
        this.manager = null;
    }

    rebuild(ctx: ModuleBuildContext): ModuleBuildResult {
        const prevLevel = this.fuelLevel;
        this.cleanup();
        const result = this.build(ctx);
        // Preserve fuel level across rebuild
        this._fuelMass = this._fuelCapacity * prevLevel;
        return result;
    }

    private computeMass(): number {
        const surfaceArea = this._tankVolume > 0
            ? this.estimateSurfaceArea()
            : 0;
        return this._fuelMass + CARBON_FIBER_DENSITY * surfaceArea * TANK_THICKNESS;
    }

    private estimateSurfaceArea(): number {
        // Approximate from tank volume (assume sphere-capped cylinder)
        // V = πr²d + 4/3πr³ → estimate r from volume
        const r = Math.cbrt(this._tankVolume * 3 / (4 * Math.PI)); // sphere equivalent
        return 4 * Math.PI * r ** 2 * 1.5; // ~1.5× sphere for capsule shape
    }
}

import type { PortConfig } from '../objects/dockingPort';

// ── Module parameter types ──────────────────────────────────────────

export interface TrussModuleParams {
    radius?: number;
}

export type FuelType = 'hydrazine' | 'mmh-nto' | 'xenon' | 'lox-lh2';

export const FUEL_TYPES: Record<FuelType, {
    label: string;
    density: number;
    /** Thrust multiplier relative to baseline chemical rockets. */
    thrustFactor: number;
    /** Exhaust color as hex. */
    exhaustColor: number;
}> = {
    'hydrazine':  { label: 'Hydrazine',   density: 1004, thrustFactor: 1.0,  exhaustColor: 0xffffcc },  // pale yellow
    'mmh-nto':    { label: 'MMH/NTO',     density: 1190, thrustFactor: 1.2,  exhaustColor: 0xff8844 },  // orange
    'xenon':      { label: 'Xenon (ion)',  density: 1600, thrustFactor: 0.01, exhaustColor: 0x6666ff },  // blue-purple
    'lox-lh2':    { label: 'LOX/LH2',     density: 360,  thrustFactor: 1.5,  exhaustColor: 0xccddff },  // pale blue
};

export interface FuelTankModuleParams {
    radius?: number;
    fuelType?: FuelType;
}

export interface DockingPortModuleParams {
    ports?: PortConfig[];
    radius?: number;
    length?: number;
    depth?: number;
}

export interface RcsModuleParams {
    particles?: boolean;
    lights?: boolean;
}

export interface SolarPanelModuleParams {
    /** Which face(s) the panel boom attaches to (horizontal). */
    placement: 'left' | 'right' | 'both';
    /** Vertical attachment position on the hull face. */
    verticalPosition?: 'top' | 'center' | 'bottom';
    /** Number of panel segments per wing. Span is computed automatically. */
    panelCount?: number;
    /** Width of each panel segment (along the mast axis). */
    panelWidth?: number;
    /** Gap between panels. */
    panelGap?: number;
    /** Panel thickness. */
    panelThickness?: number;
    /** Strut/mast cylinder radius. */
    mastRadius?: number;
    /** Length of the boom connecting the hull to the panel array base. */
    boomLength?: number;
    /** Panel fold angle when fully deployed, in degrees. 0 = flat. */
    deployedAngle?: number;
    /** Panel fold angle when stowed, in degrees. 90 = fully folded. */
    stowedAngle?: number;
    /** Deploy animation duration in seconds. 0 = instant. */
    deployDuration?: number;
    /** Whether panels start deployed. */
    startDeployed?: boolean;
}

// ── Module declaration (discriminated union) ────────────────────────

export type ModuleDeclaration =
    | { type: 'truss'; params?: TrussModuleParams }
    | { type: 'fuelTank'; params?: FuelTankModuleParams }
    | { type: 'dockingPorts'; params?: DockingPortModuleParams }
    | { type: 'rcs'; params?: RcsModuleParams }
    | { type: 'solarPanel'; params: SolarPanelModuleParams };

// ── Blueprint ───────────────────────────────────────────────────────

/** Declares how to build a spacecraft: body dimensions + modules. */
export interface SpacecraftBlueprint {
    name: string;
    width: number;
    height: number;
    depth: number;
    modules: ModuleDeclaration[];
}

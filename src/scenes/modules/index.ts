// Core interfaces
export type { SpacecraftModule, ModuleBuildContext, ModuleBuildResult } from './SpacecraftModule';
export type { SpacecraftBlueprint, ModuleDeclaration, SolarPanelModuleParams, FuelType } from './SpacecraftBlueprint';
export { FUEL_TYPES } from './SpacecraftBlueprint';

// Module implementations
export { TrussModule } from './TrussModule';
export { FuelTankModule } from './FuelTankModule';
export { DockingPortModule } from './DockingPortModule';
export { RcsModule } from './RcsModule';
export { SolarPanelModule } from './SolarPanelModule';

// Registry & factory
export { createModule, registerModuleFactory } from './ModuleRegistry';

// Predefined blueprints
export { createMoverBlueprint, createNodeBlueprint, createSolarSpacecraftBlueprint } from './blueprints';

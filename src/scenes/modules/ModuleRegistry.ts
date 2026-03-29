import type { SpacecraftModule } from './SpacecraftModule';
import type { ModuleDeclaration } from './SpacecraftBlueprint';
import { TrussModule } from './TrussModule';
import { FuelTankModule } from './FuelTankModule';
import { DockingPortModule } from './DockingPortModule';
import { RcsModule } from './RcsModule';
import { SolarPanelModule } from './SolarPanelModule';

type ModuleFactory = (decl: ModuleDeclaration, boxDepth: number) => SpacecraftModule;

const factories: Record<string, ModuleFactory> = {
    truss: (decl) => new TrussModule(decl.type === 'truss' ? decl.params : undefined),
    fuelTank: (decl) => new FuelTankModule(decl.type === 'fuelTank' ? decl.params : undefined),
    dockingPorts: (decl, boxDepth) => new DockingPortModule(boxDepth, decl.type === 'dockingPorts' ? decl.params : undefined),
    rcs: (decl) => new RcsModule(decl.type === 'rcs' ? decl.params : undefined),
    solarPanel: (decl) => new SolarPanelModule(decl.type === 'solarPanel' ? decl.params : undefined),
};

/** Create a module instance from a declaration. */
export function createModule(decl: ModuleDeclaration, boxDepth: number): SpacecraftModule {
    const factory = factories[decl.type];
    if (!factory) {
        throw new Error(`Unknown module type: ${decl.type}`);
    }
    return factory(decl, boxDepth);
}

/** Register a custom module factory. */
export function registerModuleFactory(type: string, factory: ModuleFactory): void {
    factories[type] = factory;
}

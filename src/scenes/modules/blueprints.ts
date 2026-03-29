import type { SpacecraftBlueprint } from './SpacecraftBlueprint';
import type { SolarPanelModuleParams } from './SpacecraftBlueprint';

/** Standard mover spacecraft with RCS, fuel tank, and docking ports. */
export function createMoverBlueprint(
    name = 'Spacecraft',
    width = 1, height = 1, depth = 2,
): SpacecraftBlueprint {
    return {
        name, width, height, depth,
        modules: [
            { type: 'truss' },
            { type: 'fuelTank' },
            { type: 'dockingPorts' },
            { type: 'rcs' },
        ],
    };
}

/** Passive docking node with 2/4/6 ports and no thrusters. */
export function createNodeBlueprint(
    portCount: 2 | 4 | 6 = 4,
    size = 1,
): SpacecraftBlueprint {
    const d = size / 2;
    const allPorts = [
        { id: 'front', localPosition: { x: 0, y: 0, z: d + 0.3 }, localDirection: { x: 0, y: 0, z: 1 } },
        { id: 'back', localPosition: { x: 0, y: 0, z: -d - 0.3 }, localDirection: { x: 0, y: 0, z: -1 } },
        { id: 'right', localPosition: { x: d + 0.3, y: 0, z: 0 }, localDirection: { x: 1, y: 0, z: 0 } },
        { id: 'left', localPosition: { x: -d - 0.3, y: 0, z: 0 }, localDirection: { x: -1, y: 0, z: 0 } },
        { id: 'top', localPosition: { x: 0, y: d + 0.3, z: 0 }, localDirection: { x: 0, y: 1, z: 0 } },
        { id: 'bottom', localPosition: { x: 0, y: -d - 0.3, z: 0 }, localDirection: { x: 0, y: -1, z: 0 } },
    ];
    const label = portCount === 2 ? 'Coupler' : portCount === 6 ? 'Hub' : 'Node';
    return {
        name: label, width: size, height: size, depth: size,
        modules: [
            { type: 'truss' },
            { type: 'dockingPorts', params: { ports: allPorts.slice(0, portCount) } },
        ],
    };
}

/** Spacecraft with deployable solar panels on both sides. */
export function createSolarSpacecraftBlueprint(
    name = 'Solar Spacecraft',
    panelParams?: Partial<SolarPanelModuleParams>,
): SpacecraftBlueprint {
    return {
        name, width: 1, height: 1, depth: 2,
        modules: [
            { type: 'truss' },
            { type: 'fuelTank' },
            { type: 'dockingPorts' },
            { type: 'solarPanel', params: { placement: 'both', panelCount: 4, ...panelParams } },
            { type: 'rcs' },
        ],
    };
}

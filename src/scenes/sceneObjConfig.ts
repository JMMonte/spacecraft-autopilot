import * as THREE from 'three';

interface BoxDimensions {
    width: number;
    height: number;
    depth: number;
}

interface Materials {
    aluminumDensity: number;
    carbonFiberDensity: number;
    fuelDensity: number;
}

interface Truss {
    radius: number;
    length: number;
    numberOfTrusses: number;
}

interface DockingPort {
    radius: number;
    length: number;
    depth: number;
    numberOfDockingPorts: number;
}

interface Tank {
    thickness: number;
}

interface MaterialProperty {
    color: string;
    metalness: number;
    roughness: number;
    clearcoat?: number;
    side?: THREE.Side;
    opacity?: number;
    transparent?: boolean;
}

interface MaterialProperties {
    aluminum: MaterialProperty;
    carbonFiber: MaterialProperty;
    fuelTank: MaterialProperty;
    dockingPort: MaterialProperty;
    truss: MaterialProperty;
    endStructure: MaterialProperty;
    blue: MaterialProperty;
    gold: MaterialProperty;
    transparent: MaterialProperty;
    silver: MaterialProperty;
}

interface Config {
    boxDimensions: BoxDimensions;
    materials: Materials;
    panelThickness: number;
    truss: Truss;
    dockingPort: DockingPort;
    tank: Tank;
    materialProperties: MaterialProperties;
}

export const CONFIG: Config = {
    boxDimensions: {
        width: 1,
        height: 1,
        depth: 2
    },
    materials: {
        aluminumDensity: 2700, // kg/m^3
        carbonFiberDensity: 1600, // kg/m^3
        fuelDensity: 1021, // kg/m^3
    },
    panelThickness: 0.004,
    truss: {
        radius: 0.025,
        length: 1,
        numberOfTrusses: 12 // 4 on each side
    },
    dockingPort: {
        radius: 0.2,
        length: 0.1,
        depth: 0.3,
        numberOfDockingPorts: 2 // One on each side
    },
    tank: {
        thickness: 0.001 // m
    },
    materialProperties: {
        aluminum: { color: 'silver', metalness: 1.0, roughness: 0.5, clearcoat: 1.0, side: THREE.DoubleSide },
        carbonFiber: { color: 'black', metalness: 0.5, roughness: 0.5, clearcoat: 1.0, side: THREE.DoubleSide },
        fuelTank: { color: 'silver', metalness: 1.0, roughness: 0.5 },
        dockingPort: { color: 'silver', metalness: 1.0, roughness: 0.5 },
        truss: { color: 'silver', metalness: 1.0, roughness: 0.5, clearcoat: 1.0, side: THREE.DoubleSide },
        endStructure: { color: 'silver', metalness: 1.0, roughness: 0.5 },
        blue: { color: 'blue', metalness: 0.5, roughness: 0.5, clearcoat: 1.0, side: THREE.DoubleSide },
        gold: { color: 'gold', metalness: 0.5, roughness: 0.5, clearcoat: 1.0, side: THREE.DoubleSide },
        transparent: { color: 'white', metalness: 0, roughness: 0, opacity: 0, transparent: true },
        silver: { color: 'silver', metalness: 0.5, roughness: 0.5, clearcoat: 1.0, side: THREE.DoubleSide }
    }
}; 
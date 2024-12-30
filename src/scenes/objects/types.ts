import * as THREE from 'three';

export interface SceneObjectsConfig {
    boxWidth: number;
    boxHeight: number;
    boxDepth: number;
    materials: {
        aluminumDensity: number;
        carbonFiberDensity: number;
        fuelDensity: number;
    };
    panelThickness: number;
    truss: {
        radius: number;
        length: number;
        numberOfTrusses: number;
    };
    dockingPort: {
        radius: number;
        length: number;
        depth: number;
        numberOfDockingPorts: number;
    };
    tank: {
        thickness: number;
    };
    materialProperties: {
        [key: string]: THREE.MeshPhysicalMaterialParameters;
    };
}

export interface EndStructureDimensions {
    margin: number;
    structureDepth: number;
    endWidth: number;
    endHeight: number;
}

export interface StartPoints {
    front: THREE.Vector3[];
    back: THREE.Vector3[];
}

export interface EndPoints {
    front: THREE.Vector3[];
    back: THREE.Vector3[];
}

export type PlacementType = 'both' | 'front' | 'back'; 
import * as THREE from 'three';
import { SceneObjectsConfig } from './types';

export class MaterialManager {
    private materials: { [key: string]: THREE.Material } = {};

    constructor(properties?: SceneObjectsConfig['materialProperties']) {
        this.initMaterials(properties);
    }

    private initMaterials(properties?: { [key: string]: THREE.MeshPhysicalMaterialParameters }): void {
        // Default material properties
        const defaultProperties: { [key: string]: THREE.MeshPhysicalMaterialParameters } = {
            blue: { color: 0x0066cc, metalness: 0.8, roughness: 0.2 },
            gold: { color: 0xffd700, metalness: 0.8, roughness: 0.2 },
            transparent: { transparent: true, opacity: 0.5, color: 0xffffff },
            truss: { 
                color: 'silver', 
                metalness: 1.0, 
                roughness: 0.5, 
                clearcoat: 1.0, 
                side: THREE.DoubleSide 
            },
            dockingPort: { 
                color: 'silver',
                metalness: 1.0,
                roughness: 0.5,
                clearcoat: 1.0,
                side: THREE.DoubleSide
            },
            silver: {
                color: 'silver',
                metalness: 0.9,
                roughness: 0.2,
                clearcoat: 0.5
            },
            endStructure: {
                color: 'silver',
                metalness: 0.9,
                roughness: 0.2,
                clearcoat: 0.5
            },
            fuelTank: { 
                color: 0x606060, 
                metalness: 0.7, 
                roughness: 0.3 
            }
        };
        
        // Merge provided properties with defaults
        const finalProperties = { ...defaultProperties, ...(properties || {}) };
        
        // Create materials
        for (const [key, props] of Object.entries(finalProperties)) {
            this.materials[key] = new THREE.MeshPhysicalMaterial({
                ...props,
                side: props.side || THREE.FrontSide
            });
        }
    }

    public getMaterial(name: string): THREE.Material {
        return this.materials[name];
    }

    public getBoxMaterials(): THREE.Material[] {
        return [
            this.materials['blue'] || new THREE.MeshPhysicalMaterial({ color: 0x0066cc }),
            this.materials['gold'] || new THREE.MeshPhysicalMaterial({ color: 0xffd700 }),
            this.materials['blue'] || new THREE.MeshPhysicalMaterial({ color: 0x0066cc }),
            this.materials['gold'] || new THREE.MeshPhysicalMaterial({ color: 0xffd700 }),
            this.materials['transparent'] || new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.5 }),
            this.materials['transparent'] || new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.5 })
        ];
    }

    public cleanup(): void {
        Object.values(this.materials).forEach(material => material.dispose());
        this.materials = {};
    }
} 
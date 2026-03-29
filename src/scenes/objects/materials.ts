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
            transparent: { transparent: true, opacity: 0.0, color: 0xffffff },
            truss: {
                color: 0xa0a0a0,
                metalness: 0.8,
                roughness: 0.4,
                clearcoat: 0.3,
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
                color: 0xa0a0a0,
                metalness: 0.8,
                roughness: 0.4,
                clearcoat: 0.3
            },
            fuelTank: {
                color: 0x606060,
                metalness: 0.7,
                roughness: 0.3
            },
            solarPanel: {
                color: 0x1a237e,
                metalness: 0.1,
                roughness: 0.6,
                clearcoat: 0.8,
                side: THREE.DoubleSide
            },
            solarPanelBack: {
                color: 0xcccccc,
                metalness: 0.3,
                roughness: 0.7,
                side: THREE.DoubleSide
            },
            solarMast: {
                color: 'silver',
                metalness: 0.9,
                roughness: 0.3,
                clearcoat: 0.5
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
            this.materials['transparent'] || new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.0 }),
            this.materials['transparent'] || new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.0 })
        ];
    }

    /** Get box materials by preset name. */
    public getBoxMaterialsByPreset(preset: string): THREE.Material[] {
        const transparent = this.materials['transparent'] || new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.0 });
        const mat = (name: string, fallback: number) =>
            this.materials[name] || new THREE.MeshPhysicalMaterial({ color: fallback, metalness: 0.8, roughness: 0.2 });

        switch (preset) {
            case 'gold-silver': return this.getSolarBoxMaterials();
            case 'silver': {
                const s = mat('silver', 0xc0c0c0);
                return [s, s, s, s, transparent, transparent];
            }
            case 'white': {
                const w = new THREE.MeshPhysicalMaterial({ color: 0xf0f0f0, metalness: 0.1, roughness: 0.5 });
                return [w, w, w, w, transparent, transparent];
            }
            case 'gold': {
                const g = mat('gold', 0xffd700);
                return [g, g, g, g, transparent, transparent];
            }
            case 'blue-gold':
            default:
                return this.getBoxMaterials();
        }
    }

    /** Gold/silver box materials for spacecraft with solar panels. */
    public getSolarBoxMaterials(): THREE.Material[] {
        const gold = this.materials['gold'] || new THREE.MeshPhysicalMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 });
        const silver = this.materials['silver'] || new THREE.MeshPhysicalMaterial({ color: 0xc0c0c0, metalness: 0.9, roughness: 0.2 });
        const transparent = this.materials['transparent'] || new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.0 });
        return [silver, gold, silver, gold, transparent, transparent];
    }

    public cleanup(): void {
        Object.values(this.materials).forEach(material => material.dispose());
        this.materials = {};
    }
} 
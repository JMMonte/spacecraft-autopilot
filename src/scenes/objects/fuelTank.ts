import * as THREE from 'three';

export class FuelTankManager {
    private fuelTankVisual?: THREE.Group;

    constructor(
        private boxWidth: number,
        private boxHeight: number,
        private boxDepth: number,
        private trussRadius: number,
        private dockingPortDepth: number
    ) {}

    public manageFuelTank(box: THREE.Mesh, material: THREE.Material, radius?: number, depth?: number): void {
        const marginRadius = 1.6;
        if (!radius || !depth) {
            radius = Math.max(Math.min(this.boxWidth, this.boxHeight) / 2 - this.trussRadius - 0.01, 0.1);
            depth = Math.max(this.boxDepth - 0.2, 0.1);
        }

        depth = Math.max(Math.min(depth, this.boxDepth - this.dockingPortDepth), 0.9);
        const maxRadius = (depth - this.dockingPortDepth) / 2;
        radius = Math.min(radius, maxRadius);

        const effectiveCylinderDepth = depth - radius * marginRadius;

        // Clean up old fuel tank if it exists
        if (this.fuelTankVisual) {
            // Remove all children and dispose geometries/materials
            while (this.fuelTankVisual.children.length > 0) {
                const child = this.fuelTankVisual.children[0];
                if (child instanceof THREE.Mesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
                this.fuelTankVisual.remove(child);
            }
            // Remove the group from the parent box
            box.remove(this.fuelTankVisual);
            this.fuelTankVisual = undefined;
        }

        // Create new fuel tank group
        this.fuelTankVisual = new THREE.Group();
        box.add(this.fuelTankVisual);

        const cylinderGeometry = new THREE.CylinderGeometry(radius, radius, effectiveCylinderDepth, 32);
        const sphereGeometry = new THREE.SphereGeometry(radius, 32, 32);

        const cylinder = new THREE.Mesh(cylinderGeometry, material);
        const topCap = new THREE.Mesh(sphereGeometry, material);
        const bottomCap = new THREE.Mesh(sphereGeometry, material);

        this.fuelTankVisual.add(cylinder, topCap, bottomCap);

        const sphereOffset = effectiveCylinderDepth / 2;
        topCap.position.y = sphereOffset;
        bottomCap.position.y = -sphereOffset;

        this.fuelTankVisual.position.set(0, 0, 0);
        this.fuelTankVisual.rotation.x = Math.PI / 2;

        [cylinder, topCap, bottomCap].forEach(mesh => {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        });
    }

    public cleanup(): void {
        if (this.fuelTankVisual) {
            // Remove and dispose all children
            while (this.fuelTankVisual.children.length > 0) {
                const child = this.fuelTankVisual.children[0];
                if (child instanceof THREE.Mesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
                this.fuelTankVisual.remove(child);
            }
            // If the group has a parent, remove it
            if (this.fuelTankVisual.parent) {
                this.fuelTankVisual.parent.remove(this.fuelTankVisual);
            }
            this.fuelTankVisual = undefined;
        }
    }
} 
import * as THREE from 'three';
import { EndStructureDimensions, PlacementType, StartPoints, EndPoints } from './types';

export class TrussManager {
    constructor(
        private boxWidth: number,
        private boxHeight: number,
        private boxDepth: number,
        private trussRadius: number,
        private dockingPortRadius: number
    ) {}

    public createBeam(start: THREE.Vector3, end: THREE.Vector3, material: THREE.Material): THREE.Mesh {
        const midPoint = new THREE.Vector3();
        midPoint.addVectors(start, end).multiplyScalar(0.5);
        const length = start.distanceTo(end);
        const geometry = new THREE.CylinderGeometry(this.trussRadius, this.trussRadius, length, 16, 1, false);
        
        const beam = new THREE.Mesh(geometry, material.clone());
        beam.position.copy(midPoint);
        beam.lookAt(start);
        beam.rotateX(Math.PI / 2);
        beam.name = "truss";
        beam.castShadow = true;
        beam.receiveShadow = true;
        return beam;
    }

    public addTrussToBox(box: THREE.Mesh, material: THREE.Material): void {
        const vertices = [
            new THREE.Vector3(this.boxWidth / 2, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2, this.boxHeight / 2, -this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2, -this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2, -this.boxHeight / 2, -this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, this.boxHeight / 2, -this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, -this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2, -this.boxHeight / 2, -this.boxDepth / 2)
        ];

        for (let i = 0; i < vertices.length; i++) {
            for (let j = i + 1; j < vertices.length; j++) {
                const beam = this.createBeam(vertices[i], vertices[j], material);
                box.add(beam);
            }
        }
    }

    public removeTrussFromBox(box: THREE.Mesh): void {
        const toRemove = box.children.filter(child => child.name === "truss");
        toRemove.forEach(obj => {
            box.remove(obj);
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                }
            }
        });
    }

    private getStartPoints(margin: number = 0.05): StartPoints {
        const createFrontStartPoints = (margin: number) => [
            new THREE.Vector3(-this.boxWidth / 2 + margin, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2 - margin, this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(-this.boxWidth / 2 + margin, -this.boxHeight / 2, this.boxDepth / 2),
            new THREE.Vector3(this.boxWidth / 2 - margin, -this.boxHeight / 2, this.boxDepth / 2)
        ];

        const frontStartPoints = createFrontStartPoints(margin);
        const backStartPoints = frontStartPoints.map(point => new THREE.Vector3(point.x, point.y, -point.z));

        return { front: frontStartPoints, back: backStartPoints };
    }

    private getEndPoints(startPoints: StartPoints, dimensions: { structureDepth: number, margin?: number }): EndPoints {
        const margin = dimensions.margin || 0.05;
        const calculateEndPoints = (points: THREE.Vector3[], depthAdjustment: number) => [
            new THREE.Vector3(-this.dockingPortRadius + margin / 2, this.dockingPortRadius - margin / 2, points[0].z + depthAdjustment),
            new THREE.Vector3(this.dockingPortRadius - margin / 2, this.dockingPortRadius - margin / 2, points[1].z + depthAdjustment),
            new THREE.Vector3(-this.dockingPortRadius + margin / 2, -this.dockingPortRadius + margin / 2, points[2].z + depthAdjustment),
            new THREE.Vector3(this.dockingPortRadius - margin / 2, -this.dockingPortRadius + margin / 2, points[3].z + depthAdjustment),
        ];

        return {
            front: calculateEndPoints(startPoints.front, dimensions.structureDepth),
            back: calculateEndPoints(startPoints.back, -dimensions.structureDepth)
        };
    }

    public updateEndStructure(box: THREE.Mesh, material: THREE.Material, dimensions: EndStructureDimensions, placement: PlacementType = 'both'): void {
        const startPoints = this.getStartPoints(dimensions.margin);
        const endPoints = this.getEndPoints(startPoints, dimensions);

        // Remove existing trusses if any
        if (placement === 'both' || placement === 'front') {
            this.removeTrusses(box, startPoints.front);
        }
        if (placement === 'both' || placement === 'back') {
            this.removeTrusses(box, startPoints.back);
        }

        // Add new trusses
        if (placement === 'both' || placement === 'front') {
            this.addTrusses(box, startPoints.front, endPoints.front, material);
        }
        if (placement === 'both' || placement === 'back') {
            this.addTrusses(box, startPoints.back, endPoints.back, material);
        }
    }

    private removeTrusses(box: THREE.Mesh, startPoints: THREE.Vector3[]): void {
        const trusses = box.children.filter(child => child.name === "truss");
        
        trusses.forEach(truss => {
            const shouldRemove = startPoints.some(startPoint => {
                const distance = truss.position.distanceTo(startPoint);
                return distance < 0.001;
            });

            if (shouldRemove) {
                box.remove(truss);
                if (truss instanceof THREE.Mesh) {
                    truss.geometry.dispose();
                    if (truss.material instanceof THREE.Material) {
                        truss.material.dispose();
                    }
                }
            }
        });
    }

    private addTrusses(box: THREE.Mesh, startPoints: THREE.Vector3[], endPoints: THREE.Vector3[], material: THREE.Material): void {
        for (let i = 0; i < startPoints.length; i++) {
            const beam = this.createBeam(startPoints[i], endPoints[i], material);
            box.add(beam);
        }
    }
} 
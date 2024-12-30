import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class DockingPortManager {
    constructor(
        private boxDepth: number,
        private dockingPortRadius: number,
        private dockingPortLength: number,
        private dockingPortDepth: number
    ) {}

    public addDockingPorts(box: THREE.Mesh, boxBody: CANNON.Body, material: THREE.Material): void {
        const portPositions = [
            { name: "dockingPortFront", z: this.boxDepth / 2 + this.dockingPortDepth, angle: 0 },
            { name: "dockingPortBack", z: -this.boxDepth / 2 - this.dockingPortDepth, angle: Math.PI }
        ];

        portPositions.forEach(({ name, z, angle }) => {
            // Create the main cylinder
            const cylinderGeometry = new THREE.CylinderGeometry(
                this.dockingPortRadius,
                this.dockingPortRadius,
                this.dockingPortLength,
                32
            );
            const cylinder = new THREE.Mesh(cylinderGeometry, material);
            cylinder.name = name;
            cylinder.rotation.x = Math.PI / 2;
            cylinder.position.z = z;
            cylinder.castShadow = true;
            cylinder.receiveShadow = true;
            box.add(cylinder);

            // Create the outer ring (torus)
            const torusGeometry = new THREE.TorusGeometry(
                this.dockingPortRadius,
                0.05,
                16,
                100
            );
            const torus = new THREE.Mesh(torusGeometry, material);
            torus.name = `${name}Ring`;
            torus.rotation.y = angle;
            torus.position.z = z;
            torus.castShadow = true;
            torus.receiveShadow = true;
            box.add(torus);

            // Create the physics shape for the docking port
            const shape = new CANNON.Cylinder(this.dockingPortRadius, this.dockingPortRadius, this.dockingPortLength, 32);
            const quaternion = new CANNON.Quaternion();
            quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
            
            boxBody.addShape(shape, new CANNON.Vec3(0, 0, z), quaternion);
        });
    }

    public removeDockingPorts(box: THREE.Mesh, boxBody: CANNON.Body): void {
        // Remove visual elements
        const visualToRemove = box.children.filter(
            child =>
                child.name === 'dockingPortFront' ||
                child.name === 'dockingPortBack' ||
                child.name === 'dockingPortFrontRing' ||
                child.name === 'dockingPortBackRing'
        );
        visualToRemove.forEach(obj => {
            box.remove(obj);
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                }
            }
        });

        // Remove physics shapes
        boxBody.shapes = boxBody.shapes.filter((_, index) => {
            const shapePosition = boxBody.shapeOffsets[index];
            const isDockingPort = 
                (shapePosition.z === this.boxDepth / 2 + this.dockingPortDepth) || 
                (shapePosition.z === -this.boxDepth / 2 - this.dockingPortDepth);
            return !isDockingPort;
        });
    }

    public updateDockingPorts(box: THREE.Mesh, boxBody: CANNON.Body, material: THREE.Material): void {
        this.removeDockingPorts(box, boxBody);
        this.addDockingPorts(box, boxBody, material);
    }
} 
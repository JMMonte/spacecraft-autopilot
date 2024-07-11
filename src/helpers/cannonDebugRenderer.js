import * as THREE from 'three';
import * as CANNON from 'cannon';

export class CannonDebugRenderer {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.meshes = [];
        this.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    }

    update() {
        // Remove existing meshes
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
        });
        this.meshes.length = 0;
    
        // Create new meshes
        this.world.bodies.forEach(body => {
            body.shapes.forEach((shape, index) => {
                let mesh;
                if (shape instanceof CANNON.Box) {
                    const { x, y, z } = shape.halfExtents;
                    const geometry = new THREE.BoxGeometry(x * 2, y * 2, z * 2);
                    mesh = new THREE.Mesh(geometry, this.material);
                } else if (shape instanceof CANNON.Sphere) {
                    const radius = shape.radius;
                    const geometry = new THREE.SphereGeometry(radius, 32, 32); // Adjust detail for better visualization
                    mesh = new THREE.Mesh(geometry, this.material);
                } else if (shape instanceof CANNON.Cylinder) {
                    const { radiusTop, radiusBottom, height, numSegments } = shape;
                    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, numSegments);
                    mesh = new THREE.Mesh(geometry, this.material);
                    // Adjust for CANNON.js's Y-up orientation
                    mesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
                }
                // Adjust position and quaternion to match CANNON.js body
                if (mesh) {
                    mesh.position.copy(body.position);
                    mesh.quaternion.copy(body.quaternion);
                    this.scene.add(mesh);
                    this.meshes.push(mesh);
                }
            });
        });
    }
    
}

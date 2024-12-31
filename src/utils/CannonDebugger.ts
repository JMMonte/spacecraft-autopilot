import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class CannonDebugger {
    private scene: THREE.Scene;
    private world: CANNON.World;
    private meshes: THREE.Mesh[] = [];

    constructor(scene: THREE.Scene, world: CANNON.World) {
        this.scene = scene;
        this.world = world;
    }

    update(): void {
        // Remove old meshes
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
            if (mesh.material instanceof THREE.Material) {
                mesh.material.dispose();
            }
        });
        this.meshes.length = 0;

        // Add new meshes
        this.world.bodies.forEach(body => {
            if (!body.shapes.length) return;

            body.shapes.forEach((shape) => {
                const mesh = this.createShapeMesh(shape);
                if (!mesh) return;

                // Copy position and rotation from body
                mesh.position.copy(new THREE.Vector3(
                    body.position.x,
                    body.position.y,
                    body.position.z
                ));
                mesh.quaternion.copy(new THREE.Quaternion(
                    body.quaternion.x,
                    body.quaternion.y,
                    body.quaternion.z,
                    body.quaternion.w
                ));

                this.scene.add(mesh);
                this.meshes.push(mesh);
            });
        });
    }

    private createShapeMesh(shape: CANNON.Shape): THREE.Mesh | null {
        let geometry: THREE.BufferGeometry;
        let material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            wireframe: true,
            opacity: 0.5,
            transparent: true
        });

        if (shape instanceof CANNON.ConvexPolyhedron) {
            const vertices = shape.vertices.map(v => new THREE.Vector3(v.x, v.y, v.z));
            const faces = shape.faces.map(f => f.map(i => i));
            
            geometry = new THREE.BufferGeometry();
            
            // Create vertices
            const positions: number[] = [];
            faces.forEach(face => {
                for (let i = 1; i < face.length - 1; i++) {
                    positions.push(
                        vertices[face[0]].x, vertices[face[0]].y, vertices[face[0]].z,
                        vertices[face[i]].x, vertices[face[i]].y, vertices[face[i]].z,
                        vertices[face[i + 1]].x, vertices[face[i + 1]].y, vertices[face[i + 1]].z
                    );
                }
            });
            
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.computeVertexNormals();
            
            return new THREE.Mesh(geometry, material);
        }

        return null;
    }

    dispose(): void {
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
            if (mesh.material instanceof THREE.Material) {
                mesh.material.dispose();
            }
        });
        this.meshes.length = 0;
    }
} 
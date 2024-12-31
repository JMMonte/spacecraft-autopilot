import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SpacecraftModel } from './spacecraftModel';

interface ThrusterData {
    position: [number, number, number];
    rotation: {
        axis: THREE.Vector3;
        angle: number;
    };
}

class Thruster {
    public cone: THREE.Group;
    private spacecraftBody: CANNON.Body;
    private relativePosition: CANNON.Vec3;

    constructor(cone: THREE.Group, spacecraftBody: CANNON.Body, positionRelativeToParent: [number, number, number]) {
        this.cone = cone;
        this.spacecraftBody = spacecraftBody;
        this.relativePosition = new CANNON.Vec3(...positionRelativeToParent);
    }

    public applyForce(magnitude: number): void {
        // Get the thruster's direction in local space
        const localDirection = new THREE.Vector3(0, 1, 0);
        localDirection.applyQuaternion(this.cone.quaternion);
        
        // Convert to CANNON.Vec3 and scale by magnitude
        const localForce = new CANNON.Vec3(
            -localDirection.x * magnitude,
            -localDirection.y * magnitude,
            -localDirection.z * magnitude
        );

        // Apply force at thruster position in local space
        this.spacecraftBody.applyLocalForce(localForce, this.relativePosition);
    }
}

class ThrusterGeometry {
    public coneGeometry: THREE.ConeGeometry;
    public nozzleConeGeometry: THREE.ConeGeometry;

    constructor(coneRadius: number, coneHeight: number) {
        this.coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32);
        this.coneGeometry.translate(0, coneHeight / 2, 0);
        this.nozzleConeGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true);
    }
}

interface TargetColor {
    r: number;
    g: number;
    b: number;
}

class ThrusterMaterials {
    public nozzleConeMaterial: THREE.MeshPhysicalMaterial;
    public exhaustConeMaterial: THREE.MeshBasicMaterial;

    constructor(gradientLines: number = 12, targetColor: TargetColor = { r: 255, g: 255, b: 0 }) {
        this.nozzleConeMaterial = new THREE.MeshPhysicalMaterial({
            color: 'grey',
            metalness: 1.0,
            roughness: 0.5,
            side: THREE.DoubleSide
        });

        const colorsArray = new Uint8Array(gradientLines * 4); // 4 values per color (RGBA)

        for (let i = 0; i < gradientLines; i++) {
            const scale = Math.log(i + 1) / Math.log(gradientLines); // Logarithmic scale
            // Interpolate color based on the logarithmic scale
            const r = Math.round(255 + (targetColor.r - 255) * scale);
            const g = Math.round(255 + (targetColor.g - 255) * scale);
            const b = Math.round(255 + (targetColor.b - 255) * scale);
            const alpha = Math.round(255 * (1 - i / (gradientLines - 1))); // Gradually decrease alpha
            colorsArray.set([r, g, b, alpha], i * 4);
        }

        const gradientTexture = new THREE.DataTexture(
            colorsArray,
            1, // Width of the texture (1 pixel wide)
            gradientLines, // Height of the texture (number of gradient lines)
            THREE.RGBAFormat
        );
        gradientTexture.needsUpdate = true;

        this.exhaustConeMaterial = new THREE.MeshBasicMaterial({
            map: gradientTexture,
            transparent: true
        });
    }
}

// The minimum interface required by RCSVisuals
type SceneObjects = Pick<SpacecraftModel, 'boxWidth' | 'boxHeight' | 'boxDepth' | 'box'>;

export class RCSVisuals {
    private boxWidth: number;
    private boxHeight: number;
    private boxDepth: number;
    private spacecraftBody: CANNON.Body;
    private coneRadius: number;
    private coneHeight: number;
    private cones: Thruster[];
    private coneMeshes: THREE.Mesh[];
    private thrusterGroups: THREE.Group[] = [];
    private thrusterVisibility: boolean[];
    private thrusterGeometry: ThrusterGeometry;
    private thrusterMaterials: ThrusterMaterials;

    constructor(objects: SceneObjects, body: CANNON.Body, _world: CANNON.World) {
        this.boxWidth = objects.boxWidth;
        this.boxHeight = objects.boxHeight;
        this.boxDepth = objects.boxDepth;
        this.spacecraftBody = body;
        this.coneRadius = 0.1;
        this.coneHeight = 0.5;
        
        // Initialize arrays
        this.cones = new Array(24);  // Pre-size arrays for 24 thrusters
        this.coneMeshes = new Array(24);
        this.thrusterGroups = [];
        this.thrusterVisibility = new Array(24).fill(false);

        this.thrusterGeometry = new ThrusterGeometry(this.coneRadius, this.coneHeight);
        this.thrusterMaterials = new ThrusterMaterials();

        // Create thrusters (this will also set their positions)
        this.createThrusters(objects);
        
        // Ensure all thrusters start invisible
        this.coneMeshes.forEach(mesh => {
            if (mesh) {
                mesh.visible = false;
                mesh.scale.set(1, 1, 1);
            }
        });
    }

    public getConeMeshes(): THREE.Mesh[] {
        return this.coneMeshes;
    }

    public applyForce(index: number, magnitude: number): void {
        if (this.cones[index]) {
            // Apply force and update visuals
            this.cones[index].applyForce(magnitude);
            
            // Update visual effects
            const maxHeight = 1.5;
            const minHeight = 0.01;
            const normalizedMagnitude = Math.min(Math.abs(magnitude) / 100, 1);
            const baseHeight = minHeight + (maxHeight - minHeight) * normalizedMagnitude;
            const randomVariation = 0.2;
            const randomHeight = baseHeight * (1 + (Math.random() * 2 - 1) * randomVariation);
            
            // Update visibility state and visuals
            this.thrusterVisibility[index] = magnitude !== 0;
            if (this.coneMeshes[index]) {
                this.coneMeshes[index].visible = magnitude !== 0;
                this.coneMeshes[index].scale.y = magnitude !== 0 ? randomHeight : 1;
            }
        }
    }

    public updateThrusterCones(): void {
        this.coneMeshes.forEach((coneMesh, index) => {
            if (coneMesh) {
                coneMesh.visible = this.thrusterVisibility[index];
            }
        });
    }

    private createThrusterGroup(
        index: number,
        position: [number, number, number],
        rotation: { axis: THREE.Vector3; angle: number },
        objects: SceneObjects
    ): THREE.Group {
        const thrusterGroup = new THREE.Group();
        thrusterGroup.name = `thruster-${index}`;
        
        // Create exhaust cone (the visible part when firing)
        const exhaustCone = new THREE.Mesh(this.thrusterGeometry.coneGeometry, this.thrusterMaterials.exhaustConeMaterial);
        exhaustCone.visible = false;
        
        // Create nozzle cone (the physical part)
        const nozzleCone = new THREE.Mesh(this.thrusterGeometry.nozzleConeGeometry, this.thrusterMaterials.nozzleConeMaterial);
        nozzleCone.rotateX(Math.PI);
        nozzleCone.position.y = -this.coneHeight / 2;
        nozzleCone.castShadow = true;
        nozzleCone.receiveShadow = true;
    
        // Add meshes to group first
        thrusterGroup.add(exhaustCone);
        thrusterGroup.add(nozzleCone);
        
        // Set up position and rotation
        thrusterGroup.position.set(...position);
        thrusterGroup.setRotationFromAxisAngle(rotation.axis, rotation.angle);
        
        // Add to scene
        objects.box.add(thrusterGroup);
    
        // Create thruster controller with the correct position
        const thruster = new Thruster(thrusterGroup, this.spacecraftBody, position);
        
        // Store references
        this.cones[index] = thruster;
        this.coneMeshes[index] = exhaustCone;
        this.thrusterGroups.push(thrusterGroup);
        this.thrusterVisibility[index] = false;
    
        return thrusterGroup;
    }

    private createThrusters(objects: SceneObjects): void {
        const thrustersData = this.getThrustersData();
        thrustersData.forEach((thrusterData, index) => {
            this.createThrusterGroup(index, thrusterData.position, thrusterData.rotation, objects);
        });
    }

    private getThrustersData(): ThrusterData[] {
        const halfWidth = this.boxWidth / 2;
        const halfHeight = this.boxHeight / 2;
        const halfDepth = this.boxDepth / 2;
        const halfCones = this.coneHeight / 2;
        const xAxis = new THREE.Vector3(1, 0, 0);
        const zAxis = new THREE.Vector3(0, 0, 1);
        const halfPi = Math.PI / 2;
    
        const thrustersData: ThrusterData[] = [];
    
        // Front Face
        thrustersData.push(
            { position: [-halfWidth, -halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } },
            { position: [-halfWidth, halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } },
            { position: [halfWidth, -halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } },
            { position: [halfWidth, halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis, angle: -halfPi } }
        );
    
        // Back Face
        thrustersData.push(
            { position: [-halfWidth, -halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } },
            { position: [-halfWidth, halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } },
            { position: [halfWidth, -halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } },
            { position: [halfWidth, halfHeight, halfDepth + halfCones], rotation: { axis: xAxis, angle: halfPi } }
        );
    
        // Top Face
        thrustersData.push(
            { position: [-halfWidth, halfHeight + halfCones, -halfDepth], rotation: { axis: zAxis, angle: 0 } },
            { position: [halfWidth, halfHeight + halfCones, -halfDepth], rotation: { axis: zAxis, angle: 0 } },
            { position: [halfWidth, halfHeight + halfCones, halfDepth], rotation: { axis: zAxis, angle: 0 } },
            { position: [-halfWidth, halfHeight + halfCones, halfDepth], rotation: { axis: zAxis, angle: 0 } }
        );
    
        // Bottom Face
        thrustersData.push(
            { position: [-halfWidth, -halfHeight - halfCones, -halfDepth], rotation: { axis: zAxis, angle: Math.PI } },
            { position: [halfWidth, -halfHeight - halfCones, -halfDepth], rotation: { axis: zAxis, angle: Math.PI } },
            { position: [halfWidth, -halfHeight - halfCones, halfDepth], rotation: { axis: zAxis, angle: Math.PI } },
            { position: [-halfWidth, -halfHeight - halfCones, halfDepth], rotation: { axis: zAxis, angle: Math.PI } }
        );
    
        // Left Face
        thrustersData.push(
            { position: [halfWidth + halfCones, halfHeight, -halfDepth], rotation: { axis: zAxis, angle: -halfPi } },
            { position: [halfWidth + halfCones, -halfHeight, -halfDepth], rotation: { axis: zAxis, angle: -halfPi } },
            { position: [halfWidth + halfCones, halfHeight, halfDepth], rotation: { axis: zAxis, angle: -halfPi } },
            { position: [halfWidth + halfCones, -halfHeight, halfDepth], rotation: { axis: zAxis, angle: -halfPi } }
        );
    
        // Right Face
        thrustersData.push(
            { position: [-halfWidth - halfCones, halfHeight, -halfDepth], rotation: { axis: zAxis, angle: halfPi } },
            { position: [-halfWidth - halfCones, -halfHeight, -halfDepth], rotation: { axis: zAxis, angle: halfPi } },
            { position: [-halfWidth - halfCones, halfHeight, halfDepth], rotation: { axis: zAxis, angle: halfPi } },
            { position: [-halfWidth - halfCones, -halfHeight, halfDepth], rotation: { axis: zAxis, angle: halfPi } }
        );
    
        return thrustersData;
    }

    public cleanup(): void {
        // Remove entire thruster groups from the scene
        this.thrusterGroups.forEach(group => {
            if (group && group.parent) {
                // Dispose of all meshes in the group
                group.traverse(child => {
                    if (child instanceof THREE.Mesh) {
                        if (child.geometry) child.geometry.dispose();
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else if (child.material) {
                            child.material.dispose();
                        }
                    }
                });
                group.parent.remove(group);
            }
        });

        // Clear arrays
        this.cones = new Array(24);
        this.coneMeshes = new Array(24);
        this.thrusterGroups = [];
        this.thrusterVisibility = new Array(24).fill(false);
    }

    public showCones(): void {
        this.coneMeshes.forEach(mesh => {
            mesh.visible = true;
        });
    }

    public hideCones(): void {
        this.coneMeshes.forEach(mesh => {
            mesh.visible = false;
        });
    }

    public getThrusterData(): ThrusterData[] {
        return this.getThrustersData();
    }
} 
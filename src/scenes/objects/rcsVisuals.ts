import * as THREE from 'three';
import { SpacecraftModel } from './spacecraftModel';
import type { RigidBody } from '../../physics/types';

interface ThrusterData {
    position: [number, number, number];
    rotation: {
        axis: THREE.Vector3;
        angle: number;
    };
}

class Thruster {
    public cone: THREE.Group;
    private rigid: RigidBody;
    private relativePosition: THREE.Vector3;

    constructor(cone: THREE.Group, rigid: RigidBody, positionRelativeToParent: [number, number, number]) {
        this.cone = cone;
        this.rigid = rigid;
        this.relativePosition = new THREE.Vector3(...positionRelativeToParent);
    }

    public applyForce(magnitude: number, dt: number = 0): void {
        // Compute force direction in body-local space using the thruster group rotation
        const localDir = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cone.quaternion);
        // Body world orientation
        const q = this.rigid.getQuaternion();
        const bodyQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
        // World-space force vector (negative of nozzle direction)
        const worldForce = localDir.clone().applyQuaternion(bodyQuat).multiplyScalar(-magnitude);
        // World-space application point = bodyPos + bodyRot * localPos
        const p = this.rigid.getPosition();
        const bodyPos = new THREE.Vector3(p.x, p.y, p.z);
        const worldPoint = this.relativePosition.clone().applyQuaternion(bodyQuat).add(bodyPos);
        // Apply as impulse to avoid persistent-force accumulation on Rapier
        if (dt > 0) {
            const impulse = worldForce.clone().multiplyScalar(dt);
            this.rigid.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z });
        }
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
    private rigid: RigidBody;
    private coneRadius: number;
    private coneHeight: number;
    private cones: Thruster[];
    private coneMeshes: THREE.Mesh[];
    private thrusterLights: THREE.PointLight[];
    private thrusterGroups: THREE.Group[] = [];
    private thrusterVisibility: boolean[];
    private thrusterGeometry: ThrusterGeometry;
    private thrusterMaterials: ThrusterMaterials;
    // Particle system fields
    private scene: THREE.Scene | null = null;
    private particleTexture: THREE.Texture | null = null;
    private particlePool: THREE.Sprite[] = [];
    private activeParticles: Array<{
        sprite: THREE.Sprite;
        velocity: THREE.Vector3;
        life: number;
        maxLife: number;
        growth: number;
    }> = [];
    private maxParticles: number = 128000;
    private emissionRateFullThrust: number = 1800; // particles/sec at full thrust
    private emissionAccumulators: number[] = new Array(24).fill(0);

    constructor(objects: SceneObjects, rigid: RigidBody) {
        this.boxWidth = objects.boxWidth;
        this.boxHeight = objects.boxHeight;
        this.boxDepth = objects.boxDepth;
        this.rigid = rigid;
        this.coneRadius = 0.1;
        this.coneHeight = 0.5;
        
        // Initialize arrays
        this.cones = new Array(24);  // Pre-size arrays for 24 thrusters
        this.coneMeshes = new Array(24);
        this.thrusterLights = new Array(24);
        this.thrusterGroups = [];
        this.thrusterVisibility = new Array(24).fill(false);

        this.thrusterGeometry = new ThrusterGeometry(this.coneRadius, this.coneHeight);
        this.thrusterMaterials = new ThrusterMaterials();

        // Resolve the root scene for particles (attach to scene, not spacecraft)
        const maybeScene = (objects.box.parent as THREE.Scene) || null;
        this.scene = maybeScene;

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

    public applyForce(index: number, magnitude: number, dt: number = 0): void {
        if (this.cones[index]) {
            // Apply force and update visuals
            this.cones[index].applyForce(magnitude, dt);
            
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

            // Update per-thruster light to simulate plume glow
            const light = this.thrusterLights[index];
            if (light) {
                light.visible = magnitude !== 0;
                const maxIntensity = 1.5; // keep subtle to avoid washing out scene
                light.intensity = normalizedMagnitude * maxIntensity;
                light.distance = 1.0 + normalizedMagnitude * 1.5; // 1.0 .. 2.5
            }

            // Emit particles proportional to thrust
            if (dt > 0 && magnitude > 0) {
                this.emitFromThruster(index, normalizedMagnitude, dt);
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
        // Visual-only HUD-like exhaust should never occlude lens flare
        (exhaustCone as any).userData = { ...(exhaustCone as any).userData, lensflare: 'no-occlusion', lensflareTransmission: 1.0 };
        
        // Create nozzle cone (the physical part)
        const nozzleCone = new THREE.Mesh(this.thrusterGeometry.nozzleConeGeometry, this.thrusterMaterials.nozzleConeMaterial);
        nozzleCone.rotateX(Math.PI);
        nozzleCone.position.y = -this.coneHeight / 2;
        nozzleCone.castShadow = true;
        nozzleCone.receiveShadow = true;
    
        // Add meshes to group first
        thrusterGroup.add(exhaustCone);
        thrusterGroup.add(nozzleCone);
        
        // Add a compact point light for nozzle/plume glow
        const glowColor = new THREE.Color(0xFFFFee); // cool bluish thruster glow
        const pointLight = new THREE.PointLight(glowColor, 0, 1, 2.0); // start off
        pointLight.visible = false;
        pointLight.castShadow = false; // many small lights; avoid shadow cost
        pointLight.position.set(0, 0.05, 0); // just ahead of the nozzle
        // Avoid lens flare occlusion side effects
        (pointLight as any).userData = { ...(pointLight as any).userData, lensflare: 'no-occlusion' };
        // Parent to the exhaust mesh so its visibility toggles together
        exhaustCone.add(pointLight);
        
        // Set up position and rotation
        thrusterGroup.position.set(...position);
        thrusterGroup.setRotationFromAxisAngle(rotation.axis, rotation.angle);
        
        // Add to scene
        objects.box.add(thrusterGroup);
    
        // Create thruster controller with the correct position
        const thruster = new Thruster(thrusterGroup, this.rigid, position);
        
        // Store references
        this.cones[index] = thruster;
        this.coneMeshes[index] = exhaustCone;
        this.thrusterLights[index] = pointLight;
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

        // Dispose particles
        this.activeParticles.forEach(p => {
            p.sprite.parent?.remove(p.sprite);
            if (p.sprite.material) p.sprite.material.dispose();
        });
        this.activeParticles = [];
        this.particlePool.forEach(s => {
            s.parent?.remove(s);
            if (s.material) s.material.dispose();
        });
        this.particlePool = [];
        if (this.particleTexture) {
            this.particleTexture.dispose();
            this.particleTexture = null;
        }

        // Clear arrays
        this.cones = new Array(24);
        this.coneMeshes = new Array(24);
        this.thrusterLights = new Array(24);
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

    // --- Particle system helpers ---
    private ensureParticleTexture(): THREE.Texture {
        if (this.particleTexture) return this.particleTexture;
        // Create a small radial gradient texture
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        // Soft white/gray smoke gradient
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        gradient.addColorStop(0.4, 'rgba(210, 210, 210, 0.6)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.particleTexture = texture;
        return texture;
    }

    private getSpriteFromPool(): THREE.Sprite | null {
        const texture = this.ensureParticleTexture();
        if (this.particlePool.length > 0) {
            const s = this.particlePool.pop()!;
            // Refresh texture reference in case disposed
            (s.material as THREE.SpriteMaterial).map = texture;
            return s;
        }
        if (this.activeParticles.length >= this.maxParticles) return null;
        const material = new THREE.SpriteMaterial({
            map: texture,
            color: new THREE.Color(0xffffff),
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: THREE.NormalBlending
        });
        const sprite = new THREE.Sprite(material);
        // Do not occlude lens flares
        (sprite as any).userData = { ...(sprite as any).userData, lensflare: 'no-occlusion' };
        return sprite;
    }

    private spawnParticle(worldPos: THREE.Vector3, worldVel: THREE.Vector3, size: number, life: number, growth: number): void {
        if (!this.scene) return;
        const sprite = this.getSpriteFromPool();
        if (!sprite) return;
        sprite.position.copy(worldPos);
        sprite.scale.setScalar(size);
        (sprite.material as THREE.SpriteMaterial).opacity = 0.4;
        this.scene.add(sprite);
        this.activeParticles.push({ sprite, velocity: worldVel.clone(), life, maxLife: life, growth });
    }

    private emitFromThruster(index: number, intensity: number, dt: number): void {
        if (!this.thrusterGroups[index]) return;
        if (!this.scene) return;
        const group = this.thrusterGroups[index];
        // Emission rate scales with intensity
        const rate = this.emissionRateFullThrust * Math.max(0, Math.min(intensity, 1));
        this.emissionAccumulators[index] += rate * dt;
        const count = Math.floor(this.emissionAccumulators[index]);
        if (count <= 0) return;
        this.emissionAccumulators[index] -= count;

        // Compute emission origin (just ahead of nozzle) in world space
        const localOrigin = new THREE.Vector3(0, 0.02, 0);
        const worldOrigin = group.localToWorld(localOrigin.clone());

        // Direction: +Y of thruster group in world space
        const groupWorldQuat = new THREE.Quaternion();
        group.getWorldQuaternion(groupWorldQuat);
        const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(groupWorldQuat).normalize();

        // Add parent's linear velocity so exhaust keeps moving with ship
        const lv = this.rigid.getLinearVelocity();
        const parentVel = new THREE.Vector3(lv.x, lv.y, lv.z);

        for (let i = 0; i < count; i++) {
            // Spread angle
            const spread = 0.15; // radians
            const randA = (Math.random() - 0.5) * spread;
            const randB = (Math.random() - 0.5) * spread;
            // Construct two perpendicular vectors to dir
            const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
            const tangent = new THREE.Vector3().crossVectors(dir, up).normalize();
            const bitangent = new THREE.Vector3().crossVectors(dir, tangent).normalize();
            const variedDir = new THREE.Vector3().copy(dir).addScaledVector(tangent, randA).addScaledVector(bitangent, randB).normalize();

            // Speed scales with intensity
            const baseSpeed = 30.0; // 10x faster emission
            const speedJitter = 20.0 * (Math.random() * 2 - 1);
            const speed = baseSpeed * (0.6 + 0.4 * intensity) + speedJitter;
            const worldVel = variedDir.multiplyScalar(speed).add(parentVel);

            // Lifetime and size
            const life = 0.08 + Math.random() * 0.06; // seconds
            const size = 0.03 + Math.random() * 0.04; // world units (start small)

            // Growth rate increases with intensity (expand as moving away)
            const growth = 28 + intensity * 60.2; // scale per second
            this.spawnParticle(worldOrigin, worldVel, size, life, growth);
        }
    }

    public update(dt: number): void {
        if (dt <= 0 || this.activeParticles.length === 0) return;
        // Update particles
        const survivors: typeof this.activeParticles = [];
        for (let i = 0; i < this.activeParticles.length; i++) {
            const p = this.activeParticles[i];
            p.life -= dt;
            if (p.life <= 0) {
                // Recycle
                p.sprite.parent?.remove(p.sprite);
                this.particlePool.push(p.sprite);
                continue;
            }
            // Integrate
            p.sprite.position.addScaledVector(p.velocity, dt);
            // Fade and shrink
            const t = 1 - (p.life / p.maxLife);
            const alpha = 0.35 * Math.pow(1 - t, 1.2); // lower overall opacity
            (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(alpha, 1));
            const scale = Math.min(0.6, p.sprite.scale.x * (1 + p.growth * dt));
            p.sprite.scale.setScalar(scale);
            survivors.push(p);
        }
        this.activeParticles = survivors;
    }
}

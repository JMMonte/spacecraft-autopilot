import * as THREE from 'three';
import type { PhysicsEngine, RigidBody } from '../physics';
import { createLogger } from '../utils/logger';
import { getAsteroidLOD } from './AsteroidLODCache';

export type AsteroidModelId = '1a' | '1e' | '2a' | '2b';

export interface AsteroidOptions {
  position: THREE.Vector3;
  diameter: number; // world units (final visual diameter)
  model: AsteroidModelId;
  physics?: PhysicsEngine;
}

export class AsteroidModel {
  private log = createLogger('objects:AsteroidModel');
  private scene: THREE.Scene;
  private lod: THREE.LOD | null = null;
  private physics?: PhysicsEngine;
  private rigid?: RigidBody;
  private diameter: number = 1; // world units
  private position: THREE.Vector3;
  // Simple spin model (client-side only)
  private spinAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private spinRateRadSec = 0; // radians per second
  private spinEnabled = false;

  constructor(scene: THREE.Scene, opts: AsteroidOptions) {
    this.scene = scene;
    this.physics = opts.physics;
    this.diameter = Math.max(1e-6, opts.diameter);
    this.position = opts.position.clone();
    this.load(opts);
  }

  private async load(opts: AsteroidOptions): Promise<void> {
    const { position, diameter, model } = opts;

    try {
      const cached = await getAsteroidLOD(model);
      const finalScale = diameter / cached.gmax;

      const lod = new THREE.LOD();
      lod.position.copy(position);
      // Scale the entire LOD group instead of cloning geometry per instance
      lod.scale.setScalar(finalScale);
      lod.userData.isAsteroid = true;

      // Add each tier as a LOD level — geometry is SHARED (not cloned)
      for (const tier of cached.tiers) {
        const mesh = new THREE.Mesh(tier.geometry, tier.material);
        mesh.castShadow = tier.distance === 0;
        mesh.receiveShadow = tier.distance === 0;
        // Distance thresholds scale with diameter
        const dist = tier.distance * diameter;
        lod.addLevel(mesh, dist);
      }

      this.lod = lod;
      this.scene.add(lod);

      // Physics collider (only when physics is provided, e.g. asteroid system)
      if (this.physics) {
        // Use the far LOD geometry (cheapest) scaled for the physics trimesh
        const farGeom = cached.tiers[cached.tiers.length - 1].geometry;
        const posAttr = farGeom.getAttribute('position');
        const vertices: number[] = [];
        for (let i = 0; i < posAttr.count; i++) {
          vertices.push(
            posAttr.getX(i) * finalScale,
            posAttr.getY(i) * finalScale,
            posAttr.getZ(i) * finalScale,
          );
        }
        let indices: number[] = [];
        const idx = farGeom.getIndex();
        if (idx) {
          indices = Array.from(idx.array as any);
        } else {
          for (let i = 0; i < posAttr.count; i++) indices.push(i);
        }
        this.rigid = this.physics.createTrimeshBody(vertices, indices, true, {
          x: position.x, y: position.y, z: position.z,
        });
      }
    } catch (err) {
      this.log.error('Error loading asteroid LOD:', err instanceof Error ? err.message : err);
    }
  }

  public update(): void {
    if (!this.lod || !this.rigid) return;
    const p = this.rigid.getPosition();
    const q = this.rigid.getQuaternion();
    this.lod.position.set(p.x, p.y, p.z);
    this.lod.quaternion.set(q.x, q.y, q.z, q.w);
  }

  // Advance local spin by dt seconds (optionally multiplied by a timeScale)
  public advance(dt: number, timeScale = 1): void {
    if (!this.lod) return;
    if (!this.spinEnabled || this.spinRateRadSec === 0) return;
    const angle = this.spinRateRadSec * dt * timeScale;
    if (angle === 0) return;
    const dq = new THREE.Quaternion().setFromAxisAngle(this.spinAxis, angle);
    const current = this.rigid ? this.rigid.getQuaternion() : this.lod.quaternion;
    const q = new THREE.Quaternion(current.x, current.y, current.z, 'w' in current ? (current as any).w : this.lod.quaternion.w);
    q.premultiply(dq);
    this.setQuaternion(q);
  }

  // Configure continuous spin
  public setSpin(axis: THREE.Vector3, rateRadSec: number): void {
    this.spinAxis = axis.clone().normalize();
    this.spinRateRadSec = rateRadSec;
    this.spinEnabled = Math.abs(rateRadSec) > 0;
  }

  public setPosition(pos: THREE.Vector3): void {
    if (this.rigid) this.rigid.setPosition(pos.x, pos.y, pos.z);
    if (this.lod) this.lod.position.copy(pos);
    this.position.copy(pos);
  }

  public setQuaternion(q: THREE.Quaternion): void {
    if (this.rigid) this.rigid.setQuaternion(q.x, q.y, q.z, q.w);
    if (this.lod) this.lod.quaternion.copy(q);
  }

  public getPosition(): THREE.Vector3 | null {
    if (this.lod) return this.lod.position.clone();
    return this.position.clone();
  }

  public getRadius(): number {
    return this.diameter * 0.5;
  }

  public dispose(): void {
    if (this.lod) {
      this.scene.remove(this.lod);
      // Geometry and materials are shared via cache — do NOT dispose them here
      this.lod = null;
    }
  }
}

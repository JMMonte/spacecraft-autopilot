import * as THREE from 'three';
import type { PhysicsEngine, RigidBody } from '../physics';
// @ts-ignore
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createLogger } from '../utils/logger';

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
  private mesh!: THREE.Mesh;
  private physics?: PhysicsEngine;
  private rigid?: RigidBody;
  private static fbx = new FBXLoader();
  // Simple spin model (client-side only)
  private spinAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private spinRateRadSec = 0; // radians per second
  private spinEnabled = false;
  // Use a local LoadingManager to avoid polluting DefaultLoadingManager error logs
  private static makeTextureLoader() {
    const mgr = new THREE.LoadingManager();
    // silence errors for optional maps
    mgr.onError = () => {};
    return new THREE.TextureLoader(mgr);
  }

  constructor(scene: THREE.Scene, opts: AsteroidOptions) {
    this.scene = scene;
    this.physics = opts.physics;
    this.load(opts);
  }

  private load(opts: AsteroidOptions): void {
    const { position, diameter, model } = opts;
    const modelPath = `/Asteroid_${model}_FBX/Asteroid_${model}.fbx`;

    AsteroidModel.fbx.load(
      modelPath,
      (object: THREE.Group) => {
        // Use the raw mesh geometry (local space) to compute and enforce exact scaling
        if (!(object.children[0] instanceof THREE.Mesh)) {
          this.log.error('Asteroid FBX has no mesh child:', modelPath);
          return;
        }
        const baseMesh = object.children[0] as THREE.Mesh;
        const srcGeom = baseMesh.geometry;
        srcGeom.computeBoundingBox();
        const gbox = srcGeom.boundingBox;
        if (!gbox) throw new Error(`No bounding box for model ${model}`);
        const gsize = new THREE.Vector3();
        gbox.getSize(gsize);
        const gmax = Math.max(gsize.x, gsize.y, gsize.z);
        if (!(gmax > 0)) throw new Error(`Asteroid FBX zero-extent geometry for model ${model}`);
        if (!(diameter > 0)) throw new Error(`Invalid asteroid diameter: ${diameter}`);
        const finalScale = diameter / gmax;

        const geom = srcGeom.clone();
        // Center geometry to its own local center, then scale
        const gcenter = gbox.getCenter(new THREE.Vector3());
        geom.translate(-gcenter.x, -gcenter.y, -gcenter.z);
        geom.scale(finalScale, finalScale, finalScale);

        // Ensure normals/uvs are valid
        if (!geom.hasAttribute('normal')) geom.computeVertexNormals();
        if (!geom.hasAttribute('uv2') && geom.hasAttribute('uv')) {
          geom.setAttribute('uv2', geom.getAttribute('uv').clone());
        }

        // Prepare textures/materials
        const baseTexturePath = `/Asteroid_${model}_FBX/2K/Asteroid${model}`;
        const material = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 1.0,
          metalness: 0.0,
          envMapIntensity: 0.0,
          normalScale: new THREE.Vector2(1, 1),
          aoMapIntensity: 0.55,
          side: THREE.FrontSide,
          flatShading: false,
          normalMapType: THREE.TangentSpaceNormalMap,
        });

        // Load textures best-effort (non-blocking)
        const texLoader = AsteroidModel.makeTextureLoader();
        const tryTex = (url: string, apply: (t: THREE.Texture) => void) => {
          texLoader.load(url, (t) => {
            apply(t);
          }, undefined, () => {});
        };
        tryTex(`${baseTexturePath}_Color_2K.png`, (t) => {
          t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; (material as any).map = t; material.needsUpdate = true;
        });
        const normalCandidates = model.startsWith('2')
          ? [`${baseTexturePath}_NormalGL_2K.png`]
          : model === '1e'
            ? [`${baseTexturePath}_NormalOpenGL_2K.png`]
            : [`${baseTexturePath}_Normal_OpenGL_2K.png`];
        normalCandidates.forEach(p => tryTex(p, (t) => { t.colorSpace = THREE.NoColorSpace; (material as any).normalMap = t; material.needsUpdate = true; }));
        [ `${baseTexturePath}_AORM_2K.png`, `${baseTexturePath}_Mixed_AO_2K.png` ].forEach(p =>
          tryTex(p, (t) => { (material as any).aoMap = t; material.needsUpdate = true; })
        );

        this.mesh = new THREE.Mesh(geom, material);
        this.mesh.position.copy(position);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.userData.isAsteroid = true;
        this.scene.add(this.mesh);

        // Optional physics collider
        if (this.physics) {
          const posAttr = geom.getAttribute('position');
          const vertices: number[] = [];
          for (let i = 0; i < posAttr.count; i++) {
            vertices.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          }
          let indices: number[] = [];
          const idx = geom.getIndex();
          if (idx) indices = Array.from(idx.array as any); else { for (let i = 0; i < posAttr.count; i++) indices.push(i); }
          this.rigid = this.physics.createTrimeshBody(vertices, indices, true, { x: position.x, y: position.y, z: position.z });
        }
      },
      undefined,
      (err: unknown) => {
        this.log.error('Error loading asteroid model:', err instanceof Error ? err.message : err);
        }
      );
  }

  public update(): void {
    if (!this.mesh || !this.rigid) return;
    const p = this.rigid.getPosition();
    const q = this.rigid.getQuaternion();
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }

  // Advance local spin by dt seconds (optionally multiplied by a timeScale)
  public advance(dt: number, timeScale = 1): void {
    if (!this.mesh) return;
    if (!this.spinEnabled || this.spinRateRadSec === 0) return;
    const angle = this.spinRateRadSec * dt * timeScale;
    if (angle === 0) return;
    const dq = new THREE.Quaternion().setFromAxisAngle(this.spinAxis, angle);
    // Apply to current orientation
    const current = this.rigid ? this.rigid.getQuaternion() : this.mesh.quaternion;
    const q = new THREE.Quaternion(current.x, current.y, current.z, 'w' in current ? (current as any).w : this.mesh.quaternion.w);
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
    if (this.mesh) this.mesh.position.copy(pos);
  }

  public setQuaternion(q: THREE.Quaternion): void {
    if (this.rigid) this.rigid.setQuaternion(q.x, q.y, q.z, q.w);
    if (this.mesh) this.mesh.quaternion.copy(q);
  }

  public getPosition(): THREE.Vector3 | null {
    return this.mesh ? this.mesh.position.clone() : null;
  }

  public dispose(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry?.dispose?.();
      const mat = this.mesh.material as any;
      if (mat?.dispose) mat.dispose();
    }
  }
}

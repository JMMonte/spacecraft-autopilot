// Dynamic Rapier engine wrapper. Does not require the package at compile-time.
// To enable, install @dimforge/rapier3d-compat and switch engine to 'rapier'.
import type { PhysicsEngine, PhysicsInitOptions, RigidBody } from './types';

type RapierModule = any; // Avoid type dependency; resolved at runtime via dynamic import

class RapierPhysics implements PhysicsEngine {
  private RAPIER!: RapierModule;
  private world: any;
  private isStepping = false;
  private pendingOps: Array<() => void> = [];
  private bodies: Set<{ rb: any; cache: { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number }; lv: { x: number; y: number; z: number }; av: { x: number; y: number; z: number } } }> = new Set();

  constructor(RAPIER: RapierModule, opts: PhysicsInitOptions = {}) {
    this.RAPIER = RAPIER;
    const g = opts.gravity ?? { x: 0, y: 0, z: 0 };
    this.world = new RAPIER.World({ x: g.x, y: g.y, z: g.z });
    // Use Rapier's default timestep (1/60). We avoid mutating it every frame
    // to prevent re-entrancy/aliasing issues when other code queries the world.
  }

  step(_dt: number): void {
    // Avoid changing the timestep each frame; rely on Rapier's default.
    // Also prevent any re-entrant Rapier calls during stepping.
    if (this.isStepping) return;
    this.isStepping = true;
    try {
      try {
        this.world.step();
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        // Swallow aliasing/re-entrancy and wasm unreachable errors this frame to avoid hard crash.
        if (
          msg.includes('recursive use of an object') ||
          msg.includes('aliasing') ||
          msg.includes('unreachable')
        ) {
          // no-op: skip this physics tick
        } else {
          throw err;
        }
      }
    } finally {
      this.isStepping = false;
      // Refresh caches for all bodies after the step
      try {
        for (const entry of this.bodies) {
          const t = entry.rb.translation();
          const rq = entry.rb.rotation();
          const lv = entry.rb.linvel();
          const av = entry.rb.angvel();
          entry.cache.p = { x: t.x, y: t.y, z: t.z };
          entry.cache.q = { x: rq.x, y: rq.y, z: rq.z, w: rq.w };
          entry.cache.lv = { x: lv.x, y: lv.y, z: lv.z };
          entry.cache.av = { x: av.x, y: av.y, z: av.z };
        }
      } catch (_) {
        // ignore cache refresh issues
      }
      // Flush any queued ops that attempted to run during stepping
      if (this.pendingOps.length) {
        const ops = this.pendingOps.splice(0, this.pendingOps.length);
        for (const op of ops) {
          try { op(); } catch (_) {}
        }
      }
    }
  }

  setGravity(x: number, y: number, z: number): void {
    this.world.gravity = { x, y, z };
  }

  getNativeWorld(): unknown {
    return this.world;
  }

  createBoxBody(halfExtents: { x: number; y: number; z: number }, mass: number): RigidBody {
    // In Rapier, bodies and colliders are separate. Use a dynamic body for mass > 0 else fixed.
    const { RAPIER, world } = this;
    const self = this;
    const rbDesc = mass > 0 ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    const rb = world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const col = world.createCollider(colDesc, rb);
    const entry = { rb, cache: { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, lv: { x: 0, y: 0, z: 0 }, av: { x: 0, y: 0, z: 0 } } };
    this.bodies.add(entry);
    if (mass > 0) {
      // Rapier mass is derived from collider density. Set density so total mass approximates input.
      // For a cuboid, mass = density * volume. volume = 8 * hx * hy * hz.
      const volume = 8 * halfExtents.x * halfExtents.y * halfExtents.z;
      const density = volume > 0 ? mass / volume : 1;
      col.setDensity(density);
    }
    const wrapper: RigidBody = {
      setPosition: (x, y, z) => {
        const fn = () => { try { rb.setTranslation({ x, y, z }, true); } catch (_) {} };
        // Keep cache coherent even if we defer the native call
        entry.cache.p = { x, y, z };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      setQuaternion: (x, y, z, w) => {
        const fn = () => { try { rb.setRotation({ x, y, z, w }, true); } catch (_) {} };
        entry.cache.q = { x, y, z, w } as any;
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      getPosition: () => {
        // Always serve from cache to avoid re-entrancy into WASM during renders
        return { ...entry.cache.p };
      },
      getQuaternion: () => {
        return { ...entry.cache.q } as any;
      },
      setMass(newMass: number) {
        const vol = 8 * halfExtents.x * halfExtents.y * halfExtents.z;
        const dens = vol > 0 ? newMass / vol : 1;
        col.setDensity(dens);
      },
      getMass() { return col.mass(); },
      setDamping: (linear: number, angular: number) => { const fn = () => { try { rb.setLinearDamping(linear); rb.setAngularDamping(angular); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      applyForce: (force, worldPoint) => {
        const fn = () => { try { if (worldPoint) rb.addForceAtPoint(force, worldPoint, true); else rb.addForce(force, true); } catch (_) {} };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      applyImpulse: (impulse, worldPoint) => {
        const fn = () => { try { if (worldPoint) rb.applyImpulseAtPoint(impulse, worldPoint, true); else rb.applyImpulse(impulse, true); } catch (_) {} };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      getLinearVelocity: () => {
        return { ...entry.cache.lv };
      },
      setLinearVelocity: (v) => { entry.cache.lv = { ...v }; const fn = () => { try { rb.setLinvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getAngularVelocity: () => {
        return { ...entry.cache.av };
      },
      setAngularVelocity: (v) => { entry.cache.av = { ...v }; const fn = () => { try { rb.setAngvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getNative() { return rb; }
    };
    return wrapper;
  }

  createTrimeshBody(
    vertices: number[] | Float32Array,
    indices: number[] | Uint32Array,
    isStatic: boolean,
    position?: { x: number; y: number; z: number }
  ): RigidBody {
    const R = this.RAPIER;
    const self = this;
    const verts = (vertices instanceof Float32Array) ? vertices : new Float32Array(vertices as number[]);
    const inds = (indices instanceof Uint32Array) ? indices : new Uint32Array(indices as number[]);
    const rbDesc = isStatic ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
    if (position) rbDesc.setTranslation(position.x, position.y, position.z);
    const rb = this.world.createRigidBody(rbDesc);
    const colDesc = R.ColliderDesc.trimesh(verts, inds);
    this.world.createCollider(colDesc, rb);
    const entry = { rb, cache: { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, lv: { x: 0, y: 0, z: 0 }, av: { x: 0, y: 0, z: 0 } } };
    this.bodies.add(entry);
    // Wrap as RigidBody
    const wrapper: RigidBody = {
      setPosition: (x, y, z) => { entry.cache.p = { x, y, z }; const fn = () => { try { rb.setTranslation({ x, y, z }, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      setQuaternion: (x, y, z, w) => { entry.cache.q = { x, y, z, w } as any; const fn = () => { try { rb.setRotation({ x, y, z, w }, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getPosition: () => { return { ...entry.cache.p }; },
      getQuaternion: () => { return { ...entry.cache.q } as any; },
      setMass(_newMass: number) { /* density-based; static by design */ },
      getMass() { return isStatic ? 0 : (rb.mass ? rb.mass() : 1); },
      setDamping: (l, a) => { const fn = () => { try { rb.setLinearDamping(l); rb.setAngularDamping(a); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      applyForce: (force, worldPoint) => { const fn = () => { try { if (worldPoint) rb.addForceAtPoint(force, worldPoint, true); else rb.addForce(force, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      applyImpulse: (impulse, worldPoint) => { const fn = () => { try { if (worldPoint) rb.applyImpulseAtPoint(impulse, worldPoint, true); else rb.applyImpulse(impulse, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getLinearVelocity: () => { return { ...entry.cache.lv }; },
      setLinearVelocity: (v) => { entry.cache.lv = { ...v }; const fn = () => { try { rb.setLinvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getAngularVelocity: () => { return { ...entry.cache.av }; },
      setAngularVelocity: (v) => { entry.cache.av = { ...v }; const fn = () => { try { rb.setAngvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getNative() { return rb; }
    };
    return wrapper;
  }

  createFixedConstraint(a: RigidBody, b: RigidBody, options?: {
    frameA?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; w: number } };
    frameB?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; w: number } };
  }): unknown {
    const rbA = a.getNative<any>();
    const rbB = b.getNative<any>();
    const posA = options?.frameA?.position ?? { x: 0, y: 0, z: 0 };
    const rotA = options?.frameA?.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const posB = options?.frameB?.position ?? { x: 0, y: 0, z: 0 };
    const rotB = options?.frameB?.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const jd = this.RAPIER.JointData.fixed(posA, rotA, posB, rotB);
    // Impulse joint API (preferred)
    if (typeof this.world.createImpulseJoint === 'function') {
      return this.world.createImpulseJoint(jd, rbA, rbB, true);
    }
    // Fallback
    if (typeof this.world.createJoint === 'function') {
      return this.world.createJoint(jd, rbA, rbB);
    }
    throw new Error('Rapier world does not support joint creation');
  }

  removeConstraint(handle: unknown): void {
    if (!handle) return;
    try {
      if (typeof this.world.removeImpulseJoint === 'function') {
        this.world.removeImpulseJoint(handle);
        return;
      }
      if (typeof (handle as any).detach === 'function') {
        (handle as any).detach();
        return;
      }
      if (typeof this.world.removeJoint === 'function') {
        this.world.removeJoint(handle);
      }
    } catch (_) {}
  }

  // Attach a cylinder collider to an existing rigid body.
  // length corresponds to the full height of the cylinder before rotation.
  attachCylinderCollider(
    body: RigidBody,
    radius: number,
    length: number,
    options?: {
      translation?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number; w: number };
      isSensor?: boolean;
      restitution?: number;
      friction?: number;
    }
  ): unknown {
    try {
      const rb = body.getNative<any>();
      const halfHeight = Math.max(0.0001, length / 2);
      const cd = this.RAPIER.ColliderDesc.cylinder(halfHeight, Math.max(0.0001, radius));
      if (options?.translation) {
        cd.setTranslation(options.translation.x, options.translation.y, options.translation.z);
      }
      if (options?.rotation) {
        cd.setRotation(options.rotation);
      }
      if (typeof options?.isSensor === 'boolean') cd.setSensor(options.isSensor);
      if (typeof options?.restitution === 'number') cd.setRestitution(options.restitution);
      if (typeof options?.friction === 'number') cd.setFriction(options.friction);
      const collider = this.world.createCollider(cd, rb);
      return collider;
    } catch (_) {
      return undefined;
    }
  }

  removeCollider(handle: unknown): void {
    try {
      if (!handle) return;
      if (typeof this.world.removeCollider === 'function') {
        this.world.removeCollider(handle as any, true);
      } else if ((handle as any).parent && typeof (handle as any).parent === 'object') {
        // Fallback: try to detach from parent rigid body if API differs
        (handle as any).parent?.removeCollider?.(handle);
      }
    } catch (_) {}
  }
}

export async function createRapierPhysics(opts: PhysicsInitOptions = {}): Promise<PhysicsEngine> {
  try {
    // Prefer compat build for ESM
    const RAPIER = await import('@dimforge/rapier3d-compat');
    if ((RAPIER as any).init) {
      // Initialize Rapier. Prefer no-arg init to avoid deprecation warnings
      // across minor versions that changed the init signature.
      await (RAPIER as any).init({});
    }
    return new RapierPhysics(RAPIER, opts);
  } catch (e) {
    throw new Error(
      'Rapier is not installed. Please install "@dimforge/rapier3d-compat" and try again.\n' +
      `Original error: ${(e as Error).message}`
    );
  }
}

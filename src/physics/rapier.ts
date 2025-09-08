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
  private warnedAlias = false;
  private warnedUnreachable = false;

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
    let skipPostStep = false;
    try {
      try {
        this.world.step();
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        // Swallow aliasing/re-entrancy and wasm unreachable errors this frame to avoid hard crash.
        if (
          msg.includes('recursive use of an object') ||
          msg.includes('aliasing') ||
          msg.includes('unreachable') ||
          msg.includes('memory access out of bounds') ||
          msg.includes('Maximum call stack size exceeded') ||
          msg.includes('call stack size exceeded')
        ) {
          // no-op: skip this physics tick
          skipPostStep = true;
          if ((msg.includes('aliasing') || msg.includes('recursive')) && !this.warnedAlias) {
            this.warnedAlias = true;
            try { console.warn('[Rapier] Physics tick skipped due to re-entrancy/aliasing. Ensure no Rapier calls during step.'); } catch (_) {}
          }
          if (msg.includes('unreachable') && !this.warnedUnreachable) {
            this.warnedUnreachable = true;
            try { console.warn('[Rapier] Physics tick skipped due to WASM unreachable (likely NaN/invalid input). Sanitizing inputs or clamping forces may help.'); } catch (_) {}
          }
          if (msg.includes('memory access out of bounds')) {
            try { console.warn('[Rapier] Physics tick skipped due to WASM memory OOB. This typically indicates an invalid joint/collider or NaN state.'); } catch (_) {}
          }
          if (msg.includes('call stack size exceeded')) {
            try { console.warn('[Rapier] Physics tick skipped due to WASM stack overflow. Likely caused by unstable solver state or degenerate constraints.'); } catch (_) {}
          }
        } else {
          throw err;
        }
      }
    } finally {
      // Only refresh caches and flush queued ops if the step completed without a WASM error
      if (!skipPostStep) {
        // Refresh caches for all bodies after the step (keep isStepping true
        // until after we finish cache refresh + pending ops flush to avoid
        // re-entrancy during this critical section)
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
      this.isStepping = false;
    }
  }

  setGravity(x: number, y: number, z: number): void {
    const gx = Number.isFinite(x) ? x : 0;
    const gy = Number.isFinite(y) ? y : 0;
    const gz = Number.isFinite(z) ? z : 0;
    this.world.gravity = { x: gx, y: gy, z: gz };
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
    // Prevent Rapier from auto-sleeping our actively-controlled spacecraft.
    // Sleeping can look like the simulation "stops" if subsequent forces are small.
    if (mass > 0 && typeof rb.setCanSleep === 'function') {
      try { rb.setCanSleep(false); } catch (_) {}
    }
    const hx = Math.max(1e-5, Math.abs(halfExtents.x));
    const hy = Math.max(1e-5, Math.abs(halfExtents.y));
    const hz = Math.max(1e-5, Math.abs(halfExtents.z));
    const colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    const col = world.createCollider(colDesc, rb);
    const entry = { rb, cache: { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, lv: { x: 0, y: 0, z: 0 }, av: { x: 0, y: 0, z: 0 } } };
    this.bodies.add(entry);
    if (mass > 0) {
      // Rapier mass is derived from collider density. Set density so total mass approximates input.
      // For a cuboid, mass = density * volume. volume = 8 * hx * hy * hz.
      const volume = 8 * hx * hy * hz;
      const density = volume > 0 ? mass / volume : 1;
      col.setDensity(density);
    }
    const isFiniteVec3 = (v: any) => Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.z);
    const isFiniteQuat = (q: any) => Number.isFinite(q?.x) && Number.isFinite(q?.y) && Number.isFinite(q?.z) && Number.isFinite(q?.w);
    const wrapper: RigidBody = {
      setPosition: (x, y, z) => {
        const fn = () => { try { if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) rb.setTranslation({ x, y, z }, true); } catch (_) {} };
        // Keep cache coherent even if we defer the native call
        entry.cache.p = { x, y, z };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      setQuaternion: (x, y, z, w) => {
        const fn = () => { try { if (isFiniteQuat({ x, y, z, w })) rb.setRotation({ x, y, z, w }, true); } catch (_) {} };
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
        const fn = () => { try { if (!isFiniteVec3(force)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; if (worldPoint) rb.addForceAtPoint(force, worldPoint, true); else rb.addForce(force, true); } catch (_) {} };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      applyImpulse: (impulse, worldPoint) => {
        const fn = () => { try { if (!isFiniteVec3(impulse)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; if (worldPoint) rb.applyImpulseAtPoint(impulse, worldPoint, true); else rb.applyImpulse(impulse, true); } catch (_) {} };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      getLinearVelocity: () => {
        return { ...entry.cache.lv };
      },
      setLinearVelocity: (v) => { entry.cache.lv = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) rb.setLinvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getAngularVelocity: () => {
        return { ...entry.cache.av };
      },
      setAngularVelocity: (v) => { entry.cache.av = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) rb.setAngvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
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
    const vertsSrc = (vertices instanceof Float32Array) ? vertices : new Float32Array(vertices as number[]);
    // Sanitize vertices: ensure finite numbers and pad to multiple of 3
    const verts: Float32Array = (() => {
      const out = new Float32Array(vertsSrc.length - (vertsSrc.length % 3));
      for (let i = 0; i < out.length; i++) {
        const v = vertsSrc[i];
        out[i] = Number.isFinite(v) ? v : 0;
      }
      return out;
    })();
    const vertCount = Math.max(0, Math.floor(verts.length / 3));
    // Start from provided indices (or sequential) and sanitize to valid, non-degenerate triangles
    const rawInds = (indices instanceof Uint32Array) ? indices : new Uint32Array(indices as number[]);
    const tmp: number[] = [];
    const limit = Math.floor(rawInds.length / 3) * 3;
    for (let i = 0; i < limit; i += 3) {
      let a = rawInds[i] | 0, b = rawInds[i + 1] | 0, c = rawInds[i + 2] | 0;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
      if (a < 0 || b < 0 || c < 0) continue;
      if (a >= vertCount || b >= vertCount || c >= vertCount) continue;
      if (a === b || b === c || a === c) continue; // degenerate
      tmp.push(a, b, c);
    }
    // If no indices were valid and geometry is non-indexed, attempt sequential triangles
    if (tmp.length === 0 && vertCount >= 3) {
      const triCount = Math.floor(vertCount / 3);
      for (let t = 0; t < triCount; t++) {
        const base = t * 3;
        tmp.push(base, base + 1, base + 2);
      }
    }
    const inds = new Uint32Array(tmp);
    const rbDesc = isStatic ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
    if (position) rbDesc.setTranslation(position.x, position.y, position.z);
    const rb = this.world.createRigidBody(rbDesc);
    if (!isStatic && typeof rb.setCanSleep === 'function') {
      try { rb.setCanSleep(false); } catch (_) {}
    }
    // If sanitized indices are empty, fall back to an AABB cuboid collider to avoid WASM crashes
    if (inds.length >= 3) {
      try {
        const colDesc = R.ColliderDesc.trimesh(verts, inds);
        this.world.createCollider(colDesc, rb);
      } catch (_) {
        // Fallback to cuboid using bounds
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < verts.length; i += 3) {
          const x = verts[i], y = verts[i + 1], z = verts[i + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        const hx = Math.max(1e-3, (maxX - minX) * 0.5);
        const hy = Math.max(1e-3, (maxY - minY) * 0.5);
        const hz = Math.max(1e-3, (maxZ - minZ) * 0.5);
        const cd = R.ColliderDesc.cuboid(hx, hy, hz);
        this.world.createCollider(cd, rb);
      }
    } else {
      // Fallback immediately
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < verts.length; i += 3) {
        const x = verts[i], y = verts[i + 1], z = verts[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const hx = Math.max(1e-3, (maxX - minX) * 0.5);
      const hy = Math.max(1e-3, (maxY - minY) * 0.5);
      const hz = Math.max(1e-3, (maxZ - minZ) * 0.5);
      const cd = R.ColliderDesc.cuboid(hx, hy, hz);
      this.world.createCollider(cd, rb);
    }
    const entry = { rb, cache: { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, lv: { x: 0, y: 0, z: 0 }, av: { x: 0, y: 0, z: 0 } } };
    this.bodies.add(entry);
    // Wrap as RigidBody
    const isFiniteVec3 = (v: any) => Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.z);
    const isFiniteQuat = (q: any) => Number.isFinite(q?.x) && Number.isFinite(q?.y) && Number.isFinite(q?.z) && Number.isFinite(q?.w);
    const wrapper: RigidBody = {
      setPosition: (x, y, z) => { entry.cache.p = { x, y, z }; const fn = () => { try { if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) rb.setTranslation({ x, y, z }, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      setQuaternion: (x, y, z, w) => { entry.cache.q = { x, y, z, w } as any; const fn = () => { try { if (isFiniteQuat({ x, y, z, w })) rb.setRotation({ x, y, z, w }, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getPosition: () => { return { ...entry.cache.p }; },
      getQuaternion: () => { return { ...entry.cache.q } as any; },
      setMass(_newMass: number) { /* density-based; static by design */ },
      getMass() { return isStatic ? 0 : (rb.mass ? rb.mass() : 1); },
      setDamping: (l, a) => { const fn = () => { try { rb.setLinearDamping(l); rb.setAngularDamping(a); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      applyForce: (force, worldPoint) => { const fn = () => { try { if (!isFiniteVec3(force)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; if (worldPoint) rb.addForceAtPoint(force, worldPoint, true); else rb.addForce(force, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      applyImpulse: (impulse, worldPoint) => { const fn = () => { try { if (!isFiniteVec3(impulse)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; if (worldPoint) rb.applyImpulseAtPoint(impulse, worldPoint, true); else rb.applyImpulse(impulse, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getLinearVelocity: () => { return { ...entry.cache.lv }; },
      setLinearVelocity: (v) => { entry.cache.lv = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) rb.setLinvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getAngularVelocity: () => { return { ...entry.cache.av }; },
      setAngularVelocity: (v) => { entry.cache.av = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) rb.setAngvel(v, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getNative() { return rb; }
    };
    return wrapper;
  }

  createFixedConstraint(a: RigidBody, b: RigidBody, options?: {
    frameA?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; w: number } };
    frameB?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; w: number } };
  }): unknown {
    const rbA = a?.getNative<any>();
    const rbB = b?.getNative<any>();
    if (!rbA || !rbB) return undefined;
    const posAin = options?.frameA?.position ?? { x: 0, y: 0, z: 0 };
    const rotAin = options?.frameA?.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const posBin = options?.frameB?.position ?? { x: 0, y: 0, z: 0 };
    const rotBin = options?.frameB?.rotation ?? { x: 0, y: 0, z: 0, w: 1 };

    const sanitizeVec3 = (v: any) => ({
      x: Number.isFinite(v?.x) ? v.x : 0,
      y: Number.isFinite(v?.y) ? v.y : 0,
      z: Number.isFinite(v?.z) ? v.z : 0,
    });
    const normalizeQuat = (q: any) => {
      const x = Number.isFinite(q?.x) ? q.x : 0;
      const y = Number.isFinite(q?.y) ? q.y : 0;
      const z = Number.isFinite(q?.z) ? q.z : 0;
      const w = Number.isFinite(q?.w) ? q.w : 1;
      const len = Math.hypot(x, y, z, w) || 1;
      return { x: x / len, y: y / len, z: z / len, w: w / len };
    };

    const posA = sanitizeVec3(posAin);
    const posB = sanitizeVec3(posBin);
    const rotA = normalizeQuat(rotAin);
    const rotB = normalizeQuat(rotBin);

    const jd = this.RAPIER.JointData.fixed(posA, rotA, posB, rotB);
    // Impulse joint API (preferred)
    if (typeof this.world.createImpulseJoint === 'function') {
      try { return this.world.createImpulseJoint(jd, rbA, rbB, true); } catch (_) { /* fall through */ }
    }
    // Fallback
    if (typeof this.world.createJoint === 'function') {
      try { return this.world.createJoint(jd, rbA, rbB); } catch (_) { /* fall through */ }
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
      const halfHeight = Math.max(0.0001, Math.abs(length) / 2);
      const cd = this.RAPIER.ColliderDesc.cylinder(halfHeight, Math.max(0.0001, Math.abs(radius)));
      if (options?.translation) {
        const tx = Number.isFinite(options.translation.x) ? options.translation.x : 0;
        const ty = Number.isFinite(options.translation.y) ? options.translation.y : 0;
        const tz = Number.isFinite(options.translation.z) ? options.translation.z : 0;
        cd.setTranslation(tx, ty, tz);
      }
      if (options?.rotation) {
        const r = options.rotation;
        const rx = Number.isFinite(r.x) ? r.x : 0;
        const ry = Number.isFinite(r.y) ? r.y : 0;
        const rz = Number.isFinite(r.z) ? r.z : 0;
        const rw = Number.isFinite(r.w) ? r.w : 1;
        cd.setRotation({ x: rx, y: ry, z: rz, w: rw });
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

// Dynamic Rapier engine wrapper. Does not require the package at compile-time.
// To enable, install @dimforge/rapier3d-compat and switch engine to 'rapier'.
import type { PhysicsEngine, PhysicsInitOptions, RigidBody } from './types';

type RapierModule = any; // Avoid type dependency; resolved at runtime via dynamic import

class RapierPhysics implements PhysicsEngine {
  private RAPIER!: RapierModule;
  private world: any;
  private isStepping = false;
  private pendingOps: Array<() => void> = [];
  private afterStepOps: Array<() => void> = [];
  private bodies: Set<{ rb: any; cache: { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number }; lv: { x: number; y: number; z: number }; av: { x: number; y: number; z: number } } }> = new Set();
  private constraints: Set<any> = new Set();
  private warnedAlias = false;
  private warnedUnreachable = false;
  private skipStreak = 0;

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
      // Refresh caches after a successful step
      if (!skipPostStep) {
        this.skipStreak = 0;
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
        } catch (_) {}
      } else {
        // Failed step: drop queued ops and attempt recovery after a short streak
        this.skipStreak++;
        if (this.pendingOps.length) this.pendingOps.splice(0, this.pendingOps.length);
        // Sanitize caches to finite values to prevent propagating NaNs
        try {
          for (const entry of this.bodies) {
            const p = entry.cache.p, q = entry.cache.q, lv = entry.cache.lv, av = entry.cache.av;
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
              entry.cache.p = { x: 0, y: 0, z: 0 };
            }
            const nqw = Math.hypot(q.x, q.y, q.z, q.w) || 1;
            if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w) || Math.abs(nqw - 1) > 1e3) {
              entry.cache.q = { x: 0, y: 0, z: 0, w: 1 };
            }
            if (!Number.isFinite(lv.x) || !Number.isFinite(lv.y) || !Number.isFinite(lv.z)) {
              entry.cache.lv = { x: 0, y: 0, z: 0 };
            }
            if (!Number.isFinite(av.x) || !Number.isFinite(av.y) || !Number.isFinite(av.z)) {
              entry.cache.av = { x: 0, y: 0, z: 0 };
            }
          }
        } catch (_) {}
        if (this.skipStreak >= 5) {
          // Schedule recovery ops to run after we exit stepping
          this.afterStepOps.push(() => {
            try {
              for (const entry of this.bodies) {
                try { entry.rb.setLinvel({ x: 0, y: 0, z: 0 }, true); } catch (_) {}
                try { entry.rb.setAngvel({ x: 0, y: 0, z: 0 }, true); } catch (_) {}
              }
              try { console.warn('[Rapier] Recovery: zeroed all body velocities after repeated step failures.'); } catch (_) {}
              if (this.constraints.size) {
                for (const h of Array.from(this.constraints)) {
                  try {
                    if (typeof this.world.removeImpulseJoint === 'function') this.world.removeImpulseJoint(h);
                    else if (typeof this.world.removeJoint === 'function') this.world.removeJoint(h);
                  } catch (_) {}
                  this.constraints.delete(h);
                }
                try { console.warn('[Rapier] Recovery: cleared all constraints.'); } catch (_) {}
              }
            } catch (_) {}
          });
          this.skipStreak = 0;
        }
      }
      // Allow pending ops to run outside the stepping window
      this.isStepping = false;
      if (this.afterStepOps.length) {
        const ops = this.afterStepOps.splice(0, this.afterStepOps.length);
        for (const op of ops) { try { op(); } catch (_) {} }
      }
      if (this.pendingOps.length) {
        const ops = this.pendingOps.splice(0, this.pendingOps.length);
        for (const op of ops) {
          try { op(); } catch (_) {}
        }
      }
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
    // Enable CCD when available to reduce deep penetrations/tunneling instability
    try {
      if (typeof rb.setCcdEnabled === 'function') { rb.setCcdEnabled(true); }
      else if (typeof rb.enableCcd === 'function') { rb.enableCcd(true); }
    } catch (_) {}
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
    const clampVec3 = (v: { x: number; y: number; z: number }, maxLen = 1e5) => {
      const m2 = v.x * v.x + v.y * v.y + v.z * v.z;
      if (m2 > maxLen * maxLen) {
        const m = Math.sqrt(m2) || 1;
        const s = maxLen / m;
        return { x: v.x * s, y: v.y * s, z: v.z * s };
      }
      return v;
    };
    const clampPos = (v: { x: number; y: number; z: number }, maxAbs = 1e6) => ({
      x: Math.max(-maxAbs, Math.min(maxAbs, v.x)),
      y: Math.max(-maxAbs, Math.min(maxAbs, v.y)),
      z: Math.max(-maxAbs, Math.min(maxAbs, v.z)),
    });
    const normalizeQuat = (q: { x: number; y: number; z: number; w: number }) => {
      const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
      return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
    };
    const wrapper: RigidBody = {
      setPosition: (x, y, z) => {
        const fn = () => { try { if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) { const p = clampPos({ x, y, z }); rb.setTranslation(p, true); } } catch (_) {} };
        // Keep cache coherent even if we defer the native call
        entry.cache.p = { x, y, z };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      setQuaternion: (x, y, z, w) => {
        const fn = () => { try { if (isFiniteQuat({ x, y, z, w })) { const q = normalizeQuat({ x, y, z, w }); rb.setRotation(q, true); } } catch (_) {} };
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
        const fn = () => { try { if (!isFiniteVec3(force)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; const f = clampVec3(force, 1e6); if (worldPoint) rb.addForceAtPoint(f, worldPoint, true); else rb.addForce(f, true); } catch (_) {} };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      applyImpulse: (impulse, worldPoint) => {
        const fn = () => { try { if (!isFiniteVec3(impulse)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; const J = clampVec3(impulse, 1e6); if (worldPoint) rb.applyImpulseAtPoint(J, worldPoint, true); else rb.applyImpulse(J, true); } catch (_) {} };
        self.isStepping ? self.pendingOps.push(fn) : fn();
      },
      getLinearVelocity: () => {
        return { ...entry.cache.lv };
      },
      setLinearVelocity: (v) => { entry.cache.lv = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) { const vv = clampVec3(v); rb.setLinvel(vv, true); } } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getAngularVelocity: () => {
        return { ...entry.cache.av };
      },
      setAngularVelocity: (v) => { entry.cache.av = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) { const vv = clampVec3(v, 1e4); rb.setAngvel(vv, true); } } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
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
        // Treat large environment meshes as sensors to avoid heavy contact resolution
        try { colDesc.setSensor(true); } catch (_) {}
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
        try { cd.setSensor(true); } catch (_) {}
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
      try { cd.setSensor(true); } catch (_) {}
      this.world.createCollider(cd, rb);
    }
    const entry = { rb, cache: { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, lv: { x: 0, y: 0, z: 0 }, av: { x: 0, y: 0, z: 0 } } };
    this.bodies.add(entry);
    // Wrap as RigidBody
    const isFiniteVec3 = (v: any) => Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.z);
    const isFiniteQuat = (q: any) => Number.isFinite(q?.x) && Number.isFinite(q?.y) && Number.isFinite(q?.z) && Number.isFinite(q?.w);
    const clampVec3 = (v: { x: number; y: number; z: number }, maxLen = 1e5) => {
      const m2 = v.x * v.x + v.y * v.y + v.z * v.z;
      if (m2 > maxLen * maxLen) {
        const m = Math.sqrt(m2) || 1;
        const s = maxLen / m;
        return { x: v.x * s, y: v.y * s, z: v.z * s };
      }
      return v;
    };
    const clampPos = (v: { x: number; y: number; z: number }, maxAbs = 1e6) => ({
      x: Math.max(-maxAbs, Math.min(maxAbs, v.x)),
      y: Math.max(-maxAbs, Math.min(maxAbs, v.y)),
      z: Math.max(-maxAbs, Math.min(maxAbs, v.z)),
    });
    const normalizeQuat = (q: { x: number; y: number; z: number; w: number }) => {
      const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
      return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
    };
    const wrapper: RigidBody = {
      setPosition: (x, y, z) => { entry.cache.p = { x, y, z }; const fn = () => { try { if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) { const p = clampPos({ x, y, z }); rb.setTranslation(p, true); } } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      setQuaternion: (x, y, z, w) => { entry.cache.q = { x, y, z, w } as any; const fn = () => { try { if (isFiniteQuat({ x, y, z, w })) { const qn = normalizeQuat({ x, y, z, w }); rb.setRotation(qn, true); } } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getPosition: () => { return { ...entry.cache.p }; },
      getQuaternion: () => { return { ...entry.cache.q } as any; },
      setMass(_newMass: number) { /* density-based; static by design */ },
      getMass() { return isStatic ? 0 : (rb.mass ? rb.mass() : 1); },
      setDamping: (l, a) => { const fn = () => { try { rb.setLinearDamping(l); rb.setAngularDamping(a); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      applyForce: (force, worldPoint) => { const fn = () => { try { if (!isFiniteVec3(force)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; const f = clampVec3(force, 1e6); if (worldPoint) rb.addForceAtPoint(f, worldPoint, true); else rb.addForce(f, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      applyImpulse: (impulse, worldPoint) => { const fn = () => { try { if (!isFiniteVec3(impulse)) return; if (worldPoint && !isFiniteVec3(worldPoint)) return; const J = clampVec3(impulse, 1e6); if (worldPoint) rb.applyImpulseAtPoint(J, worldPoint, true); else rb.applyImpulse(J, true); } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getLinearVelocity: () => { return { ...entry.cache.lv }; },
      setLinearVelocity: (v) => { entry.cache.lv = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) { const vv = clampVec3(v); rb.setLinvel(vv, true); } } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
      getAngularVelocity: () => { return { ...entry.cache.av }; },
      setAngularVelocity: (v) => { entry.cache.av = { ...v }; const fn = () => { try { if (isFiniteVec3(v)) { const vv = clampVec3(v, 1e4); rb.setAngvel(vv, true); } } catch (_) {} }; self.isStepping ? self.pendingOps.push(fn) : fn(); },
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
      try { const h = this.world.createImpulseJoint(jd, rbA, rbB, true); this.constraints.add(h); return h; } catch (_) { /* fall through */ }
    }
    // Fallback
    if (typeof this.world.createJoint === 'function') {
      try { const h = this.world.createJoint(jd, rbA, rbB); this.constraints.add(h); return h; } catch (_) { /* fall through */ }
    }
    throw new Error('Rapier world does not support joint creation');
  }

  removeConstraint(handle: unknown): void {
    if (!handle) return;
    try {
      if (typeof this.world.removeImpulseJoint === 'function') {
        this.world.removeImpulseJoint(handle);
        this.constraints.delete(handle);
        return;
      }
      if (typeof (handle as any).detach === 'function') {
        (handle as any).detach();
        this.constraints.delete(handle);
        return;
      }
      if (typeof this.world.removeJoint === 'function') {
        this.world.removeJoint(handle);
        this.constraints.delete(handle);
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
      await (RAPIER as any).init();
    }
    return new RapierPhysics(RAPIER, opts);
  } catch (e) {
    throw new Error(
      'Rapier is not installed. Please install "@dimforge/rapier3d-compat" and try again.\n' +
      `Original error: ${(e as Error).message}`
    );
  }
}

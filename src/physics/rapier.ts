// Dynamic Rapier engine wrapper. Does not require the package at compile-time.
// To enable, install @dimforge/rapier3d-compat and switch engine to 'rapier'.
import type { PhysicsEngine, PhysicsInitOptions, RigidBody } from './types';

type RapierModule = any; // Avoid type dependency; resolved at runtime via dynamic import

class RapierPhysics implements PhysicsEngine {
  private RAPIER!: RapierModule;
  private world: any;

  constructor(RAPIER: RapierModule, opts: PhysicsInitOptions = {}) {
    this.RAPIER = RAPIER;
    const g = opts.gravity ?? { x: 0, y: 0, z: 0 };
    this.world = new RAPIER.World({ x: g.x, y: g.y, z: g.z });
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
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
    const rbDesc = mass > 0 ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    const rb = world.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const col = world.createCollider(colDesc, rb);
    if (mass > 0) {
      // Rapier mass is derived from collider density. Set density so total mass approximates input.
      // For a cuboid, mass = density * volume. volume = 8 * hx * hy * hz.
      const volume = 8 * halfExtents.x * halfExtents.y * halfExtents.z;
      const density = volume > 0 ? mass / volume : 1;
      col.setDensity(density);
    }
    const wrapper: RigidBody = {
      setPosition(x, y, z) { rb.setTranslation({ x, y, z }, true); },
      setQuaternion(x, y, z, w) { rb.setRotation({ x, y, z, w }, true); },
      getPosition() { const t = rb.translation(); return { x: t.x, y: t.y, z: t.z }; },
      getQuaternion() { const q = rb.rotation(); return { x: q.x, y: q.y, z: q.z, w: q.w }; },
      setMass(newMass: number) {
        const vol = 8 * halfExtents.x * halfExtents.y * halfExtents.z;
        const dens = vol > 0 ? newMass / vol : 1;
        col.setDensity(dens);
      },
      getMass() { return col.mass(); },
      setDamping(linear: number, angular: number) { rb.setLinearDamping(linear); rb.setAngularDamping(angular); },
      applyForce(force, worldPoint) {
        if (worldPoint) {
          rb.addForceAtPoint(force, worldPoint, true);
        } else {
          rb.addForce(force, true);
        }
      },
      applyImpulse(impulse, worldPoint) {
        if (worldPoint) {
          rb.applyImpulseAtPoint(impulse, worldPoint, true);
        } else {
          rb.applyImpulse(impulse, true);
        }
      },
      getLinearVelocity() { const v = rb.linvel(); return { x: v.x, y: v.y, z: v.z }; },
      setLinearVelocity(v) { rb.setLinvel(v, true); },
      getAngularVelocity() { const v = rb.angvel(); return { x: v.x, y: v.y, z: v.z }; },
      setAngularVelocity(v) { rb.setAngvel(v, true); },
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
    const verts = (vertices instanceof Float32Array) ? vertices : new Float32Array(vertices as number[]);
    const inds = (indices instanceof Uint32Array) ? indices : new Uint32Array(indices as number[]);
    const rbDesc = isStatic ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
    if (position) rbDesc.setTranslation(position.x, position.y, position.z);
    const rb = this.world.createRigidBody(rbDesc);
    const colDesc = R.ColliderDesc.trimesh(verts, inds);
    this.world.createCollider(colDesc, rb);
    // Wrap as RigidBody
    const wrapper: RigidBody = {
      setPosition(x, y, z) { rb.setTranslation({ x, y, z }, true); },
      setQuaternion(x, y, z, w) { rb.setRotation({ x, y, z, w }, true); },
      getPosition() { const t = rb.translation(); return { x: t.x, y: t.y, z: t.z }; },
      getQuaternion() { const q = rb.rotation(); return { x: q.x, y: q.y, z: q.z, w: q.w }; },
      setMass(_newMass: number) { /* density-based; static by design */ },
      getMass() { return isStatic ? 0 : (rb.mass ? rb.mass() : 1); },
      setDamping(l, a) { rb.setLinearDamping(l); rb.setAngularDamping(a); },
      applyForce(force, worldPoint) { if (worldPoint) rb.addForceAtPoint(force, worldPoint, true); else rb.addForce(force, true); },
      applyImpulse(impulse, worldPoint) { if (worldPoint) rb.applyImpulseAtPoint(impulse, worldPoint, true); else rb.applyImpulse(impulse, true); },
      getLinearVelocity() { const v = rb.linvel(); return { x: v.x, y: v.y, z: v.z }; },
      setLinearVelocity(v) { rb.setLinvel(v, true); },
      getAngularVelocity() { const v = rb.angvel(); return { x: v.x, y: v.y, z: v.z }; },
      setAngularVelocity(v) { rb.setAngvel(v, true); },
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
    if (RAPIER.init) {
      await RAPIER.init();
    }
    return new RapierPhysics(RAPIER, opts);
  } catch (e) {
    throw new Error(
      'Rapier is not installed. Please install "@dimforge/rapier3d-compat" and try again.\n' +
      `Original error: ${(e as Error).message}`
    );
  }
}

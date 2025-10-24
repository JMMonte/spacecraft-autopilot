export type PhysicsInitOptions = {
  gravity?: { x: number; y: number; z: number };
};

export interface RigidBody {
  setPosition(x: number, y: number, z: number): void;
  setQuaternion(x: number, y: number, z: number, w: number): void;
  getPosition(): { x: number; y: number; z: number };
  getQuaternion(): { x: number; y: number; z: number; w: number };
  setMass(mass: number): void;
  getMass(): number;
  setDamping(linear: number, angular: number): void;
  applyForce(force: { x: number; y: number; z: number }, worldPoint?: { x: number; y: number; z: number }): void;
  applyLocalForce?(force: { x: number; y: number; z: number }): void;
  applyImpulse(impulse: { x: number; y: number; z: number }, worldPoint?: { x: number; y: number; z: number }): void;
  applyLocalImpulse?(impulse: { x: number; y: number; z: number }): void;
  getLinearVelocity(): { x: number; y: number; z: number };
  setLinearVelocity(v: { x: number; y: number; z: number }): void;
  getAngularVelocity(): { x: number; y: number; z: number };
  setAngularVelocity(v: { x: number; y: number; z: number }): void;
  getNative<T = unknown>(): T;
}

export interface PhysicsEngine {
  step(dt: number): void;
  setGravity(x: number, y: number, z: number): void;
  getNativeWorld(): unknown;
  createBoxBody(halfExtents: { x: number; y: number; z: number }, mass: number, material?: unknown): RigidBody;
  createTrimeshBody(
    vertices: number[] | Float32Array,
    indices: number[] | Uint32Array,
    isStatic: boolean,
    position?: { x: number; y: number; z: number }
  ): RigidBody;
  createFixedConstraint(a: RigidBody, b: RigidBody, options?: {
    frameA?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; w: number } };
    frameB?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; w: number } };
  }): unknown;
  removeConstraint(handle: unknown): void;

  // Optional helpers for attaching additional colliders to an existing body
  attachCylinderCollider?(
    body: RigidBody,
    radius: number,
    length: number,
    options?: {
      translation?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number; w: number };
      isSensor?: boolean;
      restitution?: number;
      friction?: number;
      density?: number;
    }
  ): unknown;

  removeCollider?(handle: unknown): void;
}

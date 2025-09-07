import type { PhysicsEngine, PhysicsInitOptions } from './types';

export async function createPhysicsEngine(
  _engine: 'rapier' = 'rapier',
  opts: PhysicsInitOptions = {}
): Promise<PhysicsEngine> {
  const { createRapierPhysics } = await import('./rapier');
  return createRapierPhysics(opts);
}

export type { PhysicsEngine, PhysicsInitOptions, RigidBody } from './types';

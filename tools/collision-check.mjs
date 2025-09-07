// Rapier-based physics sanity check: dynamic box resting on a trimesh ground
import * as THREE from 'three';

async function main() {
  const R = await import('@dimforge/rapier3d-compat');
  await R.init({});
  const world = new R.World({ x: 0, y: -9.82, z: 0 });

  // Build a sphere-like trimesh ground
  const radius = 2;
  const points = [];
  const segments = 16;
  for (let i = 0; i <= segments; i++) {
    const theta = i * Math.PI / segments;
    for (let j = 0; j <= segments; j++) {
      const phi = j * 2 * Math.PI / segments;
      const x = radius * Math.sin(theta) * Math.cos(phi);
      const y = radius * Math.cos(theta);
      const z = radius * Math.sin(theta) * Math.sin(phi);
      points.push(x, y, z);
    }
  }
  const indices = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const groundRb = world.createRigidBody(R.RigidBodyDesc.fixed());
  const groundCol = R.ColliderDesc.trimesh(new Float32Array(points), new Uint32Array(indices));
  world.createCollider(groundCol, groundRb);

  // Dynamic box
  const rb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, radius + 1, 0));
  world.createCollider(R.ColliderDesc.cuboid(0.2, 0.2, 0.2), rb);

  for (let i = 0; i < 600; i++) world.step();

  const y = rb.translation().y;
  const expectedMinY = radius + 0.19;
  const pass = y >= expectedMinY - 0.1;
  if (pass) {
    console.log('PASS: Box rests on Rapier trimesh (y=', y.toFixed(3), ')');
    process.exit(0);
  } else {
    console.error('FAIL: Box penetrated Rapier trimesh (y=', y.toFixed(3), ', expected >=', expectedMinY.toFixed(3), ')');
    process.exit(1);
  }
}

main();

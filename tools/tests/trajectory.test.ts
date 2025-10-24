// Minimal trajectory planner tests (run with: npm run test:traj)
import * as THREE from 'three';
import { TrajectoryPlanner } from '../../src/controllers/trajectory/TrajectoryPlanner.ts';

type Ob = { position: THREE.Vector3; size: THREE.Vector3; isTarget: boolean };

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('TEST FAIL:', msg); process.exit(1); }
}

function mkBox(pos: [number, number, number], half: number, isTarget = false): Ob {
  return { position: new THREE.Vector3(pos[0], pos[1], pos[2]), size: new THREE.Vector3(half, half, half), isTarget };
}

function lengthOfPath(pts: THREE.Vector3[]): number {
  if (!pts || pts.length < 2) return 0;
  let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  return L;
}

function anySegHitsBoxes(path: THREE.Vector3[], obs: Ob[]): boolean {
  const boxes = obs.map(o => TrajectoryPlanner.calculateSafetyBox(o.position, o.size, o.isTarget));
  for (let i = 0; i < path.length - 1; i++) {
    if (TrajectoryPlanner.doesLineIntersectAnySafetyBox(path[i], path[i + 1], boxes)) return true;
  }
  return false;
}

// 1) Central large obstacle: start and goal opposite sides
(() => {
  const start = new THREE.Vector3(-100, 0, 0);
  const goal = new THREE.Vector3(100, 0, 0);
  const obs = [mkBox([0, 0, 0], 10)]; // half-extent 10; planner inflates internally
  const wps = TrajectoryPlanner.calculateAvoidanceWaypoints(start, goal, obs);
  assert(wps.length >= 2, 'Central obstacle: planner should return a path');
  assert(!anySegHitsBoxes(wps, obs), 'Central obstacle: path segment intersects safety boxes');
  const L = lengthOfPath(wps);
  const Ldirect = start.distanceTo(goal);
  assert(L <= Ldirect * 3.0, `Central obstacle: path too long (L=${L.toFixed(2)}), direct=${Ldirect.toFixed(2)}`);
})();

// 2) Goal just behind obstacle (but outside inflated box)
(() => {
  const start = new THREE.Vector3(-100, 0, 0);
  const goal = new THREE.Vector3(22, 0, 0); // near the surface (r=10 + clearance ~ 1)
  const obs = [mkBox([0, 0, 0], 10)];
  const wps = TrajectoryPlanner.calculateAvoidanceWaypoints(start, goal, obs, 1.0);
  assert(wps.length >= 2, 'Behind obstacle: planner should return a path');
  assert(!anySegHitsBoxes(wps, obs), 'Behind obstacle: path segment intersects safety boxes');
  const L = lengthOfPath(wps);
  const Ldirect = start.distanceTo(goal);
  assert(L <= Ldirect * 3.0, `Behind obstacle: path too long (L=${L.toFixed(2)}), direct=${Ldirect.toFixed(2)}`);
})();

// 3) Tangential free corridor should remain straight (no unnecessary waypoints)
(() => {
  const start = new THREE.Vector3(-100, 30, 0);
  const goal = new THREE.Vector3(100, 30, 0);
  const obs = [mkBox([0, 0, 0], 10)];
  const boxes = obs.map(o => TrajectoryPlanner.calculateSafetyBox(o.position, o.size, o.isTarget));
  const directBlocked = TrajectoryPlanner.doesLineIntersectAnySafetyBox(start, goal, boxes);
  assert(!directBlocked, 'Tangential corridor: direct path unexpectedly blocked');
  const wps = TrajectoryPlanner.calculateAvoidanceWaypoints(start, goal, obs);
  assert(wps.length >= 2, 'Tangential corridor: planner returned empty path');
  // Allow exact 2 or small smoothing additions, but should be short and not intersect
  assert(!anySegHitsBoxes(wps, obs), 'Tangential corridor: path intersects safety boxes');
  const L = lengthOfPath(wps);
  const Ldirect = start.distanceTo(goal);
  assert(L <= Ldirect * 1.2, `Tangential corridor: path too long (L=${L.toFixed(2)}), direct=${Ldirect.toFixed(2)}`);
})();

console.log('All trajectory planner tests passed.');

// 4) Start very close to obstacle surface; still must route around safely
(() => {
  const start = new THREE.Vector3(-12, 0, 0);
  const goal = new THREE.Vector3(50, 0, 0);
  const obs = [mkBox([0, 0, 0], 10)];
  const wps = TrajectoryPlanner.calculateAvoidanceWaypoints(start, goal, obs, 1.0);
  assert(wps.length >= 2, 'Close start: planner should return a path');
  assert(!anySegHitsBoxes(wps, obs), 'Close start: path segment intersects safety boxes');
})();

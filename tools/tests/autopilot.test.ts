// Minimal runtime tests for allocator + modes (run with: npm run test:ap)
import * as THREE from 'three';
import { PIDController } from '../../src/controllers/pidController.ts';
import { AutopilotMode, AutopilotConfig } from '../../src/controllers/autopilot/AutopilotMode.ts';
import { CancelRotation } from '../../src/controllers/autopilot/CancelRotation.ts';
import { PointToPosition } from '../../src/controllers/autopilot/PointToPosition.ts';

// Mock Spacecraft providing the minimum API used by modes
class MockSpacecraft {
  private q = new THREE.Quaternion();
  private av = new THREE.Vector3();
  private p = new THREE.Vector3();
  private v = new THREE.Vector3();
  constructor(public mass = 10, public dims = new THREE.Vector3(1, 1, 2)) { }
  // Orientation/velocity refs (no allocations in modes)
  getWorldOrientationRef() { return this.q; }
  getWorldAngularVelocityRef() { return this.av; }
  getWorldPositionRef() { return this.p; }
  getWorldVelocityRef() { return this.v; }
  // Cloned accessors
  getWorldOrientation() { return this.q.clone(); }
  getWorldAngularVelocity() { return this.av.clone(); }
  getWorldPosition() { return this.p.clone(); }
  getWorldVelocity() { return this.v.clone(); }
  getMainBodyDimensions() { return this.dims.clone(); }
  getMass() { return this.mass; }
  // Thruster config not needed when getDynamicCaps is overridden by mode; but provide a stub.
  getThrusterConfigs() { return []; }
  // Helpers to set state
  setOrientation(q: THREE.Quaternion) { this.q.copy(q); }
  setAngularVelocity(v: THREE.Vector3) { this.av.copy(v); }
  setPosition(v: THREE.Vector3) { this.p.copy(v); }
  setVelocity(v: THREE.Vector3) { this.v.copy(v); }
}

// Test helper: simple groups—one thruster per signed axis
const groups = {
  pitch: [[0], [1]],
  yaw: [[2], [3]],
  roll: [[4], [5]],
  forward: [[6], [7]],
  up: [[8], [9]],
  left: [[10], [11]],
};
const thrusterMax = new Array(24).fill(1);
const config: AutopilotConfig = {
  pid: {
    orientation: { kp: 0.12, ki: 0, kd: 0.06 },
    position: { kp: 1.0, ki: 0.0, kd: 0.5 },
    momentum: { kp: 2.0, ki: 0.0, kd: 0.5 },
  },
  limits: {
    maxForce: 1000,
    epsilon: 0.01,
    maxAngularMomentum: 1.0,
    maxLinearMomentum: 10.0,
    maxAngularVelocity: 1.2,
    maxAngularAcceleration: 3.0,
  },
  damping: { factor: 1.0 },
};

// Subclass to expose allocator and stub dynamic caps
class TestAllocator extends AutopilotMode {
  constructor(sc: any, pid: PIDController) { super(sc, config, groups as any, 1, pid, thrusterMax); }
  calculateForces(): number[] { return new Array(24).fill(0); }
  protected getDynamicCaps(): any {
    return {
      linForce: { x: 1, y: 1, z: 1 },
      linAccel: { x: 1, y: 1, z: 1 },
      inertia: { x: 1, y: 1, z: 1 },
      angTorque: { x: 1, y: 1, z: 1 },
      angAccel: { x: 1, y: 1, z: 1 },
    };
  }
  public map(pidOut: THREE.Vector3): number[] {
    const out = new Array(24).fill(0);
    this['applyPIDOutputToThrustersInPlace'](pidOut, out);
    return out;
  }
}

function assert(cond: boolean, msg: string) { if (!cond) { console.error('TEST FAIL:', msg); process.exit(1); } }

// 1) Allocator produces torque on correct signed group
(() => {
  const sc = new MockSpacecraft();
  const pid = new PIDController(0, 0, 0, 'angularMomentum');
  const alloc = new TestAllocator(sc as any, pid);
  const out = alloc.map(new THREE.Vector3(0.5, 0, 0)); // +X (positive torque) => pitch[0] (pitch up)
  assert(out[0] > 0 || out[1] > 0, 'Allocator: +X should drive pitch thrusters');
  assert(out.reduce((s, v) => s + v, 0) > 0, 'Allocator: sum should be > 0');
})();

// 2) CancelRotation produces yaw torque for non-zero ωy
(() => {
  const sc = new MockSpacecraft();
  sc.setAngularVelocity(new THREE.Vector3(0, 0.3, 0));
  const pid = new PIDController(3.0, 0.0, 1.0, 'angularMomentum');
  const cancel = new (class extends CancelRotation {
    protected getDynamicCaps(): any { return { angTorque: { x: 1, y: 1, z: 1 } } as any; }
  })(sc as any, config, groups as any, 1, pid, thrusterMax);
  const out = cancel.calculateForces(0.1);
  const yawSum = out[2] + out[3];
  assert(yawSum > 0, 'CancelRotation: should drive yaw thrusters');
})();

// 3) PointToPosition produces rotation when target is off-forward
(() => {
  const sc = new MockSpacecraft();
  const pid = new PIDController(0.12, 0, 0.06, 'angularMomentum');
  const target = new THREE.Vector3(1, 0, 5);
  const pt = new (class extends PointToPosition {
    protected getDynamicCaps(): any { return { angTorque: { x: 1, y: 1, z: 1 }, angAccel: { x: 1, y: 1, z: 1 } } as any; }
  })(sc as any, config, groups as any, 1, pid, target, thrusterMax);
  const out = pt.calculateForces(0.1);
  const sum = out.reduce((s, v) => s + v, 0);
  assert(sum > 0, 'PointToPosition: should produce rotation thrusts');
})();

console.log('All autopilot tests passed.');

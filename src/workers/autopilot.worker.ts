// Web Worker: Autopilot compute off main thread
import * as THREE from 'three';
import { PIDController } from '../controllers/pidController';
import { CancelRotation } from '../controllers/autopilot/CancelRotation';
import { CancelLinearMotion } from '../controllers/autopilot/CancelLinearMotion';
import { PointToPosition } from '../controllers/autopilot/PointToPosition';
import { OrientationMatchAutopilot } from '../controllers/autopilot/OrientationMatchAutopilot';
import { GoToPosition } from '../controllers/autopilot/GoToPosition';
import type { AutopilotConfig } from '../controllers/autopilot/AutopilotMode';
import { TrajectoryPlanner } from '../controllers/trajectory/TrajectoryPlanner';
import type { ThrusterGroups } from '../config/spacecraftConfig';
import type { WorkerInboundMsg } from '../controllers/autopilot/types';
import type { WorkerThrusterConfig as ThrusterConfig } from '../controllers/autopilot/types';

class SpacecraftAdapter {
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private lv = new THREE.Vector3();
  private av = new THREE.Vector3();
  private dims = new THREE.Vector3(1, 1, 1);
  private mass = 1;
  private thrusters: { position: THREE.Vector3; direction: THREE.Vector3 }[] = [];

  updateSnapshot(s: {
    p: [number, number, number];
    q: [number, number, number, number];
    lv: [number, number, number];
    av: [number, number, number];
  }): void {
    this.pos.set(s.p[0], s.p[1], s.p[2]);
    this.quat.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    this.lv.set(s.lv[0], s.lv[1], s.lv[2]);
    this.av.set(s.av[0], s.av[1], s.av[2]);
  }

  setMass(m: number) { this.mass = m; }
  setDims(x: number, y: number, z: number) { this.dims.set(x, y, z); }
  setThrusters(t: ThrusterConfig[]) {
    this.thrusters = t.map(tc => ({
      position: new THREE.Vector3(tc.position[0], tc.position[1], tc.position[2]),
      direction: new THREE.Vector3(tc.direction[0], tc.direction[1], tc.direction[2])
    }));
  }

  // Methods used by autopilot modes
  getWorldPosition() { return this.pos.clone(); }
  getWorldOrientation() { return this.quat.clone(); }
  getWorldVelocity() { return this.lv.clone(); }
  getWorldAngularVelocity() { return this.av.clone(); }
  // Zero-allocation reference variants to match main Spacecraft API
  getWorldPositionRef() { return this.pos; }
  getWorldOrientationRef() { return this.quat; }
  getWorldVelocityRef() { return this.lv; }
  getWorldAngularVelocityRef() { return this.av; }
  getMass() { return this.mass; }
  getMainBodyDimensions() { return this.dims; }
  getThrusterConfigs() { return this.thrusters; }
}

class WorkerAutopilot {
  private sc: SpacecraftAdapter;
  private config: AutopilotConfig;
  private thrusterGroups: ThrusterGroups;
  private thrust: number;
  private thrusterMax: number[];
  private cancelRotationMode: CancelRotation;
  private cancelLinearMotionMode: CancelLinearMotion;
  private pointToPositionMode: PointToPosition;
  private orientationMatchMode: OrientationMatchAutopilot;
  private goToPositionMode: GoToPosition;
  private orientationPID: PIDController;
  private rotationCancelPID: PIDController;
  private linearPID: PIDController;
  private momentumPID: PIDController;
  private targetPosition = new THREE.Vector3();
  private targetOrientation = new THREE.Quaternion();
  private scratchDir = new THREE.Vector3();
  private scratchForward = new THREE.Vector3();
  private scratchQuat = new THREE.Quaternion();
  private referenceVelocityWorld = new THREE.Vector3();
  private guidanceMode: 'direct' | 'trackRef' = 'direct';
  private rotScale = 1.0;

  constructor(
    sc: SpacecraftAdapter,
    thrusterGroups: ThrusterGroups,
    thrust: number,
    config: AutopilotConfig,
    thrusterMax?: number[],
  ) {
    this.sc = sc;
    this.thrusterGroups = thrusterGroups;
    this.thrust = thrust;
    this.config = config;
    this.thrusterMax = (thrusterMax && thrusterMax.length === 24) ? thrusterMax.slice(0, 24) : new Array(24).fill(thrust);

    this.orientationPID = new PIDController(config.pid.orientation.kp, config.pid.orientation.ki, config.pid.orientation.kd, 'angularMomentum');
    this.rotationCancelPID = new PIDController(config.pid.orientation.kp, config.pid.orientation.ki, config.pid.orientation.kd, 'angularMomentum');
    this.linearPID = new PIDController(config.pid.position.kp, config.pid.position.ki, config.pid.position.kd, 'position');
    this.momentumPID = new PIDController(config.pid.momentum.kp, config.pid.momentum.ki, config.pid.momentum.kd, 'linearMomentum');
    this.linearPID.setMaxIntegral(0.1);
    this.linearPID.setDerivativeAlpha(0.95);
    this.momentumPID.setMaxIntegral(0.2);
    this.momentumPID.setDerivativeAlpha(0.9);

    this.cancelRotationMode = new CancelRotation(this.sc as any, this.config, this.thrusterGroups, this.thrust, this.rotationCancelPID, this.thrusterMax);
    this.cancelLinearMotionMode = new CancelLinearMotion(this.sc as any, this.config, this.thrusterGroups, this.thrust, this.momentumPID, this.thrusterMax);
    this.pointToPositionMode = new PointToPosition(this.sc as any, this.config, this.thrusterGroups, this.thrust, this.orientationPID, this.targetPosition, this.thrusterMax);
    this.orientationMatchMode = new OrientationMatchAutopilot(this.sc as any, this.config, this.thrusterGroups, this.thrust, this.orientationPID, this.targetOrientation, undefined, false, this.thrusterMax);
    this.goToPositionMode = new GoToPosition(this.sc as any, this.config, this.thrusterGroups, this.thrust, this.linearPID, this.targetPosition, this.thrusterMax);
  }

  async autoCalibrateAll(): Promise<void> {
    try {
      await Promise.all([
        this.orientationPID.autoCalibrate(),
        this.linearPID.autoCalibrate(),
        this.momentumPID.autoCalibrate(),
      ]);
    } catch (_) {}
  }

  setTargets(pos: [number, number, number], quat: [number, number, number, number]) {
    this.targetPosition.set(pos[0], pos[1], pos[2]);
    this.targetOrientation.set(quat[0], quat[1], quat[2], quat[3]);
    this.orientationMatchMode.setTargetOrientation(this.targetOrientation);
    this.pointToPositionMode.setTargetPosition(this.targetPosition);
    this.goToPositionMode.setTargetPosition(this.targetPosition);
  }

  setReferenceVelocity(v: [number, number, number]) {
    this.referenceVelocityWorld.set(v[0], v[1], v[2]);
    this.cancelLinearMotionMode.setReferenceVelocityWorld(this.referenceVelocityWorld);
    this.goToPositionMode.setReferenceVelocityWorld(this.referenceVelocityWorld);
  }

  setGuidanceModeTrackRef(enabled: boolean) {
    this.guidanceMode = enabled ? 'trackRef' : 'direct';
    this.goToPositionMode.setGuidanceMode(this.guidanceMode);
  }

  setRotationAllocationScale(scale: number) {
    this.rotScale = Math.max(0, Math.min(1, scale));
    this.cancelRotationMode.setAllocationScale(this.rotScale);
    this.orientationMatchMode.setAllocationScale(this.rotScale);
    this.pointToPositionMode.setAllocationScale(this.rotScale);
    this.cancelLinearMotionMode.setAllocationScale(1.0);
    this.goToPositionMode.setAllocationScale(1.0);
  }

  compute(dt: number, active: { orientationMatch: boolean; cancelRotation: boolean; cancelLinearMotion: boolean; pointToPosition: boolean; goToPosition: boolean }): { forces: Float32Array; telemetry: { point?: any; orient?: any; goto?: any } } {
    // Update targetOrientation if pointing to a position (like main thread version)
    if (active.pointToPosition) {
      const q = this.sc.getWorldOrientationRef();
      const pos = this.sc.getWorldPositionRef();
      this.scratchDir.copy(this.targetPosition).sub(pos);
      if (this.scratchDir.lengthSq() > 1e-10) {
        this.scratchDir.normalize();
        this.scratchForward.set(0, 0, 1).applyQuaternion(q);
        this.scratchQuat.setFromUnitVectors(this.scratchForward, this.scratchDir);
        this.scratchQuat.multiply(q);
        this.setTargets([this.targetPosition.x, this.targetPosition.y, this.targetPosition.z], [this.scratchQuat.x, this.scratchQuat.y, this.scratchQuat.z, this.scratchQuat.w]);
      }
    }

    const out: number[] = new Array(24).fill(0);
    if (active.cancelRotation) this.cancelRotationMode.calculateForces(dt, out);
    if (active.cancelLinearMotion) this.cancelLinearMotionMode.calculateForces(dt, out);
    if (active.pointToPosition) this.pointToPositionMode.calculateForces(dt, out);
    if (active.orientationMatch) this.orientationMatchMode.calculateForces(dt, out);
    if (active.goToPosition) this.goToPositionMode.calculateForces(dt, out);
    // Per-thruster saturation to hardware caps
    for (let i = 0; i < out.length; i++) {
      const cap = (this as any)['thrusterMax']?.[i] ?? this.thrust;
      out[i] = Math.min(Math.max(0, out[i] || 0), cap);
    }
    const forces = Float32Array.from(out);
    const telemetry = {
      point: active.pointToPosition ? (this.pointToPositionMode as any)?.getTelemetry?.() : undefined,
      orient: active.orientationMatch ? (this.orientationMatchMode as any)?.getTelemetry?.() : undefined,
      goto: active.goToPosition ? (this.goToPositionMode as any)?.getTelemetry?.() : undefined,
    };
    return { forces, telemetry };
  }
}

let autopilot: WorkerAutopilot | null = null;
let scAdapter: SpacecraftAdapter | null = null;


self.onmessage = async (ev: MessageEvent<WorkerInboundMsg>) => {
  const data = ev.data;
  if (data.type === 'init') {
    scAdapter = new SpacecraftAdapter();
    scAdapter.setMass(data.mass);
    scAdapter.setDims(data.dims[0], data.dims[1], data.dims[2]);
    scAdapter.setThrusters(data.thrusterConfigs);

    autopilot = new WorkerAutopilot(scAdapter, data.thrusterGroups, data.thrust, data.config, data.thrusterStrengths);
    if (data.autoCalibrate) await autopilot.autoCalibrateAll();
    (self as any).postMessage({ type: 'ready' });
    return;
  }
  if (data.type === 'planPath') {
    // Build obstacles and compute an efficient curved path in the worker
    try {
      const start = new THREE.Vector3(data.start[0], data.start[1], data.start[2]);
      const goal = new THREE.Vector3(data.goal[0], data.goal[1], data.goal[2]);
      const obstacles = data.obstacles.map(o => ({ position: new THREE.Vector3(o.pos[0], o.pos[1], o.pos[2]), size: new THREE.Vector3(o.size[0], o.size[1], o.size[2]), isTarget: o.isTarget }));

      // Build safety boxes and check direct blockage using the same logic as main thread
      const dims = scAdapter?.getMainBodyDimensions?.() || new THREE.Vector3(1,1,1);
      const craftR = Math.max(dims.x, dims.y, dims.z);
      const safetyBoxes = obstacles.map(o => TrajectoryPlanner.calculateSafetyBox(o.position, o.size, o.isTarget, craftR * 0.6));
      let waypoints: THREE.Vector3[] = [start, goal];
      const directBlocked = TrajectoryPlanner.doesLineIntersectAnySafetyBox(start, goal, safetyBoxes);
      if (directBlocked) {
        // Restrict to obstacles near corridor to keep it scalable
        const seg = goal.clone().sub(start); const L = Math.max(1e-6, seg.length()); const dir = seg.clone().multiplyScalar(1 / L);
        const nearDist = 12.0;
        const nearObs = obstacles.filter(o => {
          const u = THREE.MathUtils.clamp(o.position.clone().sub(start).dot(dir), 0, L);
          const closest = start.clone().add(dir.clone().multiplyScalar(u));
          const r = Math.max(o.size.x, o.size.y, o.size.z);
          return closest.distanceTo(o.position) <= (nearDist + r);
        });
        const obsSet = nearObs.length ? nearObs : obstacles;
        const w = TrajectoryPlanner.calculateAvoidanceWaypoints(start, goal, obsSet, craftR * 0.6);
        waypoints = (w && w.length >= 2) ? w : [start, goal];
      }

      // Return result
      const flat = new Float32Array(waypoints.length * 3);
      for (let i = 0; i < waypoints.length; i++) { flat[i * 3 + 0] = waypoints[i].x; flat[i * 3 + 1] = waypoints[i].y; flat[i * 3 + 2] = waypoints[i].z; }
      (self as any).postMessage({ type: 'planPathResult', id: data.id, points: flat }, [flat.buffer]);
    } catch (err) {
      (self as any).postMessage({ type: 'planPathResult', id: data.id, points: new Float32Array(0) });
    }
    return;
  }
  if (data.type === 'setGains') {
    if (!autopilot) return;
    try {
      autopilot['orientationPID']?.setGain('Kp', data.gains.orientation.kp);
      autopilot['orientationPID']?.setGain('Ki', data.gains.orientation.ki);
      autopilot['orientationPID']?.setGain('Kd', data.gains.orientation.kd);
      if (data.gains.rotationCancel) {
        autopilot['rotationCancelPID']?.setGain('Kp', data.gains.rotationCancel.kp);
        autopilot['rotationCancelPID']?.setGain('Ki', data.gains.rotationCancel.ki);
        autopilot['rotationCancelPID']?.setGain('Kd', data.gains.rotationCancel.kd);
      }
      autopilot['linearPID']?.setGain('Kp', data.gains.position.kp);
      autopilot['linearPID']?.setGain('Ki', data.gains.position.ki);
      autopilot['linearPID']?.setGain('Kd', data.gains.position.kd);
      autopilot['momentumPID']?.setGain('Kp', data.gains.momentum.kp);
      autopilot['momentumPID']?.setGain('Ki', data.gains.momentum.ki);
      autopilot['momentumPID']?.setGain('Kd', data.gains.momentum.kd);
    } catch {}
    return;
  }
  if (data.type === 'calibrate') {
    if (!autopilot) return;
    try {
      const promises: Promise<any>[] = [];
      if (data.targets.includes('attitude')) promises.push(autopilot['orientationPID']?.autoCalibrate?.());
      if (data.targets.includes('rotCancel')) promises.push(autopilot['rotationCancelPID']?.autoCalibrate?.());
      if (data.targets.includes('linear')) promises.push(autopilot['linearPID']?.autoCalibrate?.());
      if (data.targets.includes('momentum')) promises.push(autopilot['momentumPID']?.autoCalibrate?.());
      await Promise.all(promises);
    } catch {}
    return;
  }
  if (data.type === 'setThrusterStrengths') {
    if (!autopilot) return;
    try {
      const arr = (Array.isArray(data.strengths) && data.strengths.length === 24) ? data.strengths.slice(0, 24) : new Array(24).fill(autopilot['thrust']);
      (autopilot as any)['thrusterMax'] = arr;
      (autopilot as any)['cancelRotationMode']?.setThrusterMax?.(arr);
      (autopilot as any)['cancelLinearMotionMode']?.setThrusterMax?.(arr);
      (autopilot as any)['pointToPositionMode']?.setThrusterMax?.(arr);
      (autopilot as any)['orientationMatchMode']?.setThrusterMax?.(arr);
      (autopilot as any)['goToPositionMode']?.setThrusterMax?.(arr);
    } catch {}
    return;
  }
  if (data.type === 'setThrusterGroups') {
    if (!autopilot) return;
    try {
      (autopilot as any)['thrusterGroups'] = data.groups;
      (autopilot as any)['cancelRotationMode']?.setThrusterGroups?.(data.groups);
      (autopilot as any)['cancelLinearMotionMode']?.setThrusterGroups?.(data.groups);
      (autopilot as any)['pointToPositionMode']?.setThrusterGroups?.(data.groups);
      (autopilot as any)['orientationMatchMode']?.setThrusterGroups?.(data.groups);
      (autopilot as any)['goToPositionMode']?.setThrusterGroups?.(data.groups);
    } catch {}
    return;
  }
  if (data.type === 'setThrusters') {
    if (!autopilot || !scAdapter) return;
    try {
      scAdapter.setThrusters(data.thrusters);
      (autopilot as any)['cancelRotationMode']?.invalidateCaps?.();
      (autopilot as any)['cancelLinearMotionMode']?.invalidateCaps?.();
      (autopilot as any)['pointToPositionMode']?.invalidateCaps?.();
      (autopilot as any)['orientationMatchMode']?.invalidateCaps?.();
      (autopilot as any)['goToPositionMode']?.invalidateCaps?.();
    } catch {}
    return;
  }
  if (data.type === 'setThrust') {
    if (!autopilot) return;
    try {
      (autopilot as any)['thrust'] = data.thrust;
      // Update per-thruster capacities to match new thrust (consistent with main thread)
      const newThrusterMax = new Array(24).fill(data.thrust);
      (autopilot as any)['thrusterMax'] = newThrusterMax;
      (autopilot as any)['cancelRotationMode']?.setThrust?.(data.thrust);
      (autopilot as any)['cancelRotationMode']?.setThrusterMax?.(newThrusterMax);
      (autopilot as any)['cancelLinearMotionMode']?.setThrust?.(data.thrust);
      (autopilot as any)['cancelLinearMotionMode']?.setThrusterMax?.(newThrusterMax);
      (autopilot as any)['pointToPositionMode']?.setThrust?.(data.thrust);
      (autopilot as any)['pointToPositionMode']?.setThrusterMax?.(newThrusterMax);
      (autopilot as any)['orientationMatchMode']?.setThrust?.(data.thrust);
      (autopilot as any)['orientationMatchMode']?.setThrusterMax?.(newThrusterMax);
      (autopilot as any)['goToPositionMode']?.setThrust?.(data.thrust);
      (autopilot as any)['goToPositionMode']?.setThrusterMax?.(newThrusterMax);
    } catch {}
    return;
  }
  if (data.type === 'update') {
    if (!autopilot || !scAdapter) return;
    scAdapter.updateSnapshot(data.snapshot);
    autopilot.setTargets(data.targetPos, data.targetQuat);
    autopilot.setReferenceVelocity(data.refVel);
    autopilot.setGuidanceModeTrackRef(!!data.trackRef);
    if (typeof data.rotScale === 'number') autopilot.setRotationAllocationScale(data.rotScale);
    const { forces, telemetry } = autopilot.compute(data.dt, data.active);
    // Transfer array buffer for performance
    (self as any).postMessage({ type: 'forces', forces, telemetry }, [forces.buffer]);
    return;
  }
};

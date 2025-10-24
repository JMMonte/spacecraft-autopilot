import * as THREE from 'three';
import { PathFollower } from '../follow/PathFollower';
import type { PathFollowerOptions } from '../follow/types';
import { TrajectoryPlanner } from '../trajectory/TrajectoryPlanner';
import type { Spacecraft } from '../../core/spacecraft';

export type Obstacle = { position: THREE.Vector3; size: THREE.Vector3; isTarget: boolean };

type CapsFn = () => { x: number; y: number; z: number };
type DimsFn = () => THREE.Vector3;
type TargetObjFn = () => Spacecraft | null;

type WorldLike = {
  getSpacecraftList?: () => Spacecraft[];
  getAsteroidObstacles?: () => Array<{ position: THREE.Vector3; size: THREE.Vector3 }>;
};

const EPS = 1e-6;

export class PathManager {
  private follower: PathFollower | null = null;
  private carrot = new THREE.Vector3();
  private vRef = new THREE.Vector3();
  private lastGoal = new THREE.Vector3(NaN, NaN, NaN);
  private lastGoalQuat = new THREE.Quaternion(0, 0, 0, 1);
  private lastStart = new THREE.Vector3(NaN, NaN, NaN);
  private replanTimer = 0;
  private replanInterval = 0.5;
  private planPending = false;
  private reqId = 0;
  private lastObsSnapshot: Obstacle[] = [];
  private deviationThreshold = 2.5;
  private hasMultiSegmentPath = false;

  constructor(
    private getAxisLinearAccelCaps: CapsFn,
    private getMaxLinearVelocity: () => number,
    private getDims: DimsFn,
    private getTargetObject: TargetObjFn,
  ) {}

  public clear(): void { this.follower = null; }
  public getSamples(): THREE.Vector3[] | null { try { return this.follower?.getSamples() ?? null; } catch { return null; } }
  public getProgress(): { sCur: number; sRem: number; sTotal: number; idx: number; done: boolean } | null { try { return this.follower?.getProgress() ?? null; } catch { return null; } }
  public getCarrot(): THREE.Vector3 | null { return this.follower ? this.carrot.clone() : null; }
  public getVRef(): THREE.Vector3 { return this.vRef; }

  public setGoalQuatSnapshot(q: THREE.Quaternion): void { this.lastGoalQuat.copy(q); }
  public setLastStartGoal(start: THREE.Vector3, goal: THREE.Vector3): void { this.lastStart.copy(start); this.lastGoal.copy(goal); }
  public beginPlan(): number { this.planPending = true; this.reqId++; return this.reqId; }
  public completePlan(points: Float32Array): void {
    this.planPending = false;
    if ((points?.length ?? 0) >= 6) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < points.length; i += 3) pts.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
      this.setWaypoints(pts);
    }
  }
  public isPlanPending(): boolean { return this.planPending; }

  public setWaypoints(waypoints: THREE.Vector3[], opts?: PathFollowerOptions): void {
    this.hasMultiSegmentPath = Array.isArray(waypoints) && waypoints.length > 2;
    const dims = this.getDims();
    const nominalClear = Math.max(dims.x, dims.y, dims.z) * 0.8;
    const endClearanceAbs = THREE.MathUtils.clamp(opts?.endClearanceAbs ?? nominalClear, 0.5, 1.5);

    const vMax = this.getMaxLinearVelocity();
    const followerOpts: PathFollowerOptions = {
      sampleSpacing: opts?.sampleSpacing,
      maxSamples: opts?.maxSamples,
      lookaheadMin: opts?.lookaheadMin ?? 1.5,
      lookaheadMax: opts?.lookaheadMax ?? Math.max(6, vMax),
      lookaheadGain: opts?.lookaheadGain ?? 1.0,
      endClearanceAbs,
      curved: !this.hasMultiSegmentPath,
    };

    this.follower = new PathFollower(waypoints, followerOpts);
    this.carrot.set(0, 0, 0);
    this.vRef.set(0, 0, 0);
  }

  public tick(dt: number): void { this.replanTimer += dt; }
  public isTimeToReplan(): boolean {
    if (this.replanTimer >= this.replanInterval) { this.replanTimer = 0; return true; }
    return false;
  }

  public shouldReplan(spacecraft: Spacecraft, start: THREE.Vector3, goal: THREE.Vector3): boolean {
    const movedGoal = !(Number.isFinite(this.lastGoal.x)) || goal.distanceTo(this.lastGoal) > 0.5;
    const dev = this.computeDeviationFromPath(start);
    const obsChanged = this.haveObstaclesChangedNear(spacecraft, start, goal);
    return movedGoal || (dev > this.deviationThreshold) || obsChanged;
  }

  private computeDeviationFromPath(pos: THREE.Vector3): number {
    if (!this.follower) return 0;
    try { return this.follower.distanceToPath(pos); } catch { return 0; }
  }

  public collectObstacles(spacecraft: Spacecraft): Obstacle[] {
    const res: Obstacle[] = [];
    try {
      const world: WorldLike | undefined = (spacecraft as unknown as { basicWorld?: WorldLike }).basicWorld;
      const target = this.getTargetObject();
      if (target) res.push({ position: target.objects.box.position.clone(), size: target.getFullDimensions().clone(), isTarget: true });
      const otherCraft = (world?.getSpacecraftList?.() || []).filter((s: Spacecraft) => s !== spacecraft);
      for (const s of otherCraft) res.push({ position: s.objects.box.position.clone(), size: s.getFullDimensions().clone(), isTarget: false });
      try {
        const ast = world?.getAsteroidObstacles?.() || [];
        for (const a of ast) res.push({ position: a.position.clone(), size: a.size.clone(), isTarget: false });
      } catch {}
    } catch {}
    return res;
  }

  private haveObstaclesChangedNear(spacecraft: Spacecraft, start: THREE.Vector3, goal: THREE.Vector3): boolean {
    const curr = this.collectObstacles(spacecraft);
    const seg = goal.clone().sub(start); const L = Math.max(EPS, seg.length()); const dir = seg.clone().multiplyScalar(1 / L);
    const nearDist = 12.0;
    const near = curr.filter(o => {
      const u = THREE.MathUtils.clamp(o.position.clone().sub(start).dot(dir), 0, L);
      const closest = start.clone().add(dir.clone().multiplyScalar(u));
      const r = Math.max(o.size.x, o.size.y, o.size.z);
      return closest.distanceTo(o.position) <= (nearDist + r);
    });
    const prev = this.lastObsSnapshot; const movedThresh = 1.0;
    let changed = near.length !== prev.length;
    if (!changed) {
      for (let i = 0; i < near.length; i++) {
        const a = near[i]; const b = prev[i]; if (!b) { changed = true; break; }
        if (a.position.distanceTo(b.position) > movedThresh) { changed = true; break; }
      }
    }
    if (changed) this.lastObsSnapshot = near.map(o => ({ position: o.position.clone(), size: o.size.clone(), isTarget: o.isTarget }));
    return changed;
  }

  public buildAvoidancePath(spacecraft: Spacecraft, start: THREE.Vector3, goal: THREE.Vector3): THREE.Vector3[] {
    try {
      let objs = this.collectObstacles(spacecraft);
      const craftR = (() => { try { const d = this.getDims(); return Math.max(d.x, d.y, d.z); } catch { return 1.0; } })();
      const safetyBoxes = objs.map(o => TrajectoryPlanner.calculateSafetyBox(o.position, o.size, o.isTarget, craftR));
      const directBlocked = TrajectoryPlanner.doesLineIntersectAnySafetyBox(start, goal, safetyBoxes);
      if (!directBlocked) return [start, goal];

      const seg = goal.clone().sub(start); const segLen = Math.max(EPS, seg.length()); const segDir = seg.clone().multiplyScalar(1 / segLen);
      const nearDist = 12.0;
      const nearObjs = objs.filter(o => {
        const w = o.position.clone().sub(start);
        const u = THREE.MathUtils.clamp(w.dot(segDir), 0, segLen);
        const closest = start.clone().add(segDir.clone().multiplyScalar(u));
        const dist = closest.distanceTo(o.position);
        const r = Math.max(o.size.x, o.size.y, o.size.z);
        return dist <= (nearDist + r);
      });
      objs = nearObjs.length ? nearObjs : objs;

      const wps = TrajectoryPlanner.calculateAvoidanceWaypoints(start, goal, objs, craftR);
      return wps && wps.length >= 2 ? wps : [start, goal];
    } catch { return [start, goal]; }
  }

  public updateFollowStep(spacecraft: Spacecraft, targetPosition: THREE.Vector3, targetOrientation: THREE.Quaternion, referenceVelocityWorld: THREE.Vector3 | null): { useFollower: boolean } {
    if (!this.follower) return { useFollower: false };
    const p = spacecraft.getWorldPositionRef();
    const v = spacecraft.getWorldVelocityRef();
    const gNow = targetPosition;
    const qPlan = this.lastGoalQuat;
    const qNow = targetOrientation;
    const qDelta = new THREE.Quaternion().copy(qNow).multiply(new THREE.Quaternion().copy(qPlan).invert());
    const qDeltaInv = new THREE.Quaternion().copy(qDelta).invert();
    const relPosNow = new THREE.Vector3(p.x, p.y, p.z).sub(gNow);
    const posPlanned = this.lastGoal.clone().add(relPosNow.applyQuaternion(qDeltaInv));
    const vGoal = referenceVelocityWorld || new THREE.Vector3(0, 0, 0);
    const vRelNow = new THREE.Vector3().copy(v).sub(vGoal);
    const vPlanned = vRelNow.applyQuaternion(qDeltaInv);
    const followerState = this.follower.update(posPlanned, vPlanned);
    const useFollowerNow = !followerState.done;
    if (useFollowerNow) {
      const desiredVelWorld = followerState.velocityRef.clone().applyQuaternion(qDelta).add(vGoal);
      const progress = this.follower.getProgress();
      const remaining = Math.max(0, progress?.sRem ?? 0);

      const maxSpeed = Math.max(0.5, this.getMaxLinearVelocity());
      if (desiredVelWorld.length() > maxSpeed) desiredVelWorld.setLength(maxSpeed);

      const caps = this.getAxisLinearAccelCaps();
      const maxAccel = Math.max(0.5, Math.min(caps.x, caps.y, caps.z));

      const deltaV = desiredVelWorld.clone().sub(v);
      const desiredSpeed = desiredVelWorld.length();
      let alongDir = new THREE.Vector3();
      if (desiredSpeed > 1e-3) alongDir.copy(desiredVelWorld).multiplyScalar(1 / desiredSpeed);
      else if (remaining > 1e-3) alongDir.copy(targetPosition).sub(p).normalize();
      const deltaAlong = deltaV.dot(alongDir);
      const vAlongCurrent = alongDir.lengthSq() > 1e-6 ? v.dot(alongDir) : 0;

      const minTime = 0.2;
      const maxTime = 2.5;
      let timeMag: number;
      let preview: number;
      if (deltaAlong < 0) {
        const excessSpeed = Math.max(0, vAlongCurrent - desiredSpeed);
        timeMag = Math.max(minTime, Math.min(maxTime, excessSpeed / Math.max(maxAccel, 1e-3)));
        preview = -timeMag;
      } else {
        const denom = Math.max(desiredSpeed, 1e-3);
        timeMag = Math.max(minTime, Math.min(maxTime, remaining / denom));
        preview = timeMag;
      }

      let accelVector = deltaV.multiplyScalar(1 / Math.max(timeMag, 1e-3));
      if (accelVector.length() > maxAccel) accelVector.setLength(maxAccel);

      const previewPos = p.clone()
        .add(v.clone().multiplyScalar(preview))
        .add(accelVector.clone().multiplyScalar(0.5 * preview * preview));

      this.carrot.copy(previewPos);
      this.vRef.copy(desiredVelWorld);
    } else {
      this.vRef.set(0, 0, 0);
      this.carrot.copy(targetPosition);
    }
    return { useFollower: useFollowerNow };
  }
}

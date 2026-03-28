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
  private replanTimer = Infinity;  // trigger immediately on first tick
  private replanInterval = 0.5;
  private planPending = false;
  private reqId = 0;
  /** Spacecraft to exclude from obstacle collection (e.g. docking target during dock phase). */
  private excludedSpacecraft: Set<string> = new Set();
  private lastObsSnapshot: Obstacle[] = [];
  private deviationThreshold = 2.5;
  private hasMultiSegmentPath = false;

  // Scratch vectors for per-frame math — avoid allocations
  private _toTarget = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  // Scratch vectors for obstacle filtering (called at replan interval, not every frame)
  private _seg = new THREE.Vector3();
  private _segDir = new THREE.Vector3();
  private _w = new THREE.Vector3();
  private _closestPt = new THREE.Vector3();

  constructor(
    private getAxisLinearAccelCaps: CapsFn,
    private getMaxLinearVelocity: () => number,
    private getDims: DimsFn,
    private getTargetObject: TargetObjFn,
  ) { }

  public clear(): void { this.follower = null; }
  public getSamples(): THREE.Vector3[] | null { try { return this.follower?.getSamples() ?? null; } catch { return null; } }
  public getProgress(): { sCur: number; sRem: number; sTotal: number; idx: number; done: boolean } | null { try { return this.follower?.getProgress() ?? null; } catch { return null; } }
  public getCarrot(): THREE.Vector3 | null { return this.follower ? this.carrot : null; }
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
  public setReplanInterval(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.replanInterval = THREE.MathUtils.clamp(seconds, 0.1, 5.0);
  }
  public setDeviationThreshold(distance: number): void {
    if (!Number.isFinite(distance)) return;
    this.deviationThreshold = THREE.MathUtils.clamp(distance, 0.2, 20.0);
  }

  public setWaypoints(waypoints: THREE.Vector3[], opts?: PathFollowerOptions): void {
    this.hasMultiSegmentPath = Array.isArray(waypoints) && waypoints.length > 2;
    const dims = this.getDims();
    const nominalClear = Math.max(dims.x, dims.y, dims.z) * 0.8;
    const endClearanceAbs = THREE.MathUtils.clamp(opts?.endClearanceAbs ?? nominalClear, 0.5, 1.5);

    const vMax = this.getMaxLinearVelocity();

    // Get actual spacecraft braking capability (minimum axis acceleration)
    const caps = this.getAxisLinearAccelCaps();
    const maxBrakingAccel = Math.min(caps.x, caps.y, caps.z);

    const followerOpts: PathFollowerOptions = {
      sampleSpacing: opts?.sampleSpacing,
      maxSamples: opts?.maxSamples,
      lookaheadMin: opts?.lookaheadMin ?? 1.5,
      lookaheadMax: opts?.lookaheadMax ?? Math.max(6, vMax),
      lookaheadGain: opts?.lookaheadGain ?? 1.0,
      endClearanceAbs,
      curved: !this.hasMultiSegmentPath,
      maxBrakingAccel: opts?.maxBrakingAccel ?? maxBrakingAccel, // Use actual spacecraft capability
      terminalSpeedGain: opts?.terminalSpeedGain ?? 2.0,
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

  /** Set spacecraft UUIDs to exclude from obstacle collection (e.g. docking target during dock phase). */
  public setExcludedSpacecraft(uuids: Set<string>): void {
    this.excludedSpacecraft = uuids;
  }

  public collectObstacles(spacecraft: Spacecraft): Obstacle[] {
    const res: Obstacle[] = [];
    try {
      const world: WorldLike | undefined = (spacecraft as unknown as { registry?: WorldLike }).registry
        ?? (spacecraft as unknown as { basicWorld?: WorldLike }).basicWorld;
      const target = this.getTargetObject();
      if (target && !this.excludedSpacecraft.has(target.uuid)) {
        res.push({ position: target.objects.box.position.clone(), size: target.getFullDimensions().clone(), isTarget: true });
      }
      const otherCraft = (world?.getSpacecraftList?.() || []).filter((s: Spacecraft) => s !== spacecraft);
      for (const s of otherCraft) {
        if (this.excludedSpacecraft.has(s.uuid)) continue;
        res.push({ position: s.objects.box.position.clone(), size: s.getFullDimensions().clone(), isTarget: false });
      }
      try {
        const ast = world?.getAsteroidObstacles?.() || [];
        for (const a of ast) res.push({ position: a.position.clone(), size: a.size.clone(), isTarget: false });
      } catch { }
    } catch { }
    return res;
  }

  private getObstacleRadius(size: THREE.Vector3): number {
    return Math.max(size.x, size.y, size.z);
  }

  private filterObstaclesNearSegment(obstacles: Obstacle[], start: THREE.Vector3, goal: THREE.Vector3, nearDist: number): Obstacle[] {
    this._seg.subVectors(goal, start);
    const segLen = Math.max(EPS, this._seg.length());
    this._segDir.copy(this._seg).multiplyScalar(1 / segLen);
    return obstacles.filter(o => {
      this._w.subVectors(o.position, start);
      const u = THREE.MathUtils.clamp(this._w.dot(this._segDir), 0, segLen);
      this._closestPt.copy(start).addScaledVector(this._segDir, u);
      const dist = this._closestPt.distanceTo(o.position);
      const r = this.getObstacleRadius(o.size);
      return dist <= (nearDist + r);
    });
  }

  private haveObstaclesChangedNear(spacecraft: Spacecraft, start: THREE.Vector3, goal: THREE.Vector3): boolean {
    const curr = this.collectObstacles(spacecraft);
    const near = this.filterObstaclesNearSegment(curr, start, goal, 12.0);
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

  private getSpacecraftRadius(): number {
    try {
      const d = this.getDims();
      return this.getObstacleRadius(d);
    } catch {
      return 1.0;
    }
  }

  public buildAvoidancePath(spacecraft: Spacecraft, start: THREE.Vector3, goal: THREE.Vector3): THREE.Vector3[] {
    try {
      let objs = this.collectObstacles(spacecraft);
      const craftR = this.getSpacecraftRadius();
      const safetyBoxes = objs.map(o => TrajectoryPlanner.calculateSafetyBox(o.position, o.size, o.isTarget, craftR));
      const directBlocked = TrajectoryPlanner.doesLineIntersectAnySafetyBox(start, goal, safetyBoxes);
      if (!directBlocked) return [start, goal];

      const nearObjs = this.filterObstaclesNearSegment(objs, start, goal, 12.0);
      objs = nearObjs.length ? nearObjs : objs;

      const wps = TrajectoryPlanner.calculateAvoidanceWaypoints(start, goal, objs, craftR);
      return wps && wps.length >= 2 ? wps : [start, goal];
    } catch { return [start, goal]; }
  }

  public updateFollowStep(spacecraft: Spacecraft, targetPosition: THREE.Vector3, _targetOrientation: THREE.Quaternion, referenceVelocityWorld: THREE.Vector3 | null): { useFollower: boolean } {
    const p = spacecraft.getWorldPositionRef();
    const v = spacecraft.getWorldVelocityRef();

    // No path: simple direct guidance with braking
    if (!this.follower) {
      this.updateDirectGuidance(p, targetPosition, referenceVelocityWorld);
      return { useFollower: false };
    }

    // Use PathFollower for guided trajectory
    const followerState = this.follower.update(p, v);
    if (followerState.done) {
      // Smooth handoff: once the path follower is "done", continue directly to
      // the true target so we do not hover/chatter at end-clearance offset.
      this.updateDirectGuidance(p, targetPosition, referenceVelocityWorld);
      return { useFollower: false };
    }
    this.carrot.copy(followerState.carrot);
    this.vRef.copy(followerState.velocityRef);
    if (referenceVelocityWorld) this.vRef.add(referenceVelocityWorld);

    return { useFollower: true };
  }

  private updateDirectGuidance(currentPosition: THREE.Vector3, targetPosition: THREE.Vector3, vGoal: THREE.Vector3 | null): void {
    this.carrot.copy(targetPosition);
    this._toTarget.subVectors(targetPosition, currentPosition);
    const dist = this._toTarget.length();
    if (dist <= EPS) {
      if (vGoal) this.vRef.copy(vGoal);
      else this.vRef.set(0, 0, 0);
      return;
    }

    // Blended terminal profile to avoid endpoint limit cycles:
    // v <= sqrt(2*a*d) and v <= k*d
    const caps = this.getAxisLinearAccelCaps();
    const aBrake = Math.max(EPS, Math.min(caps.x, caps.y, caps.z));
    this._dir.copy(this._toTarget).multiplyScalar(1 / dist);
    const vTargetBrake = Math.sqrt(2 * aBrake * dist);
    // Terminal capture gain: v <= k*d. Lower k = more damped approach, less overshoot.
    // 1.0 provides critically damped behavior for thruster-quantized systems.
    const vTargetLinear = 1.0 * dist;
    const speed = Math.min(this.getMaxLinearVelocity(), vTargetBrake, vTargetLinear);
    this.vRef.copy(this._dir).multiplyScalar(speed);
    if (vGoal) this.vRef.add(vGoal);
  }
}

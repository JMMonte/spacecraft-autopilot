import * as THREE from 'three';
import type { PathFollowerOptions, PathFollowerState } from './types';

const EPS = 1e-6;

export class PathFollower {
  private opts: Required<PathFollowerOptions>;
  private samples: THREE.Vector3[] = [];
  private tangents: THREE.Vector3[] = [];
  private arc: number[] = [];
  private totalS = 0;
  private lastIdx = 0;
  private lastState: PathFollowerState | null = null;

  // Scratch vectors — reused every frame to avoid GC pressure
  private _ab = new THREE.Vector3();
  private _ap = new THREE.Vector3();
  private _closest = new THREE.Vector3();
  private _seg0 = new THREE.Vector3();
  private _seg1 = new THREE.Vector3();
  private _q0 = new THREE.Vector3();
  private _q1 = new THREE.Vector3();
  private _interpPos = new THREE.Vector3();
  private _interpTan = new THREE.Vector3();
  private _carrotOut = new THREE.Vector3();
  private _velRefOut = new THREE.Vector3();

  constructor(waypoints: THREE.Vector3[], options: PathFollowerOptions = {}) {
    this.opts = {
      sampleSpacing: options.sampleSpacing ?? 0.4,
      maxSamples: Math.max(4, Math.floor(options.maxSamples ?? 2000)),
      lookaheadMin: options.lookaheadMin ?? 1.5,
      lookaheadMax: options.lookaheadMax ?? 12.0,
      lookaheadGain: options.lookaheadGain ?? 1.0,
      endClearanceAbs: Math.max(0, options.endClearanceAbs ?? 0.05), // 5cm
      curved: options.curved ?? true,
      maxBrakingAccel: Math.max(0.5, options.maxBrakingAccel ?? 2.0), // Default 2.0 m/s²
      terminalSpeedGain: Math.max(0.1, options.terminalSpeedGain ?? 2.0),
    };
    this.setWaypoints(waypoints);
  }

  public setWaypoints(pts: THREE.Vector3[]): void {
    this.rebuildSamples(pts);
  }

  public clear(): void {
    this.samples = [];
    this.tangents = [];
    this.arc = [];
    this.totalS = 0;
    this.lastIdx = 0;
    this.lastState = null;
  }

  public getSamples(): THREE.Vector3[] { return this.samples.map(p => p.clone()); }
  public getLength(): number { return this.totalS; }
  public getProgress(): { sCur: number; sRem: number; sTotal: number; idx: number; done: boolean } {
    if (!this.lastState) return { sCur: 0, sRem: 0, sTotal: this.totalS, idx: this.lastIdx, done: true };
    const sRem = Math.max(0, this.totalS - this.opts.endClearanceAbs - this.lastState.sCur);
    return { sCur: this.lastState.sCur, sRem, sTotal: this.totalS, idx: this.lastIdx, done: this.lastState.done };
  }

  public distanceToPath(pos: THREE.Vector3): number {
    if (this.samples.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < this.samples.length - 1; i++) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      this._ab.subVectors(b, a);
      this._ap.subVectors(pos, a);
      const t = THREE.MathUtils.clamp(this._ap.dot(this._ab) / Math.max(EPS, this._ab.lengthSq()), 0, 1);
      this._closest.copy(a).addScaledVector(this._ab, t);
      const d2 = pos.distanceToSquared(this._closest);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  private rebuildSamples(waypoints: THREE.Vector3[]): void {
    const pts = this.buildResampledPoints(waypoints);
    if (pts.length < 2) { this.clear(); return; }

    this.samples = pts;
    this.arc = new Array(pts.length).fill(0);
    for (let i = 1; i < pts.length; i++) {
      this.arc[i] = this.arc[i - 1] + pts[i].distanceTo(pts[i - 1]);
    }
    this.totalS = this.arc[this.arc.length - 1];

    this.tangents = pts.map((_, i) => {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(pts.length - 1, i + 1);
      const dir = pts[i1].clone().sub(pts[i0]);
      const len = dir.length();
      return len > EPS ? dir.multiplyScalar(1 / len) : new THREE.Vector3(0, 0, 1);
    });
  }

  private buildResampledPoints(waypoints: THREE.Vector3[]): THREE.Vector3[] {
    const dedupe = (pts: THREE.Vector3[]) => pts.filter((p, i) => i === 0 || !p.equals(pts[i - 1]));
    const clean = dedupe(waypoints);
    if (clean.length < 2) return [];

    if (!this.opts.curved) {
      return this.linearResample(clean);
    }

    try {
      const curve = new THREE.CatmullRomCurve3(clean, false, 'centripetal', 0.5);
      const approxLen = curve.getLength();
      const spacing = Math.max(EPS, this.opts.sampleSpacing);
      const samples = Math.min(this.opts.maxSamples, Math.max(2, Math.ceil(approxLen / spacing)));
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= samples; i++) pts.push(curve.getPoint(i / samples));
      return pts;
    } catch {
      return this.linearResample(clean);
    }
  }

  private linearResample(pts: THREE.Vector3[]): THREE.Vector3[] {
    const spacing = Math.max(EPS, this.opts.sampleSpacing);
    const out: THREE.Vector3[] = [];
    out.push(pts[0].clone());
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i];
      const B = pts[i + 1];
      const seg = B.clone().sub(A);
      const len = Math.max(EPS, seg.length());
      const dir = seg.clone().multiplyScalar(1 / len);
      const n = Math.max(1, Math.floor(len / spacing));
      for (let k = 1; k <= n; k++) {
        const t = Math.min(1, (k * spacing) / len);
        out.push(A.clone().add(dir.clone().multiplyScalar(t * len)));
      }
    }
    if (out.length > this.opts.maxSamples) {
      const stride = Math.ceil(out.length / this.opts.maxSamples);
      const reduced: THREE.Vector3[] = [];
      for (let i = 0; i < out.length; i += stride) reduced.push(out[i]);
      if (!reduced[reduced.length - 1].equals(out[out.length - 1])) reduced.push(out[out.length - 1]);
      return reduced;
    }
    return out;
  }

  private project(pos: THREE.Vector3): { s: number; index: number } {
    if (this.samples.length < 2) return { s: 0, index: 0 };
    const idx = this.findNearestIndex(pos);
    if (idx <= 0) {
      const a = this.samples[0];
      const b = this.samples[1];
      this._ab.subVectors(b, a);
      this._ap.subVectors(pos, a);
      const t = THREE.MathUtils.clamp(this._ap.dot(this._ab) / Math.max(EPS, this._ab.lengthSq()), 0, 1);
      return { s: this.arc[0] + t * Math.max(EPS, this.arc[1] - this.arc[0]), index: 0 };
    }
    if (idx >= this.samples.length - 1) {
      const a = this.samples[this.samples.length - 2];
      const b = this.samples[this.samples.length - 1];
      this._ab.subVectors(b, a);
      this._ap.subVectors(pos, a);
      const t = THREE.MathUtils.clamp(this._ap.dot(this._ab) / Math.max(EPS, this._ab.lengthSq()), 0, 1);
      return { s: this.arc[this.samples.length - 2] + t * Math.max(EPS, this.arc[this.samples.length - 1] - this.arc[this.samples.length - 2]), index: this.samples.length - 2 };
    }
    const prev = this.samples[idx - 1];
    const cur = this.samples[idx];
    const next = this.samples[idx + 1];
    this._seg0.subVectors(cur, prev);
    this._seg1.subVectors(next, cur);
    this._ap.subVectors(pos, prev);
    const t0 = THREE.MathUtils.clamp(this._ap.dot(this._seg0) / Math.max(EPS, this._seg0.lengthSq()), 0, 1);
    this._ap.subVectors(pos, cur);
    const t1 = THREE.MathUtils.clamp(this._ap.dot(this._seg1) / Math.max(EPS, this._seg1.lengthSq()), 0, 1);
    this._q0.copy(prev).addScaledVector(this._seg0, t0);
    this._q1.copy(cur).addScaledVector(this._seg1, t1);
    if (pos.distanceToSquared(this._q0) <= pos.distanceToSquared(this._q1)) {
      return { s: this.arc[idx - 1] + t0 * Math.max(EPS, this.arc[idx] - this.arc[idx - 1]), index: idx - 1 };
    }
    return { s: this.arc[idx] + t1 * Math.max(EPS, this.arc[idx + 1] - this.arc[idx]), index: idx };
  }

  private findNearestIndex(p: THREE.Vector3): number {
    if (this.samples.length === 0) return 0;
    const radius = 12;
    let bestIdx = this.lastIdx;
    let bestD2 = Infinity;
    const start = Math.max(0, this.lastIdx - radius);
    const end = Math.min(this.samples.length - 1, this.lastIdx + radius);
    for (let i = start; i <= end; i++) {
      const d2 = this.samples[i].distanceToSquared(p);
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }
    if (bestD2 > 400) {
      for (let i = 0; i < this.samples.length; i++) {
        const d2 = this.samples[i].distanceToSquared(p);
        if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
      }
    }
    this.lastIdx = bestIdx;
    return bestIdx;
  }

  private interpolateAtS(sTarget: number): void {
    if (this.samples.length === 0) {
      this._interpPos.set(0, 0, 0);
      this._interpTan.set(0, 0, 1);
      return;
    }
    if (sTarget <= 0) {
      this._interpPos.copy(this.samples[0]);
      this._interpTan.copy(this.tangents[0]);
      return;
    }
    if (sTarget >= this.totalS) {
      this._interpPos.copy(this.samples[this.samples.length - 1]);
      this._interpTan.copy(this.tangents[this.tangents.length - 1]);
      return;
    }
    let lo = 0, hi = this.arc.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.arc[mid] <= sTarget) lo = mid; else hi = mid;
    }
    const s0 = this.arc[lo];
    const s1 = this.arc[lo + 1];
    const u = THREE.MathUtils.clamp((sTarget - s0) / Math.max(EPS, s1 - s0), 0, 1);
    this._interpPos.copy(this.samples[lo]).lerp(this.samples[lo + 1], u);
    this._interpTan.copy(this.tangents[lo]).lerp(this.tangents[lo + 1], u).normalize();
  }

  public update(position: THREE.Vector3, velocity: THREE.Vector3): PathFollowerState {
    if (this.samples.length < 2 || this.totalS <= 0) {
      if (this.samples.length) this._carrotOut.copy(this.samples[this.samples.length - 1]);
      else this._carrotOut.copy(position);
      this._velRefOut.set(0, 0, 0);
      this.lastState = { carrot: this._carrotOut, velocityRef: this._velRefOut, done: true, sCur: 0, sTotal: this.totalS };
      return this.lastState;
    }

    const proj = this.project(position);
    const sStop = Math.max(0, this.totalS - this.opts.endClearanceAbs);
    const remaining = Math.max(0, sStop - proj.s);
    const vMag = velocity.length();
    const lookahead = THREE.MathUtils.clamp(this.opts.lookaheadMin + this.opts.lookaheadGain * vMag, this.opts.lookaheadMin, this.opts.lookaheadMax);
    const sTarget = Math.min(sStop, proj.s + Math.min(remaining, lookahead));
    this.interpolateAtS(sTarget);

    // Blended terminal profile:
    // 1) braking bound: v <= sqrt(2*a*d)
    // 2) linear capture bound: v <= k*d (critically damped near endpoint)
    const aBrake = this.opts.maxBrakingAccel;
    const vTargetBrake = Math.sqrt(2 * aBrake * Math.max(0, remaining));
    const vTargetLinear = this.opts.terminalSpeedGain * remaining;
    const speed = Math.min(vTargetBrake, vTargetLinear, this.opts.lookaheadMax);

    this._carrotOut.copy(this._interpPos);
    this._velRefOut.copy(this._interpTan).multiplyScalar(speed);
    const done = remaining <= this.opts.endClearanceAbs;

    this.lastState = { carrot: this._carrotOut, velocityRef: this._velRefOut, done, sCur: proj.s, sTotal: this.totalS };
    return this.lastState;
  }
}

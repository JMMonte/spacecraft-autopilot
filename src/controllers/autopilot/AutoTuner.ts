import * as THREE from 'three';
import type { Spacecraft } from '../../core/spacecraft';
import type { IAutopilot } from './types';
import { fitExponentialTau } from './AutoTuneUtils';
import { PIDController } from '../pidController';

type TuneDomain = 'attitude' | 'rotCancel' | 'position' | 'linMomentum';

export class AutoTuner {
  constructor(
    private ap: IAutopilot,
    private spacecraft: Spacecraft,
    private pids: {
      orientation: PIDController;
      rotationCancel: PIDController;
      position: PIDController;
      momentum: PIDController;
    },
  ) {}

  async run(type: TuneDomain, durationMs: number = 1200): Promise<void> {
    // Snapshot autopilot state
    const prevEnabled = this.ap.getAutopilotEnabled();
    const prevModes = this.ap.getActiveAutopilots();
    // We cannot read reference object here via interface; just clear during tuning

    // Ensure enabled
    this.ap.setEnabled(true);
    this.ap.setReferenceObject(null);

    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const samples: Array<{ t: number; e: number }> = [];
    const sample = () => {
      const tNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const t = (tNow - start) / 1000;
      let e = 0;
      if (type === 'attitude') {
        const q = this.spacecraft.getWorldOrientation();
        const target = this.ap.getTargetOrientation();
        const qInv = q.clone().invert();
        const errQ = qInv.multiply(target);
        const wClamped = Math.max(-1, Math.min(1, errQ.w));
        e = 2 * Math.acos(Math.abs(wClamped)); // radians
      } else if (type === 'rotCancel') {
        const w = this.spacecraft.getWorldAngularVelocity();
        // Approximate |L| as |w| with unit inertia scaling for sampling
        e = w.length();
      } else if (type === 'position') {
        const p = this.spacecraft.getWorldPosition();
        const tgt = this.ap.getTargetPosition();
        e = p.distanceTo(tgt);
      } else if (type === 'linMomentum') {
        const v = this.spacecraft.getWorldVelocity();
        e = v.length();
      }
      samples.push({ t, e });
    };

    // Excite system
    const q0 = this.spacecraft.getWorldOrientation();
    const p0 = this.spacecraft.getWorldPosition();
    try {
      if (type === 'attitude') {
        const axis = new THREE.Vector3(0, 1, 0);
        const angle = THREE.MathUtils.degToRad(12);
        const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        const target = dq.multiply(q0.clone());
        this.ap.setTargetOrientation(target);
        this.ap.setMode('orientationMatch', true);
      } else if (type === 'rotCancel') {
        try {
          const rb: any = (this.spacecraft as any)?.objects?.rigid;
          if (rb) {
            const av = rb.getAngularVelocity?.() || { x: 0, y: 0, z: 0 };
            const nearZero = (Math.abs(av.y) + Math.abs(av.x) + Math.abs(av.z)) < 1e-3;
            if (nearZero && rb.setAngularVelocity) rb.setAngularVelocity({ x: 0, y: 0.4, z: 0 });
          }
        } catch {}
        this.ap.setMode('cancelRotation', true);
      } else if (type === 'position') {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q0);
        const tgt = p0.clone().add(forward.multiplyScalar(0.8));
        this.ap.setTargetPosition(tgt);
        this.ap.setMode('goToPosition', true);
      } else if (type === 'linMomentum') {
        try {
          const rb: any = (this.spacecraft as any)?.objects?.rigid;
          if (rb) {
            const lv = rb.getLinearVelocity?.() || { x: 0, y: 0, z: 0 };
            const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
            if (speed < 0.1 && rb.setLinearVelocity) rb.setLinearVelocity({ x: 0.4, y: 0, z: 0 });
          }
        } catch {}
        this.ap.setMode('cancelLinearMotion', true);
      }

      // Sample during the window (use rAF where present)
      const end = start + durationMs;
      await new Promise<void>((resolve) => {
        const tick = () => {
          sample();
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if (now >= end) return resolve();
          (typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame(tick) : setTimeout(tick, 16);
        };
        tick();
      });

      const tau = fitExponentialTau(samples);
      if (type === 'attitude') this.pids.orientation.tuneFromTau('attitude', tau);
      else if (type === 'rotCancel') this.pids.rotationCancel.tuneFromTau('rotCancel', tau);
      else if (type === 'position') this.pids.position.tuneFromTau('position', tau);
      else if (type === 'linMomentum') this.pids.momentum.tuneFromTau('linMomentum', tau);
    } finally {
      // Restore previous autopilot config
      this.ap.setMode('goToPosition', !!prevModes.goToPosition);
      this.ap.setMode('orientationMatch', !!prevModes.orientationMatch);
      this.ap.setMode('cancelLinearMotion', !!prevModes.cancelLinearMotion);
      this.ap.setMode('cancelRotation', !!prevModes.cancelRotation);
      this.ap.setMode('pointToPosition', !!prevModes.pointToPosition);
      if (!prevEnabled) this.ap.setEnabled(false);
    }
  }
}

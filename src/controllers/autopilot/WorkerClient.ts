import type * as THREE from 'three';
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import type { AutopilotConfig } from './types';
import type { AutopilotModes, AutopilotTelemetry, WorkerInboundMsg, WorkerPlanPathMsg, WorkerThrusterConfig } from './types';
import { ControlScheduler } from './ControlScheduler';

type Snapshot = { p: [number, number, number]; q: [number, number, number, number]; lv: [number, number, number]; av: [number, number, number] };

type Callbacks = {
  onReady?: () => void;
  onForces?: (forces: Float32Array, telemetry: AutopilotTelemetry) => void;
  onPlanPathResult?: (id: number, points: Float32Array) => void;
  onError?: (err: unknown) => void;
};

export class WorkerClient {
  private worker?: Worker;
  private ready = false;
  private scheduler = new ControlScheduler(30, true);

  constructor(private cbs: Callbacks = {}) {}

  public isReady(): boolean { return this.ready; }
  public setUpdateRateHz(hz: number): void { this.scheduler.setRateHz(hz); }

  init(params: { thrusterGroups: ThrusterGroups; thrust: number; config: AutopilotConfig; mass: number; dims: THREE.Vector3; thrusters: WorkerThrusterConfig[]; strengths: number[]; autoCalibrate?: boolean; }): void {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.worker = new Worker(new URL('../../workers/autopilot.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      this.cbs.onError?.(err);
      this.ready = false;
      return;
    }
    this.worker.onmessage = (ev: MessageEvent<any>) => {
      const data = ev.data as WorkerInboundMsg | any;
      if (data?.type === 'ready') { this.ready = true; this.cbs.onReady?.(); return; }
      if (data?.type === 'forces' && data.forces) {
        this.cbs.onForces?.(data.forces, data.telemetry || {});
        return;
      }
      if (data?.type === 'planPathResult') {
        this.cbs.onPlanPathResult?.(data.id, data.points || new Float32Array(0));
        return;
      }
    };
    this.worker.postMessage({
      type: 'init',
      thrusterGroups: params.thrusterGroups,
      thrust: params.thrust,
      config: params.config,
      mass: params.mass,
      dims: [params.dims.x, params.dims.y, params.dims.z] as [number, number, number],
      thrusterConfigs: params.thrusters,
      thrusterStrengths: params.strengths,
      autoCalibrate: !!params.autoCalibrate,
    });
    this.scheduler.reset(true);
  }

  terminate(): void { try { this.worker?.terminate(); } catch {} this.worker = undefined; this.ready = false; }

  setGains(gains: { orientation: { kp: number; ki: number; kd: number }; rotationCancel?: { kp: number; ki: number; kd: number }; position: { kp: number; ki: number; kd: number }; momentum: { kp: number; ki: number; kd: number } }): void { try { this.worker?.postMessage({ type: 'setGains', gains }); } catch {} }
  setThrusterStrengths(strengths: number[]): void { try { this.worker?.postMessage({ type: 'setThrusterStrengths', strengths }); } catch {} }
  setThrusterGroups(groups: ThrusterGroups): void { try { this.worker?.postMessage({ type: 'setThrusterGroups', groups }); } catch {} }
  setThrusters(thrusters: WorkerThrusterConfig[]): void { try { this.worker?.postMessage({ type: 'setThrusters', thrusters }); } catch {} }
  setThrust(thrust: number): void { try { this.worker?.postMessage({ type: 'setThrust', thrust }); } catch {} }

  /** Check if the scheduler is ready for a new update. Returns controlDt or null. Accumulates dt internally. */
  shouldUpdate(dt: number): number | null {
    if (!this.worker || !this.ready) return null;
    return this.scheduler.consume(dt);
  }

  /** Post an update to the worker. Only call after shouldUpdate returned non-null. */
  postUpdate(controlDt: number, payload: { snapshot: Snapshot; active: AutopilotModes; targetPos: [number, number, number]; targetQuat: [number, number, number, number]; refVel: [number, number, number]; finalTarget?: [number, number, number]; obstacles?: Array<{ pos: [number, number, number]; radius: number }>; craftRadius?: number; trackRef?: boolean; rotScale?: number; }): void {
    try { this.worker!.postMessage({ type: 'update', dt: controlDt, ...payload }); } catch {}
  }

  planPath(id: number, start: [number, number, number], goal: [number, number, number], obstacles: WorkerPlanPathMsg['obstacles']): void {
    try { this.worker?.postMessage({ type: 'planPath', id, start, goal, obstacles }); } catch {}
  }
}

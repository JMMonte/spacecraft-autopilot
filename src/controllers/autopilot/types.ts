import * as THREE from 'three';
import type { Spacecraft } from '../../core/spacecraft';
import type { ThrusterGroups } from '../../config/spacecraftConfig';

export interface AutopilotConfig {
    pid: {
        orientation: { kp: number; ki: number; kd: number; };
        position: { kp: number; ki: number; kd: number; };
        momentum: { kp: number; ki: number; kd: number; };
    };
    limits: {
        maxForce: number;
        epsilon: number;
        maxAngularMomentum: number;
        maxLinearMomentum: number;
        maxAngularVelocity: number;
        maxAngularAcceleration: number;
        maxLinearVelocity?: number;
        maxLinearAcceleration?: number;
    };
    damping: {
        factor: number;
    };
    customInertia?: { x: number; y: number; z: number };
    inertiaMode?: 'solid' | 'hollow' | 'thin-shell';
}

// Mode names and state
export type AutopilotModeName =
  | 'orientationMatch'
  | 'cancelRotation'
  | 'cancelLinearMotion'
  | 'pointToPosition'
  | 'goToPosition';

export type AutopilotModes = Record<AutopilotModeName, boolean>;

export interface AutopilotState {
  enabled: boolean;
  activeAutopilots: AutopilotModes;
}

export type TargetPoint = 'center' | 'front' | 'back';

// Telemetry types
export interface OrientationLikeTelemetry {
  angleDeg: number;
  alphaMax: number;
  omegaMax: number;
  Ieff: number;
  wDesMag: number;
  LErr: number;
  deadband: boolean;
}

export type PointToPositionTelemetry = OrientationLikeTelemetry;
export type OrientationMatchTelemetry = OrientationLikeTelemetry;

export interface Vec3Telemetry {
  x: number;
  y: number;
  z: number;
}

export interface GoToPositionTelemetry {
  distance: number;
  vAlong: number;
  vDes: number;
  dStop: number;
  braking: boolean;
  alignAngleDeg: number;
  alignGate: boolean;
  aMax: number;
  vMax: number;
  aCmdLocal?: Vec3Telemetry;
  targetType?: 'spacecraft' | 'static';
  vTargetMag?: number;
  vTargetAlong?: number;
  vRelMag?: number;
  tGo?: number;
  missMag?: number;
  // Bang-coast-bang maneuver telemetry
  maneuverPhase?: string;            // 'burn_accel' | 'coast' | 'burn_decel' | 'done' | 'idle'
  maneuverTimeRemaining?: number;    // seconds remaining in current maneuver
  thrusterDutyCycle?: number;        // 0-1, fraction of frames with thrusters firing
  coastFraction?: number;            // 0-1, fraction of planned maneuver that is coast
  // Legacy fields kept during telemetry migration.
  vCmd?: Vec3Telemetry;
  vActual?: Vec3Telemetry;
  vError?: Vec3Telemetry;
  aCmd?: Vec3Telemetry;
  positionError?: Vec3Telemetry;
}

export interface AutopilotTelemetry {
  point?: PointToPositionTelemetry;
  orient?: OrientationMatchTelemetry;
  goto?: GoToPositionTelemetry;
}

// Path follower telemetry snippets consumed by UI
export interface PathFollowerProgress {
  sCur: number; // current arc-length position
  sRem: number; // remaining arc-length
  sTotal: number; // total arc-length of path
  idx: number; // nearest sample index
  done: boolean;
}

// Worker wiring types
export type WorkerThrusterConfig = {
  position: [number, number, number];
  direction: [number, number, number];
};

export type WorkerInitMsg = {
  type: 'init';
  thrusterGroups: ThrusterGroups;
  thrust: number;
  config: AutopilotConfig;
  mass: number;
  dims: [number, number, number];
  thrusterConfigs: WorkerThrusterConfig[];
  thrusterStrengths?: number[];
  autoCalibrate?: boolean;
};

export type WorkerSetGainsMsg = {
  type: 'setGains';
  gains: {
    orientation: { kp: number; ki: number; kd: number };
    rotationCancel?: { kp: number; ki: number; kd: number };
    position: { kp: number; ki: number; kd: number };
    momentum: { kp: number; ki: number; kd: number };
  };
};

export type WorkerCalibrateMsg = {
  type: 'calibrate';
  targets: Array<'rotation' | 'linear' | 'momentum' | 'attitude' | 'rotCancel'>;
};

export type WorkerSetThrusterStrengthsMsg = {
  type: 'setThrusterStrengths';
  strengths: number[];
};

export type WorkerSetThrusterGroupsMsg = {
  type: 'setThrusterGroups';
  groups: ThrusterGroups;
};

export type WorkerSetThrustersMsg = {
  type: 'setThrusters';
  thrusters: WorkerThrusterConfig[];
};

export type WorkerSetThrustMsg = {
  type: 'setThrust';
  thrust: number;
};

export type WorkerUpdateMsg = {
  type: 'update';
  dt: number;
  snapshot: {
    p: [number, number, number];
    q: [number, number, number, number];
    lv: [number, number, number];
    av: [number, number, number];
  };
  active: AutopilotModes;
  targetPos: [number, number, number];
  targetQuat: [number, number, number, number];
  refVel: [number, number, number];
  finalTarget?: [number, number, number];
  obstacles?: Array<{ pos: [number, number, number]; radius: number }>;
  craftRadius?: number;
  trackRef?: boolean;
  rotScale?: number;
};

export type WorkerPlanPathMsg = {
  type: 'planPath';
  id: number;
  start: [number, number, number];
  goal: [number, number, number];
  obstacles: Array<{ pos: [number, number, number]; size: [number, number, number]; isTarget: boolean }>;
};

export type WorkerInboundMsg =
  | WorkerInitMsg
  | WorkerUpdateMsg
  | WorkerSetGainsMsg
  | WorkerCalibrateMsg
  | WorkerSetThrusterStrengthsMsg
  | WorkerSetThrusterGroupsMsg
  | WorkerSetThrustersMsg
  | WorkerSetThrustMsg
  | WorkerPlanPathMsg;

export type WorkerOutboundMsg =
  | { type: 'ready' }
  | { type: 'forces'; forces: Float32Array; telemetry: AutopilotTelemetry }
  | { type: 'planPathResult'; id: number; points: Float32Array };

// Public autopilot interface (subset of Autopilot class)
export interface IAutopilot {
  setEnabled(enabled: boolean): void;
  getAutopilotEnabled(): boolean;
  setMode(mode: AutopilotModeName, enabled?: boolean): void;
  getActiveAutopilots(): AutopilotModes;
  calculateAutopilotForces(dt: number): number[];

  setTargetPosition(position: THREE.Vector3): void;
  setTargetOrientation(orientation: THREE.Quaternion): void;
  setTargetObject(target: Spacecraft | null, targetPoint: TargetPoint): void;
  setReferenceObject(obj: Spacecraft | null): void;
  getTargetPosition(): THREE.Vector3;
  getTargetOrientation(): THREE.Quaternion;
  resetAllModes(): void;

  setOnStateChange(cb: (state: AutopilotState) => void): void;

  // Optional path helpers exposed for UI
  setPathWaypoints(waypoints: THREE.Vector3[], opts?: {
    sampleSpacing?: number;
    maxSamples?: number;
    lookaheadMin?: number;
    lookaheadMax?: number;
    lookaheadGain?: number;
    lookaheadFraction?: number;
    endClearanceAbs?: number;
  }): void;
  clearPath(): void;
  getPathSamples(): THREE.Vector3[] | null;
  getPathProgress(): PathFollowerProgress | null;
  getPathCarrot(): THREE.Vector3 | null;

  // Telemetry getters
  getPointToPositionTelemetry(): PointToPositionTelemetry | null | undefined;
  getOrientationMatchTelemetry(): OrientationMatchTelemetry | null | undefined;
  getGoToPositionTelemetry(): GoToPositionTelemetry | null | undefined;
}

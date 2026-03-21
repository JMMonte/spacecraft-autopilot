import * as THREE from 'three';

export interface PathFollowerOptions {
  sampleSpacing?: number;
  maxSamples?: number;
  lookaheadMin?: number;
  lookaheadMax?: number;
  lookaheadGain?: number;
  endClearanceAbs?: number;
  curved?: boolean;
  maxBrakingAccel?: number; // Maximum deceleration capability (m/s²) for braking distance calc
  terminalSpeedGain?: number; // v <= k*d near endpoint for smooth capture
}

export interface PathFollowerState {
  carrot: THREE.Vector3;
  velocityRef: THREE.Vector3;
  done: boolean;
  sCur: number;
  sTotal: number;
}

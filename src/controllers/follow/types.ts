import * as THREE from 'three';

export interface PathFollowerOptions {
  sampleSpacing?: number;
  maxSamples?: number;
  lookaheadMin?: number;
  lookaheadMax?: number;
  lookaheadGain?: number;
  endClearanceAbs?: number;
  curved?: boolean;
}

export interface PathFollowerState {
  carrot: THREE.Vector3;
  velocityRef: THREE.Vector3;
  done: boolean;
  sCur: number;
  sTotal: number;
}

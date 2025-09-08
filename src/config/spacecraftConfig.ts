import * as THREE from 'three';

// Centralized spacecraft configuration helpers
// - Thruster layout builder preserves existing ordering
// - Group indices match current controller usage

export interface ThrusterRotation {
  axis: THREE.Vector3;
  angle: number;
}

export interface ThrusterData {
  position: [number, number, number];
  rotation: ThrusterRotation;
}

export interface ThrusterGroups {
  forward: number[][]; // [positiveZGroup, negativeZGroup]
  up: number[][];      // [positiveYGroup, negativeYGroup]
  left: number[][];    // [negativeXGroup, positiveXGroup] (kept naming for compatibility)
  pitch: number[][];   // [pitchUp, pitchDown]
  yaw: number[][];     // [yawLeft, yawRight]
  roll: number[][];    // [rollRight, rollLeft]
}

export interface SpacecraftBody {
  width: number;
  height: number;
  depth: number;
}

export interface SpacecraftRcsConfig {
  thrusters: ThrusterData[];
  groups: ThrusterGroups;
}

export interface SpacecraftConfig {
  body: SpacecraftBody;
  rcs: SpacecraftRcsConfig;
  // Future: add components array to preserve full hierarchy (tanks, ports, trusses, etc.)
}

/**
 * Build the default 24-thruster RCS layout for a rectangular body.
 * Ordering and directions match the previous RCSVisuals implementation.
 */
export function buildBasicRcsThrusters(
  body: SpacecraftBody,
  coneHeight: number
): ThrusterData[] {
  const halfWidth = body.width / 2;
  const halfHeight = body.height / 2;
  const halfDepth = body.depth / 2;
  const halfCones = coneHeight / 2;

  const xAxis = new THREE.Vector3(1, 0, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const halfPi = Math.PI / 2;

  const thrusters: ThrusterData[] = [];

  // Front Face (fires to +Z in world when mounted on -Z face)
  thrusters.push(
    { position: [-halfWidth, -halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis.clone(), angle: -halfPi } },
    { position: [-halfWidth,  halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis.clone(), angle: -halfPi } },
    { position: [ halfWidth, -halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis.clone(), angle: -halfPi } },
    { position: [ halfWidth,  halfHeight, -halfDepth - halfCones], rotation: { axis: xAxis.clone(), angle: -halfPi } },
  );

  // Back Face (fires to -Z in world when mounted on +Z face)
  thrusters.push(
    { position: [-halfWidth, -halfHeight,  halfDepth + halfCones], rotation: { axis: xAxis.clone(), angle:  halfPi } },
    { position: [-halfWidth,  halfHeight,  halfDepth + halfCones], rotation: { axis: xAxis.clone(), angle:  halfPi } },
    { position: [ halfWidth, -halfHeight,  halfDepth + halfCones], rotation: { axis: xAxis.clone(), angle:  halfPi } },
    { position: [ halfWidth,  halfHeight,  halfDepth + halfCones], rotation: { axis: xAxis.clone(), angle:  halfPi } },
  );

  // Top Face
  thrusters.push(
    { position: [-halfWidth,  halfHeight + halfCones, -halfDepth], rotation: { axis: zAxis.clone(), angle: 0 } },
    { position: [ halfWidth,  halfHeight + halfCones, -halfDepth], rotation: { axis: zAxis.clone(), angle: 0 } },
    { position: [ halfWidth,  halfHeight + halfCones,  halfDepth], rotation: { axis: zAxis.clone(), angle: 0 } },
    { position: [-halfWidth,  halfHeight + halfCones,  halfDepth], rotation: { axis: zAxis.clone(), angle: 0 } },
  );

  // Bottom Face
  thrusters.push(
    { position: [-halfWidth, -halfHeight - halfCones, -halfDepth], rotation: { axis: zAxis.clone(), angle: Math.PI } },
    { position: [ halfWidth, -halfHeight - halfCones, -halfDepth], rotation: { axis: zAxis.clone(), angle: Math.PI } },
    { position: [ halfWidth, -halfHeight - halfCones,  halfDepth], rotation: { axis: zAxis.clone(), angle: Math.PI } },
    { position: [-halfWidth, -halfHeight - halfCones,  halfDepth], rotation: { axis: zAxis.clone(), angle: Math.PI } },
  );

  // Left Face (+X side, thrusters aim +X/-X via +/−90° about Z)
  thrusters.push(
    { position: [ halfWidth + halfCones,  halfHeight, -halfDepth], rotation: { axis: zAxis.clone(), angle: -halfPi } },
    { position: [ halfWidth + halfCones, -halfHeight, -halfDepth], rotation: { axis: zAxis.clone(), angle: -halfPi } },
    { position: [ halfWidth + halfCones,  halfHeight,  halfDepth], rotation: { axis: zAxis.clone(), angle: -halfPi } },
    { position: [ halfWidth + halfCones, -halfHeight,  halfDepth], rotation: { axis: zAxis.clone(), angle: -halfPi } },
  );

  // Right Face (-X side)
  thrusters.push(
    { position: [-halfWidth - halfCones,  halfHeight, -halfDepth], rotation: { axis: zAxis.clone(), angle:  halfPi } },
    { position: [-halfWidth - halfCones, -halfHeight, -halfDepth], rotation: { axis: zAxis.clone(), angle:  halfPi } },
    { position: [-halfWidth - halfCones,  halfHeight,  halfDepth], rotation: { axis: zAxis.clone(), angle:  halfPi } },
    { position: [-halfWidth - halfCones, -halfHeight,  halfDepth], rotation: { axis: zAxis.clone(), angle:  halfPi } },
  );

  return thrusters;
}

/**
 * Provide default thruster groups matching existing controller mapping.
 */
export function getBasicThrusterGroups(): ThrusterGroups {
  return {
    forward: [
      [0, 1, 2, 3],     // Forward (+Z) thrusters (mounted on front/-Z face)
      [4, 5, 6, 7],     // Back (-Z) thrusters (mounted on back/+Z face)
    ],
    up: [
      [12, 13, 14, 15], // Up (+Y) thrusters (top)
      [8, 9, 10, 11],   // Down (-Y) thrusters (bottom)
    ],
    left: [
      [16, 17, 18, 19], // Left (-X) thrusters (mounted on +X side)
      [20, 21, 22, 23], // Right (+X) thrusters (mounted on -X side)
    ],
    pitch: [
      [0, 2, 5, 7, 8, 9, 14, 15],   // Pitch up
      [1, 3, 4, 6, 10, 11, 12, 13], // Pitch down
    ],
    yaw: [
      [0, 1, 6, 7], // Yaw left
      [2, 3, 4, 5], // Yaw right
    ],
    roll: [
      [8, 11, 13, 14],  // Roll right
      [9, 10, 12, 15],  // Roll left
    ],
  };
}

/** Build a complete default spacecraft config for given body dimensions. */
export function buildDefaultSpacecraftConfig(body: SpacecraftBody, coneHeight: number): SpacecraftConfig {
  return {
    body,
    rcs: {
      thrusters: buildBasicRcsThrusters(body, coneHeight),
      groups: getBasicThrusterGroups(),
    },
  };
}


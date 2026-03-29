import { useSyncExternalStore } from 'react';
import * as THREE from 'three';

export type TelemetrySnapshot = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  orientation: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  mass: number;
  thrusterStatus: readonly boolean[];
};

type Listener = () => void;

let snapshot: TelemetrySnapshot | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function cloneSnapshot(next: TelemetrySnapshot): TelemetrySnapshot {
  return Object.freeze({
    position: Object.freeze(next.position.clone()),
    velocity: Object.freeze(next.velocity.clone()),
    orientation: Object.freeze(next.orientation.clone()),
    angularVelocity: Object.freeze(next.angularVelocity.clone()),
    mass: next.mass,
    thrusterStatus: Object.freeze([...next.thrusterStatus]),
  });
}

export function subscribeTelemetrySnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TelemetrySnapshot | null {
  return snapshot;
}

export function setTelemetrySnapshot(next: TelemetrySnapshot | null): void {
  snapshot = next ? cloneSnapshot(next) : null;
  emit();
}

export function getTelemetrySnapshot(): TelemetrySnapshot | null {
  return snapshot;
}

export function resetTelemetrySnapshotForTests(): void {
  snapshot = null;
  emit();
}

export function useTelemetrySnapshot(): TelemetrySnapshot | null {
  return useSyncExternalStore(subscribeTelemetrySnapshot, getSnapshot, getSnapshot);
}

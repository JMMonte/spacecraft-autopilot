import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import * as THREE from 'three';
import {
  getTelemetrySnapshot,
  resetTelemetrySnapshotForTests,
  setTelemetrySnapshot,
  subscribeTelemetrySnapshot,
} from '../../../src/components/windows/telemetrySnapshotStore';

afterEach(() => {
  resetTelemetrySnapshotForTests();
});

test('telemetry snapshot store snapshots payloads, notifies subscribers, and resets cleanly', () => {
  const observedMasses: Array<number | null> = [];
  const unsubscribe = subscribeTelemetrySnapshot(() => {
    observedMasses.push(getTelemetrySnapshot()?.mass ?? null);
  });

  const source = {
    position: new THREE.Vector3(1, 2, 3),
    velocity: new THREE.Vector3(4, 5, 6),
    orientation: new THREE.Quaternion(0, 0, 0, 1),
    angularVelocity: new THREE.Vector3(7, 8, 9),
    mass: 42,
    thrusterStatus: [true, false, true],
  };

  setTelemetrySnapshot(source);

  const snapshot = getTelemetrySnapshot();
  assert.ok(snapshot);
  assert.notEqual(snapshot, source);
  assert.notEqual(snapshot?.position, source.position);
  assert.notEqual(snapshot?.thrusterStatus, source.thrusterStatus);
  assert.equal(snapshot?.mass, 42);
  assert.ok(Object.isFrozen(snapshot));

  source.position.set(9, 9, 9);
  source.thrusterStatus[0] = false;

  assert.deepEqual(snapshot?.position.toArray(), [1, 2, 3]);
  assert.deepEqual(snapshot?.thrusterStatus, [true, false, true]);

  resetTelemetrySnapshotForTests();

  assert.equal(getTelemetrySnapshot(), null);
  assert.deepEqual(observedMasses, [42, null]);

  unsubscribe();
  setTelemetrySnapshot(source);
  assert.deepEqual(observedMasses, [42, null]);
});

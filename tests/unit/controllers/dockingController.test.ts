import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { DockingController } from '../../../src/controllers/docking/DockingController';

test('DockingController cleanup unsubscribes from spacecraft list changes', () => {
  const subscribers = new Set<() => void>();

  const registry = {
    getSpacecraftList: () => [],
    getAsteroidObstacles: () => [],
    onSpacecraftListChanged: (callback: () => void) => {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  };

  const spacecraft = {
    uuid: 'craft-1',
    name: 'Craft 1',
    registry,
    basicWorld: null,
    objects: {
      dockingPortRadius: 1,
      dockingPortLength: 1,
      boxDepth: 2,
      box: new THREE.Object3D(),
    },
    getWorldPosition: () => new THREE.Vector3(),
    getWorldVelocity: () => new THREE.Vector3(),
    getWorldAngularVelocity: () => new THREE.Vector3(),
    getWorldOrientation: () => new THREE.Quaternion(),
    getFullDimensions: () => new THREE.Vector3(1, 1, 1),
    getDockingPortWorldDirection: () => new THREE.Vector3(0, 0, 1),
    getDockingPortWorldPosition: () => new THREE.Vector3(),
    getCompoundMembers: () => [],
  } as any;

  const controller = new DockingController(spacecraft, new THREE.Scene());
  assert.equal(subscribers.size, 1);

  controller.cleanup();
  assert.equal(subscribers.size, 0);

  controller.cleanup();
  assert.equal(subscribers.size, 0);
});

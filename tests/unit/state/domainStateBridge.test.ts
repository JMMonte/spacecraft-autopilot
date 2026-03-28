import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  emitAutopilotStateChanged,
  emitCameraModeToggleRequested,
  emitDockingPlanChanged,
  emitTraceSampleAppended,
  emitTraceSamplesCleared,
  resetSimulationEventsForTests,
} from '../../../src/domain/simulationEvents';
import { resetAppStateForTests, store, traceStore } from '../../../src/state/appState';
import {
  ensureDomainStateBridgeInstalled,
  installDomainStateBridge,
  resetDomainStateBridgeForTests,
} from '../../../src/state/domainStateBridge';

beforeEach(() => {
  resetDomainStateBridgeForTests();
  resetSimulationEventsForTests();
  resetAppStateForTests();
});

afterEach(() => {
  resetDomainStateBridgeForTests();
  resetSimulationEventsForTests();
  resetAppStateForTests();
});

test('autopilot event updates app state', () => {
  const cleanup = installDomainStateBridge();
  emitAutopilotStateChanged({
    enabled: true,
    activeAutopilots: {
      orientationMatch: false,
      cancelRotation: true,
      cancelLinearMotion: false,
      pointToPosition: false,
      goToPosition: false,
    },
  });

  const autopilot = store.getState().autopilot;
  assert.equal(autopilot.enabled, true);
  assert.equal(autopilot.activeAutopilots.cancelRotation, true);
  cleanup();
});

test('docking plan event sets and clears plan', () => {
  const cleanup = installDomainStateBridge();
  emitDockingPlanChanged({
    plan: {
      sourceUuid: 'src',
      targetUuid: 'dst',
      sourceQuat: { x: 0, y: 0, z: 0, w: 1 },
      targetQuat: { x: 0, y: 1, z: 0, w: 0 },
    },
  });
  assert.equal(store.getState().dockingPlan?.sourceUuid, 'src');

  emitDockingPlanChanged({ plan: null });
  assert.equal(store.getState().dockingPlan, undefined);
  cleanup();
});

test('camera toggle event flips mode', () => {
  const cleanup = installDomainStateBridge();
  assert.equal(store.getState().ui.cameraMode, 'follow');
  emitCameraModeToggleRequested('keyboard');
  assert.equal(store.getState().ui.cameraMode, 'free');
  emitCameraModeToggleRequested('keyboard');
  assert.equal(store.getState().ui.cameraMode, 'follow');
  cleanup();
});

test('trace events append and clear samples', () => {
  const cleanup = installDomainStateBridge();
  emitTraceSampleAppended({
    spacecraftId: 'sc-01',
    sample: { t: 100, x: 1, y: 2, z: 3, speed: 4, accel: 5, forceAbs: 6, forceNet: 7 },
  });

  const samples = traceStore.getTraces()['sc-01'];
  assert.equal(samples.length, 1);
  assert.equal(samples[0].speed, 4);

  emitTraceSamplesCleared('sc-01');
  assert.equal(traceStore.getTraces()['sc-01'].length, 0);
  cleanup();
});

test('bridge cleanup detaches event listeners', () => {
  const cleanup = installDomainStateBridge();
  cleanup();

  emitCameraModeToggleRequested('ui');
  assert.equal(store.getState().ui.cameraMode, 'follow');
});

test('ensureDomainStateBridgeInstalled is idempotent', () => {
  const cleanupA = ensureDomainStateBridgeInstalled();
  const cleanupB = ensureDomainStateBridgeInstalled();
  assert.equal(cleanupA, cleanupB);

  emitCameraModeToggleRequested('ui');
  assert.equal(store.getState().ui.cameraMode, 'free');
  emitCameraModeToggleRequested('ui');
  assert.equal(store.getState().ui.cameraMode, 'follow');
});

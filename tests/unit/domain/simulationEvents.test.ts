import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  emitAutopilotStateChanged,
  emitCameraModeToggleRequested,
  emitDockingPlanChanged,
  emitTraceSampleAppended,
  emitTraceSamplesCleared,
  resetSimulationEventsForTests,
  simulationEvents,
} from '../../../src/domain/simulationEvents';

afterEach(() => {
  resetSimulationEventsForTests();
});

test('subscribers receive typed domain events', () => {
  const observed: string[] = [];
  const unsubs = [
    simulationEvents.on('autopilotStateChanged', () => observed.push('autopilot')),
    simulationEvents.on('dockingPlanChanged', () => observed.push('docking')),
    simulationEvents.on('cameraModeToggleRequested', () => observed.push('camera')),
    simulationEvents.on('traceSampleAppended', () => observed.push('trace:add')),
    simulationEvents.on('traceSamplesCleared', () => observed.push('trace:clear')),
  ];

  emitAutopilotStateChanged({
    enabled: true,
    activeAutopilots: {
      orientationMatch: true,
      cancelRotation: false,
      cancelLinearMotion: false,
      pointToPosition: false,
      goToPosition: false,
    },
  });
  emitDockingPlanChanged({
    plan: {
      sourceUuid: 'a',
      targetUuid: 'b',
      sourceQuat: { x: 0, y: 0, z: 0, w: 1 },
      targetQuat: { x: 0, y: 0, z: 0, w: 1 },
    },
  });
  emitCameraModeToggleRequested('keyboard');
  emitTraceSampleAppended({
    spacecraftId: 'sc-1',
    sample: { t: 1, x: 0, y: 0, z: 0, speed: 0, accel: 0, forceAbs: 0, forceNet: 0 },
  });
  emitTraceSamplesCleared('sc-1');

  assert.deepEqual(observed, ['autopilot', 'docking', 'camera', 'trace:add', 'trace:clear']);

  unsubs.forEach((u) => u());
});

test('unsubscribe detaches listener', () => {
  let calls = 0;
  const unsub = simulationEvents.on('cameraModeToggleRequested', () => {
    calls += 1;
  });

  emitCameraModeToggleRequested('ui');
  unsub();
  emitCameraModeToggleRequested('ui');

  assert.equal(calls, 1);
});

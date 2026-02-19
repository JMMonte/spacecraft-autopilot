import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  resetAppStateForTests,
  setCameraMode,
  setGridVisible,
  setTraceSettings,
  setUiTheme,
} from '../../../src/state/appState';
import { simulationRuntimeStatePort } from '../../../src/state/simulationRuntimeStatePort';

beforeEach(() => {
  resetAppStateForTests();
});

test('ui adapter reflects current state and notifies only on ui changes', () => {
  const observed: string[] = [];
  const unsub = simulationRuntimeStatePort.subscribeUiState((state) => {
    observed.push(`${state.cameraMode}:${state.gridVisible ? '1' : '0'}`);
  });

  const initial = simulationRuntimeStatePort.getUiState();
  assert.equal(initial.cameraMode, 'follow');
  assert.equal(initial.gridVisible, true);

  setCameraMode('free');
  setGridVisible(false);
  // Non-UI change should not trigger ui subscriber.
  setUiTheme('b');

  assert.deepEqual(observed, ['free:1', 'free:0']);
  unsub();
});

test('trace adapter reflects current state and notifies only on trace changes', () => {
  const observed: string[] = [];
  const unsub = simulationRuntimeStatePort.subscribeTraceSettings((s) => {
    observed.push(`${s.gradientEnabled ? '1' : '0'}:${s.gradientMode}:${s.palette}`);
  });

  const initial = simulationRuntimeStatePort.getTraceSettings();
  assert.equal(initial.gradientEnabled, false);
  assert.equal(initial.gradientMode, 'velocity');

  setTraceSettings({ gradientEnabled: true });
  setTraceSettings({ gradientMode: 'forceNet' });
  setTraceSettings({ palette: 'viridis' });
  // Non-trace change should not trigger trace subscriber.
  setGridVisible(false);

  assert.deepEqual(
    observed,
    ['1:velocity:turbo', '1:forceNet:turbo', '1:forceNet:viridis']
  );
  unsub();
});

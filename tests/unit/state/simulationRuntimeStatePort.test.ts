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

test('runtime snapshots are frozen and do not expose live store objects', () => {
  const uiSnapshot = simulationRuntimeStatePort.getUiState();
  const traceSnapshot = simulationRuntimeStatePort.getTraceSettings();

  assert.ok(Object.isFrozen(uiSnapshot));
  assert.ok(Object.isFrozen(traceSnapshot));

  assert.throws(() => {
    (uiSnapshot as { cameraMode: 'follow' | 'free' }).cameraMode = 'free';
  }, TypeError);

  assert.throws(() => {
    (traceSnapshot as { palette: 'turbo' | 'viridis' }).palette = 'viridis';
  }, TypeError);

  setCameraMode('free');
  setTraceSettings({ palette: 'viridis' });

  assert.equal(simulationRuntimeStatePort.getUiState().cameraMode, 'free');
  assert.equal(simulationRuntimeStatePort.getTraceSettings().palette, 'viridis');
  assert.equal(uiSnapshot.cameraMode, 'follow');
  assert.equal(traceSnapshot.palette, 'turbo');
});

test('runtime subscribers receive frozen snapshots that stay detached from later store updates', () => {
  const uiSnapshots: Array<{ cameraMode: 'follow' | 'free'; gridVisible: boolean }> = [];
  const traceSnapshots: Array<{
    gradientEnabled: boolean;
    gradientMode: 'velocity' | 'forceNet';
    palette: 'turbo' | 'viridis';
  }> = [];

  const unsubscribeUi = simulationRuntimeStatePort.subscribeUiState((state) => {
    uiSnapshots.push(state as { cameraMode: 'follow' | 'free'; gridVisible: boolean });
  });
  const unsubscribeTrace = simulationRuntimeStatePort.subscribeTraceSettings((state) => {
    traceSnapshots.push(state as {
      gradientEnabled: boolean;
      gradientMode: 'velocity' | 'forceNet';
      palette: 'turbo' | 'viridis';
    });
  });

  setCameraMode('free');
  setTraceSettings({ palette: 'viridis' });

  const uiSnapshot = uiSnapshots.at(-1)!;
  const traceSnapshot = traceSnapshots.at(-1)!;

  assert.ok(Object.isFrozen(uiSnapshot));
  assert.ok(Object.isFrozen(traceSnapshot));

  assert.throws(() => {
    uiSnapshot.cameraMode = 'follow';
  }, TypeError);
  assert.throws(() => {
    traceSnapshot.palette = 'turbo';
  }, TypeError);

  setCameraMode('follow');
  setTraceSettings({ palette: 'turbo' });

  assert.equal(uiSnapshot.cameraMode, 'free');
  assert.equal(traceSnapshot.palette, 'viridis');

  unsubscribeUi();
  unsubscribeTrace();
});

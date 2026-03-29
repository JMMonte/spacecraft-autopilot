import type {
  SimulationRuntimeStatePort,
  TraceRuntimeSettings,
  UiRuntimeState,
} from '../domain/runtimeStatePort';
import { store } from './appState';

function sameUi(a: UiRuntimeState, b: UiRuntimeState): boolean {
  return a.cameraMode === b.cameraMode && a.gridVisible === b.gridVisible;
}

function sameTrace(a: TraceRuntimeSettings, b: TraceRuntimeSettings): boolean {
  return (
    a.gradientEnabled === b.gradientEnabled &&
    a.gradientMode === b.gradientMode &&
    a.palette === b.palette
  );
}

function freezeUiState(state: UiRuntimeState): UiRuntimeState {
  return Object.freeze({
    gridVisible: state.gridVisible,
    cameraMode: state.cameraMode,
  });
}

function freezeTraceSettings(state: TraceRuntimeSettings): TraceRuntimeSettings {
  return Object.freeze({
    gradientEnabled: state.gradientEnabled,
    gradientMode: state.gradientMode,
    palette: state.palette,
  });
}

let cachedUiState = freezeUiState(store.getState().ui);
let cachedTraceSettings = freezeTraceSettings(store.getState().traceSettings);
let cachedUiSource = store.getState().ui;
let cachedTraceSource = store.getState().traceSettings;

function syncUiSnapshot(): UiRuntimeState {
  const current = store.getState().ui;
  if (current !== cachedUiSource) {
    cachedUiSource = current;
    cachedUiState = freezeUiState(current);
  }
  return cachedUiState;
}

function syncTraceSnapshot(): TraceRuntimeSettings {
  const current = store.getState().traceSettings;
  if (current !== cachedTraceSource) {
    cachedTraceSource = current;
    cachedTraceSettings = freezeTraceSettings(current);
  }
  return cachedTraceSettings;
}

export const simulationRuntimeStatePort: SimulationRuntimeStatePort = {
  getUiState: () => syncUiSnapshot(),
  subscribeUiState: (listener) => {
    let prev = store.getState().ui;
    return store.subscribe(() => {
      const next = store.getState().ui;
      if (sameUi(prev, next)) return;
      prev = next;
      cachedUiSource = next;
      cachedUiState = freezeUiState(next);
      listener(cachedUiState);
    });
  },
  getTraceSettings: () => syncTraceSnapshot(),
  subscribeTraceSettings: (listener) => {
    let prev = store.getState().traceSettings;
    return store.subscribe(() => {
      const next = store.getState().traceSettings;
      if (sameTrace(prev, next)) return;
      prev = next;
      cachedTraceSource = next;
      cachedTraceSettings = freezeTraceSettings(next);
      listener(cachedTraceSettings);
    });
  },
};

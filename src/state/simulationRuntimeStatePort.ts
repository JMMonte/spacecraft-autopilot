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

export const simulationRuntimeStatePort: SimulationRuntimeStatePort = {
  getUiState: () => store.getState().ui,
  subscribeUiState: (listener) => {
    let prev = store.getState().ui;
    return store.subscribe(() => {
      const next = store.getState().ui;
      if (sameUi(prev, next)) return;
      prev = next;
      listener(next);
    });
  },
  getTraceSettings: () => store.getState().traceSettings,
  subscribeTraceSettings: (listener) => {
    let prev = store.getState().traceSettings;
    return store.subscribe(() => {
      const next = store.getState().traceSettings;
      if (sameTrace(prev, next)) return;
      prev = next;
      listener(next);
    });
  },
};

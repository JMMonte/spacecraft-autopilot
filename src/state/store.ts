import { useSyncExternalStore } from 'react';
import {
  store,
  setAutopilotState,
  setUi,
  setGridVisible,
  setCameraMode,
  toggleCameraMode,
  setSettings,
  setAttitudeSphereTexture,
  setUiTheme,
  setTraceSettings,
  setDockingPlan,
} from './appState';
import type {
  AppState,
  AutopilotModes,
  UiState,
  SettingsState,
  TraceSample,
  TraceSettings,
  DockingPlan,
} from './appState';

export type {
  AppState,
  AutopilotModes,
  UiState,
  SettingsState,
  TraceSample,
  TraceSettings,
  DockingPlan,
};

export {
  store,
  setAutopilotState,
  setUi,
  setGridVisible,
  setCameraMode,
  toggleCameraMode,
  setSettings,
  setAttitudeSphereTexture,
  setUiTheme,
  setTraceSettings,
  setDockingPlan,
};

export function useAutopilot() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().autopilot,
    () => store.getState().autopilot,
  );
}

// UI slice helpers
export function useUi() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().ui,
    () => store.getState().ui,
  );
}

// Settings slice helpers
export function useSettings() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().settings,
    () => store.getState().settings,
  );
}

// Trace settings helpers
export function useTraceSettings() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().traceSettings,
    () => store.getState().traceSettings,
  );
}

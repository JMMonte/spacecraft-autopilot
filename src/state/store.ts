import { useSyncExternalStore } from 'react';
import {
  store,
  traceStore,
  setAutopilotState,
  setUi,
  setGridVisible,
  setCameraMode,
  toggleCameraMode,
  setSettings,
  setAttitudeSphereTexture,
  setUiTheme,
  setThrusterLights,
  setThrusterParticles,
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
  traceStore,
  setAutopilotState,
  setUi,
  setGridVisible,
  setCameraMode,
  toggleCameraMode,
  setSettings,
  setAttitudeSphereTexture,
  setUiTheme,
  setThrusterLights,
  setThrusterParticles,
  setTraceSettings,
  setDockingPlan,
};

// Hooks use stable snapshot getters — Object.is returns true when the slice
// hasn't changed, preventing re-renders from unrelated state mutations.

export function useAutopilot() {
  return useSyncExternalStore(store.subscribe, store.getAutopilot, store.getAutopilot);
}

export function useUi() {
  return useSyncExternalStore(store.subscribe, store.getUi, store.getUi);
}

export function useSettings() {
  return useSyncExternalStore(store.subscribe, store.getSettings, store.getSettings);
}

export function useTraceSettings() {
  return useSyncExternalStore(store.subscribe, store.getTraceSettings, store.getTraceSettings);
}

import { useSyncExternalStore } from 'react';
import type { AutopilotModes } from '../controllers/autopilot/types';

// Lightweight external store for React and non-React code
// No dependencies; UI subscribes with useSyncExternalStore.

// AutopilotModes imported from controllers/autopilot/types

type UiState = {
  gridVisible: boolean;
  cameraMode: 'follow' | 'free';
};

type SettingsState = {
  attitudeSphereTexture: string; // URL path under /images/textures
  uiTheme: 'a' | 'b' | 'c';
};

export type TraceSample = {
  t: number; // ms since navigationStart
  x: number; y: number; z: number;
  speed: number; // m/s
  accel: number; // m/s^2 (approx)
  forceAbs: number; // sum of magnitudes across thrusters (N)
  forceNet: number; // magnitude of net linear force vector (N)
};

type TraceSettings = {
  gradientEnabled: boolean;
  gradientMode: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet';
  palette: 'turbo' | 'viridis';
};

type AppState = {
  autopilot: {
    enabled: boolean;
    activeAutopilots: AutopilotModes;
  };
  ui: UiState;
  settings: SettingsState;
  traces: Record<string, TraceSample[]>; // key: spacecraft uuid
  traceSettings: TraceSettings;
  dockingPlan?: {
    sourceUuid: string;
    targetUuid: string;
    sourceQuat: { x: number; y: number; z: number; w: number };
    targetQuat: { x: number; y: number; z: number; w: number };
  };
};

type Listener = () => void;

const defaultAutopilot: AutopilotModes = {
  orientationMatch: false,
  cancelRotation: false,
  cancelLinearMotion: false,
  pointToPosition: false,
  goToPosition: false,
};

let state: AppState = {
  autopilot: {
    enabled: false,
    activeAutopilots: { ...defaultAutopilot },
  },
  ui: {
    gridVisible: true,
    cameraMode: 'follow',
  },
  settings: {
    attitudeSphereTexture: '/images/textures/rLHbWVB.png',
    uiTheme: 'a',
  },
  traces: {},
  traceSettings: {
    gradientEnabled: false,
    gradientMode: 'velocity',
    palette: 'turbo',
  },
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const store = {
  getState: () => state,
  subscribe: (cb: Listener) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  setState: (partial: Partial<AppState>) => {
    state = { ...state, ...partial } as AppState;
    emit();
  },
  // Imperative mutation helpers for large arrays (avoid object churn)
  appendTraceSample: (spacecraftId: string, sample: TraceSample) => {
    const map = state.traces;
    if (!map[spacecraftId]) map[spacecraftId] = [];
    map[spacecraftId].push(sample);
    // Emit without replacing the traces object to keep large arrays stable
    emit();
  },
  clearTraceSamples: (spacecraftId: string) => {
    if (state.traces[spacecraftId]) {
      state.traces[spacecraftId] = [];
      emit();
    }
  },
};

// Specific setters/selectors
export function setAutopilotState(enabled: boolean, activeAutopilots: AutopilotModes) {
  store.setState({ autopilot: { enabled, activeAutopilots } as AppState['autopilot'] });
}

export function useAutopilot() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().autopilot,
    () => store.getState().autopilot,
  );
}

// UI slice helpers
export function setUi(partial: Partial<UiState>) {
  const prev = store.getState().ui;
  store.setState({ ui: { ...prev, ...partial } } as Partial<AppState>);
}

export function setGridVisible(visible: boolean) {
  setUi({ gridVisible: visible });
}

export function setCameraMode(mode: 'follow' | 'free') {
  setUi({ cameraMode: mode });
}

export function toggleCameraMode() {
  const current = store.getState().ui.cameraMode;
  setCameraMode(current === 'follow' ? 'free' : 'follow');
}

export function useUi() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().ui,
    () => store.getState().ui,
  );
}

// Settings slice helpers
export function setSettings(partial: Partial<SettingsState>) {
  const prev = store.getState().settings;
  store.setState({ settings: { ...prev, ...partial } } as Partial<AppState>);
}

export function setAttitudeSphereTexture(url: string) {
  setSettings({ attitudeSphereTexture: url });
}

export function useSettings() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().settings,
    () => store.getState().settings,
  );
}

export function setUiTheme(theme: 'a' | 'b' | 'c') {
  setSettings({ uiTheme: theme });
}

// Trace settings helpers
export function useTraceSettings() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().traceSettings,
    () => store.getState().traceSettings,
  );
}

export function setTraceSettings(partial: Partial<TraceSettings>) {
  const prev = store.getState().traceSettings;
  store.setState({ traceSettings: { ...prev, ...partial } } as Partial<AppState>);
}

// Docking plan helpers (shared between controllers/UIs)
export function setDockingPlan(plan: AppState['dockingPlan'] | null) {
  if (plan) store.setState({ dockingPlan: plan } as Partial<AppState>);
  else store.setState({ dockingPlan: undefined } as Partial<AppState>);
}

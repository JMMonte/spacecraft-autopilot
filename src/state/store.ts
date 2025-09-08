import { useSyncExternalStore } from 'react';

// Lightweight external store for React and non-React code
// No dependencies; UI subscribes with useSyncExternalStore.

type AutopilotModes = {
  orientationMatch: boolean;
  cancelRotation: boolean;
  cancelLinearMotion: boolean;
  pointToPosition: boolean;
  goToPosition: boolean;
};

type UiState = {
  gridVisible: boolean;
  cameraMode: 'follow' | 'free';
};

type SettingsState = {
  attitudeSphereTexture: string; // URL path under /images/textures
  uiTheme: 'a' | 'b' | 'c';
};

type AppState = {
  autopilot: {
    enabled: boolean;
    activeAutopilots: AutopilotModes;
  };
  ui: UiState;
  settings: SettingsState;
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

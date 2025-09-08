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
};

type AppState = {
  autopilot: {
    enabled: boolean;
    activeAutopilots: AutopilotModes;
  };
  ui: UiState;
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

export function useUi() {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().ui,
    () => store.getState().ui,
  );
}

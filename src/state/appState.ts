// Runtime app state shared by UI and simulation code.
// This module is React-free so core/controllers can depend on it safely.

export type AutopilotModeName =
  | 'orientationMatch'
  | 'cancelRotation'
  | 'cancelLinearMotion'
  | 'pointToPosition'
  | 'goToPosition';

export type AutopilotModes = Record<AutopilotModeName, boolean>;

export type UiState = {
  gridVisible: boolean;
  cameraMode: 'follow' | 'free';
};

export type SettingsState = {
  attitudeSphereTexture: string; // URL path under /images/textures
  uiTheme: 'a' | 'b' | 'c';
  thrusterLights: boolean;
  thrusterParticles: boolean;
};

export type TraceSample = {
  t: number; // ms since navigationStart
  x: number; y: number; z: number;
  speed: number; // m/s
  accel: number; // m/s^2 (approx)
  forceAbs: number; // sum of magnitudes across thrusters (N)
  forceNet: number; // magnitude of net linear force vector (N)
};

export type TraceSettings = {
  gradientEnabled: boolean;
  gradientMode: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet';
  palette: 'turbo' | 'viridis';
};

export type DockingPlan = {
  sourceUuid: string;
  targetUuid: string;
  sourceQuat: { x: number; y: number; z: number; w: number };
  targetQuat: { x: number; y: number; z: number; w: number };
};

export type AppState = {
  autopilot: {
    enabled: boolean;
    activeAutopilots: AutopilotModes;
  };
  ui: UiState;
  settings: SettingsState;
  traceSettings: TraceSettings;
  dockingPlan?: DockingPlan;
};

type Listener = () => void;

const defaultAutopilot: AutopilotModes = {
  orientationMatch: false,
  cancelRotation: false,
  cancelLinearMotion: false,
  pointToPosition: false,
  goToPosition: false,
};

function createInitialState(): AppState {
  return {
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
      thrusterLights: true,
      thrusterParticles: true,
    },
    traceSettings: {
      gradientEnabled: false,
      gradientMode: 'velocity',
      palette: 'turbo',
    },
  };
}

let state: AppState = createInitialState();

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

// Snapshot cache: we keep stable object references per slice so that
// useSyncExternalStore's Object.is check can skip re-renders when
// only unrelated slices change.
let prevAutopilot = state.autopilot;
let prevUi = state.ui;
let prevSettings = state.settings;
let prevTraceSettings = state.traceSettings;

function sameAutopilot(a: AppState['autopilot'], b: AppState['autopilot']): boolean {
  if (a.enabled !== b.enabled) return false;
  const ak = a.activeAutopilots;
  const bk = b.activeAutopilots;
  return (
    ak.orientationMatch === bk.orientationMatch &&
    ak.cancelRotation === bk.cancelRotation &&
    ak.cancelLinearMotion === bk.cancelLinearMotion &&
    ak.pointToPosition === bk.pointToPosition &&
    ak.goToPosition === bk.goToPosition
  );
}

function sameUi(a: UiState, b: UiState): boolean {
  return a.gridVisible === b.gridVisible && a.cameraMode === b.cameraMode;
}

function sameSettings(a: SettingsState, b: SettingsState): boolean {
  return (
    a.attitudeSphereTexture === b.attitudeSphereTexture &&
    a.uiTheme === b.uiTheme &&
    a.thrusterLights === b.thrusterLights &&
    a.thrusterParticles === b.thrusterParticles
  );
}

function sameTraceSettings(a: TraceSettings, b: TraceSettings): boolean {
  return (
    a.gradientEnabled === b.gradientEnabled &&
    a.gradientMode === b.gradientMode &&
    a.palette === b.palette
  );
}

function updateSnapshots() {
  if (!sameAutopilot(prevAutopilot, state.autopilot)) prevAutopilot = state.autopilot;
  if (!sameUi(prevUi, state.ui)) prevUi = state.ui;
  if (!sameSettings(prevSettings, state.settings)) prevSettings = state.settings;
  if (!sameTraceSettings(prevTraceSettings, state.traceSettings)) prevTraceSettings = state.traceSettings;
}

export const store = {
  getState: () => state,
  subscribe: (cb: Listener) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  setState: (partial: Partial<AppState>) => {
    state = { ...state, ...partial } as AppState;
    updateSnapshots();
    emit();
  },
  // Stable snapshot getters for useSyncExternalStore (return same ref when unchanged)
  getAutopilot: () => prevAutopilot,
  getUi: () => prevUi,
  getSettings: () => prevSettings,
  getTraceSettings: () => prevTraceSettings,
};

// ── Separate trace store (high-frequency, 60Hz updates) ──
// Decoupled from main store so trace appends don't trigger UI hook re-renders.
let traces: Record<string, TraceSample[]> = {};
const traceListeners = new Set<Listener>();

function emitTraces() {
  for (const l of traceListeners) l();
}

export const traceStore = {
  getTraces: () => traces,
  subscribe: (cb: Listener) => {
    traceListeners.add(cb);
    return () => traceListeners.delete(cb);
  },
  appendTraceSample: (spacecraftId: string, sample: TraceSample) => {
    if (!traces[spacecraftId]) traces[spacecraftId] = [];
    traces[spacecraftId].push(sample);
    emitTraces();
  },
  clearTraceSamples: (spacecraftId: string) => {
    if (traces[spacecraftId]) {
      traces[spacecraftId] = [];
      emitTraces();
    }
  },
};

// Specific setters/selectors
export function setAutopilotState(enabled: boolean, activeAutopilots: AutopilotModes) {
  store.setState({ autopilot: { enabled, activeAutopilots } });
}

// UI slice helpers
export function setUi(partial: Partial<UiState>) {
  const prev = store.getState().ui;
  store.setState({ ui: { ...prev, ...partial } });
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

// Settings slice helpers
export function setSettings(partial: Partial<SettingsState>) {
  const prev = store.getState().settings;
  store.setState({ settings: { ...prev, ...partial } });
}

export function setAttitudeSphereTexture(url: string) {
  setSettings({ attitudeSphereTexture: url });
}

export function setUiTheme(theme: 'a' | 'b' | 'c') {
  setSettings({ uiTheme: theme });
}

export function setThrusterLights(enabled: boolean) {
  setSettings({ thrusterLights: enabled });
}

export function setThrusterParticles(enabled: boolean) {
  setSettings({ thrusterParticles: enabled });
}

// Trace settings helpers
export function setTraceSettings(partial: Partial<TraceSettings>) {
  const prev = store.getState().traceSettings;
  store.setState({ traceSettings: { ...prev, ...partial } });
}

// Docking plan helpers (shared between controllers/UIs)
export function setDockingPlan(plan: DockingPlan | null) {
  if (plan) store.setState({ dockingPlan: plan });
  else store.setState({ dockingPlan: undefined });
}

export function resetAppStateForTests(): void {
  state = createInitialState();
  updateSnapshots();
  prevAutopilot = state.autopilot;
  prevUi = state.ui;
  prevSettings = state.settings;
  prevTraceSettings = state.traceSettings;
  traces = {};
  emit();
  emitTraces();
}

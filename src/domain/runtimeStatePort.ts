export type UiRuntimeState = {
  gridVisible: boolean;
  cameraMode: 'follow' | 'free';
};

export type TraceRuntimeSettings = {
  gradientEnabled: boolean;
  gradientMode: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet';
  palette: 'turbo' | 'viridis';
};

export interface SimulationRuntimeStatePort {
  getUiState(): UiRuntimeState;
  subscribeUiState(listener: (state: UiRuntimeState) => void): () => void;
  getTraceSettings(): TraceRuntimeSettings;
  subscribeTraceSettings(listener: (settings: TraceRuntimeSettings) => void): () => void;
}

const defaultUiState: UiRuntimeState = {
  gridVisible: true,
  cameraMode: 'follow',
};

const defaultTraceSettings: TraceRuntimeSettings = {
  gradientEnabled: false,
  gradientMode: 'velocity',
  palette: 'turbo',
};

export const noopSimulationRuntimeStatePort: SimulationRuntimeStatePort = {
  getUiState: () => defaultUiState,
  subscribeUiState: () => () => {},
  getTraceSettings: () => defaultTraceSettings,
  subscribeTraceSettings: () => () => {},
};

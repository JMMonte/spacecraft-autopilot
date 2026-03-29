export type UiRuntimeState = Readonly<{
  gridVisible: boolean;
  cameraMode: 'follow' | 'free';
}>;

export type TraceRuntimeSettings = Readonly<{
  gradientEnabled: boolean;
  gradientMode: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet';
  palette: 'turbo' | 'viridis';
}>;

export interface SimulationRuntimeStatePort {
  getUiState(): UiRuntimeState;
  subscribeUiState(listener: (state: UiRuntimeState) => void): () => void;
  getTraceSettings(): TraceRuntimeSettings;
  subscribeTraceSettings(listener: (settings: TraceRuntimeSettings) => void): () => void;
}

function freezeUiState(state: { gridVisible: boolean; cameraMode: 'follow' | 'free' }): UiRuntimeState {
  return Object.freeze({
    gridVisible: state.gridVisible,
    cameraMode: state.cameraMode,
  });
}

function freezeTraceSettings(state: {
  gradientEnabled: boolean;
  gradientMode: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet';
  palette: 'turbo' | 'viridis';
}): TraceRuntimeSettings {
  return Object.freeze({
    gradientEnabled: state.gradientEnabled,
    gradientMode: state.gradientMode,
    palette: state.palette,
  });
}

const defaultUiState = freezeUiState({
  gridVisible: true,
  cameraMode: 'follow',
});

const defaultTraceSettings = freezeTraceSettings({
  gradientEnabled: false,
  gradientMode: 'velocity',
  palette: 'turbo',
});

export const noopSimulationRuntimeStatePort: SimulationRuntimeStatePort = {
  getUiState: () => defaultUiState,
  subscribeUiState: () => () => {},
  getTraceSettings: () => defaultTraceSettings,
  subscribeTraceSettings: () => () => {},
};

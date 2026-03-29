interface WindowConfig {
  label: string;
}

interface Windows {
  [key: string]: WindowConfig;
}

export const WINDOWS: Windows = {
  telemetry: { label: 'Flight Telemetry' },
  horizon: { label: 'Attitude Indicator' },
  spacecraftConfig: { label: 'Spacecraft Config' },
  arrows: { label: 'Visualization Aids' },
  pid: { label: 'PID Tuning' },
  autopilot: { label: 'Autopilot & Targeting' },
  spacecraftList: { label: 'Spacecraft Manager' },
  dockingCameras: { label: 'Dock Cameras & Lights' },
  settings: { label: 'Display Settings' },
  chart: { label: 'Chart' },
};

export const INITIAL_WINDOW_STATE: { [key: string]: boolean } = Object.keys(WINDOWS).reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {} as { [key: string]: boolean });

/** Multiplier for per-thruster force: mass / 24_thrusters * THRUST_FACTOR */
export const THRUST_FACTOR = 5;

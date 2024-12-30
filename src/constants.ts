interface WindowConfig {
  label: string;
}

interface Windows {
  [key: string]: WindowConfig;
}

export const WINDOWS: Windows = {
  telemetry: { label: 'Telemetry' },
  horizon: { label: 'Horizon' },
  dimensions: { label: 'Dimensions' },
  rcs: { label: 'RCS' },
  arrows: { label: 'Helpers' },
  pid: { label: 'PID' },
  autopilot: { label: 'Autopilot' },
  spacecraftList: { label: 'Spacecraft' }
};

export const INITIAL_WINDOW_STATE: { [key: string]: boolean } = Object.keys(WINDOWS).reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {} as { [key: string]: boolean }); 
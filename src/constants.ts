interface WindowConfig {
  label: string;
}

interface Windows {
  [key: string]: WindowConfig;
}

export const WINDOWS: Windows = {
  telemetry: { label: 'Flight Telemetry' },
  horizon: { label: 'Attitude Indicator' },
  dimensions: { label: 'Spacecraft Dimensions' },
  rcs: { label: 'RCS Thrust' },
  arrows: { label: 'Visualization Aids' },
  pid: { label: 'PID Tuning' },
  autopilot: { label: 'Autopilot & Targeting' },
  spacecraftList: { label: 'Spacecraft Manager' },
  dockingCameras: { label: 'Dock Cameras & Lights' },
  settings: { label: 'Display Settings' },
};

export const INITIAL_WINDOW_STATE: { [key: string]: boolean } = Object.keys(WINDOWS).reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {} as { [key: string]: boolean }); 

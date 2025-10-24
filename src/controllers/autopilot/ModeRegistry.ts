import type { AutopilotModeName, AutopilotModes } from './types';

const rotationModes: AutopilotModeName[] = ['orientationMatch', 'cancelRotation', 'pointToPosition'];
const translationModes: AutopilotModeName[] = ['cancelLinearMotion', 'goToPosition'];

export const ModeRegistry = {
  rotationModes,
  translationModes,
  isRotation(mode: AutopilotModeName): boolean { return rotationModes.includes(mode); },
  isTranslation(mode: AutopilotModeName): boolean { return translationModes.includes(mode); },
  exclusiveEnable(state: AutopilotModes, mode: AutopilotModeName, enabled: boolean): AutopilotModes {
    const next: AutopilotModes = { ...state };
    if (enabled) {
      if (rotationModes.includes(mode)) rotationModes.forEach(m => { if (m !== mode) next[m] = false; });
      if (translationModes.includes(mode)) translationModes.forEach(m => { if (m !== mode) next[m] = false; });
    }
    next[mode] = enabled;
    return next;
  },
};


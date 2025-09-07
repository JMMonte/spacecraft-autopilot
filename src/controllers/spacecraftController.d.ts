import { Autopilot } from './autopilot/Autopilot';

export interface SpacecraftController {
  getAutopilot: () => Autopilot;
  getIsActive: () => boolean;
  setIsActive: (active: boolean) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  handleKeyUp: (event: KeyboardEvent) => void;
  applyForces: () => void;
  cleanup?: () => void;
}


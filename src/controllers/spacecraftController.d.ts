import { Spacecraft } from '../core/spacecraft';
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

// Remove the module augmentation since it's causing type conflicts
// declare module '../core/spacecraft' {
//   interface Spacecraft {
//     objects: {
//       boxBody: import('cannon-es').Body & { shapes: import('cannon-es').Box[] };
//       [key: string]: any;
//     };
//   }
// } 
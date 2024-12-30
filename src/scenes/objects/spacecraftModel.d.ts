import * as THREE from 'three';
import * as CANNON from 'cannon';
import { RCSVisuals } from '../../ui/rcsVisuals';

export interface SpacecraftModel {
  boxWidth: number;
  boxHeight: number;
  boxDepth: number;
  box: THREE.Mesh;
  boxBody: CANNON.Body & { shapes: CANNON.Shape[] };
  rcsVisuals: RCSVisuals;
  onRCSVisualsUpdate?: (newRcsVisuals: RCSVisuals) => void;
  update: () => void;
  cleanup?: () => void;
} 
import * as THREE from 'three';
import {
    noopSimulationRuntimeStatePort,
    SimulationRuntimeStatePort,
} from '../domain/runtimeStatePort';
import { ArrowManager } from './helpers/ArrowManager';
import { TraceVisualizer } from './helpers/TraceVisualizer';
import { PathVisualizer } from './helpers/PathVisualizer';

/**
 * Facade composing ArrowManager, TraceVisualizer, and PathVisualizer.
 * Preserves the original public API so Spacecraft and SpacecraftController work unchanged.
 */
export class SceneHelpers {
    private arrows: ArrowManager;
    private trace: TraceVisualizer;
    private path: PathVisualizer;

    // Expose arrow visibility for VisualizationCallbacks compatibility
    get autopilotArrow() { return this.arrows.autopilotArrow; }
    get autopilotTorqueArrow() { return this.arrows.autopilotTorqueArrow; }
    get rotationAxisArrow() { return this.arrows.rotationAxisArrow; }
    get orientationArrow() { return this.arrows.orientationArrow; }
    get velocityArrow() { return this.arrows.velocityArrow; }
    get traceLine() { return this.trace.traceLine; }
    get pathLine() { return this.path.pathLine; }
    get pathCarrot() { return this.path.pathCarrot; }

    constructor(
        scene: THREE.Scene,
        _light: THREE.Light,
        _camera: THREE.Camera,
        runtimeState: SimulationRuntimeStatePort = noopSimulationRuntimeStatePort,
    ) {
        this.arrows = new ArrowManager(scene);
        this.trace = new TraceVisualizer(scene, runtimeState);
        this.path = new PathVisualizer(scene);
    }

    // Arrow methods
    updateAutopilotArrow(pos: THREE.Vector3 | { x: number; y: number; z: number }, dir: THREE.Vector3 | { x: number; y: number; z: number }): void { this.arrows.updateAutopilotArrow(pos, dir); }
    updateAutopilotTorqueArrow(pos: THREE.Vector3 | { x: number; y: number; z: number }, torque: THREE.Vector3 | { x: number; y: number; z: number }): void { this.arrows.updateAutopilotTorqueArrow(pos, torque); }
    updateRotationAxisArrow(pos: THREE.Vector3 | { x: number; y: number; z: number }, axis: THREE.Vector3 | { x: number; y: number; z: number }): void { this.arrows.updateRotationAxisArrow(pos, axis); }
    updateOrientationArrow(pos: THREE.Vector3 | { x: number; y: number; z: number }, dir: THREE.Vector3 | { x: number; y: number; z: number }): void { this.arrows.updateOrientationArrow(pos, dir); }
    updateVelocityArrow(pos: THREE.Vector3 | { x: number; y: number; z: number }, vel: THREE.Vector3 | { x: number; y: number; z: number }): void { this.arrows.updateVelocityArrow(pos, vel); }
    enableHelpers(): void { this.arrows.enableHelpers(); }
    disableHelpers(): void { this.arrows.disableHelpers(); }

    // Trace methods
    setTraceVisible(visible: boolean): void { this.trace.setTraceVisible(visible); }
    resetTrace(): void { this.trace.resetTrace(); }
    updateTrace(spacecraftId: string, position: THREE.Vector3 | { x: number; y: number; z: number }, velocity: THREE.Vector3 | { x: number; y: number; z: number }): void { this.trace.updateTrace(spacecraftId, position, velocity); }
    setLatestForceMetrics(absSum: number, netMag: number): void { this.trace.setLatestForceMetrics(absSum, netMag); }

    // Path methods
    setPathVisible(visible: boolean): void { this.path.setPathVisible(visible); }
    updatePath(points: THREE.Vector3[], carrot?: THREE.Vector3): void { this.path.updatePath(points, carrot); }

    cleanup(): void {
        this.arrows.cleanup();
        this.trace.cleanup();
        this.path.cleanup();
    }
}

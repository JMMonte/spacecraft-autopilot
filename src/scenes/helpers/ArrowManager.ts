import * as THREE from 'three';

/**
 * Manages the 5 directional arrow helpers for spacecraft visualization:
 * autopilot (red), torque (blue), rotation axis (green), orientation (yellow), velocity (cyan).
 */
export class ArrowManager {
    public autopilotArrow: THREE.ArrowHelper | null = null;
    public autopilotTorqueArrow: THREE.ArrowHelper | null = null;
    public rotationAxisArrow: THREE.ArrowHelper | null = null;
    public orientationArrow: THREE.ArrowHelper | null = null;
    public velocityArrow: THREE.ArrowHelper | null = null;

    constructor(private scene: THREE.Scene) {
        this.init();
    }

    private init(): void {
        const makeArrow = (color: number): THREE.ArrowHelper => {
            const arrow = new THREE.ArrowHelper(
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(0, 0, 0),
                1,
                color
            );
            (arrow as any).userData = { ...(arrow as any).userData, lensflare: 'no-occlusion' };
            this.scene.add(arrow);
            return arrow;
        };

        this.autopilotArrow = makeArrow(0xff0000);
        this.autopilotTorqueArrow = makeArrow(0x0000ff);
        this.rotationAxisArrow = makeArrow(0x00ff00);
        this.orientationArrow = makeArrow(0xffff00);
        this.velocityArrow = makeArrow(0x00ffff);
        this.disableHelpers();
    }

    updateAutopilotArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, direction: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (this.autopilotArrow) this.updateArrow(this.autopilotArrow, position, direction);
    }

    updateAutopilotTorqueArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, torque: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (this.autopilotTorqueArrow) this.updateArrow(this.autopilotTorqueArrow, position, torque);
    }

    updateRotationAxisArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, axis: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (this.rotationAxisArrow) this.updateArrow(this.rotationAxisArrow, position, axis);
    }

    updateOrientationArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, orientation: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (this.orientationArrow) this.updateArrow(this.orientationArrow, position, orientation);
    }

    updateVelocityArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, velocity: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (this.velocityArrow) this.updateArrow(this.velocityArrow, position, velocity);
    }

    enableHelpers(): void {
        for (const a of this.allArrows()) if (a) a.visible = true;
    }

    disableHelpers(): void {
        for (const a of this.allArrows()) if (a) a.visible = false;
    }

    cleanup(): void {
        for (const a of this.allArrows()) {
            if (a) { this.scene.remove(a); a.dispose(); }
        }
    }

    private allArrows(): (THREE.ArrowHelper | null)[] {
        return [this.autopilotArrow, this.autopilotTorqueArrow, this.rotationAxisArrow, this.orientationArrow, this.velocityArrow];
    }

    private updateArrow(arrow: THREE.ArrowHelper, position: THREE.Vector3 | { x: number; y: number; z: number }, direction: THREE.Vector3 | { x: number; y: number; z: number }): void {
        arrow.position.set((position as any).x, (position as any).y, (position as any).z);
        const dx = (direction as any).x, dy = (direction as any).y, dz = (direction as any).z;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length > 0.001) {
            arrow.setDirection(new THREE.Vector3(dx / length, dy / length, dz / length));
            arrow.setLength(length);
        }
    }
}

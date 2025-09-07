import * as THREE from 'three';

export class SceneHelpers {
    private scene: THREE.Scene;
    public autopilotArrow: THREE.ArrowHelper | null = null;
    public autopilotTorqueArrow: THREE.ArrowHelper | null = null;
    public rotationAxisArrow: THREE.ArrowHelper | null = null;
    public orientationArrow: THREE.ArrowHelper | null = null;
    public velocityArrow: THREE.ArrowHelper | null = null;

    constructor(scene: THREE.Scene, _light: THREE.Light, _camera: THREE.Camera) {
        this.scene = scene;
        this.initHelpers();
    }

    private initHelpers(): void {
        // Initialize autopilot arrow (red)
        this.autopilotArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0xff0000
        );
        // HUD-like: do not occlude lens flares
        (this.autopilotArrow as any).userData = { ...(this.autopilotArrow as any).userData, lensflare: 'no-occlusion' };
        this.scene.add(this.autopilotArrow);

        // Initialize autopilot torque arrow (blue)
        this.autopilotTorqueArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0x0000ff
        );
        (this.autopilotTorqueArrow as any).userData = { ...(this.autopilotTorqueArrow as any).userData, lensflare: 'no-occlusion' };
        this.scene.add(this.autopilotTorqueArrow);

        // Initialize rotation axis arrow (green)
        this.rotationAxisArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0x00ff00
        );
        (this.rotationAxisArrow as any).userData = { ...(this.rotationAxisArrow as any).userData, lensflare: 'no-occlusion' };
        this.scene.add(this.rotationAxisArrow);

        // Initialize orientation arrow (yellow)
        this.orientationArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0xffff00
        );
        (this.orientationArrow as any).userData = { ...(this.orientationArrow as any).userData, lensflare: 'no-occlusion' };
        this.scene.add(this.orientationArrow);

        // Initialize velocity arrow (cyan)
        this.velocityArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0x00ffff
        );
        (this.velocityArrow as any).userData = { ...(this.velocityArrow as any).userData, lensflare: 'no-occlusion' };
        this.scene.add(this.velocityArrow);

        // Initially hide all helpers
        this.disableHelpers();
    }

    public updateAutopilotArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, direction: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (!this.autopilotArrow) return;
        this.updateArrow(this.autopilotArrow, position, direction);
    }

    public updateAutopilotTorqueArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, torque: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (!this.autopilotTorqueArrow) return;
        this.updateArrow(this.autopilotTorqueArrow, position, torque);
    }

    public updateRotationAxisArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, axis: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (!this.rotationAxisArrow) return;
        this.updateArrow(this.rotationAxisArrow, position, axis);
    }

    public updateOrientationArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, orientation: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (!this.orientationArrow) return;
        this.updateArrow(this.orientationArrow, position, orientation);
    }

    public updateVelocityArrow(position: THREE.Vector3 | { x: number; y: number; z: number }, velocity: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (!this.velocityArrow) return;
        this.updateArrow(this.velocityArrow, position, velocity);
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

    public enableHelpers(): void {
        [
            this.autopilotArrow,
            this.autopilotTorqueArrow,
            this.rotationAxisArrow,
            this.orientationArrow,
            this.velocityArrow
        ].forEach(arrow => {
            if (arrow) arrow.visible = true;
        });
    }

    public disableHelpers(): void {
        [
            this.autopilotArrow,
            this.autopilotTorqueArrow,
            this.rotationAxisArrow,
            this.orientationArrow,
            this.velocityArrow
        ].forEach(arrow => {
            if (arrow) arrow.visible = false;
        });
    }

    public cleanup(): void {
        [
            this.autopilotArrow,
            this.autopilotTorqueArrow,
            this.rotationAxisArrow,
            this.orientationArrow,
            this.velocityArrow
        ].forEach(arrow => {
            if (arrow) {
                this.scene.remove(arrow);
                arrow.dispose();
            }
        });
    }
} 

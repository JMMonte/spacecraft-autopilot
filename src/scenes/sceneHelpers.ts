import * as THREE from 'three';
import * as CANNON from 'cannon-es';

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
        this.scene.add(this.autopilotArrow);

        // Initialize autopilot torque arrow (blue)
        this.autopilotTorqueArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0x0000ff
        );
        this.scene.add(this.autopilotTorqueArrow);

        // Initialize rotation axis arrow (green)
        this.rotationAxisArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0x00ff00
        );
        this.scene.add(this.rotationAxisArrow);

        // Initialize orientation arrow (yellow)
        this.orientationArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0xffff00
        );
        this.scene.add(this.orientationArrow);

        // Initialize velocity arrow (cyan)
        this.velocityArrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 0),
            1,
            0x00ffff
        );
        this.scene.add(this.velocityArrow);

        // Initially hide all helpers
        this.disableHelpers();
    }

    public updateAutopilotArrow(position: CANNON.Vec3, direction: CANNON.Vec3): void {
        if (!this.autopilotArrow) return;
        this.updateArrow(this.autopilotArrow, position, direction);
    }

    public updateAutopilotTorqueArrow(position: CANNON.Vec3, torque: CANNON.Vec3): void {
        if (!this.autopilotTorqueArrow) return;
        this.updateArrow(this.autopilotTorqueArrow, position, torque);
    }

    public updateRotationAxisArrow(position: CANNON.Vec3, axis: CANNON.Vec3): void {
        if (!this.rotationAxisArrow) return;
        this.updateArrow(this.rotationAxisArrow, position, axis);
    }

    public updateOrientationArrow(position: CANNON.Vec3, orientation: CANNON.Vec3): void {
        if (!this.orientationArrow) return;
        this.updateArrow(this.orientationArrow, position, orientation);
    }

    public updateVelocityArrow(position: CANNON.Vec3, velocity: CANNON.Vec3): void {
        if (!this.velocityArrow) return;
        this.updateArrow(this.velocityArrow, position, velocity);
    }

    private updateArrow(arrow: THREE.ArrowHelper, position: CANNON.Vec3, direction: CANNON.Vec3): void {
        arrow.position.set(position.x, position.y, position.z);
        const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
        if (length > 0.001) {
            arrow.setDirection(new THREE.Vector3(direction.x / length, direction.y / length, direction.z / length));
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
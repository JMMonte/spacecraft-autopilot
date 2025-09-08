import * as THREE from 'three';

export class SceneHelpers {
    private scene: THREE.Scene;
    public autopilotArrow: THREE.ArrowHelper | null = null;
    public autopilotTorqueArrow: THREE.ArrowHelper | null = null;
    public rotationAxisArrow: THREE.ArrowHelper | null = null;
    public orientationArrow: THREE.ArrowHelper | null = null;
    public velocityArrow: THREE.ArrowHelper | null = null;
    // Trace line helpers
    public traceLine: THREE.Line | null = null;
    private traceGeometry: THREE.BufferGeometry | null = null;
    private traceMaterial: THREE.LineBasicMaterial | null = null;
    private tracePositions: Float32Array | null = null;
    private traceCount: number = 0;
    private traceMaxPoints: number = 2000;
    private traceMinDist: number = 0.05;
    private traceSpeedEps: number = 0.005;
    private traceLastPos: THREE.Vector3 | null = null;

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

        // Initialize trace line (hidden by default)
        this.initTraceLine();
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

    // --- Trace line API ---
    private initTraceLine(): void {
        // Allocate fixed-size buffer to avoid per-frame reallocations
        this.traceGeometry = new THREE.BufferGeometry();
        this.tracePositions = new Float32Array(this.traceMaxPoints * 3);
        this.traceGeometry.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3));
        this.traceGeometry.setDrawRange(0, 0);

        this.traceMaterial = new THREE.LineBasicMaterial({
            color: 0xff66cc,
            linewidth: 1,
            transparent: true,
            opacity: 0.85,
            depthTest: false,
            depthWrite: false,
        });
        this.traceLine = new THREE.Line(this.traceGeometry, this.traceMaterial);
        // Ensure the trace is never culled when off-camera; we treat it as HUD-like
        this.traceLine.frustumCulled = false;
        (this.traceLine as any).renderOrder = 999;
        (this.traceLine as any).userData = { ...(this.traceLine as any).userData, lensflare: 'no-occlusion' };
        this.traceLine.visible = false;
        this.scene.add(this.traceLine);
    }

    public setTraceVisible(visible: boolean): void {
        if (!this.traceLine) return;
        // On enabling, start a fresh trace from next update
        if (visible && !this.traceLine.visible) {
            this.resetTrace();
        }
        this.traceLine.visible = visible;
    }

    public resetTrace(): void {
        if (!this.traceGeometry || !this.tracePositions) return;
        this.traceCount = 0;
        this.traceGeometry.setDrawRange(0, 0);
        this.traceLastPos = null;
    }

    public updateTrace(position: THREE.Vector3 | { x: number; y: number; z: number }, velocity: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (!this.traceLine || !this.traceLine.visible) return;
        if (!this.traceGeometry || !this.tracePositions) return;
        const px = (position as any).x, py = (position as any).y, pz = (position as any).z;
        const vx = (velocity as any).x, vy = (velocity as any).y, vz = (velocity as any).z;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed <= this.traceSpeedEps) return;

        const curr = new THREE.Vector3(px, py, pz);
        if (this.traceLastPos && this.traceLastPos.distanceTo(curr) < this.traceMinDist) {
            return;
        }
        this.appendTracePoint(curr);
        this.traceLastPos = curr;
    }

    private appendTracePoint(pos: THREE.Vector3): void {
        if (!this.traceGeometry || !this.tracePositions) return;
        if (this.traceCount < this.traceMaxPoints) {
            const i = this.traceCount * 3;
            this.tracePositions[i] = pos.x;
            this.tracePositions[i + 1] = pos.y;
            this.tracePositions[i + 2] = pos.z;
            this.traceCount++;
        } else {
            // Shift left by one vertex (3 floats) and append at end
            this.tracePositions.copyWithin(0, 3);
            const i = (this.traceMaxPoints - 1) * 3;
            this.tracePositions[i] = pos.x;
            this.tracePositions[i + 1] = pos.y;
            this.tracePositions[i + 2] = pos.z;
        }
        const attr = this.traceGeometry.getAttribute('position') as THREE.BufferAttribute;
        attr.needsUpdate = true;
        this.traceGeometry.setDrawRange(0, this.traceCount);
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

        if (this.traceLine) {
            this.scene.remove(this.traceLine);
            this.traceLine = null;
        }
        if (this.traceGeometry) {
            this.traceGeometry.dispose();
            this.traceGeometry = null;
        }
        if (this.traceMaterial) {
            this.traceMaterial.dispose();
            this.traceMaterial = null;
        }
    }
} 

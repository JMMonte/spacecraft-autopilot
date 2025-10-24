import * as THREE from 'three';
import { store } from '../state/store';

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
    private traceColors: Float32Array | null = null;
    private traceCount: number = 0;
    private traceCapacity: number = 2000;
    private traceMinDist: number = 0.05;
    private traceSpeedEps: number = 0.005;
    private traceLastPos: THREE.Vector3 | null = null;
    private traceLastVel: THREE.Vector3 | null = null;
    private traceLastTimeMs: number | null = null;
    private latestForceAbs: number = 0;
    private latestForceNet: number = 0;
    private storeUnsub: (() => void) | null = null;
    // Per-point metrics for recoloring
    private metricSpeed: Float32Array | null = null;
    private metricAccel: Float32Array | null = null;
    private metricForceAbs: Float32Array | null = null;
    private metricForceNet: Float32Array | null = null;
    // Cached min/max for active metric
    private activeMetric: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet' = 'velocity';
    private metricMin: number = Infinity;
    private metricMax: number = -Infinity;
    private prevGradientEnabled: boolean = false;
    private prevPalette: 'turbo' | 'viridis' = 'turbo';
    // Path visualization
    public pathLine: THREE.Line | null = null;
    private pathGeometry: THREE.BufferGeometry | null = null;
    private pathMaterial: THREE.LineBasicMaterial | null = null;
    public pathCarrot: THREE.Mesh | null = null;

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
        // Initialize path visuals (hidden by default)
        this.initPathVisuals();
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
        // Dynamic buffers with vertex colors for gradient visualization
        this.traceGeometry = new THREE.BufferGeometry();
        this.tracePositions = new Float32Array(this.traceCapacity * 3);
        this.traceColors = new Float32Array(this.traceCapacity * 3);
        this.metricSpeed = new Float32Array(this.traceCapacity);
        this.metricAccel = new Float32Array(this.traceCapacity);
        this.metricForceAbs = new Float32Array(this.traceCapacity);
        this.metricForceNet = new Float32Array(this.traceCapacity);
        this.traceGeometry.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3));
        this.traceGeometry.setAttribute('color', new THREE.BufferAttribute(this.traceColors, 3));
        this.traceGeometry.setDrawRange(0, 0);

        this.traceMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff, // multiplied by vertex colors
            linewidth: 1,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false,
            vertexColors: true,
        });
        this.traceLine = new THREE.Line(this.traceGeometry, this.traceMaterial);
        // Ensure the trace is never culled when off-camera; we treat it as HUD-like
        this.traceLine.frustumCulled = false;
        (this.traceLine as any).renderOrder = 999;
        (this.traceLine as any).userData = { ...(this.traceLine as any).userData, lensflare: 'no-occlusion' };
        this.traceLine.visible = false;
        this.scene.add(this.traceLine);

        // Subscribe to trace settings to handle gradient changes
        try {
            this.storeUnsub = store.subscribe(() => {
                const s = store.getState().traceSettings;
                const mode = s.gradientMode;
                const justEnabled = s.gradientEnabled && !this.prevGradientEnabled;
                const justDisabled = !s.gradientEnabled && this.prevGradientEnabled;
                this.prevGradientEnabled = s.gradientEnabled;
                const paletteChanged = s.palette !== this.prevPalette;
                this.prevPalette = s.palette;

                if (mode !== this.activeMetric) {
                    this.activeMetric = mode;
                    if (s.gradientEnabled) this.recomputeColors();
                }
                if (justEnabled || paletteChanged) {
                    this.recomputeColors();
                } else if (justDisabled) {
                    this.applyFlatColor();
                }
            });
        } catch {}
    }

    public setTraceVisible(visible: boolean): void {
        if (!this.traceLine) return;
        // On enabling, start a fresh trace from next update
        if (visible && !this.traceLine.visible) {
            this.resetTrace();
        }
        this.traceLine.visible = visible;
    }

    // --- Path visualization API ---
    private initPathVisuals(): void {
        this.pathGeometry = new THREE.BufferGeometry();
        this.pathMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
        this.pathLine = new THREE.Line(this.pathGeometry, this.pathMaterial);
        (this.pathLine as any).renderOrder = 998;
        (this.pathLine as any).userData = { ...(this.pathLine as any).userData, lensflare: 'no-occlusion' };
        this.pathLine.visible = false;
        this.scene.add(this.pathLine);

        const carrotGeom = new THREE.SphereGeometry(0.15, 16, 16);
        const carrotMat = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
        this.pathCarrot = new THREE.Mesh(carrotGeom, carrotMat);
        (this.pathCarrot as any).renderOrder = 999;
        (this.pathCarrot as any).userData = { ...(this.pathCarrot as any).userData, lensflare: 'no-occlusion' };
        this.pathCarrot.visible = false;
        this.scene.add(this.pathCarrot);
    }

    public setPathVisible(visible: boolean): void {
        if (this.pathLine) this.pathLine.visible = visible;
        if (this.pathCarrot) this.pathCarrot.visible = visible;
    }

    public updatePath(points: THREE.Vector3[], carrot?: THREE.Vector3): void {
        if (!this.pathGeometry || !this.pathLine || !points || points.length < 2) {
            if (this.pathLine) this.pathLine.visible = false;
            if (this.pathCarrot) this.pathCarrot.visible = false;
            return;
        }
        const attr = this.pathGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!attr || attr.count !== points.length) {
            // Dispose previous attribute to free GPU memory
            if (attr) {
                try { (attr as any).dispose?.(); } catch {}
                try { this.pathGeometry.deleteAttribute('position'); } catch {}
            }
            const arr = new Float32Array(points.length * 3);
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                arr[i * 3 + 0] = p.x;
                arr[i * 3 + 1] = p.y;
                arr[i * 3 + 2] = p.z;
            }
            this.pathGeometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            this.pathGeometry.computeBoundingSphere();
        } else {
            // Update existing buffer in place (no allocations)
            const arr = (attr.array as Float32Array);
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                const j = i * 3;
                arr[j] = p.x; arr[j + 1] = p.y; arr[j + 2] = p.z;
            }
            attr.needsUpdate = true;
        }
        if (this.pathCarrot && carrot) {
            this.pathCarrot.position.copy(carrot);
        }
    }

    public resetTrace(): void {
        if (!this.traceGeometry || !this.tracePositions) return;
        this.traceCount = 0;
        this.traceGeometry.setDrawRange(0, 0);
        this.traceLastPos = null;
        this.traceLastVel = null;
        this.traceLastTimeMs = null;
        this.metricMin = Infinity;
        this.metricMax = -Infinity;
        if (this.traceColors) {
            for (let i = 0; i < this.traceColors.length; i += 3) {
                this.traceColors[i + 0] = 0.0;
                this.traceColors[i + 1] = 1.0;
                this.traceColors[i + 2] = 0.8;
            }
            const attr = this.traceGeometry.getAttribute('color') as THREE.BufferAttribute;
            if (attr) attr.needsUpdate = true;
        }
    }

    public updateTrace(spacecraftId: string, position: THREE.Vector3 | { x: number; y: number; z: number }, velocity: THREE.Vector3 | { x: number; y: number; z: number }): void {
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
        const now = performance.now();
        let accel = 0;
        if (this.traceLastVel && this.traceLastTimeMs != null) {
            const dt = Math.max(1e-3, (now - this.traceLastTimeMs) / 1000);
            const dv = new THREE.Vector3(vx, vy, vz).sub(this.traceLastVel);
            accel = dv.length() / dt;
        }
        this.appendTracePoint(spacecraftId, curr, speed, accel, this.latestForceAbs, this.latestForceNet);
        this.traceLastPos = curr;
        this.traceLastVel = new THREE.Vector3(vx, vy, vz);
        this.traceLastTimeMs = now;
    }

    private appendTracePoint(spacecraftId: string, pos: THREE.Vector3, speed: number, accel: number, forceAbs: number, forceNet: number): void {
        if (!this.traceGeometry || !this.tracePositions || !this.traceColors) return;
        if (this.traceCount >= this.traceCapacity) this.growTraceCapacity();

        const i3 = this.traceCount * 3;
        this.tracePositions[i3 + 0] = pos.x;
        this.tracePositions[i3 + 1] = pos.y;
        this.tracePositions[i3 + 2] = pos.z;

        if (this.metricSpeed && this.metricAccel && this.metricForceAbs && this.metricForceNet) {
            this.metricSpeed[this.traceCount] = speed;
            this.metricAccel[this.traceCount] = accel;
            this.metricForceAbs[this.traceCount] = forceAbs;
            this.metricForceNet[this.traceCount] = forceNet;
        }

        const s = store.getState().traceSettings;
        if (s.gradientEnabled) {
            const v = this.pickMetricValue(s.gradientMode, speed, accel, forceAbs, forceNet);
            let needsRecolorAll = false;
            if (v < this.metricMin) { this.metricMin = v; needsRecolorAll = true; }
            if (v > this.metricMax) { this.metricMax = v; needsRecolorAll = true; }
            if (needsRecolorAll) {
                // Recompute colors for all existing points so scaling is relative to all data
                this.recomputeColors();
            }
            // Color this point with current global min/max
            const color = this.samplePalette(s.palette, this.normalize(v, this.metricMin, this.metricMax));
            this.traceColors[i3 + 0] = color[0];
            this.traceColors[i3 + 1] = color[1];
            this.traceColors[i3 + 2] = color[2];
        } else {
            this.traceColors[i3 + 0] = 0.0;
            this.traceColors[i3 + 1] = 1.0;
            this.traceColors[i3 + 2] = 0.8;
        }

        this.traceCount++;

        const posAttr = this.traceGeometry.getAttribute('position') as THREE.BufferAttribute;
        const colAttr = this.traceGeometry.getAttribute('color') as THREE.BufferAttribute;
        if (posAttr) posAttr.needsUpdate = true;
        if (colAttr) colAttr.needsUpdate = true;
        this.traceGeometry.setDrawRange(0, this.traceCount);

        try {
            store.appendTraceSample(spacecraftId, {
                t: performance.now(), x: pos.x, y: pos.y, z: pos.z,
                speed, accel, forceAbs, forceNet,
            });
        } catch {}
    }

    public setLatestForceMetrics(absSum: number, netMag: number): void {
        this.latestForceAbs = absSum;
        this.latestForceNet = netMag;
    }

    private growTraceCapacity(): void {
        const newCap = Math.max(1024, Math.floor(this.traceCapacity * 1.8));
        const newPos = new Float32Array(newCap * 3);
        const newCol = new Float32Array(newCap * 3);
        const newSpeed = new Float32Array(newCap);
        const newAccel = new Float32Array(newCap);
        const newFA = new Float32Array(newCap);
        const newFN = new Float32Array(newCap);
        if (this.tracePositions) newPos.set(this.tracePositions.subarray(0, this.traceCount * 3));
        if (this.traceColors) newCol.set(this.traceColors.subarray(0, this.traceCount * 3));
        if (this.metricSpeed) newSpeed.set(this.metricSpeed.subarray(0, this.traceCount));
        if (this.metricAccel) newAccel.set(this.metricAccel.subarray(0, this.traceCount));
        if (this.metricForceAbs) newFA.set(this.metricForceAbs.subarray(0, this.traceCount));
        if (this.metricForceNet) newFN.set(this.metricForceNet.subarray(0, this.traceCount));
        this.tracePositions = newPos;
        this.traceColors = newCol;
        this.metricSpeed = newSpeed;
        this.metricAccel = newAccel;
        this.metricForceAbs = newFA;
        this.metricForceNet = newFN;
        this.traceCapacity = newCap;
        this.traceGeometry!.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3));
        this.traceGeometry!.setAttribute('color', new THREE.BufferAttribute(this.traceColors, 3));
    }

    private normalize(v: number, min: number, max: number): number {
        if (!isFinite(min) || !isFinite(max) || max <= min) return 0.5;
        return Math.min(1, Math.max(0, (v - min) / (max - min)));
    }

    private pickMetricValue(mode: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet', speed: number, accel: number, fa: number, fn: number): number {
        switch (mode) {
            case 'velocity': return speed;
            case 'acceleration': return accel;
            case 'forceAbs': return fa;
            case 'forceNet': return fn;
        }
    }

    private srgbToLinear(c: number): number {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    private samplePalette(palette: 'turbo' | 'viridis', t: number): [number, number, number] {
        const x = Math.min(1, Math.max(0, t));
        if (palette === 'viridis') {
            // Simple viridis approximation
            const r_s = Math.min(1, Math.max(0, 0.267 + 2.15*x - 4.38*x*x + 2.69*x*x*x));
            const g_s = Math.min(1, Math.max(0, 0.005 + 1.65*x + 1.75*x*x - 3.36*x*x*x));
            const b_s = Math.min(1, Math.max(0, 0.329 - 0.17*x + 2.91*x*x - 2.16*x*x*x));
            return [this.srgbToLinear(r_s), this.srgbToLinear(g_s), this.srgbToLinear(b_s)];
        } else {
            // Turbo colormap approximation (Google)
            const r_s = 0.13572138 + 4.61539260*x - 42.66032258*x*x + 132.13108234*x*x*x - 152.94239396*x*x*x*x + 59.28637943*x*x*x*x*x;
            const g_s = 0.09140261 + 2.19418839*x + 4.84296658*x*x - 14.18503333*x*x*x + 14.13814087*x*x*x*x - 4.42412465*x*x*x*x*x;
            const b_s = 0.10667330 + 11.60249308*x - 41.70399641*x*x + 63.12301484*x*x*x - 36.84398614*x*x*x*x + 7.01701563*x*x*x*x*x;
            const r = Math.min(1, Math.max(0, r_s));
            const g = Math.min(1, Math.max(0, g_s));
            const b = Math.min(1, Math.max(0, b_s));
            return [this.srgbToLinear(r), this.srgbToLinear(g), this.srgbToLinear(b)];
        }
    }

    private applyFlatColor(): void {
        if (!this.traceColors) return;
        // Convert the default sRGB-ish (0,1,0.8) to linear
        const c0 = 0.0;
        const c1 = 1.0; // 1 stays 1 in linear
        const c2 = this.srgbToLinear(0.8);
        for (let i = 0; i < this.traceCount; i++) {
            const j = i * 3;
            this.traceColors[j + 0] = c0;
            this.traceColors[j + 1] = c1;
            this.traceColors[j + 2] = c2;
        }
        const colAttr = this.traceGeometry!.getAttribute('color') as THREE.BufferAttribute;
        if (colAttr) colAttr.needsUpdate = true;
    }

    private recomputeColors(): void {
        if (!this.traceColors || this.traceCount === 0) return;
        const s = store.getState().traceSettings;
        if (!s.gradientEnabled) { this.applyFlatColor(); return; }
        // Recompute min/max for selected metric
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < this.traceCount; i++) {
            const v = this.pickMetricValue(
                s.gradientMode,
                this.metricSpeed?.[i] ?? 0,
                this.metricAccel?.[i] ?? 0,
                this.metricForceAbs?.[i] ?? 0,
                this.metricForceNet?.[i] ?? 0
            );
            if (v < min) min = v;
            if (v > max) max = v;
        }
        this.metricMin = min; this.metricMax = max;
        for (let i = 0; i < this.traceCount; i++) {
            const v = this.pickMetricValue(
                s.gradientMode,
                this.metricSpeed?.[i] ?? 0,
                this.metricAccel?.[i] ?? 0,
                this.metricForceAbs?.[i] ?? 0,
                this.metricForceNet?.[i] ?? 0
            );
            const t = this.normalize(v, min, max);
            const [r, g, b] = this.samplePalette(s.palette, t);
            const j = i * 3;
            this.traceColors[j + 0] = r; this.traceColors[j + 1] = g; this.traceColors[j + 2] = b;
        }
        const colAttr = this.traceGeometry!.getAttribute('color') as THREE.BufferAttribute;
        if (colAttr) colAttr.needsUpdate = true;
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
        if (this.pathLine) {
            this.scene.remove(this.pathLine);
            this.pathLine = null;
        }
        if (this.traceGeometry) {
            this.traceGeometry.dispose();
            this.traceGeometry = null;
        }
        if (this.pathGeometry) {
            this.pathGeometry.dispose();
            this.pathGeometry = null;
        }
        if (this.traceMaterial) {
            this.traceMaterial.dispose();
            this.traceMaterial = null;
        }
        if (this.pathMaterial) {
            this.pathMaterial.dispose();
            this.pathMaterial = null;
        }
        if (this.pathCarrot) {
            this.scene.remove(this.pathCarrot);
            (this.pathCarrot.geometry as any)?.dispose?.();
            const mat = this.pathCarrot.material as any; if (mat?.dispose) mat.dispose();
            this.pathCarrot = null;
        }
        try { this.storeUnsub?.(); } catch {}
    }
} 

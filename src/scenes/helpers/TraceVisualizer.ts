import * as THREE from 'three';
import { emitTraceSampleAppended } from '../../domain/simulationEvents';
import type { SimulationRuntimeStatePort } from '../../domain/runtimeStatePort';
import { noopSimulationRuntimeStatePort } from '../../domain/runtimeStatePort';

/**
 * Manages the spacecraft trajectory trace line with dynamic buffer growth,
 * per-vertex gradient coloring (velocity/acceleration/force metrics), and
 * colormap support (turbo/viridis).
 */
export class TraceVisualizer {
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
    private activeMetric: 'velocity' | 'acceleration' | 'forceAbs' | 'forceNet' = 'velocity';
    private metricMin: number = Infinity;
    private metricMax: number = -Infinity;
    private prevGradientEnabled: boolean = false;
    private prevPalette: 'turbo' | 'viridis' = 'turbo';
    private runtimeState: SimulationRuntimeStatePort;

    constructor(
        private scene: THREE.Scene,
        runtimeState: SimulationRuntimeStatePort = noopSimulationRuntimeStatePort,
    ) {
        this.runtimeState = runtimeState;
        this.init();
    }

    private init(): void {
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
            color: 0xffffff, linewidth: 1, transparent: true, opacity: 0.9,
            depthTest: false, depthWrite: false, vertexColors: true,
        });
        this.traceLine = new THREE.Line(this.traceGeometry, this.traceMaterial);
        this.traceLine.frustumCulled = false;
        (this.traceLine as any).renderOrder = 999;
        (this.traceLine as any).userData = { ...(this.traceLine as any).userData, lensflare: 'no-occlusion' };
        this.traceLine.visible = false;
        this.scene.add(this.traceLine);

        try {
            this.storeUnsub = this.runtimeState.subscribeTraceSettings((s) => {
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
                if (justEnabled || paletteChanged) this.recomputeColors();
                else if (justDisabled) this.applyFlatColor();
            });
        } catch {}
    }

    setTraceVisible(visible: boolean): void {
        if (!this.traceLine) return;
        if (visible && !this.traceLine.visible) this.resetTrace();
        this.traceLine.visible = visible;
    }

    resetTrace(): void {
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
                this.traceColors[i] = 0.0; this.traceColors[i + 1] = 1.0; this.traceColors[i + 2] = 0.8;
            }
            const attr = this.traceGeometry.getAttribute('color') as THREE.BufferAttribute;
            if (attr) attr.needsUpdate = true;
        }
    }

    updateTrace(spacecraftId: string, position: THREE.Vector3 | { x: number; y: number; z: number }, velocity: THREE.Vector3 | { x: number; y: number; z: number }): void {
        if (!this.traceLine || !this.traceLine.visible) return;
        if (!this.traceGeometry || !this.tracePositions) return;
        const px = (position as any).x, py = (position as any).y, pz = (position as any).z;
        const vx = (velocity as any).x, vy = (velocity as any).y, vz = (velocity as any).z;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed <= this.traceSpeedEps) return;

        const curr = new THREE.Vector3(px, py, pz);
        if (this.traceLastPos && this.traceLastPos.distanceTo(curr) < this.traceMinDist) return;
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

    setLatestForceMetrics(absSum: number, netMag: number): void {
        this.latestForceAbs = absSum;
        this.latestForceNet = netMag;
    }

    cleanup(): void {
        if (this.traceLine) { this.scene.remove(this.traceLine); this.traceLine = null; }
        if (this.traceGeometry) { this.traceGeometry.dispose(); this.traceGeometry = null; }
        if (this.traceMaterial) { this.traceMaterial.dispose(); this.traceMaterial = null; }
        try { this.storeUnsub?.(); } catch {}
    }

    // ── Private helpers ──

    private appendTracePoint(spacecraftId: string, pos: THREE.Vector3, speed: number, accel: number, forceAbs: number, forceNet: number): void {
        if (!this.traceGeometry || !this.tracePositions || !this.traceColors) return;
        if (this.traceCount >= this.traceCapacity) this.growTraceCapacity();
        const i3 = this.traceCount * 3;
        this.tracePositions[i3] = pos.x; this.tracePositions[i3 + 1] = pos.y; this.tracePositions[i3 + 2] = pos.z;
        if (this.metricSpeed && this.metricAccel && this.metricForceAbs && this.metricForceNet) {
            this.metricSpeed[this.traceCount] = speed;
            this.metricAccel[this.traceCount] = accel;
            this.metricForceAbs[this.traceCount] = forceAbs;
            this.metricForceNet[this.traceCount] = forceNet;
        }
        const s = this.runtimeState.getTraceSettings();
        if (s.gradientEnabled) {
            const v = this.pickMetric(s.gradientMode, speed, accel, forceAbs, forceNet);
            let needsRecolor = false;
            if (v < this.metricMin) { this.metricMin = v; needsRecolor = true; }
            if (v > this.metricMax) { this.metricMax = v; needsRecolor = true; }
            if (needsRecolor) this.recomputeColors();
            const color = this.samplePalette(s.palette, this.normalize(v, this.metricMin, this.metricMax));
            this.traceColors[i3] = color[0]; this.traceColors[i3 + 1] = color[1]; this.traceColors[i3 + 2] = color[2];
        } else {
            this.traceColors[i3] = 0.0; this.traceColors[i3 + 1] = 1.0; this.traceColors[i3 + 2] = 0.8;
        }
        this.traceCount++;
        const posAttr = this.traceGeometry.getAttribute('position') as THREE.BufferAttribute;
        const colAttr = this.traceGeometry.getAttribute('color') as THREE.BufferAttribute;
        if (posAttr) posAttr.needsUpdate = true;
        if (colAttr) colAttr.needsUpdate = true;
        this.traceGeometry.setDrawRange(0, this.traceCount);
        try {
            emitTraceSampleAppended({ spacecraftId, sample: { t: performance.now(), x: pos.x, y: pos.y, z: pos.z, speed, accel, forceAbs, forceNet } });
        } catch {}
    }

    private growTraceCapacity(): void {
        const newCap = Math.max(1024, Math.floor(this.traceCapacity * 1.8));
        const grow = <T extends Float32Array>(old: T | null, elems: number): Float32Array => {
            const arr = new Float32Array(newCap * elems);
            if (old) arr.set(old.subarray(0, this.traceCount * elems));
            return arr;
        };
        this.tracePositions = grow(this.tracePositions, 3);
        this.traceColors = grow(this.traceColors, 3);
        this.metricSpeed = grow(this.metricSpeed, 1);
        this.metricAccel = grow(this.metricAccel, 1);
        this.metricForceAbs = grow(this.metricForceAbs, 1);
        this.metricForceNet = grow(this.metricForceNet, 1);
        this.traceCapacity = newCap;
        this.traceGeometry!.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3));
        this.traceGeometry!.setAttribute('color', new THREE.BufferAttribute(this.traceColors, 3));
    }

    private normalize(v: number, min: number, max: number): number {
        if (!isFinite(min) || !isFinite(max) || max <= min) return 0.5;
        return Math.min(1, Math.max(0, (v - min) / (max - min)));
    }

    private pickMetric(mode: string, speed: number, accel: number, fa: number, fn: number): number {
        if (mode === 'acceleration') return accel;
        if (mode === 'forceAbs') return fa;
        if (mode === 'forceNet') return fn;
        return speed;
    }

    private srgbToLinear(c: number): number {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    private samplePalette(palette: 'turbo' | 'viridis', t: number): [number, number, number] {
        const x = Math.min(1, Math.max(0, t));
        if (palette === 'viridis') {
            const r = Math.min(1, Math.max(0, 0.267 + 2.15*x - 4.38*x*x + 2.69*x*x*x));
            const g = Math.min(1, Math.max(0, 0.005 + 1.65*x + 1.75*x*x - 3.36*x*x*x));
            const b = Math.min(1, Math.max(0, 0.329 - 0.17*x + 2.91*x*x - 2.16*x*x*x));
            return [this.srgbToLinear(r), this.srgbToLinear(g), this.srgbToLinear(b)];
        }
        const r = 0.13572138 + 4.61539260*x - 42.66032258*x*x + 132.13108234*x*x*x - 152.94239396*x*x*x*x + 59.28637943*x*x*x*x*x;
        const g = 0.09140261 + 2.19418839*x + 4.84296658*x*x - 14.18503333*x*x*x + 14.13814087*x*x*x*x - 4.42412465*x*x*x*x*x;
        const b = 0.10667330 + 11.60249308*x - 41.70399641*x*x + 63.12301484*x*x*x - 36.84398614*x*x*x*x + 7.01701563*x*x*x*x*x;
        return [this.srgbToLinear(Math.min(1, Math.max(0, r))), this.srgbToLinear(Math.min(1, Math.max(0, g))), this.srgbToLinear(Math.min(1, Math.max(0, b)))];
    }

    private applyFlatColor(): void {
        if (!this.traceColors) return;
        const c2 = this.srgbToLinear(0.8);
        for (let i = 0; i < this.traceCount; i++) {
            const j = i * 3;
            this.traceColors[j] = 0.0; this.traceColors[j + 1] = 1.0; this.traceColors[j + 2] = c2;
        }
        const colAttr = this.traceGeometry!.getAttribute('color') as THREE.BufferAttribute;
        if (colAttr) colAttr.needsUpdate = true;
    }

    private recomputeColors(): void {
        if (!this.traceColors || this.traceCount === 0) return;
        const s = this.runtimeState.getTraceSettings();
        if (!s.gradientEnabled) { this.applyFlatColor(); return; }
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < this.traceCount; i++) {
            const v = this.pickMetric(s.gradientMode, this.metricSpeed?.[i] ?? 0, this.metricAccel?.[i] ?? 0, this.metricForceAbs?.[i] ?? 0, this.metricForceNet?.[i] ?? 0);
            if (v < min) min = v;
            if (v > max) max = v;
        }
        this.metricMin = min; this.metricMax = max;
        for (let i = 0; i < this.traceCount; i++) {
            const v = this.pickMetric(s.gradientMode, this.metricSpeed?.[i] ?? 0, this.metricAccel?.[i] ?? 0, this.metricForceAbs?.[i] ?? 0, this.metricForceNet?.[i] ?? 0);
            const t = this.normalize(v, min, max);
            const [r, g, b] = this.samplePalette(s.palette, t);
            const j = i * 3;
            this.traceColors[j] = r; this.traceColors[j + 1] = g; this.traceColors[j + 2] = b;
        }
        const colAttr = this.traceGeometry!.getAttribute('color') as THREE.BufferAttribute;
        if (colAttr) colAttr.needsUpdate = true;
    }
}

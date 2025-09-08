import * as THREE from 'three';
import { setAutopilotState } from '../../state/store';
import { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import { AutopilotConfig } from './AutopilotMode';
import { CancelRotation } from './CancelRotation';
import { CancelLinearMotion } from './CancelLinearMotion';
import { PointToPosition } from './PointToPosition';
import { OrientationMatchAutopilot } from './OrientationMatchAutopilot';
import { GoToPosition } from './GoToPosition';
import { createLogger } from '../../utils/logger';

interface AutopilotModes {
    orientationMatch: boolean;
    cancelRotation: boolean;
    cancelLinearMotion: boolean;
    pointToPosition: boolean;
    goToPosition: boolean;
}

export class Autopilot {
    private log = createLogger('controllers:Autopilot');
    private spacecraft: Spacecraft;
    private config: AutopilotConfig;
    private thrusterGroups: any;
    private thrust: number;
    private thrusterMax: number[];
    private isEnabled: boolean = false;
    private activeAutopilots: AutopilotModes;
    public targetPosition: THREE.Vector3;
    public targetOrientation: THREE.Quaternion;
    private targetObject: Spacecraft | null = null;
    private targetPoint: THREE.Vector3 = new THREE.Vector3();
    private referenceObject: Spacecraft | null = null;
    // deprecated: auto-tune now only via PID window
    private useWorker: boolean = true;
    private worker?: Worker;
    private workerReady: boolean = false;
    private workerTelemetry: { point?: any; orient?: any; goto?: any } = {};
    // Output buffer and scheduling
    private forcesBuffer: number[] = new Array(24).fill(0);
    private updateInterval: number = 1 / 30; // run autopilot at 30 Hz to reduce load
    private timeSinceUpdate: number = 0;
    // Scratch objects to avoid per-frame allocations
    private scratchDir = new THREE.Vector3();
    private scratchForward = new THREE.Vector3();
    private scratchQuat = new THREE.Quaternion();

    // Mode instances
    private cancelRotationMode!: CancelRotation;
    private cancelLinearMotionMode!: CancelLinearMotion;
    private pointToPositionMode!: PointToPosition;
    private orientationMatchMode!: OrientationMatchAutopilot;
    private goToPositionMode!: GoToPosition;

    // PID Controllers
    private orientationPidController: PIDController;
    private rotationCancelPidController: PIDController;
    private linearPidController: PIDController;
    private momentumPidController: PIDController;
    private onStateChange?: (state: { enabled: boolean; activeAutopilots: AutopilotModes }) => void;

    constructor(
        spacecraft: Spacecraft,
        thrusterGroups: any,
        thrust: number,
        thrusterMax: number[],
        options: {
            pidGains?: {
                orientation?: { kp: number; ki: number; kd: number; };
                position?: { kp: number; ki: number; kd: number; };
                momentum?: { kp: number; ki: number; kd: number; };
            };
            maxForce?: number;
            dampingFactor?: number;
            maxAngularMomentum?: number;
            maxLinearMomentum?: number;
            autoTune?: boolean;
            useWorker?: boolean;
        } = {}
    ) {
        this.spacecraft = spacecraft;
        this.thrusterGroups = thrusterGroups;
        this.thrust = thrust;
        this.thrusterMax = (thrusterMax && thrusterMax.length === 24) ? thrusterMax.slice(0, 24) : new Array(24).fill(thrust);
        this.targetPosition = new THREE.Vector3();
        this.targetOrientation = new THREE.Quaternion();
        this.useWorker = options.useWorker ?? true;

        // Initialize config with default values
        const defaultPidGains = {
            orientation: { kp: 0.5, ki: 0.1, kd: 0.2 },    // For rotation control
            position: { kp: 0.1, ki: 0.001, kd: 0.5 },     // For GoToPosition - extremely gentle gains
            momentum: { kp: 6.0, ki: 0.2, kd: 2.0 }        // For CancelLinearMotion
        };

        this.config = {
            pid: {
                orientation: { ...defaultPidGains.orientation, ...options.pidGains?.orientation },
                position: { ...defaultPidGains.position, ...options.pidGains?.position },
                momentum: { ...defaultPidGains.momentum, ...options.pidGains?.momentum },
            },
            limits: {
                maxForce: options.maxForce ?? 1000,
                epsilon: 0.01,
                maxAngularMomentum: options.maxAngularMomentum ?? 1.0,
                maxLinearMomentum: options.maxLinearMomentum ?? 10.0,
                maxAngularVelocity:  options.pidGains?.orientation ? 1.0 : 1.2,
                maxAngularAcceleration: 5.0,
                maxLinearVelocity: options.maxLinearMomentum ? (options.maxLinearMomentum / Math.max(this.spacecraft.getMass(), 1e-3)) * 4 : 8.0,
                maxLinearAcceleration: 2.5,
            },
            damping: {
                factor: options.dampingFactor ?? 8.0,       // Much higher damping
            },
        };

        // Initialize PID controllers
        this.orientationPidController = new PIDController(
            this.config.pid.orientation.kp,
            this.config.pid.orientation.ki,
            this.config.pid.orientation.kd,
            'angularMomentum'
        );
        this.rotationCancelPidController = new PIDController(
            this.config.pid.orientation.kp,
            this.config.pid.orientation.ki,
            this.config.pid.orientation.kd,
            'angularMomentum'
        );

        this.linearPidController = new PIDController(
            this.config.pid.position.kp,
            this.config.pid.position.ki,
            this.config.pid.position.kd,
            'position'
        );

        this.momentumPidController = new PIDController(
            this.config.pid.momentum.kp,
            this.config.pid.momentum.ki,
            this.config.pid.momentum.kd,
            'linearMomentum'
        );
        
        // Configure additional PID parameters
        this.linearPidController.setMaxIntegral(0.1);      // Limit integral windup
        this.linearPidController.setDerivativeAlpha(0.95); // Smoother derivative

        this.momentumPidController.setMaxIntegral(0.2);    // Higher integral limit for momentum
        this.momentumPidController.setDerivativeAlpha(0.9); // Less smoothing for momentum

        // Initialize state
        this.activeAutopilots = {
            orientationMatch: false,
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            goToPosition: false
        };

        // Initialize modes (for local path)
        this.initializeModes();
        // Defer worker creation until a mode is enabled to avoid idle workers
    }

    private initializeModes(): void {
        this.cancelRotationMode = new CancelRotation(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.rotationCancelPidController,
            this.thrusterMax
        );

        this.cancelLinearMotionMode = new CancelLinearMotion(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.momentumPidController,
            this.thrusterMax
        );

        this.pointToPositionMode = new PointToPosition(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.orientationPidController,
            this.targetPosition,
            this.thrusterMax
        );

        this.orientationMatchMode = new OrientationMatchAutopilot(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.orientationPidController,
            this.targetOrientation,
            undefined,
            false,
            this.thrusterMax
        );

        this.goToPositionMode = new GoToPosition(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.linearPidController,
            this.targetPosition,
            this.thrusterMax
        );
    }

    // Expose config for helpers like ManualAllocator
    public getConfig(): AutopilotConfig {
        return this.config;
    }

    // --- Auto-tune helpers -------------------------------------------------
    private computeAxisInertia(): { x: number; y: number; z: number } {
        const mass = this.spacecraft.getMass();
        const size = this.spacecraft.getMainBodyDimensions();
        const w = size.x, h = size.y, d = size.z;
        const Ix = (1 / 12) * mass * (h * h + d * d);
        const Iy = (1 / 12) * mass * (w * w + d * d);
        const Iz = (1 / 12) * mass * (w * w + h * h);
        return { x: Ix, y: Iy, z: Iz };
    }

    private fitTau(samples: Array<{ t: number; e: number }>): number {
        const pts = samples.filter(s => s.e > 1e-6);
        if (pts.length < 3) return 1.0; // fallback
        let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0;
        for (const s of pts) {
            const y = Math.log(s.e);
            sumT += s.t; sumY += y; sumTT += s.t * s.t; sumTY += s.t * y;
        }
        const n = pts.length;
        const denom = n * sumTT - sumT * sumT;
        if (Math.abs(denom) < 1e-9) return 1.0;
        const slope = (n * sumTY - sumT * sumY) / denom; // ln e = c + slope * t
        const tau = slope < -1e-6 ? -1 / slope : 1.0;
        return Math.max(0.05, Math.min(10.0, tau));
    }

    private clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

    /**
     * Active auto-tune that excites the system and estimates gains from decay samples.
     * Runs on the main thread while the autopilot (main or worker) computes thrust.
     */
    public async autoTune(type: 'attitude' | 'rotCancel' | 'position' | 'linMomentum', durationMs: number = 1200): Promise<void> {
        // Snapshot autopilot and references
        const prevEnabled = this.isEnabled;
        const prevModes = this.getActiveAutopilots();
        const prevRef = this.referenceObject;

        // Ensure enabled for tuning
        this.setEnabled(true);
        this.setReferenceObject(null);

        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const samples: Array<{ t: number; e: number }> = [];
        const sample = () => {
            const tNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const t = (tNow - start) / 1000;
            let e = 0;
            if (type === 'attitude') {
                const q = this.spacecraft.getWorldOrientation();
                const target = this.getTargetOrientation();
                const qInv = q.clone().invert();
                const errQ = qInv.multiply(target);
                const wClamped = Math.max(-1, Math.min(1, errQ.w));
                e = 2 * Math.acos(Math.abs(wClamped)); // radians
            } else if (type === 'rotCancel') {
                const w = this.spacecraft.getWorldAngularVelocity();
                const I = this.computeAxisInertia();
                const Lx = I.x * w.x, Ly = I.y * w.y, Lz = I.z * w.z;
                e = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz); // |L|
            } else if (type === 'position') {
                const p = this.spacecraft.getWorldPosition();
                const tgt = this.getTargetPosition();
                e = p.distanceTo(tgt);
            } else if (type === 'linMomentum') {
                const v = this.spacecraft.getWorldVelocity();
                e = v.length();
            }
            samples.push({ t, e });
        };

        // Configure excitation and mode control
        const q0 = this.spacecraft.getWorldOrientation();
        const p0 = this.spacecraft.getWorldPosition();
        try {
            if (type === 'attitude') {
                // Small deliberate angle step around world Y
                const axis = new THREE.Vector3(0, 1, 0);
                const angle = THREE.MathUtils.degToRad(12);
                const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
                const target = dq.multiply(q0.clone());
                this.setTargetOrientation(target);
                this.setMode('orientationMatch', true);
            } else if (type === 'rotCancel') {
                // Inject a small angular velocity then cancel
                try {
                    const rb: any = (this.spacecraft as any)?.objects?.rigid;
                    if (rb) {
                        const av = rb.getAngularVelocity?.() || { x: 0, y: 0, z: 0 };
                        const nearZero = (Math.abs(av.y) + Math.abs(av.x) + Math.abs(av.z)) < 1e-3;
                        if (nearZero && rb.setAngularVelocity) rb.setAngularVelocity({ x: 0, y: 0.4, z: 0 });
                    }
                } catch {}
                this.setMode('cancelRotation', true);
            } else if (type === 'position') {
                // Position step in body-forward by ~0.8m
                const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q0);
                const tgt = p0.clone().add(forward.multiplyScalar(0.8));
                this.setTargetPosition(tgt);
                this.setMode('goToPosition', true);
            } else if (type === 'linMomentum') {
                // Inject a small linear velocity then cancel
                try {
                    const rb: any = (this.spacecraft as any)?.objects?.rigid;
                    if (rb) {
                        const lv = rb.getLinearVelocity?.() || { x: 0, y: 0, z: 0 };
                        const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
                        if (speed < 0.1 && rb.setLinearVelocity) rb.setLinearVelocity({ x: 0.4, y: 0, z: 0 });
                    }
                } catch {}
                this.setMode('cancelLinearMotion', true);
            }

            // Sample during the window
            const end = start + durationMs;
            await new Promise<void>((resolve) => {
                const tick = () => {
                    sample();
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    if (now >= end) return resolve();
                    (typeof requestAnimationFrame !== 'undefined') ? requestAnimationFrame(tick) : setTimeout(tick, 16);
                };
                tick();
            });

            // Fit tau and set conservative gains
            const tau = this.fitTau(samples);
            if (type === 'attitude') {
                const kp = this.clamp(0.15 / tau, 0.05, 0.6);
                const kd = this.clamp(0.08 * tau, 0.02, 0.25);
                const ki = 0.0;
                this.orientationPidController.setGain('Kp', kp);
                this.orientationPidController.setGain('Kd', kd);
                this.orientationPidController.setGain('Ki', ki);
            } else if (type === 'rotCancel') {
                const kp = this.clamp(0.35 / tau, 0.05, 1.2);
                const kd = this.clamp(0.12 * tau, 0.02, 0.35);
                const ki = 0.0;
                this.rotationCancelPidController?.setGain('Kp', kp);
                this.rotationCancelPidController?.setGain('Kd', kd);
                this.rotationCancelPidController?.setGain('Ki', ki);
            } else if (type === 'position') {
                const kp = this.clamp(0.8 / tau, 0.05, 4.0);
                const kd = this.clamp(0.35 * tau, 0.02, 2.5);
                const ki = 0.0005; // gentle integral
                this.linearPidController.setGain('Kp', kp);
                this.linearPidController.setGain('Kd', kd);
                this.linearPidController.setGain('Ki', ki);
            } else if (type === 'linMomentum') {
                const kp = this.clamp(1.1 / tau, 0.3, 6.0);
                const kd = this.clamp(0.22 * tau, 0.02, 2.0);
                const ki = 0.0;
                this.momentumPidController.setGain('Kp', kp);
                this.momentumPidController.setGain('Kd', kd);
                this.momentumPidController.setGain('Ki', ki);
            }
            // Push to worker
            this.syncPidGainsToWorker();
        } finally {
            // Restore previous autopilot config
            this.setMode('goToPosition', !!prevModes.goToPosition);
            this.setMode('orientationMatch', !!prevModes.orientationMatch);
            this.setMode('cancelLinearMotion', !!prevModes.cancelLinearMotion);
            this.setMode('cancelRotation', !!prevModes.cancelRotation);
            this.setMode('pointToPosition', !!prevModes.pointToPosition);
            if (prevRef) this.setReferenceObject(prevRef); else this.setReferenceObject(null);
            if (!prevEnabled) this.setEnabled(false);
        }
    }

    // Push current PID gains to worker (if running)
    public syncPidGainsToWorker(): void {
        if (!(this.useWorker && this.worker && this.workerReady)) return;
        try {
            const gains = {
                orientation: {
                    kp: this.orientationPidController.getGain('Kp'),
                    ki: this.orientationPidController.getGain('Ki'),
                    kd: this.orientationPidController.getGain('Kd'),
                },
                rotationCancel: {
                    kp: this.rotationCancelPidController.getGain('Kp'),
                    ki: this.rotationCancelPidController.getGain('Ki'),
                    kd: this.rotationCancelPidController.getGain('Kd'),
                },
                position: {
                    kp: this.linearPidController.getGain('Kp'),
                    ki: this.linearPidController.getGain('Ki'),
                    kd: this.linearPidController.getGain('Kd'),
                },
                momentum: {
                    kp: this.momentumPidController.getGain('Kp'),
                    ki: this.momentumPidController.getGain('Ki'),
                    kd: this.momentumPidController.getGain('Kd'),
                }
            };
            this.worker!.postMessage({ type: 'setGains', gains });
        } catch {}
    }

    // Worker calibration is no longer used; tuning happens via PID window-triggered autoTune

    public setThrusterStrengths(max: number[]): void {
        const arr = (Array.isArray(max) && max.length === 24) ? max.slice(0, 24) : new Array(24).fill(this.thrust);
        this.thrusterMax = arr;
        // Update all mode instances
        this.cancelRotationMode?.setThrusterMax(arr);
        this.cancelLinearMotionMode?.setThrusterMax(arr);
        this.pointToPositionMode?.setThrusterMax(arr);
        this.orientationMatchMode?.setThrusterMax(arr);
        this.goToPositionMode?.setThrusterMax(arr);
        // Inform worker
        if (this.useWorker && this.worker && this.workerReady) {
            try { this.worker.postMessage({ type: 'setThrusterStrengths', strengths: arr }); } catch {}
        }
    }

    // Dynamically update thruster grouping after geometry changes
    public setThrusterGroups(groups: any): void {
        this.thrusterGroups = groups;
        try { this.cancelRotationMode.setThrusterGroups(groups); } catch {}
        try { this.cancelLinearMotionMode.setThrusterGroups(groups); } catch {}
        try { this.pointToPositionMode.setThrusterGroups(groups); } catch {}
        try { this.orientationMatchMode.setThrusterGroups(groups); } catch {}
        try { this.goToPositionMode.setThrusterGroups(groups); } catch {}
        if (this.useWorker && this.worker && this.workerReady) {
            try { this.worker.postMessage({ type: 'setThrusterGroups', groups }); } catch {}
        }
    }

    // Push current thruster transforms (position+direction) to worker and clear caps caches
    public refreshThrusters(): void {
        try {
            const thrusters = (this.spacecraft.getThrusterConfigs?.() || []).map((t: any) => ({
                position: [t.position.x, t.position.y, t.position.z] as [number, number, number],
                direction: [t.direction.x, t.direction.y, t.direction.z] as [number, number, number],
            }));
            // Invalidate caps on all modes (thruster layout affects torque capacities)
            this.cancelRotationMode.invalidateCaps();
            this.cancelLinearMotionMode.invalidateCaps();
            this.pointToPositionMode.invalidateCaps();
            this.orientationMatchMode.invalidateCaps();
            this.goToPositionMode.invalidateCaps();
            if (this.useWorker && this.worker && this.workerReady) {
                this.worker.postMessage({ type: 'setThrusters', thrusters });
            }
        } catch {}
    }

    // Sets a moving reference for translation modes (relative motion)
    public setReferenceObject(obj: Spacecraft | null): void {
        this.referenceObject = obj;
        if (obj) {
            const refVel = obj.getWorldVelocity();
            this.cancelLinearMotionMode.setReferenceVelocityWorld(refVel);
            this.goToPositionMode.setReferenceVelocityWorld(refVel);
        } else {
            this.cancelLinearMotionMode.setReferenceVelocityWorld(null);
            this.goToPositionMode.setReferenceVelocityWorld(null);
        }
    }

    private initWorker(): void {
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore: Vite worker URL
            this.worker = new Worker(new URL('../../workers/autopilot.worker.ts', import.meta.url), { type: 'module' });
        } catch (err) {
            this.log.warn('Failed to create autopilot worker; falling back to main thread.', err);
            this.useWorker = false;
            return;
        }

        const dims = this.spacecraft.getMainBodyDimensions();
        const thrusters = (this.spacecraft.getThrusterConfigs?.() || []).map((t: any) => ({
            position: [t.position.x, t.position.y, t.position.z] as [number, number, number],
            direction: [t.direction.x, t.direction.y, t.direction.z] as [number, number, number],
        }));

        this.worker.onmessage = (ev: MessageEvent<any>) => {
            const data = ev.data;
            if (data?.type === 'ready') {
                this.workerReady = true;
                return;
            }
            if (data?.type === 'forces' && data.forces) {
                const arr: Float32Array = data.forces;
                for (let i = 0; i < 24; i++) this.forcesBuffer[i] = arr[i] || 0;
                // Snapshot telemetry from worker for UI polling
                try {
                    const t = data.telemetry || {};
                    this.workerTelemetry.point = t.point || this.workerTelemetry.point;
                    this.workerTelemetry.orient = t.orient || this.workerTelemetry.orient;
                    this.workerTelemetry.goto = t.goto || this.workerTelemetry.goto;
                } catch {}
                return;
            }
        };

        this.worker.postMessage({
            type: 'init',
            thrusterGroups: this.thrusterGroups,
            thrust: this.thrust,
            config: this.config,
            mass: this.spacecraft.getMass(),
            dims: [dims.x, dims.y, dims.z] as [number, number, number],
            thrusterConfigs: thrusters,
            thrusterStrengths: this.thrusterMax,
            autoCalibrate: false,
        });

        // Randomize update phase to avoid spikes when many autopilots run
        this.timeSinceUpdate = Math.random() * this.updateInterval;
    }

    public getTargetObject(): Spacecraft | null {
        return this.targetObject;
    }

    public setTargetObject(target: Spacecraft | null, targetPoint: 'center' | 'front' | 'back'): void {
        this.targetObject = target;
        if (target) {
            // Update target position and orientation based on the object
            if (targetPoint === 'center') {
                this.targetPosition.copy(target.objects.box.position);
            } else {
                const portPosition = target.getDockingPortWorldPosition(targetPoint);
                if (portPosition) {
                    this.targetPosition.copy(portPosition);
                } else {
                    this.targetPosition.copy(target.objects.box.position);
                }
            }
            this.targetOrientation.copy(target.objects.box.quaternion);
            
            // Update target point based on the selected port
            switch (targetPoint) {
                case 'front':
                    this.targetPoint.set(0, 0, 1);
                    break;
                case 'back':
                    this.targetPoint.set(0, 0, -1);
                    break;
                default:
                    this.targetPoint.set(0, 0, 0);
            }
            // Default the moving reference to the selected target
            this.setReferenceObject(target);
        }
    }

    public getTargetPoint(): THREE.Vector3 {
        return this.targetPoint;
    }

    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        this.log.debug('Autopilot enabled:', this.isEnabled);
    }

    public getAutopilotEnabled(): boolean {
        return this.isEnabled;
    }

    public orientationMatch(): void {
        this.setMode('orientationMatch', !this.activeAutopilots.orientationMatch);
    }

    public pointToPosition(): void {
        this.setMode('pointToPosition', !this.activeAutopilots.pointToPosition);
    }

    public cancelRotation(): void {
        this.setMode('cancelRotation', !this.activeAutopilots.cancelRotation);
    }

    public cancelLinearMotion(): void {
        this.setMode('cancelLinearMotion', !this.activeAutopilots.cancelLinearMotion);
    }

    public goToPosition(): void {
        this.setMode('goToPosition', !this.activeAutopilots.goToPosition);
    }

    public getActiveAutopilots(): AutopilotModes {
        return { ...this.activeAutopilots };
    }

    public calculateAutopilotForces(dt: number): number[] {
        // Fast exit if globally disabled or no active modes
        const anyModeActive = this.activeAutopilots.orientationMatch || this.activeAutopilots.cancelRotation || this.activeAutopilots.cancelLinearMotion || this.activeAutopilots.pointToPosition || this.activeAutopilots.goToPosition;
        if (!this.isEnabled || !anyModeActive) {
            // keep buffer but zero it to avoid stale forces
            this.forcesBuffer.fill(0);
            return this.forcesBuffer;
        }

        // Continuously track target object's latest pose if present
        if (this.targetObject) {
            // Refresh target position/orientation every cycle
            // Use docking port world position when targetPoint indicates one; otherwise center
            const useFront = this.targetPoint.z === 1;
            const useBack = this.targetPoint.z === -1;
            if (useFront) {
                const p = this.targetObject.getDockingPortWorldPosition('front');
                if (p) this.targetPosition.copy(p);
            } else if (useBack) {
                const p = this.targetObject.getDockingPortWorldPosition('back');
                if (p) this.targetPosition.copy(p);
            } else {
                this.targetPosition.copy(this.targetObject.objects.box.position);
            }
            this.targetOrientation.copy(this.targetObject.objects.box.quaternion);
        }

        // Keep relative motion reference in sync as well
        if (this.referenceObject) {
            const refVel = this.referenceObject.getWorldVelocity();
            this.cancelLinearMotionMode.setReferenceVelocityWorld(refVel);
            this.goToPositionMode.setReferenceVelocityWorld(refVel);
        } else {
            this.cancelLinearMotionMode.setReferenceVelocityWorld(null);
            this.goToPositionMode.setReferenceVelocityWorld(null);
        }

        // Publish/update live target orientation when pointing to a position (for UI arrows)
        if (this.activeAutopilots.pointToPosition) {
            const q = this.spacecraft.getWorldOrientationRef();
            const pos = this.spacecraft.getWorldPositionRef();
            this.scratchDir.copy(this.targetPosition).sub(pos);
            if (this.scratchDir.lengthSq() > 1e-10) {
                this.scratchDir.normalize();
                this.scratchForward.set(0, 0, 1).applyQuaternion(q);
                this.scratchQuat.setFromUnitVectors(this.scratchForward, this.scratchDir);
                this.scratchQuat.multiply(q); // qTargetWorld = delta * q
                this.setTargetOrientation(this.scratchQuat);
            }
        }

        if (this.useWorker && this.worker && this.workerReady) {
            // Worker path: throttle sends; hold last forces between updates
            this.timeSinceUpdate += dt;
            if (this.timeSinceUpdate >= this.updateInterval) {
                this.timeSinceUpdate = 0;
                const p = this.spacecraft.getWorldPositionRef();
                const q = this.spacecraft.getWorldOrientationRef();
                const lv = this.spacecraft.getWorldVelocityRef();
                const av = this.spacecraft.getWorldAngularVelocityRef();
                const active = { ...this.activeAutopilots };
                const refVel = this.referenceObject ? this.referenceObject.getWorldVelocityRef() : this.scratchDir.set(0, 0, 0);
                this.worker.postMessage({
                    type: 'update',
                    dt,
                    snapshot: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], lv: [lv.x, lv.y, lv.z], av: [av.x, av.y, av.z] },
                    active,
                    targetPos: [this.targetPosition.x, this.targetPosition.y, this.targetPosition.z],
                    targetQuat: [this.targetOrientation.x, this.targetOrientation.y, this.targetOrientation.z, this.targetOrientation.w],
                    refVel: [refVel.x, refVel.y, refVel.z],
                });
            }
            return this.forcesBuffer;
        }

        // Local compute path with throttling
        this.timeSinceUpdate += dt;
        if (this.timeSinceUpdate < this.updateInterval) {
            return this.forcesBuffer;
        }
        this.timeSinceUpdate = 0;
        for (let i = 0; i < 24; i++) this.forcesBuffer[i] = 0;
        if (this.activeAutopilots.cancelRotation) this.cancelRotationMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.cancelLinearMotion) this.cancelLinearMotionMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.pointToPosition) this.pointToPositionMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.orientationMatch) this.orientationMatchMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.goToPosition) this.goToPositionMode.calculateForces(dt, this.forcesBuffer);
        return this.forcesBuffer;
    }

    public setMode(mode: keyof AutopilotModes, enabled: boolean = true): void {
        this.log.debug('setMode called:', mode, enabled);
        const rotationModes = ['orientationMatch', 'cancelRotation', 'pointToPosition'];
        const translationModes = ['cancelLinearMotion', 'goToPosition'];

        if (enabled) {
            // Turn off other modes in the same group
            if (rotationModes.includes(mode)) {
                rotationModes.forEach((m) => {
                    if (m !== mode) this.activeAutopilots[m as keyof AutopilotModes] = false;
                });
            }
            if (translationModes.includes(mode)) {
                translationModes.forEach((m) => {
                    if (m !== mode) this.activeAutopilots[m as keyof AutopilotModes] = false;
                });
            }
        }

        this.activeAutopilots[mode] = enabled;
        this.updateAutopilotState();
    }

    private updateAutopilotState(): void {
        this.isEnabled = Object.values(this.activeAutopilots).some(v => v);
        this.log.debug('Autopilot enabled:', this.isEnabled);
        // React-friendly callback for consumers (preferred over DOM events)
        if (this.onStateChange) {
            try {
                this.onStateChange({ enabled: this.isEnabled, activeAutopilots: { ...this.activeAutopilots } });
            } catch (err) {
                this.log.warn('Autopilot onStateChange callback error:', err);
            }
        }
        // Push to global store for UI subscriptions
        try {
            setAutopilotState(this.isEnabled, { ...this.activeAutopilots });
        } catch (err) {
            this.log.warn('Autopilot store update error:', err);
        }
        // Legacy DOM event removed; React store handles subscriptions

        // Manage worker lifecycle lazily
        if (this.useWorker) {
            if (this.isEnabled && !this.worker) {
                this.initWorker();
            } else if (!this.isEnabled && this.worker) {
                try { this.worker.terminate(); } catch {}
                this.worker = undefined;
                this.workerReady = false;
            }
        }
    }

    public getTargetOrientation(): THREE.Quaternion {
        return this.targetOrientation;
    }

    public setTargetOrientation(orientation: THREE.Quaternion): void {
        this.targetOrientation.copy(orientation);
        this.orientationMatchMode.setTargetOrientation(orientation);
    }

    public cleanup(): void {
        // Reset all modes
        this.activeAutopilots = {
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            orientationMatch: false,
            goToPosition: false
        };
        
        // Terminate worker if running to avoid leaks on React StrictMode remounts
        if (this.worker) {
            try { this.worker.terminate(); } catch {}
            this.worker = undefined;
            this.workerReady = false;
        }

        // Clear references
        this.targetPosition.set(0, 0, 0);
        this.targetOrientation.set(0, 0, 0, 1);
        this.targetObject = null;
    }

    public getTargetPosition(): THREE.Vector3 {
        return this.targetPosition;
    }

    public getOrientationPidController(): PIDController {
        return this.orientationPidController;
    }

    public getRotationCancelPidController(): PIDController {
        return this.rotationCancelPidController;
    }

    public getLinearPidController(): PIDController {
        return this.linearPidController;
    }

    public getMomentumPidController(): PIDController {
        return this.momentumPidController;
    }

    public setAutoTune(_enabled: boolean): void { /* deprecated */ }

    public setUpdateRateHz(hz: number): void {
        const clamped = Math.max(5, Math.min(120, hz));
        this.updateInterval = 1 / clamped;
    }

    public setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition.copy(position);
        // Clear any target object when setting a direct position
        this.targetObject = null;
    }

    public clearTargetObject(): void {
        this.targetObject = null;
        // Reset target position and orientation when clearing target
        this.targetPosition.set(0, 0, 0);
        this.targetOrientation.set(0, 0, 0, 1);
        this.targetPoint.set(0, 0, 0);
        this.setReferenceObject(null);
    }

    public resetAllModes(): void {
        // Turn off all autopilot modes
        Object.keys(this.activeAutopilots).forEach(mode => {
            this.setMode(mode as keyof AutopilotModes, false);
        });
    }

    public setOnStateChange(cb: (state: { enabled: boolean; activeAutopilots: AutopilotModes }) => void): void {
        this.onStateChange = cb;
    }

    // Telemetry accessors for UI
    public getPointToPositionTelemetry(): any {
        if (this.useWorker && this.worker) return this.workerTelemetry.point ?? (this.pointToPositionMode as any)?.getTelemetry?.();
        return (this.pointToPositionMode as any)?.getTelemetry?.();
    }
    public getOrientationMatchTelemetry(): any {
        if (this.useWorker && this.worker) return this.workerTelemetry.orient ?? (this.orientationMatchMode as any)?.getTelemetry?.();
        return (this.orientationMatchMode as any)?.getTelemetry?.();
    }
    public getGoToPositionTelemetry(): any {
        if (this.useWorker && this.worker) return this.workerTelemetry.goto ?? (this.goToPositionMode as any)?.getTelemetry?.();
        return (this.goToPositionMode as any)?.getTelemetry?.();
    }
}

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
    private isEnabled: boolean = false;
    private activeAutopilots: AutopilotModes;
    public targetPosition: THREE.Vector3;
    public targetOrientation: THREE.Quaternion;
    private targetObject: Spacecraft | null = null;
    private targetPoint: THREE.Vector3 = new THREE.Vector3();
    private referenceObject: Spacecraft | null = null;
    private autoTuneEnabled: boolean = false;
    private useWorker: boolean = true;
    private worker?: Worker;
    private workerReady: boolean = false;
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
    private linearPidController: PIDController;
    private momentumPidController: PIDController;
    private onStateChange?: (state: { enabled: boolean; activeAutopilots: AutopilotModes }) => void;

    constructor(
        spacecraft: Spacecraft,
        thrusterGroups: any,
        thrust: number,
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
        this.targetPosition = new THREE.Vector3();
        this.targetOrientation = new THREE.Quaternion();
        this.autoTuneEnabled = options.autoTune ?? true;
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
                maxForce: options.maxForce ?? 1000,         // Reduced max force
                epsilon: 0.01,
                maxAngularMomentum: options.maxAngularMomentum ?? 2.0,
                maxLinearMomentum: options.maxLinearMomentum ?? 10.0,
                maxAngularVelocity:  options.pidGains?.orientation ? 1.0 : 1.2,
                maxAngularAcceleration: 3.0,
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
            this.orientationPidController
        );

        this.cancelLinearMotionMode = new CancelLinearMotion(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.momentumPidController
        );

        this.pointToPositionMode = new PointToPosition(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.orientationPidController,
            this.targetPosition
        );

        this.orientationMatchMode = new OrientationMatchAutopilot(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.orientationPidController,
            this.targetOrientation
        );

        this.goToPositionMode = new GoToPosition(
            this.spacecraft,
            this.config,
            this.thrusterGroups,
            this.thrust,
            this.linearPidController,
            this.targetPosition
        );
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
            autoCalibrate: true,
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

            // Auto-tune relevant controllers when enabling a mode
            if (this.autoTuneEnabled) {
                if (rotationModes.includes(mode)) {
                    this.orientationPidController.autoCalibrate().catch(() => {});
                }
                if (translationModes.includes(mode)) {
                    // Both linear position and momentum controllers are used across translation modes
                    this.linearPidController.autoCalibrate().catch(() => {});
                    this.momentumPidController.autoCalibrate().catch(() => {});
                }
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

    public getLinearPidController(): PIDController {
        return this.linearPidController;
    }

    public getMomentumPidController(): PIDController {
        return this.momentumPidController;
    }

    public setAutoTune(enabled: boolean): void {
        this.autoTuneEnabled = enabled;
    }

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
        return (this.pointToPositionMode as any)?.getTelemetry?.();
    }
    public getOrientationMatchTelemetry(): any {
        return (this.orientationMatchMode as any)?.getTelemetry?.();
    }
    public getGoToPositionTelemetry(): any {
        return (this.goToPositionMode as any)?.getTelemetry?.();
    }
}

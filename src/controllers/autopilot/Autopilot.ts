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
// Path following handled by PathManager
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import type { AutopilotMode as AutopilotModeBase } from './AutopilotMode';
import type { AutopilotModes, AutopilotModeName, AutopilotState, AutopilotTelemetry, IAutopilot, TargetPoint } from './types';
import { PathManager } from './PathManager';
import { WorkerClient } from './WorkerClient';
import { ModeRegistry } from './ModeRegistry';
import { TargetTracker } from './TargetTracker';
// AutoTuneUtils imports removed (now handled by AutoTuner)
import { AutoTuner } from './AutoTuner';

export class Autopilot implements IAutopilot {
    private log = createLogger('controllers:Autopilot');
    private spacecraft: Spacecraft;
    private config: AutopilotConfig;
    private thrusterGroups: ThrusterGroups;
    private thrust: number;
    private thrusterMax: number[];
    private isEnabled: boolean = false;
    private activeAutopilots: AutopilotModes;
    public targetPosition: THREE.Vector3;
    public targetOrientation: THREE.Quaternion;
    private targetObject: Spacecraft | null = null;
    private targetPoint: THREE.Vector3 = new THREE.Vector3();
    private referenceObject: Spacecraft | null = null;
    private targetPointType: TargetPoint = 'center';
    // deprecated: auto-tune now only via PID window
    private useWorker: boolean = true;
    private workerClient?: WorkerClient;
    private workerTelemetry: AutopilotTelemetry = {};
    // Output buffer and scheduling
    private forcesBuffer: number[] = new Array(24).fill(0);
    private updateInterval: number = 1 / 30; // run autopilot at 30 Hz to reduce load
    private timeSinceUpdate: number = 0;
    // Scratch objects to avoid per-frame allocations
    private scratchDir = new THREE.Vector3();

    // Mode instances
    private cancelRotationMode!: CancelRotation;
    private cancelLinearMotionMode!: CancelLinearMotion;
    private pointToPositionMode!: PointToPosition;
    private orientationMatchMode!: OrientationMatchAutopilot;
    private goToPositionMode!: GoToPosition;
    // Path management
    private pathManager!: PathManager;
    private targetTracker!: TargetTracker;
    private useFollowerNowFlag = false;
    private _rotScaleRuntime: number | undefined;

    // PID Controllers
    private orientationPidController: PIDController;
    private rotationCancelPidController: PIDController;
    private linearPidController: PIDController;
    private momentumPidController: PIDController;
    private onStateChange?: (state: AutopilotState) => void;

    constructor(
        spacecraft: Spacecraft,
        thrusterGroups: ThrusterGroups,
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
            // Inertia configuration for improved procedural behavior
            customInertia?: { x: number; y: number; z: number };
            inertiaMode?: 'solid' | 'hollow' | 'thin-shell';
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
            orientation: { kp: 25.0, ki: 0.0, kd: 3.0 },   // For rotation control - high gain for fast response
            position: { kp: 0.1, ki: 0.001, kd: 0.5 },     // For GoToPosition - extremely gentle gains
            momentum: { kp: 6.0, ki: 0.2, kd: 2.0 }        // For CancelLinearMotion
        };

        // PROCEDURAL EPSILON: minimum force threshold for thruster activation
        // Set to 0.01% of per-thruster force to allow fine control while filtering noise
        // This ensures small PID commands during final approach aren't discarded
        const thrustPerThruster = thrust / 4.0; // Assume ~4 thrusters per axis group
        const proceduralEpsilon = thrustPerThruster * 0.0001; // 0.01% threshold

        // PROCEDURAL ANGULAR MOMENTUM LIMIT: use reasonable default that works for most spacecraft
        // The PID gains now scale the response, not the limit
        // Keep it simple - users can override if needed
        const scaledMaxAngularMomentum = options.maxAngularMomentum ?? 2.0; // Default 2.0 works well
        
        this.config = {
            pid: {
                orientation: { ...defaultPidGains.orientation, ...options.pidGains?.orientation },
                position: { ...defaultPidGains.position, ...options.pidGains?.position },
                momentum: { ...defaultPidGains.momentum, ...options.pidGains?.momentum },
            },
            limits: {
                maxForce: options.maxForce ?? 1000,
                epsilon: proceduralEpsilon,
                maxAngularMomentum: scaledMaxAngularMomentum,
                maxLinearMomentum: options.maxLinearMomentum ?? 10.0,
                maxAngularVelocity: options.pidGains?.orientation ? 1.0 : 1.2,
                maxAngularAcceleration: 5.0,
                maxLinearVelocity: options.maxLinearMomentum ? (options.maxLinearMomentum / Math.max(this.spacecraft.getMass(), 1e-3)) * 4 : 8.0,
                maxLinearAcceleration: 2.5,
            },
            damping: {
                factor: options.dampingFactor ?? 8.0,       // Much higher damping
            },
            customInertia: options.customInertia,
            inertiaMode: options.inertiaMode,
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
        // Path manager (after modes exist, to query caps)
        this.pathManager = new PathManager(
            () => this.goToPositionMode.getAxisLinearAccelCaps(),
            () => this.config.limits.maxLinearVelocity ?? 8.0,
            () => this.spacecraft.getMainBodyDimensions(),
            () => this.targetObject,
        );
        this.targetTracker = new TargetTracker(this.spacecraft);
        // Defer worker creation until a mode is enabled to avoid idle workers
    }

    private forEachMode(fn: (m: AutopilotModeBase) => void): void {
        try { fn(this.cancelRotationMode as unknown as AutopilotModeBase); } catch {}
        try { fn(this.cancelLinearMotionMode as unknown as AutopilotModeBase); } catch {}
        try { fn(this.pointToPositionMode as unknown as AutopilotModeBase); } catch {}
        try { fn(this.orientationMatchMode as unknown as AutopilotModeBase); } catch {}
        try { fn(this.goToPositionMode as unknown as AutopilotModeBase); } catch {}
    }

    private setRotationAllocationScale(scale: number): void {
        const s = THREE.MathUtils.clamp(scale, 0, 1);
        try { this.cancelRotationMode.setAllocationScale(s); } catch {}
        try { this.orientationMatchMode.setAllocationScale(s); } catch {}
        try { this.pointToPositionMode.setAllocationScale(s); } catch {}
        try { this.cancelLinearMotionMode.setAllocationScale(1.0); } catch {}
        try { this.goToPositionMode.setAllocationScale(1.0); } catch {}
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

    // --- Curved path following --------------------------------------------
    /**
     * Provide a polyline path (world waypoints) to follow with continuous speed.
     * GoToPosition will be driven by a moving carrot and reference velocity.
     */
    public setPathWaypoints(waypoints: THREE.Vector3[], opts?: {
        sampleSpacing?: number;
        maxSamples?: number;
        lookaheadMin?: number;
        lookaheadMax?: number;
        lookaheadGain?: number;
        lookaheadFraction?: number;
        endClearanceAbs?: number;
    }): void {
        // Derive conservative accel caps from current thruster layout
        this.pathManager.setWaypoints(waypoints, opts);
        // Capture goal orientation at plan time for rotational rebase
        try {
            if (this.targetObject) this.pathManager.setGoalQuatSnapshot(this.targetObject.objects.box.quaternion);
            else this.pathManager.setGoalQuatSnapshot(this.targetOrientation);
        } catch { this.pathManager.setGoalQuatSnapshot(new THREE.Quaternion(0, 0, 0, 1)); }
    }

    public clearPath(): void { this.pathManager.clear(); }

    public getPathSamples(): THREE.Vector3[] | null {
        return this.pathManager.getSamples();
    }

    public getPathProgress(): { sCur: number; sRem: number; sTotal: number; idx: number; done: boolean } | null {
        return this.pathManager.getProgress();
    }

    public getPathCarrot(): THREE.Vector3 | null {
        return this.pathManager.getCarrot();
    }

    // --- Auto-tune helpers -------------------------------------------------
    // Legacy helpers retained for compatibility; now unused after AutoTuner extraction

    // clamp helper no longer used; gain mapping moved into PIDController

    /**
     * Active auto-tune that excites the system and estimates gains from decay samples.
     * Runs on the main thread while the autopilot (main or worker) computes thrust.
     */
    public async autoTune(type: 'attitude' | 'rotCancel' | 'position' | 'linMomentum', durationMs: number = 1200): Promise<void> {
        const tuner = new AutoTuner(this, this.spacecraft, {
            orientation: this.orientationPidController,
            rotationCancel: this.rotationCancelPidController,
            position: this.linearPidController,
            momentum: this.momentumPidController,
        });
        await tuner.run(type, durationMs);
        this.syncPidGainsToWorker();
    }

    // Push current PID gains to worker (if running)
    public syncPidGainsToWorker(): void {
        if (!this.workerClient) return;
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
            this.workerClient.setGains(gains);
        } catch { }
    }

    // Worker calibration is no longer used; tuning happens via PID window-triggered autoTune

    public setThrusterStrengths(max: number[]): void {
        const arr = (Array.isArray(max) && max.length === 24) ? max.slice(0, 24) : new Array(24).fill(this.thrust);
        this.thrusterMax = arr;
        // Update all mode instances
        this.forEachMode((m) => m.setThrusterMax(arr));
        // Inform worker
        try { this.workerClient?.setThrusterStrengths(arr); } catch { }
    }

    // Adjust the scalar thrust budget used by allocation helpers across all modes
    public setThrust(value: number): void {
        this.thrust = value;
        this.forEachMode((m) => m.setThrust(value));
        try { this.workerClient?.setThrust(value); } catch { }
    }

    // Dynamically update thruster grouping after geometry changes
    public setThrusterGroups(groups: ThrusterGroups): void {
        this.thrusterGroups = groups;
        this.forEachMode((m) => m.setThrusterGroups(groups));
        try { this.workerClient?.setThrusterGroups(groups); } catch { }
    }

    // Push current thruster transforms (position+direction) to worker and clear caps caches
    public refreshThrusters(): void {
        try {
            const thrusters = (this.spacecraft.getThrusterConfigs?.() || []).map((t: any) => ({
                position: [t.position.x, t.position.y, t.position.z] as [number, number, number],
                direction: [t.direction.x, t.direction.y, t.direction.z] as [number, number, number],
            }));
            // Invalidate caps on all modes (thruster layout affects torque capacities)
            this.forEachMode((m) => m.invalidateCaps());
            try { this.workerClient?.setThrusters(thrusters); } catch { }
        } catch { }
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
            const dims = this.spacecraft.getMainBodyDimensions();
            const thrusters = (this.spacecraft.getThrusterConfigs?.() || []).map((t: any) => ({
                position: [t.position.x, t.position.y, t.position.z] as [number, number, number],
                direction: [t.direction.x, t.direction.y, t.direction.z] as [number, number, number],
            }));
            this.workerClient = new WorkerClient({
                onReady: () => { },
                onForces: (forces, telemetry) => {
                    for (let i = 0; i < 24; i++) this.forcesBuffer[i] = forces[i] || 0;
                    this.workerTelemetry = telemetry || {};
                },
                onPlanPathResult: (_id, points) => {
                    this.pathManager.completePlan(points);
                },
                onError: (err) => {
                    this.log.warn('Failed to create autopilot worker; falling back to main thread.', err);
                    this.useWorker = false;
                },
            });
            this.workerClient.setUpdateRateHz(1 / this.updateInterval > 0 ? 1 / this.updateInterval : 30);
            this.workerClient.init({
                thrusterGroups: this.thrusterGroups,
                thrust: this.thrust,
                config: this.config,
                mass: this.spacecraft.getMass(),
                dims,
                thrusters,
                strengths: this.thrusterMax,
                autoCalibrate: false,
            });
        } catch (err) {
            this.log.warn('Failed to init worker client; falling back to main thread.', err);
            this.useWorker = false;
        }
    }

    public getTargetObject(): Spacecraft | null {
        return this.targetObject;
    }

    public setTargetObject(target: Spacecraft | null, targetPoint: TargetPoint): void {
        this.targetObject = target;
        this.targetPointType = targetPoint || 'center';
        if (target) {
            // Update pose and point vector from target
            this.targetTracker.refreshPoseFromTarget(target, targetPoint, this.targetPosition, this.targetOrientation, this.targetPoint);
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
            this.forcesBuffer.fill(0);
            return this.forcesBuffer;
        }

        this.stepUpdateTargetPoseAndReference();
        this.stepPublishPointingOrientationIfNeeded();
        this.stepUpdateRotationAllocationScale();
        this.stepUpdatePathFollowing(dt);

        if (this.stepPostToWorkerIfEnabled(dt)) return this.forcesBuffer;
        return this.stepComputeLocally(dt);
    }

    private stepUpdateTargetPoseAndReference(): void {
        if (this.targetObject) {
            this.targetTracker.refreshPoseFromTarget(this.targetObject, this.targetPointType, this.targetPosition, this.targetOrientation, this.targetPoint);
        }
        if (this.referenceObject) {
            const refVel = this.referenceObject.getWorldVelocity();
            this.cancelLinearMotionMode.setReferenceVelocityWorld(refVel);
            this.goToPositionMode.setReferenceVelocityWorld(refVel);
        } else {
            this.cancelLinearMotionMode.setReferenceVelocityWorld(null);
            this.goToPositionMode.setReferenceVelocityWorld(null);
        }
    }

    private stepPublishPointingOrientationIfNeeded(): void {
        if (!this.activeAutopilots.pointToPosition) return;
        const qTarget = this.targetTracker.computePointingOrientation(this.targetPosition);
        if (qTarget) this.setTargetOrientation(qTarget);
    }

    private stepUpdateRotationAllocationScale(): void {
        // Only reduce rotation authority when actively navigating to a position target
        // Cancel rotation and orientation modes should have full authority
        const isNavigating = this.activeAutopilots.goToPosition || this.activeAutopilots.pointToPosition;
        
        if (!isNavigating) {
            // Full authority for pure rotation control
            this.setRotationAllocationScale(1.0);
            this._rotScaleRuntime = 1.0;
            return;
        }
        
        try {
            const posNow = this.spacecraft.getWorldPositionRef();
            const distNow = posNow.distanceTo(this.targetPosition);
            const dims = this.spacecraft.getMainBodyDimensions();
            const R = Math.max(1.5, Math.max(dims.x, dims.y, dims.z) * 3.0);
            const near = THREE.MathUtils.clamp(distNow / Math.max(1e-6, R), 0, 1);
            const rotScale = 0.25 + 0.75 * near;
            this.setRotationAllocationScale(rotScale);
            this._rotScaleRuntime = rotScale;
        } catch {}
    }

    private stepUpdatePathFollowing(dt: number): void {
        if (!(this.activeAutopilots.goToPosition && this.pathManager.getSamples())) return;
        this.pathManager.tick(dt);
        if (this.pathManager.isTimeToReplan()) {
            const sNow = this.spacecraft.getWorldPositionRef();
            const gNow = this.targetPosition;
            if (this.pathManager.shouldReplan(this.spacecraft, sNow, gNow)) {
                if (this.useWorker && this.workerClient && this.workerClient.isReady() && !this.pathManager.isPlanPending()) {
                    const obstacles = this.pathManager.collectObstacles(this.spacecraft);
                    const startArr: [number, number, number] = [sNow.x, sNow.y, sNow.z];
                    const goalArr: [number, number, number] = [gNow.x, gNow.y, gNow.z];
                    const obsPayload = obstacles.map(o => ({ pos: [o.position.x, o.position.y, o.position.z] as [number, number, number], size: [o.size.x, o.size.y, o.size.z] as [number, number, number], isTarget: o.isTarget }));
                    const id = this.pathManager.beginPlan();
                    this.workerClient.planPath(id, startArr, goalArr, obsPayload);
                } else {
                    const wps = this.pathManager.buildAvoidancePath(this.spacecraft, sNow.clone(), gNow.clone());
                    this.setPathWaypoints(wps.length >= 2 ? wps : [sNow.clone(), gNow.clone()]);
                }
                this.pathManager.setLastStartGoal(sNow, gNow);
                try {
                    const qGoal = this.targetObject ? this.targetObject.objects.box.quaternion : this.targetOrientation;
                    this.pathManager.setGoalQuatSnapshot(qGoal);
                } catch {}
            }
        }
        // Update PathManager (always provides carrot + reference velocity)
        const qNow = (() => { try { return this.targetObject ? this.targetObject.objects.box.quaternion : this.targetOrientation; } catch { return this.targetOrientation; } })();
        const vGoal = this.referenceObject ? this.referenceObject.getWorldVelocityRef() : null;
        const { useFollower } = this.pathManager.updateFollowStep(this.spacecraft, this.targetPosition, qNow, vGoal);
        this.useFollowerNowFlag = useFollower;
        
        // Always use PathManager's guidance (it handles both path and direct modes)
        const carrot = this.pathManager.getCarrot();
        const vRef = this.pathManager.getVRef();
        if (carrot) this.goToPositionMode.setTargetPosition(carrot);
        this.goToPositionMode.setReferenceVelocityWorld(vRef);
    }

    private stepPostToWorkerIfEnabled(dt: number): boolean {
        if (!(this.useWorker && this.workerClient && this.workerClient.isReady())) return false;
        const p = this.spacecraft.getWorldPositionRef();
        const q = this.spacecraft.getWorldOrientationRef();
        const lv = this.spacecraft.getWorldVelocityRef();
        const av = this.spacecraft.getWorldAngularVelocityRef();
        const active = { ...this.activeAutopilots };
        const useFollower = !!(this.activeAutopilots.goToPosition && this.pathManager.getSamples() && this.useFollowerNowFlag);
        const refVelV = useFollower ? this.pathManager.getVRef() : (this.referenceObject ? this.referenceObject.getWorldVelocityRef() : this.scratchDir.set(0, 0, 0));
        const targetV = useFollower && this.pathManager.getCarrot() ? this.pathManager.getCarrot()! : this.targetPosition;
        this.workerClient.maybeUpdate(dt, {
            snapshot: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], lv: [lv.x, lv.y, lv.z], av: [av.x, av.y, av.z] },
            active,
            targetPos: [targetV.x, targetV.y, targetV.z],
            targetQuat: [this.targetOrientation.x, this.targetOrientation.y, this.targetOrientation.z, this.targetOrientation.w],
            refVel: [refVelV.x, refVelV.y, refVelV.z],
            trackRef: useFollower,
            rotScale: this._rotScaleRuntime ?? 1.0,
        });
        return true;
    }

    private stepComputeLocally(dt: number): number[] {
        this.timeSinceUpdate += dt;
        if (this.timeSinceUpdate < this.updateInterval) return this.forcesBuffer;
        this.timeSinceUpdate = 0;
        for (let i = 0; i < 24; i++) this.forcesBuffer[i] = 0;
        if (this.activeAutopilots.cancelRotation) this.cancelRotationMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.cancelLinearMotion) this.cancelLinearMotionMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.pointToPosition) this.pointToPositionMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.orientationMatch) this.orientationMatchMode.calculateForces(dt, this.forcesBuffer);
        if (this.activeAutopilots.goToPosition) this.goToPositionMode.calculateForces(dt, this.forcesBuffer);
        for (let i = 0; i < 24; i++) {
            const cap = this.thrusterMax[i] || this.thrust;
            const v = this.forcesBuffer[i] || 0;
            this.forcesBuffer[i] = Math.min(Math.max(0, v), cap);
        }
        return this.forcesBuffer;
    }

    public setMode(mode: AutopilotModeName, enabled: boolean = true): void {
        this.log.debug('setMode called:', mode, enabled);
        this.activeAutopilots = ModeRegistry.exclusiveEnable(this.activeAutopilots, mode, enabled);
        this.updateAutopilotState();

        // If enabling goToPosition and no path exists yet, seed a straight path for visualization/following
        if (mode === 'goToPosition' && enabled && !this.pathManager.getSamples()) {
            try {
                const start = this.spacecraft.getWorldPositionRef().clone();
                const goal = this.targetPosition.clone();
                // Avoid degenerate identical points
                if (start.distanceTo(goal) < 1e-3) goal.add(new THREE.Vector3(0, 0, 0.01));
                if (this.useWorker && this.workerClient && this.workerClient.isReady() && !this.pathManager.isPlanPending()) {
                    // Kick off async plan and use straight preview path until it returns
                    this.setPathWaypoints([start, goal]);
                    const obstacles = this.pathManager.collectObstacles(this.spacecraft);
                    const startArr: [number, number, number] = [start.x, start.y, start.z];
                    const goalArr: [number, number, number] = [goal.x, goal.y, goal.z];
                    const obsPayload = obstacles.map(o => ({ pos: [o.position.x, o.position.y, o.position.z] as [number, number, number], size: [o.size.x, o.size.y, o.size.z] as [number, number, number], isTarget: o.isTarget }));
                    const id = this.pathManager.beginPlan();
                    this.workerClient.planPath(id, startArr, goalArr, obsPayload);
                } else {
                    const wps = this.pathManager.buildAvoidancePath(this.spacecraft, start, goal);
                    this.setPathWaypoints(wps.length >= 2 ? wps : [start, goal]);
                }
                this.pathManager.setLastStartGoal(start, goal);
            } catch { }
        }
    }

    // Removed local obstacle collector; PathManager handles obstacle collation

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
            if (this.isEnabled && !this.workerClient) {
                this.initWorker();
            } else if (!this.isEnabled && this.workerClient) {
                try { this.workerClient.terminate(); } catch { }
                this.workerClient = undefined;
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
        if (this.workerClient) {
            try { this.workerClient.terminate(); } catch { }
            this.workerClient = undefined;
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

    public setOnStateChange(cb: (state: AutopilotState) => void): void {
        this.onStateChange = cb;
    }

    // Telemetry accessors for UI
    public getPointToPositionTelemetry(): any {
        return this.getTelemetryHelper('point', () => (this.pointToPositionMode as any)?.getTelemetry?.());
    }
    public getOrientationMatchTelemetry(): any {
        return this.getTelemetryHelper('orient', () => (this.orientationMatchMode as any)?.getTelemetry?.());
    }
    public getGoToPositionTelemetry(): any {
        return this.getTelemetryHelper('goto', () => (this.goToPositionMode as any)?.getTelemetry?.());
    }

    private getTelemetryHelper<T extends keyof AutopilotTelemetry>(key: T, local: () => any): any {
        if (this.useWorker && this.workerClient) {
            const v = this.workerTelemetry[key];
            if (v !== undefined && v !== null) return v;
        }
        try { return local?.(); } catch { return null; }
    }

    // Path follower telemetry for UI/debug
    public getPathFollowerTelemetry(): any {
        const prog = this.pathManager.getProgress();
        if (!prog) return null;
        try {
            const tel = undefined;
            const carrot = this.getPathCarrot();
            const vRefMag = this.pathManager.getVRef().length();
            return {
                progress: prog,
                energy: tel,
                carrot: carrot ? { x: carrot.x, y: carrot.y, z: carrot.z } : null,
                vRefMag,
            };
        } catch {
            return null;
        }
    }
}

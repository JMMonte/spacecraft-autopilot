import * as THREE from 'three';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import type { AutopilotConfig } from './types';
import { CapabilityCalculator } from './CapabilityCalculator';
import { ThrusterAllocator } from './ThrusterAllocator';

// Re-export for backward compatibility during migration
export type { AutopilotConfig } from './types';

export abstract class AutopilotMode {
    protected spacecraft: Spacecraft;
    protected config: AutopilotConfig;
    protected thrusterGroups: ThrusterGroups;
    protected thrust: number;
    protected thrusterMax: number[] = new Array(24).fill(0);
    protected pidController: PIDController;
    protected referenceVelocityWorld: THREE.Vector3 | null = null;
    // Composed modules
    protected capCalc: CapabilityCalculator;
    protected allocator: ThrusterAllocator;
    // Scratch vectors to reduce allocations in mode subclasses
    protected tmpVecA: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecB: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecC: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecD: THREE.Vector3 = new THREE.Vector3();
    protected tmpVecE: THREE.Vector3 = new THREE.Vector3();
    protected tmpQuatA: THREE.Quaternion = new THREE.Quaternion();
    protected tmpQuatB: THREE.Quaternion = new THREE.Quaternion();

    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: ThrusterGroups,
        thrust: number,
        pidController: PIDController,
        thrusterMax?: number[]
    ) {
        this.spacecraft = spacecraft;
        this.config = config;
        this.thrusterGroups = thrusterGroups;
        this.thrust = thrust;
        this.pidController = pidController;
        this.thrusterMax = (thrusterMax && thrusterMax.length === 24) ? thrusterMax.slice(0, 24) : new Array(24).fill(thrust);

        this.capCalc = new CapabilityCalculator(
            spacecraft as any, config, thrusterGroups, thrust, this.thrusterMax,
        );
        this.allocator = new ThrusterAllocator(
            thrusterGroups, thrust, this.thrusterMax, config.limits.epsilon,
            () => this.getDynamicCaps(),
        );
    }

    public setThrust(value: number): void {
        this.thrust = value;
        this.capCalc.setThrust(value);
        this.allocator.setThrust(value);
    }

    public setThrusterGroups(groups: ThrusterGroups): void {
        this.thrusterGroups = groups;
        this.capCalc.setThrusterGroups(groups);
        this.allocator.setThrusterGroups(groups);
    }

    public invalidateCaps(): void {
        this.capCalc.invalidate();
    }

    public setThrusterMax(max: number[]): void {
        if (Array.isArray(max) && max.length === 24) this.thrusterMax = max.slice(0, 24);
        else this.thrusterMax = new Array(24).fill(this.thrust);
        this.capCalc.setThrusterMax(this.thrusterMax);
        this.allocator.setThrusterMax(this.thrusterMax);
    }

    abstract calculateForces(dt: number, out?: number[]): number[];

    public setReferenceVelocityWorld(v: THREE.Vector3 | null): void {
        if (v) {
            if (!this.referenceVelocityWorld) this.referenceVelocityWorld = new THREE.Vector3();
            this.referenceVelocityWorld.copy(v);
        } else {
            this.referenceVelocityWorld = null;
        }
    }

    public setAllocationScale(scale: number): void {
        this.allocator.setAllocationScale(scale);
    }

    // ── Backward-compatible delegators (modes call these; will be removed in Step 1.4) ──

    /** @deprecated Use this.allocator.allocateRotation() directly */
    protected applyPIDOutputToThrusters(pidOutput: THREE.Vector3): number[] {
        const out = Array(24).fill(0);
        this.allocator.allocateRotation(pidOutput, out);
        return out;
    }

    /** @deprecated Use this.allocator.allocateRotation() directly */
    protected applyPIDOutputToThrustersInPlace(pidOutput: THREE.Vector3, out: number[]): void {
        this.allocator.allocateRotation(pidOutput, out);
    }

    /** @deprecated Use this.allocator.allocateTranslation() directly */
    protected applyTranslationalForcesToThrusterGroups(localForce: THREE.Vector3): number[] {
        const out = Array(24).fill(0);
        this.allocator.allocateTranslation(localForce, out);
        return out;
    }

    /** @deprecated Use this.allocator.allocateTranslation() directly */
    protected applyTranslationalForcesToThrusterGroupsInPlace(localForce: THREE.Vector3, out: number[]): void {
        this.allocator.allocateTranslation(localForce, out);
    }

    /** @deprecated Use this.capCalc.calculateMomentOfInertia() directly */
    protected calculateMomentOfInertia(): number {
        return this.capCalc.calculateMomentOfInertia();
    }

    /** @deprecated Use this.capCalc.calculateMomentOfInertiaByAxis() directly */
    protected calculateMomentOfInertiaByAxis(): { x: number; y: number; z: number } {
        return this.capCalc.calculateMomentOfInertiaByAxis();
    }

    /** @deprecated Use this.capCalc.getEffectiveInertiaAlongAxis() directly */
    protected getEffectiveInertiaAlongAxis(axis: THREE.Vector3): number {
        return this.capCalc.getEffectiveInertiaAlongAxis(axis.x, axis.y, axis.z);
    }

    /**
     * Overridable capability getter. Tests override this to inject fixed caps.
     * Delegates to capCalc by default.
     */
    protected getDynamicCaps(): {
        linForce: { x: number; y: number; z: number };
        linAccel: { x: number; y: number; z: number };
        inertia: { x: number; y: number; z: number };
        angTorque: { x: number; y: number; z: number };
        angAccel: { x: number; y: number; z: number };
    } {
        return this.capCalc.getDynamicCaps();
    }

    /** Derived from getDynamicCaps() — calls the overridable version for test compatibility. */
    protected getDynamicLinearAccelAlong(dirLocal: THREE.Vector3): number {
        const caps = this.getDynamicCaps();
        const nx = Math.abs(dirLocal.x);
        const ny = Math.abs(dirLocal.y);
        const nz = Math.abs(dirLocal.z);
        return nx * caps.linAccel.x + ny * caps.linAccel.y + nz * caps.linAccel.z;
    }

    /** Derived from getDynamicCaps() — calls the overridable version for test compatibility. */
    protected getDynamicAngularAccelCap(): { alphaMax: number; omegaMax: number } {
        const caps = this.getDynamicCaps();
        const angAccel = caps.angAccel;
        const alphaDyn = angAccel
            ? Math.max(1e-4, Math.min(angAccel.x, angAccel.y, angAccel.z)) * 0.6
            : this.config.limits.maxAngularAcceleration * 0.6;
        const alphaMax = Math.min(this.config.limits.maxAngularAcceleration, alphaDyn);
        const omegaFromAlpha = Math.sqrt(2 * alphaMax * 0.5);
        const omegaMax = Math.min(this.config.limits.maxAngularVelocity, Math.max(0.2, omegaFromAlpha));
        return { alphaMax, omegaMax };
    }

    protected calculateControlSignal(errorQuaternion: THREE.Quaternion): number {
        const orientationError = 2 * Math.acos(Math.abs(Math.min(1, Math.max(-1, errorQuaternion.w))));
        const normalizedError = orientationError / Math.PI;
        return Math.min(normalizedError, 0.2);
    }

    protected quaternionToAngularVelocity(quaternion: THREE.Quaternion): THREE.Vector3 {
        let angle = 2 * Math.acos(quaternion.w);
        const sinHalfAngle = Math.sqrt(1 - quaternion.w * quaternion.w);
        const axis = new THREE.Vector3(quaternion.x, quaternion.y, quaternion.z);

        if (sinHalfAngle > 0.01) {
            axis.normalize().multiplyScalar(angle / sinHalfAngle);
        } else {
            axis.set(0, 0, 0);
        }

        if (angle > Math.PI) {
            angle = 2 * Math.PI - angle;
            axis.negate();
        }
        return axis;
    }

    // Smoothing alpha setters — modes set these in constructors
    protected set rotSmoothAlpha(alpha: number) { this.allocator.setRotSmoothAlpha(alpha); }
    protected set linSmoothAlpha(alpha: number) { this.allocator.setLinSmoothAlpha(alpha); }
}

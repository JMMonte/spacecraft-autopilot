import { AutopilotMode } from './AutopilotMode';
import type { AutopilotConfig } from './types';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';
import type { ThrusterGroups } from '../../config/spacecraftConfig';
import type { GoToPositionTelemetry } from './types';

export interface GoToPositionTuning {
    velocityKp: number;
    velocityKi: number;
    velocityKd: number;
    maxForce: number;
    velocityDeadbandCmd: number;
    velocityDeadbandActual: number;
    stopDistance: number;
    velocityFilterAlpha: number;
}

/**
 * GoToPosition with velocity-profiled control and coast zone.
 *
 * Each frame:
 *   1. Compute desired velocity vector from braking profile: v = sqrt(2*a*d) toward target
 *   2. Compare to actual velocity
 *   3. If close enough → coast (zero thrust, save fuel)
 *   4. If too slow or wrong direction → thrust proportionally per-axis
 *   5. If too fast → brake proportionally per-axis
 *
 * Simple, omnidirectional (uses all 24 thrusters), no rotation required.
 */
export class GoToPosition extends AutopilotMode {
    private targetPosition: THREE.Vector3;
    private arrivalLatched = false;

    // Waypoint queue for collision avoidance paths
    private waypoints: THREE.Vector3[] = [];
    private waypointIndex = 0;

    private tuning: GoToPositionTuning = {
        velocityKp: 0, velocityKi: 0, velocityKd: 0,
        maxForce: 100,
        velocityDeadbandCmd: 0.02,
        velocityDeadbandActual: 0.05,
        stopDistance: 0.3,
        velocityFilterAlpha: 0.3,
    };

    private telemetry: GoToPositionTelemetry | null = null;
    private burnFrames = 0;
    /** Optional speed cap set by docking or external controllers. null = use config default. */
    private speedLimitOverride: number | null = null;
    private totalFrames = 0;


    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: ThrusterGroups,
        thrust: number,
        pidController: PIDController,
        targetPosition: THREE.Vector3,
        thrusterMax?: number[]
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController, thrusterMax);
        this.targetPosition = targetPosition;
        this.tuning.maxForce = this.config.limits.maxForce;
    }

    setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition = position;
    }

    setFinalTarget(position: THREE.Vector3): void {
        this.targetPosition = position;
    }

    /** Set a speed limit override (e.g. for docking final approach). null = use default. */
    setSpeedLimit(maxSpeed: number | null): void {
        // Clear arrival latch when limit changes (e.g. phase transition in docking)
        if (this.speedLimitOverride !== maxSpeed) {
            this.arrivalLatched = false;
        }
        this.speedLimitOverride = maxSpeed;
    }

    /** Set avoidance waypoints. The controller navigates each in sequence. */
    setWaypoints(points: THREE.Vector3[]): void {
        this.waypoints = points;
        this.waypointIndex = 0;
        if (points.length > 0) {
            this.targetPosition = points[0];
        }
        this.arrivalLatched = false;
    }

    /** Get the current waypoint index for telemetry. */
    getWaypointProgress(): { current: number; total: number } {
        return { current: this.waypointIndex, total: this.waypoints.length };
    }


    public setGuidanceMode(_mode: 'direct' | 'trackRef'): void {}

    public setTuning(partial: Partial<GoToPositionTuning>): void {
        if (!partial) return;
        this.tuning = { ...this.tuning, ...partial };
    }

    public getTuning(): GoToPositionTuning {
        return { ...this.tuning };
    }

    calculateForces(_dt: number, out: number[] = Array(24).fill(0)): number[] {
        const pos = this.spacecraft.getWorldPositionRef();
        const vel = this.spacecraft.getWorldVelocityRef();
        const q = this.spacecraft.getWorldOrientationRef();
        const qInv = this.tmpQuatA.copy(q).invert();

        // ── Vector to target ──────────────────────────────────────────
        const toTarget = this.tmpVecA.copy(this.targetPosition).sub(pos);
        const distance = toTarget.length();
        const speed = vel.length();

        const stopDist = Math.max(0.001, this.tuning.stopDistance);
        const deadband = Math.max(1e-4, this.tuning.velocityDeadbandActual);

        // ── Dynamic thresholds from spacecraft capabilities ──────────
        const caps = this.getDynamicCaps();
        const mass = this.spacecraft.getMass();
        const aMin = Math.max(0.01, Math.min(caps.linAccel.x, caps.linAccel.y, caps.linAccel.z));
        const minForce = Math.min(caps.linForce.x, caps.linForce.y, caps.linForce.z);
        // Minimum impulse: smallest thruster pulse (1 physics frame at min force)
        const dtPhysics = 1 / 60; // physics timestep
        const minDeltaV = (minForce * dtPhysics) / mass;
        // Stop distance: where we can't meaningfully control — ~3 minimum impulses
        let dynStopDist = Math.max(stopDist, minDeltaV * 3 / aMin);
        let dynStopOut = Math.max(dynStopDist * 2.0, dynStopDist + minDeltaV * 5 / aMin);
        // Velocity deadband: below this we can't reliably measure/control
        const dynDeadband = Math.max(deadband, minDeltaV * 2);

        // When a speed limit is active (e.g. docking), tighten stop thresholds
        // so we don't stop prematurely far from the target
        if (this.speedLimitOverride !== null) {
            const tightStop = Math.max(0.01, this.speedLimitOverride * 0.3);
            dynStopDist = Math.min(dynStopDist, tightStop);
            dynStopOut = Math.min(dynStopOut, tightStop * 2);
        }

        // ── Waypoint advancement ───────────────────────────────────────
        const isLastWaypoint = this.waypoints.length === 0 || this.waypointIndex >= this.waypoints.length - 1;
        if (!isLastWaypoint && distance <= dynStopDist * 3) {
            // Intermediate waypoint: advance to next without stopping
            this.waypointIndex++;
            this.targetPosition = this.waypoints[this.waypointIndex];
            this.arrivalLatched = false;
            return this.calculateForces(_dt, out); // recurse with new target
        }

        // ── Arrival hysteresis (only for final waypoint) ──────────────
        // Skip arrival latch when a speed limit is active (e.g. docking final approach).
        // Docking completion is handled by the physical docking gate, not GoToPosition.
        const useArrivalLatch = this.speedLimitOverride === null;
        if (useArrivalLatch) {
            if (this.arrivalLatched) {
                if (distance <= dynStopOut) return out;
                this.arrivalLatched = false;
            }
            if (distance <= dynStopDist && speed <= dynDeadband) {
                this.arrivalLatched = true;
                return out;
            }
        }

        // ── Desired velocity vector ───────────────────────────────────
        // Speed profile: v = min(vMax, sqrt(2 * a * d))
        // Safety factor on decel: accounts for thrust direction misalignment
        // when braking along an arbitrary 3D direction.
        // More omnidirectional thrusters → higher factor (closer to 1.0).
        const aMax = Math.max(0.01, Math.max(caps.linAccel.x, caps.linAccel.y, caps.linAccel.z));
        const omniFactor = aMin / aMax; // 1.0 = perfectly uniform, <1 = asymmetric
        const brakeSafety = 0.5 + 0.3 * omniFactor; // 0.5-0.8 range
        const aBrake = aMin * brakeSafety;
        const vMaxConfig = this.config.limits.maxLinearVelocity ?? 8.0;
        const vMax = this.speedLimitOverride !== null ? Math.min(vMaxConfig, this.speedLimitOverride) : vMaxConfig;
        const vBrake = Math.sqrt(2 * aBrake * Math.max(0, distance - dynStopDist));
        const vDesired = Math.min(vMax, vBrake);

        const toTargetDir = distance > 1e-6
            ? this.tmpVecB.copy(toTarget).multiplyScalar(1 / distance)
            : this.tmpVecB.set(0, 0, 0);

        // Desired velocity: speed along direction to target
        const vDesWorld = this.tmpVecC.copy(toTargetDir).multiplyScalar(vDesired);

        // ── Velocity error ────────────────────────────────────────────
        const vErr = this.tmpVecD.copy(vDesWorld).sub(vel);
        const vErrMag = vErr.length();

        // ── Coast zone: if velocity error is small, don't fire ────────
        // Coast when we're within 10% of the desired velocity profile
        const coastThreshold = Math.max(0.1, vDesired * 0.1);
        const coasting = vErrMag < coastThreshold && distance > stopDist * 3;

        this.totalFrames++;

        if (coasting) {
            // ── COAST: zero thrust ────────────────────────────────────
            this.buildTelemetry(distance, vel, vDesired, toTargetDir, caps, 'coast');
            return out;
        }

        // ── THRUST: apply per-axis force proportional to velocity error ─
        this.burnFrames++;

        // Convert velocity error to local frame
        const vErrLocal = this.tmpVecE.copy(vErr).applyQuaternion(qInv);

        // Scale: force = mass * (vErr / responseTime)
        // Response time derived from spacecraft dynamics: time to achieve 1 m/s
        // at weakest acceleration, clamped to [0.1, 1.0] for stability.
        const responseTime = Math.min(1.0, Math.max(0.1, 1.0 / aMin * 0.3));
        const localForce = vErrLocal.multiplyScalar(mass / responseTime);

        // Clamp each axis to its actual thruster group capacity
        localForce.x = Math.sign(localForce.x) * Math.min(Math.abs(localForce.x), caps.linForce.x);
        localForce.y = Math.sign(localForce.y) * Math.min(Math.abs(localForce.y), caps.linForce.y);
        localForce.z = Math.sign(localForce.z) * Math.min(Math.abs(localForce.z), caps.linForce.z);

        // Apply to thruster groups
        this.applyAxisForce(localForce.z, localForce.z >= 0 ? 0 : 1, this.thrusterGroups.forward, out);
        this.applyAxisForce(localForce.y, localForce.y >= 0 ? 0 : 1, this.thrusterGroups.up, out);
        this.applyAxisForce(localForce.x, localForce.x >= 0 ? 1 : 0, this.thrusterGroups.left, out);

        const vAlong = vel.dot(toTargetDir);
        const phase = vAlong > vDesired * 1.05 ? 'burn_decel' : 'burn_accel';
        this.buildTelemetry(distance, vel, vDesired, toTargetDir, caps, phase);
        return out;
    }

    private applyAxisForce(force: number, groupIndex: number, groups: number[][], out: number[]): void {
        if (Math.abs(force) < 1e-9) return;
        const group = groups[groupIndex];
        if (!group || group.length === 0) return;
        const sumCap = group.reduce((s, idx) => s + (this.thrusterMax[idx] || this.thrust), 0);
        const total = Math.min(Math.abs(force), sumCap);
        if (sumCap <= 1e-6) return;
        group.forEach(idx => {
            const cap = this.thrusterMax[idx] || this.thrust;
            out[idx] += cap * (total / sumCap);
        });
    }

    private buildTelemetry(
        distance: number, vel: THREE.Vector3, vDesired: number,
        toTargetDir: THREE.Vector3, caps: ReturnType<typeof this.getDynamicCaps>,
        phase: string,
    ): void {
        const vAlong = vel.dot(toTargetDir);
        const speed = vel.length();
        const aMax = Math.min(caps.linAccel.x, caps.linAccel.y, caps.linAccel.z);
        const dStop = vAlong > 0 ? (vAlong * vAlong) / (2 * aMax) : 0;
        const vMax = this.config.limits.maxLinearVelocity ?? 0;
        const alignAngleDeg = (distance > 1e-6 && speed > 1e-6)
            ? THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(vel.dot(toTargetDir) / speed, -1, 1)))
            : 0;
        const dutyCycle = this.totalFrames > 0 ? this.burnFrames / this.totalFrames : 0;

        this.telemetry = {
            distance, vAlong, vDes: vDesired, dStop,
            braking: phase === 'burn_decel',
            alignAngleDeg, alignGate: true,
            aMax, vMax,
            targetType: (this.referenceVelocityWorld && this.referenceVelocityWorld.lengthSq() > 1e-10) ? 'spacecraft' : 'static',
            vTargetMag: vDesired, vTargetAlong: vDesired,
            vRelMag: speed,
            tGo: vDesired > 0.01 ? distance / vDesired : 0,
            missMag: 0,
            maneuverPhase: phase,
            maneuverTimeRemaining: vDesired > 0.01 ? distance / vDesired : 0,
            thrusterDutyCycle: dutyCycle,
            coastFraction: this.totalFrames > 0 ? (this.totalFrames - this.burnFrames) / this.totalFrames : 0,
        };
    }

    public getTelemetry() {
        return this.telemetry;
    }

    public getAxisLinearAccelCaps(): { x: number; y: number; z: number } {
        return this.getDynamicCaps().linAccel;
    }
}

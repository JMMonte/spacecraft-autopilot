import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';

export class GoToPosition extends AutopilotMode {
    private targetPosition: THREE.Vector3;
    private threshold: number = 0.2; // Default threshold
    private isApproachPhase: boolean = false;
    // Refinements state
    private alignGateActive: boolean = true;
    private brakingActive: boolean = false;
    private alignGateOnDeg: number = 15; // engage gate when misalignment >= 15 deg
    private alignGateOffDeg: number = 8;  // disengage when <= 8 deg
    private brakeMarginOn: number = 0.08; // m
    private brakeMarginOff: number = 0.12; // m
    private telemetry: {
        distance: number;
        vAlong: number;
        vDes: number;
        dStop: number;
        braking: boolean;
        alignAngleDeg: number;
        alignGate: boolean;
        aMax: number;
        vMax: number;
        tGo?: number;
        aCmdLocal?: { x: number; y: number; z: number };
        targetType?: 'spacecraft' | 'static';
        vTargetMag?: number;
        vTargetAlong?: number;
        vRelMag?: number;
    } | null = null;

    constructor(
        spacecraft: Spacecraft,
        config: AutopilotConfig,
        thrusterGroups: any,
        thrust: number,
        pidController: PIDController,
        targetPosition: THREE.Vector3
    ) {
        super(spacecraft, config, thrusterGroups, thrust, pidController);
        this.targetPosition = targetPosition;
    }

    setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition = position;
    }

    setThreshold(threshold: number): void {
        this.threshold = threshold;
        // Use more aggressive PID gains during approach phase (threshold > 0.5m)
        this.isApproachPhase = threshold > 0.5;
        if (this.isApproachPhase) {
            this.pidController.setGain('Kp', 0.3);  // More aggressive proportional gain
            this.pidController.setGain('Ki', 0.002); // Slightly more integral gain
            this.pidController.setGain('Kd', 1.0);  // More derivative gain for better damping
        } else {
            // Reset to default gentle gains for precise positioning
            this.pidController.setGain('Kp', 0.1);
            this.pidController.setGain('Ki', 0.001);
            this.pidController.setGain('Kd', 0.5);
        }
    }

    getThreshold(): number {
        return this.threshold;
    }

    calculateForces(dt: number, out: number[] = Array(24).fill(0)): number[] {
        const currentPosition = this.spacecraft.getWorldPositionRef();
        const currentVelocity = this.spacecraft.getWorldVelocityRef();
        const targetRefVel = this.referenceVelocityWorld || this.tmpVecC.set(0, 0, 0);
        const relVelocityWorld = this.tmpVecA.copy(currentVelocity).sub(targetRefVel);
        const q = this.spacecraft.getWorldOrientationRef();
        const qInv = this.tmpQuatA.copy(q).invert();

        // Position error in world
        const posErrWorld = this.tmpVecB.copy(this.targetPosition).sub(currentPosition);
        const dist = posErrWorld.length();
        const dirWorld = this.tmpVecD.copy(posErrWorld).multiplyScalar(1 / Math.max(dist, 1e-9));

        // Local frame quantities
        const dirLocal = this.tmpVecE.copy(dirWorld).applyQuaternion(qInv);
        const velLocal = relVelocityWorld.applyQuaternion(qInv);
        const posErrLocal = posErrWorld.applyQuaternion(qInv);

        // Guidance: estimate dynamic accel caps
        // Dynamic acceleration capability projected along desired direction
        const aMaxDir = Math.max(1e-3, this.getDynamicLinearAccelAlong(dirLocal));
        const caps = this.getDynamicCaps();

        // Scale by pointing alignment so we don't thrust hard when misaligned
        const forwardWorld = this.tmpVecC.set(0, 0, 1).applyQuaternion(q);
        const alignDot = Math.max(-1, Math.min(1, forwardWorld.dot(dirWorld)));
        const alignAngle = Math.acos(alignDot) * 180 / Math.PI; // degrees
        // Update alignment gate with hysteresis (used for scaling, not hard block)
        if (this.alignGateActive) {
            if (alignAngle <= this.alignGateOffDeg) this.alignGateActive = false;
        } else {
            if (alignAngle >= this.alignGateOnDeg) this.alignGateActive = true;
        }
        const align = Math.max(0, alignDot); // use only forward alignment component
        // Never zero-out translation; just reduce authority when misaligned
        const alignScale = this.alignGateActive ? 0.3 : Math.max(0.2, Math.pow(align, 2));
        const aMax = aMaxDir * alignScale;
        // Distance-derived speed cap from stopping distance formula (no fixed vMax)
        const vStopCap = Math.sqrt(2 * aMax * Math.max(dist, 0));

        const vAlong = relVelocityWorld.dot(dirWorld);
        const dStop = (vAlong * vAlong) / (2 * Math.max(aMax, 1e-6));
        const nearLinearKV = 2.0; // m/s per m in close range

        // Update braking state with hysteresis relative to stopping distance
        // Only brake when already moving toward the target (vAlong > 0)
        if (vAlong > 0) {
            if (this.brakingActive) {
                if (dist > dStop + this.brakeMarginOff) this.brakingActive = false;
            } else {
                if (dist <= dStop + this.brakeMarginOn) this.brakingActive = true;
            }
        } else {
            this.brakingActive = false;
        }

        // New: time-to-go (ZEM/ZEV) terminal guidance for far approaches
        // Choose a conservative time-to-go from triangular profile with accel aMax
        const tMin = 0.35;     // lower bound to avoid impulse-like commands
        const tMax = 60.0;     // avoid excessive horizon at very long distances
        const tTri = aMax > 1e-6 ? 2.0 * Math.sqrt(Math.max(dist, 0) / aMax) : 2.0;
        // Blend in current speed influence to handle large closing speeds
        const vMag = currentVelocity.length();
        const tVel = aMax > 1e-6 ? vMag / aMax : 0.0;
        const tGo = Math.max(tMin, Math.min(tMax, 0.8 * tTri + 0.2 * tVel));

        // Zero-Effort Miss/Velocity guidance (relative to moving reference)
        // ZEM = posErr - vRel * tGo, ZEV = -vRel
        const ZEV = relVelocityWorld.clone().multiplyScalar(-1); // keep relVelocityWorld for telemetry
        const ZEM = posErrWorld.sub(relVelocityWorld.clone().multiplyScalar(tGo));
        const kR = 6.0 / (tGo * tGo);
        const kV = 4.0 / Math.max(tGo, 1e-6);
        const aCmdWorld = ZEM.multiplyScalar(kR).add(ZEV.multiplyScalar(kV));
        // Transform to local for axis-wise saturation
        let aCmdLocal = aCmdWorld.applyQuaternion(qInv);
        // Axis caps in local frame with alignment scaling
        const axCap = Math.min(this.config.limits.maxLinearAcceleration ?? Infinity, caps.linAccel.x * alignScale);
        const ayCap = Math.min(this.config.limits.maxLinearAcceleration ?? Infinity, caps.linAccel.y * alignScale);
        const azCap = Math.min(this.config.limits.maxLinearAcceleration ?? Infinity, caps.linAccel.z * alignScale);
        aCmdLocal.set(
            THREE.MathUtils.clamp(aCmdLocal.x, -axCap, axCap),
            THREE.MathUtils.clamp(aCmdLocal.y, -ayCap, ayCap),
            THREE.MathUtils.clamp(aCmdLocal.z, -azCap, azCap),
        );

        // Telemetry snapshot
        this.telemetry = {
            distance: dist,
            vAlong,
            vDes: this.brakingActive ? 0 : Math.min(vStopCap, nearLinearKV * dist),
            dStop,
            braking: this.brakingActive,
            alignAngleDeg: alignAngle,
            alignGate: this.alignGateActive,
            aMax,
            vMax: vStopCap,
            tGo,
            aCmdLocal: { x: aCmdLocal.x, y: aCmdLocal.y, z: aCmdLocal.z },
            targetType: this.referenceVelocityWorld ? 'spacecraft' : 'static',
            vTargetMag: targetRefVel.length(),
            vTargetAlong: targetRefVel.dot(dirWorld),
            vRelMag: relVelocityWorld.length(),
        };

        if (dist <= this.threshold) {
            // Near-target hold: damp velocity and gently pull toward the setpoint
            const kPos = 1.4; // m/s^2 per m
            const kVel = this.config.damping.factor; // m/s^2 per (m/s)
            aCmdLocal = posErrLocal.multiplyScalar(kPos)
                .add(velLocal.multiplyScalar(-kVel));
        } else {
            // Use ZEM/ZEV acceleration command computed above
            // (already saturated to axis caps)
        }

        // Force command
        const mass = this.spacecraft.getMass();
        const localForce = aCmdLocal.multiplyScalar(mass);

        // Clamp by force and step momentum budget
        const maxByForce = this.config.limits.maxForce;
        const maxByMomentum = this.config.limits.maxLinearMomentum / Math.max(dt, 1e-3);
        const maxAllowable = Math.min(maxByForce, maxByMomentum);
        if (localForce.length() > maxAllowable) {
            localForce.multiplyScalar(maxAllowable / localForce.length());
        }

        this.applyTranslationalForcesToThrusterGroupsInPlace(localForce, out);
        return out;
    }

    public getTelemetry() {
        return this.telemetry;
    }

    protected applyTranslationalForcesToThrusterGroups(localForce: THREE.Vector3): number[] {
        const thrusterForces = Array(24).fill(0);
        const forceMultiplier = 1.0;

        // Forward/Back translation (Z-axis)
        // Positive Z means we need back thrusters (index 1)
        if (Math.abs(localForce.z) > this.config.limits.epsilon) {
            const zGroup = this.thrusterGroups.forward[localForce.z >= 0 ? 0 : 1];
            const forcePerThruster = Math.min(Math.abs(localForce.z), this.thrust) * forceMultiplier / zGroup.length;
            zGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        // Up/Down translation (Y-axis)
        // Positive Y means we need up thrusters (index 0)
        if (Math.abs(localForce.y) > this.config.limits.epsilon) {
            const yGroup = this.thrusterGroups.up[localForce.y >= 0 ? 0 : 1];
            const forcePerThruster = Math.min(Math.abs(localForce.y), this.thrust) * forceMultiplier / yGroup.length;
            yGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        // Left/Right translation (X-axis)
        // Positive X means we need right thrusters (index 1)
        if (Math.abs(localForce.x) > this.config.limits.epsilon) {
            const xGroup = this.thrusterGroups.left[localForce.x >= 0 ? 1 : 0];
            const forcePerThruster = Math.min(Math.abs(localForce.x), this.thrust) * forceMultiplier / xGroup.length;
            xGroup.forEach((index: number) => {
                thrusterForces[index] = forcePerThruster;
            });
        }

        return thrusterForces;
    }

    protected applyTranslationalForcesToThrusterGroupsInPlace(localForce: THREE.Vector3, out: number[]): void {
        const forceMultiplier = 1.0;

        if (Math.abs(localForce.z) > this.config.limits.epsilon) {
            const zGroup = this.thrusterGroups.forward[localForce.z >= 0 ? 0 : 1];
            const forcePerThruster = Math.min(Math.abs(localForce.z), this.thrust) * forceMultiplier / zGroup.length;
            zGroup.forEach((index: number) => {
                out[index] += forcePerThruster;
            });
        }

        if (Math.abs(localForce.y) > this.config.limits.epsilon) {
            const yGroup = this.thrusterGroups.up[localForce.y >= 0 ? 0 : 1];
            const forcePerThruster = Math.min(Math.abs(localForce.y), this.thrust) * forceMultiplier / yGroup.length;
            yGroup.forEach((index: number) => {
                out[index] += forcePerThruster;
            });
        }

        if (Math.abs(localForce.x) > this.config.limits.epsilon) {
            const xGroup = this.thrusterGroups.left[localForce.x >= 0 ? 1 : 0];
            const forcePerThruster = Math.min(Math.abs(localForce.x), this.thrust) * forceMultiplier / xGroup.length;
            xGroup.forEach((index: number) => {
                out[index] += forcePerThruster;
            });
        }
    }
} 

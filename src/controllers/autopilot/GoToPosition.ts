import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';
import type { ThrusterGroups } from '../../config/spacecraftConfig';

export class GoToPosition extends AutopilotMode {
    private targetPosition: THREE.Vector3;
    private threshold: number = 0.2; // Default threshold
    private isApproachPhase: boolean = false;
    // Refinements state
    private alignGateActive: boolean = true;
    private alignGateOnDeg: number = 15; // engage gate when misalignment >= 15 deg
    private alignGateOffDeg: number = 8;  // disengage when <= 8 deg
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
        aCmdLocal?: { x: number; y: number; z: number };
        targetType?: 'spacecraft' | 'static';
        vTargetMag?: number;
        vTargetAlong?: number;
        vRelMag?: number;
    } | null = null;


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
    }

    setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition = position;
    }

    public setGuidanceMode(_mode: 'direct' | 'trackRef'): void { /* simplified: no-op */ }

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
        const velLocal = relVelocityWorld.clone().applyQuaternion(qInv);
        const posErrLocal = posErrWorld.clone().applyQuaternion(qInv);

        // Guidance: estimate dynamic accel caps
        // Dynamic acceleration capability projected along desired direction
        const aMaxDir = Math.max(1e-3, this.getDynamicLinearAccelAlong(dirLocal));
        const caps = this.getDynamicCaps();
        const accelLimit = this.config.limits.maxLinearAcceleration ?? Infinity;

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
        // Treat forward drive more conservatively when off-axis, but allow full braking authority to shed inertia.
        const aForwardCap = Math.min(accelLimit, aMaxDir * alignScale * 0.7);
        // Distance-derived speed cap from stopping distance formula (no fixed vMax)
        let brakeCap = Math.min(accelLimit, aMaxDir);
        const vStopCap = Math.sqrt(2 * Math.max(brakeCap, 1e-6) * Math.max(dist, 0));

        // Project world-relative velocity along world direction to target
        const vAlong = relVelocityWorld.dot(dirWorld);
        const dStop = (vAlong * vAlong) / (2 * Math.max(brakeCap, 1e-6));
        // Reduce approach slope near target based on braking ratio (physics-based)
        const soft = 0.25; // m, safety offset to avoid singularity
        const rStop = THREE.MathUtils.clamp(dist / Math.max(soft, dStop + soft), 0, 1); // small when inside stop distance
        const nearLinearKV = 1.2; // m/s per m (base)

        // Unified simple energy-based guidance (no ZEM/ZEV):
        // - Along LOS, servo to an approach speed vDes that is brake-safe.
        // - Orthogonal to LOS, damp relative velocity to avoid sliding.
        // - Scale authority by alignment and proximity.
        // Desired closing speed
        const vPlan = targetRefVel.lengthSq() > 1e-6 ? Math.max(0, targetRefVel.dot(dirWorld)) : 0;
        const vDesRaw = Math.max(vPlan, nearLinearKV * dist);
        const vDes = Math.min(vStopCap, vDesRaw);
        const kV = 3.0;
        let aAlongDesired = THREE.MathUtils.clamp(kV * (vDes - vAlong), -brakeCap, aForwardCap);
        // Tangential damping
        const vTan = relVelocityWorld.clone().sub(dirWorld.clone().multiplyScalar(vAlong));
        // Lateral authority scales down when braking distance is tight
        const latScale = 0.3 + 0.7 * rStop; // 0.3 when d << dStop, up to 1.0 far
        const latAccelCap = Math.min(accelLimit, Math.min(caps.linAccel.x, caps.linAccel.y, caps.linAccel.z));
        const alignLatScale = Math.max(0.35, alignScale);
        const aLatMaxWorld = Math.max(0.1, latAccelCap * alignLatScale * latScale);
        const kTan = 2.0 * latScale; // reduce orthogonal damping when braking hard
        let aTan = vTan.multiplyScalar(-kTan);
        if (aTan.length() > aLatMaxWorld) aTan.multiplyScalar(aLatMaxWorld / aTan.length());
        // Compose world acceleration command
        let aCmdWorld = dirWorld.clone().multiplyScalar(aAlongDesired).add(aTan);
        // Transform to local for axis-wise saturation (do not mutate world vector)
        let aCmdLocal = aCmdWorld.clone().applyQuaternion(qInv);
        // Axis caps in local frame with alignment scaling (no size-based scaling)
        const axCap = Math.min(this.config.limits.maxLinearAcceleration ?? Infinity, caps.linAccel.x * alignScale);
        const ayCap = Math.min(this.config.limits.maxLinearAcceleration ?? Infinity, caps.linAccel.y * alignScale);
        const azCap = Math.min(this.config.limits.maxLinearAcceleration ?? Infinity, caps.linAccel.z * alignScale);
        aCmdLocal.set(
            THREE.MathUtils.clamp(aCmdLocal.x, -axCap, axCap),
            THREE.MathUtils.clamp(aCmdLocal.y, -ayCap, ayCap),
            THREE.MathUtils.clamp(aCmdLocal.z, -azCap, azCap),
        );

        // Increase command smoothing when braking distance is tight (momentum-aware)
        this.linSmoothAlpha = 0.5 + 0.35 * (1 - rStop); // 0.85 when d << dStop, 0.5 far

        // Telemetry snapshot
        this.telemetry = {
            distance: dist,
            vAlong,
            vDes,
            dStop,
            braking: vAlong > Math.max(0, vDes),
            alignAngleDeg: alignAngle,
            alignGate: this.alignGateActive,
            aMax: aForwardCap,
            vMax: vStopCap,
            aCmdLocal: { x: aCmdLocal.x, y: aCmdLocal.y, z: aCmdLocal.z },
            targetType: (this.referenceVelocityWorld && this.referenceVelocityWorld.lengthSq() > 1e-10) ? 'spacecraft' : 'static',
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
            aCmdLocal.set(
                THREE.MathUtils.clamp(aCmdLocal.x, -axCap, axCap),
                THREE.MathUtils.clamp(aCmdLocal.y, -ayCap, ayCap),
                THREE.MathUtils.clamp(aCmdLocal.z, -azCap, azCap),
            );
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

    // Expose dynamic accel capabilities for path follower calibration
    public getAxisLinearAccelCaps(): { x: number; y: number; z: number } {
        const caps = this.getDynamicCaps();
        return { ...caps.linAccel };
    }

    public getAccelAlongWorldDir(dirWorld: THREE.Vector3): number {
        const q = this.spacecraft.getWorldOrientationRef();
        const qInv = this.tmpQuatA.copy(q).invert();
        const dirLocal = this.tmpVecE.copy(dirWorld).normalize().applyQuaternion(qInv);
        return Math.max(1e-6, this.getDynamicLinearAccelAlong(dirLocal));
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

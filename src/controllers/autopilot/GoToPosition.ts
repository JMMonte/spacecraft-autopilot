import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import type { Spacecraft } from '../../core/spacecraft';
import { PIDController } from '../pidController';
import * as THREE from 'three';
import type { ThrusterGroups } from '../../config/spacecraftConfig';

export class GoToPosition extends AutopilotMode {
    private targetPosition: THREE.Vector3;

    // Pure velocity tracking: single PID controller (initialized in initializeAdaptiveGains)
    private velocityPID!: PIDController;  // Tracks velocity command from PathManager
    
    // Filtered velocity for noise reduction
    private filteredVelocity = new THREE.Vector3();
    private velocityFilterAlpha = 0.3; // 30% new, 70% old

    private telemetry: {
        distance: number;
        vCmd: THREE.Vector3;
        vActual: THREE.Vector3;
        vError: THREE.Vector3;
        aCmd: THREE.Vector3;
        dStop: number;
        braking: boolean;
        alignAngleDeg: number;
        alignGate: boolean;
        positionError: THREE.Vector3;
        targetType?: 'spacecraft' | 'static';
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

        // AUTO-TUNED velocity PID gains based on spacecraft properties
        // Pure velocity tracker - position control is handled by PathManager
        this.initializeAdaptiveGains();
    }

    private initializeAdaptiveGains(): void {
        // PURE P CONTROLLER - simple and efficient
        // PathManager handles position→velocity, we handle velocity→force
        // Filtering on velocity measurement handles noise
        const mass = this.spacecraft.getMass();
        
        // Kp: 1 m/s² per m/s error
        const Kp = mass * 1.0;

        this.velocityPID = new PIDController(Kp, 0, 0, 'linearMomentum');

        console.log('[GoToPosition] P gain:', { mass: mass.toFixed(1), Kp: Kp.toFixed(1) });
    }


    setTargetPosition(position: THREE.Vector3): void {
        this.targetPosition = position;
    }

    public setGuidanceMode(_mode: 'direct' | 'trackRef'): void {
        // No-op: Pure velocity tracker always uses vRef from PathManager
        // Kept for compatibility with autopilot.worker.ts
    }

    calculateForces(dt: number, out: number[] = Array(24).fill(0)): number[] {
        // =================================================================
        // FUNDAMENTAL VELOCITY TRACKER - NO FANCY STUFF
        // =================================================================
        // vRef → PID → Force. That's it.
        // =================================================================

        const rawVelocity = this.spacecraft.getWorldVelocityRef();
        const vRef = this.referenceVelocityWorld || new THREE.Vector3(0, 0, 0);
        const q = this.spacecraft.getWorldOrientationRef();
        const qInv = this.tmpQuatA.copy(q).invert();

        // Filter velocity measurement to reduce noise (exponential moving average)
        this.filteredVelocity.multiplyScalar(1 - this.velocityFilterAlpha);
        this.filteredVelocity.addScaledVector(rawVelocity, this.velocityFilterAlpha);
        const currentVelocity = this.filteredVelocity;

        // Deadband: stop firing thrusters when appropriate
        const currentPosition = this.spacecraft.getWorldPositionRef();
        const posErr = this.targetPosition.clone().sub(currentPosition);
        const distance = posErr.length();
        const vRefMag = vRef.length();
        const vActualMag = currentVelocity.length();
        
        // Stop if commanding zero velocity and already stopped (anywhere in space)
        if (vRefMag < 0.01 && vActualMag < 0.02) {
            return out;
        }
        
        // Also stop if very close to target regardless of velocity command
        if (distance < 0.05) { // Within 5cm of target
            return out;
        }

        // Velocity error in world frame (using filtered velocity)
        const vErrWorld = this.tmpVecA.copy(vRef).sub(currentVelocity);
        
        // Convert to local frame
        const vErrLocal = vErrWorld.clone().applyQuaternion(qInv);

        // P controller: velocity error → acceleration
        const aCmdLocal = this.velocityPID.update(vErrLocal, dt);

        // F = ma
        const mass = this.spacecraft.getMass();
        const localForce = aCmdLocal.clone().multiplyScalar(mass);

        // Debug logging
        if (vRef.lengthSq() > 0.01) {
            console.log('[GoToPosition] vRef:', vRef.length().toFixed(3), 
                        'vErr:', vErrLocal.length().toFixed(3),
                        'aCmd:', aCmdLocal.length().toFixed(3),
                        'force:', localForce.length().toFixed(1));
        }

        // Apply force to thrusters with proper clamping
        const applyAxisForce = (force: number, groupIndex: number, groups: number[][]) => {
            if (Math.abs(force) < 1e-9) return;
            const group = groups[groupIndex];
            
            // Calculate total capacity of this group
            const sumCap = group.reduce((sum, idx) => sum + (this.thrusterMax[idx] || this.thrust), 0);
            
            // Clamp requested force to what the group can actually provide
            const total = Math.min(Math.abs(force), sumCap);
            if (sumCap <= 1e-6) return;
            
            // Distribute proportionally based on each thruster's capacity
            group.forEach(idx => {
                const cap = this.thrusterMax[idx] || this.thrust;
                const share = total * (cap / sumCap);
                out[idx] += Math.min(cap, share);
            });
        };
        
        applyAxisForce(localForce.z, localForce.z >= 0 ? 0 : 1, this.thrusterGroups.forward);
        applyAxisForce(localForce.y, localForce.y >= 0 ? 0 : 1, this.thrusterGroups.up);
        applyAxisForce(localForce.x, localForce.x >= 0 ? 1 : 0, this.thrusterGroups.left);

        // Telemetry (reuse posErr and distance from deadband check)
        this.telemetry = {
            distance: distance,
            vCmd: vRef.clone(),
            vActual: currentVelocity.clone(),
            vError: vErrWorld.clone(),
            aCmd: aCmdLocal.clone(),
            dStop: 0,
            braking: false,
            alignAngleDeg: 0,
            alignGate: false,
            positionError: posErr,
            targetType: (this.referenceVelocityWorld && this.referenceVelocityWorld.lengthSq() > 1e-10)
                ? 'spacecraft' : 'static',
        };

        return out;
    }

    public getTelemetry() {
        return this.telemetry;
    }

    // Expose dynamic accel capabilities for path follower calibration
    // Used by PathManager to get spacecraft braking capabilities
    public getAxisLinearAccelCaps(): { x: number; y: number; z: number } {
        return this.getDynamicCaps().linAccel;
    }
} 

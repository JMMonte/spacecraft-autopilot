/**
 * ManeuverExecutor — State machine that executes a ManeuverPlan frame-by-frame.
 *
 * Outputs full thrust, zero thrust, or full reverse thrust depending on
 * the current maneuver phase. Uses closed-loop braking distance checks
 * for robust coast→decel transitions.
 */

import type { ManeuverPlan, Vec3Like } from './ManeuverPlanner';

export enum ManeuverPhase {
    IDLE = 'idle',
    BURN_ACCEL = 'burn_accel',
    COAST = 'coast',
    BURN_DECEL = 'burn_decel',
    DONE = 'done',
}

export interface ManeuverOutput {
    /** Force direction in world frame (unit vector). Zero vector during coast/done. */
    forceDirection: Vec3Like;
    /** Force magnitude as fraction of max thrust (0 or 1). */
    forceFraction: number;
    /** Current maneuver phase. */
    phase: ManeuverPhase;
    /** Is the executor actively maneuvering? */
    isActive: boolean;
    /** Estimated time remaining in current maneuver (seconds). */
    timeRemaining: number;
}

const EPS = 1e-9;

export class ManeuverExecutor {
    private phase: ManeuverPhase = ManeuverPhase.IDLE;
    private plan: ManeuverPlan | null = null;
    private phaseTimer: number = 0;
    private totalTimer: number = 0;

    // Configurable thresholds
    private velocityDeadband: number = 0.05; // m/s
    private stopDistance: number = 0.3; // meters

    /** Set a new maneuver plan. Resets the state machine. */
    setPlan(plan: ManeuverPlan): void {
        this.plan = plan;
        this.phaseTimer = 0;
        this.totalTimer = 0;

        if (plan.burnAccelTime > EPS) {
            this.phase = ManeuverPhase.BURN_ACCEL;
        } else if (plan.coastTime > EPS) {
            this.phase = ManeuverPhase.COAST;
        } else if (plan.burnDecelTime > EPS) {
            this.phase = ManeuverPhase.BURN_DECEL;
        } else {
            this.phase = ManeuverPhase.DONE;
        }
    }

    /** Abort the current maneuver. */
    abort(): void {
        this.plan = null;
        this.phase = ManeuverPhase.IDLE;
        this.phaseTimer = 0;
        this.totalTimer = 0;
    }

    /** Get the current phase. */
    getPhase(): ManeuverPhase { return this.phase; }

    /** Get the current plan (if any). */
    getPlan(): ManeuverPlan | null { return this.plan; }

    /** Whether this executor has an active (non-idle, non-done) maneuver. */
    isActive(): boolean {
        return this.phase !== ManeuverPhase.IDLE && this.phase !== ManeuverPhase.DONE;
    }

    /** Configure deadbands. */
    setDeadbands(velocity: number, distance: number): void {
        this.velocityDeadband = Math.max(1e-4, velocity);
        this.stopDistance = Math.max(1e-3, distance);
    }

    /**
     * Advance the maneuver by one timestep.
     *
     * @param dt           Timestep (seconds)
     * @param currentPos   Current spacecraft position (world)
     * @param currentVel   Current spacecraft velocity (world)
     * @param targetPos    Target position (world) — used for closed-loop checks
     * @returns            Force output and phase info
     */
    update(
        dt: number,
        currentPos: Vec3Like,
        currentVel: Vec3Like,
        targetPos: Vec3Like,
    ): ManeuverOutput {
        if (!this.plan || this.phase === ManeuverPhase.IDLE) {
            return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.IDLE, 0);
        }
        if (this.phase === ManeuverPhase.DONE) {
            return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.DONE, 0);
        }

        this.phaseTimer += dt;
        this.totalTimer += dt;
        const plan = this.plan;
        const dir = plan.direction;

        // Compute LIVE direction to target (not the planned direction)
        const toTargetX = targetPos.x - currentPos.x;
        const toTargetY = targetPos.y - currentPos.y;
        const toTargetZ = targetPos.z - currentPos.z;
        const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ);
        // Live unit vector toward target (for decel burns)
        const liveNx = distToTarget > EPS ? toTargetX / distToTarget : dir.x;
        const liveNy = distToTarget > EPS ? toTargetY / distToTarget : dir.y;
        const liveNz = distToTarget > EPS ? toTargetZ / distToTarget : dir.z;
        // Velocity along the LIVE direction to target
        const vAlong = currentVel.x * liveNx + currentVel.y * liveNy + currentVel.z * liveNz;
        // Braking distance: use raw accel (without the planning efficiency factor)
        // so the coast→decel transition isn't triggered too early.
        // plan.accelMag already has thrustEfficiency (0.9) baked in — undo it for live checks.
        const rawAccel = plan.accelMag / 0.9;
        const brakingDist = (vAlong > 0) ? (vAlong * vAlong) / (2 * Math.max(EPS, rawAccel)) : 0;

        const timeRemaining = Math.max(0, plan.totalTime - this.totalTimer);

        switch (this.phase) {
            case ManeuverPhase.BURN_ACCEL: {
                // Also check: if braking distance is getting close, skip straight to decel
                if (brakingDist >= distToTarget * 0.98 && vAlong > this.velocityDeadband) {
                    this.transitionTo(ManeuverPhase.BURN_DECEL);
                    return this.output(
                        { x: -dir.x, y: -dir.y, z: -dir.z },
                        1, ManeuverPhase.BURN_DECEL, timeRemaining
                    );
                }
                // Transition: timer expired OR reached cruise speed
                if (this.phaseTimer >= plan.burnAccelTime || vAlong >= plan.cruiseSpeed * 0.98) {
                    if (plan.coastTime > EPS) {
                        this.transitionTo(ManeuverPhase.COAST);
                        return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.COAST, timeRemaining);
                    }
                    // No coast — go straight to decel
                    this.transitionTo(ManeuverPhase.BURN_DECEL);
                    return this.output(
                        { x: -dir.x, y: -dir.y, z: -dir.z },
                        1, ManeuverPhase.BURN_DECEL, timeRemaining
                    );
                }
                // Accel burn: use LIVE direction to target (not fixed plan direction).
                // This prevents accumulated error over long burns.
                const accelSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.y * currentVel.y + currentVel.z * currentVel.z);
                const speedGap = Math.max(0, plan.cruiseSpeed - accelSpeed);
                const accelFraction = plan.cruiseSpeed > EPS
                    ? Math.min(1.0, Math.max(0.1, speedGap / (plan.cruiseSpeed * 0.5)))
                    : 1.0;
                // Live direction toward target — continuously corrects during burn
                return this.output(
                    { x: liveNx, y: liveNy, z: liveNz },
                    accelFraction, ManeuverPhase.BURN_ACCEL, timeRemaining
                );
            }

            case ManeuverPhase.COAST: {
                // CLOSED-LOOP transition: start braking when remaining distance ≤ braking distance.
                // This is more robust than timer-based — handles drift, dynamic targets, timing errors.
                const coastSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.y * currentVel.y + currentVel.z * currentVel.z);
                if (brakingDist >= distToTarget * 0.98 && vAlong > this.velocityDeadband) {
                    this.transitionTo(ManeuverPhase.BURN_DECEL);
                    // Brake opposite to velocity
                    if (coastSpeed > EPS) {
                        return this.output(
                            { x: -currentVel.x / coastSpeed, y: -currentVel.y / coastSpeed, z: -currentVel.z / coastSpeed },
                            1, ManeuverPhase.BURN_DECEL, timeRemaining
                        );
                    }
                    return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.BURN_DECEL, timeRemaining);
                }
                // Timer-based safety fallback (3x planned coast time — should rarely trigger)
                if (this.phaseTimer >= plan.coastTime * 3.0) {
                    this.transitionTo(ManeuverPhase.BURN_DECEL);
                    if (coastSpeed > EPS) {
                        return this.output(
                            { x: -currentVel.x / coastSpeed, y: -currentVel.y / coastSpeed, z: -currentVel.z / coastSpeed },
                            1, ManeuverPhase.BURN_DECEL, timeRemaining
                        );
                    }
                    return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.BURN_DECEL, timeRemaining);
                }
                // Coast: zero thrust
                return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.COAST, timeRemaining);
            }

            case ManeuverPhase.BURN_DECEL: {
                const speed = Math.sqrt(currentVel.x * currentVel.x + currentVel.y * currentVel.y + currentVel.z * currentVel.z);

                // Arrival check: close enough and slow enough
                if (distToTarget < this.stopDistance && speed < this.velocityDeadband) {
                    this.phase = ManeuverPhase.DONE;
                    return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.DONE, 0);
                }
                // Timer-based fallback
                if (this.phaseTimer >= plan.burnDecelTime * 3.0) {
                    this.phase = ManeuverPhase.DONE;
                    return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.DONE, 0);
                }

                // PROPORTIONAL DECEL: scale thrust based on how fast we're going
                // relative to how fast we should be going at this distance.
                // Desired speed at current distance: v = sqrt(2 * a * d)
                const desiredSpeed = Math.sqrt(2 * rawAccel * Math.max(0, distToTarget));
                // Thrust fraction: high when overspeeding, low when near desired profile
                const overSpeedRatio = desiredSpeed > EPS ? speed / desiredSpeed : (speed > EPS ? 1 : 0);
                // Clamp between 0.05 (minimum pulse) and 1.0 (full thrust)
                const fraction = Math.min(1.0, Math.max(0.05, overSpeedRatio));

                if (speed > this.velocityDeadband) {
                    // Thrust opposite to velocity, scaled proportionally
                    return this.output(
                        { x: -currentVel.x / speed, y: -currentVel.y / speed, z: -currentVel.z / speed },
                        fraction, ManeuverPhase.BURN_DECEL, timeRemaining
                    );
                }
                // Nearly stopped — gentle thrust toward target
                return this.output(
                    { x: liveNx, y: liveNy, z: liveNz },
                    Math.min(0.3, fraction), ManeuverPhase.BURN_DECEL, timeRemaining
                );
            }

            default:
                return this.output({ x: 0, y: 0, z: 0 }, 0, ManeuverPhase.IDLE, 0);
        }
    }

    private transitionTo(next: ManeuverPhase): void {
        this.phase = next;
        this.phaseTimer = 0;
    }

    private output(dir: Vec3Like, fraction: number, phase: ManeuverPhase, timeRemaining: number): ManeuverOutput {
        return {
            forceDirection: dir,
            forceFraction: fraction,
            phase,
            isActive: phase !== ManeuverPhase.IDLE && phase !== ManeuverPhase.DONE,
            timeRemaining,
        };
    }
}

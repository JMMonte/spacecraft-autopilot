/**
 * ManeuverPlanner — Computes optimal bang-coast-bang burn profiles.
 *
 * Given current and target kinematic state plus thrust capabilities,
 * produces a ManeuverPlan describing exactly when and how long to burn.
 *
 * Pure math — no THREE.js state dependencies, fully testable in isolation.
 */

export interface Vec3Like {
    x: number;
    y: number;
    z: number;
}

export interface ManeuverPlan {
    /** Unit direction of the acceleration burn (world frame). */
    direction: Vec3Like;
    /** Effective scalar acceleration along direction (m/s²). */
    accelMag: number;
    /** Duration of the initial acceleration burn (seconds). */
    burnAccelTime: number;
    /** Duration of the coasting phase — zero thrust (seconds). */
    coastTime: number;
    /** Duration of the deceleration burn (seconds). */
    burnDecelTime: number;
    /** Speed at end of acceleration burn / during coast (m/s). */
    cruiseSpeed: number;
    /** Total maneuver duration (seconds). */
    totalTime: number;
    /** Is this a short (triangular) or long (trapezoidal) profile? */
    profile: 'triangular' | 'trapezoidal' | 'decel_only';
}

const EPS = 1e-9;

export class ManeuverPlanner {

    /**
     * Plan a bang-coast-bang maneuver from current state to target.
     *
     * @param currentPos   Current spacecraft position (world)
     * @param currentVel   Current spacecraft velocity (world)
     * @param targetPos    Target position (world)
     * @param targetVel    Desired velocity at target (world; zero for station-keeping)
     * @param accelCapsPerAxis  Max acceleration per local axis {x, y, z} in m/s²
     * @param maxSpeed     Maximum cruise speed (m/s)
     * @param thrustEfficiency  Safety factor 0-1 to account for PWM/quantization losses (default 0.9)
     */
    static plan(
        currentPos: Vec3Like,
        currentVel: Vec3Like,
        targetPos: Vec3Like,
        targetVel: Vec3Like,
        accelCapsPerAxis: Vec3Like,
        maxSpeed: number,
        thrustEfficiency: number = 0.9,
    ): ManeuverPlan {
        // Direction to target
        const dx = targetPos.x - currentPos.x;
        const dy = targetPos.y - currentPos.y;
        const dz = targetPos.z - currentPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < EPS) {
            return ManeuverPlanner.zeroPlan();
        }

        // Unit direction along line of sight
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        // Effective acceleration along burn direction (conservative: use weakest contributing axis)
        const aRaw = ManeuverPlanner.effectiveAccelAlongDirection(
            nx, ny, nz, accelCapsPerAxis
        );
        const a = Math.max(EPS, aRaw * thrustEfficiency);

        // Current velocity along the burn direction
        const v0along = currentVel.x * nx + currentVel.y * ny + currentVel.z * nz;
        // Target velocity along the burn direction
        const vfAlong = targetVel.x * nx + targetVel.y * ny + targetVel.z * nz;

        // Relative velocity problem: we need to go from v0along to vfAlong
        // while covering distance `dist` along the direction.
        // Transform to a frame where target velocity is zero:
        const v0 = v0along - vfAlong; // current speed relative to target
        const vMax = Math.max(0.1, maxSpeed - Math.abs(vfAlong)); // available cruise headroom

        return ManeuverPlanner.plan1D(dist, v0, vMax, a, { x: nx, y: ny, z: nz });
    }

    /**
     * Plan a 1D bang-coast-bang profile.
     *
     * @param d     Distance to cover (must be > 0)
     * @param v0    Current speed along direction (can be negative if moving away)
     * @param vMax  Maximum cruise speed
     * @param a     Acceleration magnitude (m/s²)
     * @param dir   Unit direction vector
     */
    static plan1D(
        d: number,
        v0: number,
        vMax: number,
        a: number,
        dir: Vec3Like,
    ): ManeuverPlan {
        // If moving away from target, we need to first kill reverse velocity then approach
        if (v0 < -EPS) {
            // Time to stop: t_stop = |v0| / a
            // Distance lost while stopping: d_stop = v0² / (2a)
            const tStop = Math.abs(v0) / a;
            const dStop = (v0 * v0) / (2 * a);
            // After stopping, the effective distance is d + dStop (we drifted further away)
            const dEffective = d + dStop;
            const sub = ManeuverPlanner.plan1DForward(dEffective, 0, vMax, a, dir);
            // Prepend the decel-to-stop burn to the accel burn
            return {
                ...sub,
                burnAccelTime: tStop + sub.burnAccelTime,
                totalTime: tStop + sub.totalTime,
            };
        }

        // Check if we're going too fast and need to brake immediately
        const dBrake = (v0 * v0) / (2 * a);
        if (v0 > EPS && dBrake >= d) {
            // Need to brake NOW — decel-only profile
            const tBrake = v0 / a;
            return {
                direction: dir,
                accelMag: a,
                burnAccelTime: 0,
                coastTime: 0,
                burnDecelTime: tBrake,
                cruiseSpeed: v0,
                totalTime: tBrake,
                profile: 'decel_only',
            };
        }

        // Normal forward approach from v0 >= 0
        return ManeuverPlanner.plan1DForward(d, v0, vMax, a, dir);
    }

    /**
     * Forward-moving 1D profile (v0 >= 0, moving toward target).
     */
    private static plan1DForward(
        d: number,
        v0: number,
        vMax: number,
        a: number,
        dir: Vec3Like,
    ): ManeuverPlan {
        // Distance to accelerate from v0 to vMax
        const dAccelToMax = (vMax * vMax - v0 * v0) / (2 * a);
        // Distance to decelerate from vMax to 0
        const dDecelFromMax = (vMax * vMax) / (2 * a);

        if (dAccelToMax + dDecelFromMax <= d) {
            // ── TRAPEZOIDAL: accel → coast → decel ────────────────────
            const tAccel = (vMax - v0) / a;
            const dCoast = d - dAccelToMax - dDecelFromMax;
            const tCoast = dCoast / vMax;
            const tDecel = vMax / a;
            return {
                direction: dir,
                accelMag: a,
                burnAccelTime: tAccel,
                coastTime: tCoast,
                burnDecelTime: tDecel,
                cruiseSpeed: vMax,
                totalTime: tAccel + tCoast + tDecel,
                profile: 'trapezoidal',
            };
        }

        // ── TRIANGULAR: accel → decel (no coast) ──────────────────────
        // Peak velocity: v_peak where d = (v_peak² - v0²)/(2a) + v_peak²/(2a)
        // Solving: d = (2·v_peak² - v0²) / (2a)  →  v_peak = sqrt(a·d + v0²/2)
        const vPeak = Math.sqrt(Math.max(0, a * d + (v0 * v0) / 2));
        const vCruise = Math.min(vPeak, vMax);
        const tAccel = Math.max(0, (vCruise - v0) / a);
        const tDecel = vCruise / a;
        return {
            direction: dir,
            accelMag: a,
            burnAccelTime: tAccel,
            coastTime: 0,
            burnDecelTime: tDecel,
            cruiseSpeed: vCruise,
            totalTime: tAccel + tDecel,
            profile: 'triangular',
        };
    }

    /**
     * Compute effective acceleration magnitude along an arbitrary direction,
     * given per-axis acceleration limits.
     * Uses the inverse-norm approach: a_eff = 1 / sqrt( (nx/ax)² + (ny/ay)² + (nz/az)² )
     */
    static effectiveAccelAlongDirection(
        nx: number, ny: number, nz: number,
        caps: Vec3Like,
    ): number {
        const ax = Math.max(EPS, caps.x);
        const ay = Math.max(EPS, caps.y);
        const az = Math.max(EPS, caps.z);
        const invSq = (nx * nx) / (ax * ax) + (ny * ny) / (ay * ay) + (nz * nz) / (az * az);
        if (invSq < EPS) return Math.min(ax, ay, az);
        return 1 / Math.sqrt(invSq);
    }

    /** Zero-distance plan: already at target. */
    private static zeroPlan(): ManeuverPlan {
        return {
            direction: { x: 0, y: 0, z: 1 },
            accelMag: 0,
            burnAccelTime: 0,
            coastTime: 0,
            burnDecelTime: 0,
            cruiseSpeed: 0,
            totalTime: 0,
            profile: 'triangular',
        };
    }
}

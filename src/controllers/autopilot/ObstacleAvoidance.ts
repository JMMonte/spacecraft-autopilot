/**
 * ObstacleAvoidance — Tangent-point waypoint computation.
 *
 * Given a start, goal, and list of spherical obstacles, computes the minimum-detour
 * waypoints that route around any blocking obstacles. Pure geometry, O(n) per obstacle.
 *
 * This replaces the voxel-grid A* pathfinder for obstacle avoidance — it's simpler,
 * works at any scale (asteroids to spacecraft), and produces fuel-optimal detours.
 */

import * as THREE from 'three';

export interface Obstacle {
    position: THREE.Vector3;
    radius: number;
}

// Module-level scratch vectors — reused across calls to avoid per-frame allocations.
// Each function uses a distinct set so concurrent (nested) usage does not collide.
const _caw_dir = new THREE.Vector3();
const _caw_pathDir = new THREE.Vector3();
const _caw_toObs = new THREE.Vector3();
const _caw_projPoint = new THREE.Vector3();
const _caw_perpVec = new THREE.Vector3();

const _ctp_toCenter = new THREE.Vector3();
const _ctp_toCenterDir = new THREE.Vector3();
const _ctp_perpComponent = new THREE.Vector3();
const _ctp_tangentDir = new THREE.Vector3();

const _fap_up = new THREE.Vector3();
const _fap_result = new THREE.Vector3();

const _ipb_dir = new THREE.Vector3();
const _ipb_toObs = new THREE.Vector3();
const _ipb_projPoint = new THREE.Vector3();

/**
 * Compute avoidance waypoints around spherical obstacles.
 *
 * For each obstacle that blocks the straight-line path:
 * 1. Project the obstacle center onto the start→goal line
 * 2. Compute the perpendicular offset direction
 * 3. Place a waypoint at the tangent point on the safety sphere
 *
 * @param start       Start position
 * @param goal        Goal position
 * @param obstacles   Spherical obstacles {position, radius}
 * @param craftRadius Spacecraft bounding radius
 * @param safetyFactor Extra clearance multiplier (default 1.5)
 * @returns Ordered waypoints from start to goal (includes start and goal)
 */
export function computeAvoidanceWaypoints(
    start: THREE.Vector3,
    goal: THREE.Vector3,
    obstacles: Obstacle[],
    craftRadius: number,
    safetyFactor: number = 2.0,
): THREE.Vector3[] {
    _caw_dir.subVectors(goal, start);
    const pathLength = _caw_dir.length();
    if (pathLength < 1e-6) return [start.clone(), goal.clone()];
    _caw_pathDir.copy(_caw_dir).multiplyScalar(1 / pathLength);

    // Find all blocking obstacles along the path
    const blockers: Array<{
        obstacle: Obstacle;
        safeR: number;        // safety sphere radius
        projT: number;        // projection parameter along path [0,1]
        perpDist: number;     // perpendicular distance from path to center
        perpDir: THREE.Vector3; // perpendicular direction (away from center) — cloned, owned by blocker
    }> = [];

    for (const obs of obstacles) {
        const safeR = obs.radius + craftRadius * safetyFactor;

        // Project obstacle center onto path line
        _caw_toObs.subVectors(obs.position, start);
        const projT = _caw_toObs.dot(_caw_pathDir) / pathLength; // 0=start, 1=goal

        // Skip if obstacle is entirely behind start or past goal (with margin)
        if (projT < -safeR / pathLength || projT > 1 + safeR / pathLength) continue;

        // Perpendicular distance from path line to obstacle center
        _caw_projPoint.copy(start).addScaledVector(_caw_pathDir, projT * pathLength);
        _caw_perpVec.subVectors(obs.position, _caw_projPoint);
        const perpDist = _caw_perpVec.length();

        // Only blocking if the path passes within the safety sphere
        if (perpDist >= safeR) continue;

        // Perpendicular direction (pointing away from obstacle center, toward detour side)
        // Must clone here because perpDir is stored per-blocker and used later
        const perpDir = perpDist > 1e-6
            ? _caw_perpVec.clone().multiplyScalar(-1 / perpDist) // away from obstacle
            : findArbitraryPerp(_caw_pathDir); // obstacle is exactly on the line

        blockers.push({ obstacle: obs, safeR, projT, perpDist, perpDir });
    }

    if (blockers.length === 0) return [start.clone(), goal.clone()];

    // Sort blockers by projection along path
    blockers.sort((a, b) => a.projT - b.projT);

    // Generate 2 tangent waypoints per blocker — smooth V-shaped detour.
    // The two points are where straight lines from start and goal are tangent
    // to the obstacle's safety sphere. No entry/exit zigzag.
    const waypoints: THREE.Vector3[] = [start.clone()];

    for (const b of blockers) {
        const center = b.obstacle.position;
        const safeR = b.safeR;

        // Tangent point from start: where the line from start touches the safety sphere
        const tangentFromStart = computeTangentPoint(start, center, safeR, b.perpDir);
        // Tangent point from goal: where the line from goal touches the safety sphere
        const tangentFromGoal = computeTangentPoint(goal, center, safeR, b.perpDir);

        waypoints.push(tangentFromStart);

        // The chord between tangent points can cut inside the safety sphere.
        // Add an arc midpoint on the sphere surface to keep the path outside.
        const chordMid = new THREE.Vector3().addVectors(tangentFromStart, tangentFromGoal).multiplyScalar(0.5);
        const midToCenter = new THREE.Vector3().subVectors(chordMid, center);
        const midDist = midToCenter.length();
        if (midDist < safeR - 0.01) {
            // Chord midpoint is inside the sphere — push it out to the sphere surface
            if (midDist > 1e-6) {
                midToCenter.multiplyScalar(safeR / midDist);
            } else {
                // Degenerate: use perpDir
                midToCenter.copy(b.perpDir).multiplyScalar(safeR);
            }
            const arcMid = new THREE.Vector3().copy(center).add(midToCenter);
            waypoints.push(arcMid);
        }

        waypoints.push(tangentFromGoal);
    }

    waypoints.push(goal.clone());

    // Remove duplicate/near waypoints
    return deduplicateWaypoints(waypoints, craftRadius);
}


/**
 * Compute the tangent point on a safety sphere as seen from a viewpoint.
 * This is where a straight line from `viewpoint` just grazes the sphere.
 * The result lies on the sphere surface, on the `perpDir` side.
 */
function computeTangentPoint(
    viewpoint: THREE.Vector3,
    center: THREE.Vector3,
    radius: number,
    perpDir: THREE.Vector3,
): THREE.Vector3 {
    _ctp_toCenter.subVectors(center, viewpoint);
    const dist = _ctp_toCenter.length();

    if (dist <= radius) {
        // Viewpoint is inside the sphere — push directly out
        // Must return a new vector since caller owns the result
        return new THREE.Vector3().copy(center).addScaledVector(perpDir, radius);
    }

    // Angle of the tangent line: sin(θ) = r/d
    const sinTheta = radius / dist;
    const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);

    // The tangent point lies along the direction from viewpoint to center,
    // rotated by θ toward the perpDir side.
    _ctp_toCenterDir.copy(_ctp_toCenter).multiplyScalar(1 / dist);

    // Project perpDir onto the plane perpendicular to toCenter
    _ctp_perpComponent.copy(perpDir);
    _ctp_perpComponent.addScaledVector(_ctp_toCenterDir, -perpDir.dot(_ctp_toCenterDir));
    const perpLen = _ctp_perpComponent.length();
    if (perpLen > 1e-6) _ctp_perpComponent.multiplyScalar(1 / perpLen);

    // Tangent direction = cosθ * toCenter + sinθ * perpComponent
    _ctp_tangentDir.copy(_ctp_toCenterDir).multiplyScalar(cosTheta)
        .addScaledVector(_ctp_perpComponent, sinTheta);

    // The tangent point on the sphere: project from viewpoint along tangent direction
    // Distance to tangent point: d * cosθ
    const tangentDist = dist * cosTheta;
    // Must return a new vector since caller owns the result
    return new THREE.Vector3().copy(viewpoint).addScaledVector(_ctp_tangentDir, tangentDist);
}

/** Find an arbitrary vector perpendicular to the given direction. Returns a new vector (caller owns). */
function findArbitraryPerp(dir: THREE.Vector3): THREE.Vector3 {
    if (Math.abs(dir.y) < 0.9) _fap_up.set(0, 1, 0);
    else _fap_up.set(1, 0, 0);
    _fap_result.crossVectors(dir, _fap_up).normalize();
    return _fap_result.clone();
}

/** Remove waypoints that are nearly identical. */
function deduplicateWaypoints(points: THREE.Vector3[], _craftRadius: number): THREE.Vector3[] {
    if (points.length <= 2) return points;
    const minDist = 0.5; // 0.5m — only remove truly duplicate points
    const out: THREE.Vector3[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        if (points[i].distanceTo(out[out.length - 1]) > minDist) {
            out.push(points[i]);
        }
    }
    out.push(points[points.length - 1]); // always include goal
    return out;
}

/**
 * Quick check: does the straight line from start to goal intersect any obstacle's safety sphere?
 */
export function isPathBlocked(
    start: THREE.Vector3,
    goal: THREE.Vector3,
    obstacles: Obstacle[],
    craftRadius: number,
    safetyFactor: number = 2.0,
): boolean {
    _ipb_dir.subVectors(goal, start);
    const pathLength = _ipb_dir.length();
    if (pathLength < 1e-6) return false;
    _ipb_dir.multiplyScalar(1 / pathLength);

    for (const obs of obstacles) {
        const safeR = obs.radius + craftRadius * safetyFactor;
        _ipb_toObs.subVectors(obs.position, start);
        const projDist = _ipb_toObs.dot(_ipb_dir);

        // Skip if behind start or past goal
        if (projDist < -safeR || projDist > pathLength + safeR) continue;

        // Perpendicular distance
        _ipb_projPoint.copy(start).addScaledVector(_ipb_dir, projDist);
        const perpDist = _ipb_projPoint.distanceTo(obs.position);

        if (perpDist < safeR) return true;
    }
    return false;
}

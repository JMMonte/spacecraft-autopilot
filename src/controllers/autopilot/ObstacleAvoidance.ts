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
    safetyFactor: number = 1.5,
): THREE.Vector3[] {
    const dir = new THREE.Vector3().subVectors(goal, start);
    const pathLength = dir.length();
    if (pathLength < 1e-6) return [start.clone(), goal.clone()];
    const pathDir = dir.clone().multiplyScalar(1 / pathLength);

    // Find all blocking obstacles along the path
    const blockers: Array<{
        obstacle: Obstacle;
        safeR: number;        // safety sphere radius
        projT: number;        // projection parameter along path [0,1]
        perpDist: number;     // perpendicular distance from path to center
        perpDir: THREE.Vector3; // perpendicular direction (away from center)
    }> = [];

    for (const obs of obstacles) {
        const safeR = obs.radius + craftRadius * safetyFactor;

        // Project obstacle center onto path line
        const toObs = new THREE.Vector3().subVectors(obs.position, start);
        const projT = toObs.dot(pathDir) / pathLength; // 0=start, 1=goal

        // Skip if obstacle is entirely behind start or past goal (with margin)
        if (projT < -safeR / pathLength || projT > 1 + safeR / pathLength) continue;

        // Perpendicular distance from path line to obstacle center
        const projPoint = new THREE.Vector3().copy(start).addScaledVector(pathDir, projT * pathLength);
        const perpVec = new THREE.Vector3().subVectors(obs.position, projPoint);
        const perpDist = perpVec.length();

        // Only blocking if the path passes within the safety sphere
        if (perpDist >= safeR) continue;

        // Perpendicular direction (pointing away from obstacle center, toward detour side)
        const perpDir = perpDist > 1e-6
            ? perpVec.clone().multiplyScalar(-1 / perpDist) // away from obstacle
            : findArbitraryPerp(pathDir); // obstacle is exactly on the line

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

        waypoints.push(tangentFromStart, tangentFromGoal);
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
    const toCenter = new THREE.Vector3().subVectors(center, viewpoint);
    const dist = toCenter.length();

    if (dist <= radius) {
        // Viewpoint is inside the sphere — push directly out
        return new THREE.Vector3().copy(center).addScaledVector(perpDir, radius);
    }

    // Angle of the tangent line: sin(θ) = r/d
    const sinTheta = radius / dist;
    const cosTheta = Math.sqrt(1 - sinTheta * sinTheta);

    // The tangent point lies along the direction from viewpoint to center,
    // rotated by θ toward the perpDir side.
    const toCenterDir = toCenter.clone().multiplyScalar(1 / dist);

    // Project perpDir onto the plane perpendicular to toCenter
    const perpComponent = new THREE.Vector3().copy(perpDir);
    perpComponent.addScaledVector(toCenterDir, -perpDir.dot(toCenterDir));
    const perpLen = perpComponent.length();
    if (perpLen > 1e-6) perpComponent.multiplyScalar(1 / perpLen);

    // Tangent direction = cosθ * toCenter + sinθ * perpComponent
    const tangentDir = toCenterDir.clone().multiplyScalar(cosTheta)
        .addScaledVector(perpComponent, sinTheta);

    // The tangent point on the sphere: project from viewpoint along tangent direction
    // Distance to tangent point: d * cosθ
    const tangentDist = dist * cosTheta;
    return new THREE.Vector3().copy(viewpoint).addScaledVector(tangentDir, tangentDist);
}

/** Find an arbitrary vector perpendicular to the given direction. */
function findArbitraryPerp(dir: THREE.Vector3): THREE.Vector3 {
    const up = Math.abs(dir.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3().crossVectors(dir, up).normalize();
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
    safetyFactor: number = 1.5,
): boolean {
    const dir = new THREE.Vector3().subVectors(goal, start);
    const pathLength = dir.length();
    if (pathLength < 1e-6) return false;
    const pathDir = dir.multiplyScalar(1 / pathLength);

    for (const obs of obstacles) {
        const safeR = obs.radius + craftRadius * safetyFactor;
        const toObs = new THREE.Vector3().subVectors(obs.position, start);
        const projDist = toObs.dot(pathDir);

        // Skip if behind start or past goal
        if (projDist < -safeR || projDist > pathLength + safeR) continue;

        // Perpendicular distance
        const projPoint = new THREE.Vector3().copy(start).addScaledVector(pathDir, projDist);
        const perpDist = projPoint.distanceTo(obs.position);

        if (perpDist < safeR) return true;
    }
    return false;
}

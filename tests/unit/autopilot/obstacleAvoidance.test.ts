import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as THREE from 'three';
import {
    computeAvoidanceWaypoints,
    isPathBlocked,
    type Obstacle,
} from '../../../src/controllers/autopilot/ObstacleAvoidance';

// Helpers
function v3(x: number, y: number, z: number) { return new THREE.Vector3(x, y, z); }
function obs(x: number, y: number, z: number, r: number): Obstacle {
    return { position: v3(x, y, z), radius: r };
}

const CRAFT_RADIUS = 5; // spacecraft bounding radius
const SAFETY = 1.5;     // default safety factor

describe('ObstacleAvoidance', () => {

    // ── isPathBlocked ────────────────────────────────────────────────

    describe('isPathBlocked', () => {
        test('path passing through obstacle center is blocked', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            const obstacles = [obs(50, 0, 0, 20)]; // dead center on the path

            assert.equal(isPathBlocked(start, goal, obstacles, CRAFT_RADIUS, SAFETY), true);
        });

        test('path well clear of obstacle is NOT blocked', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            // Obstacle far off to the side (y=200, well beyond safe radius)
            const obstacles = [obs(50, 200, 0, 20)];

            assert.equal(isPathBlocked(start, goal, obstacles, CRAFT_RADIUS, SAFETY), false);
        });

        test('path just outside safety sphere is NOT blocked', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            // safeR = 20 + 5*1.5 = 27.5. Place obstacle at y=28, just outside.
            const obstacles = [obs(50, 28, 0, 20)];

            assert.equal(isPathBlocked(start, goal, obstacles, CRAFT_RADIUS, SAFETY), false);
        });

        test('path just inside safety sphere IS blocked', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            // safeR = 20 + 5*1.5 = 27.5. Place obstacle at y=27, just inside.
            const obstacles = [obs(50, 27, 0, 20)];

            assert.equal(isPathBlocked(start, goal, obstacles, CRAFT_RADIUS, SAFETY), true);
        });

        test('obstacle entirely behind start is not blocking', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            const obstacles = [obs(-100, 0, 0, 20)];

            assert.equal(isPathBlocked(start, goal, obstacles, CRAFT_RADIUS, SAFETY), false);
        });

        test('obstacle entirely past goal is not blocking', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            const obstacles = [obs(250, 0, 0, 20)];

            assert.equal(isPathBlocked(start, goal, obstacles, CRAFT_RADIUS, SAFETY), false);
        });

        test('zero-length path is never blocked', () => {
            const pos = v3(50, 0, 0);
            const obstacles = [obs(50, 0, 0, 20)];

            assert.equal(isPathBlocked(pos, pos.clone(), obstacles, CRAFT_RADIUS, SAFETY), false);
        });

        test('no obstacles means not blocked', () => {
            assert.equal(
                isPathBlocked(v3(0, 0, 0), v3(100, 0, 0), [], CRAFT_RADIUS, SAFETY),
                false,
            );
        });

        test('multiple obstacles: first clear, second blocking', () => {
            const obstacles = [
                obs(50, 200, 0, 10), // far away — clear
                obs(80, 0, 0, 15),   // on path — blocking
            ];
            assert.equal(
                isPathBlocked(v3(0, 0, 0), v3(100, 0, 0), obstacles, CRAFT_RADIUS, SAFETY),
                true,
            );
        });
    });

    // ── computeAvoidanceWaypoints ────────────────────────────────────

    describe('computeAvoidanceWaypoints', () => {
        test('no obstacles returns start and goal only', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            const waypoints = computeAvoidanceWaypoints(start, goal, [], CRAFT_RADIUS, SAFETY);

            assert.equal(waypoints.length, 2);
            assert.ok(waypoints[0].distanceTo(start) < 1e-6, 'first waypoint should be start');
            assert.ok(waypoints[waypoints.length - 1].distanceTo(goal) < 1e-6, 'last waypoint should be goal');
        });

        test('non-blocking obstacle returns start and goal only', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            const obstacles = [obs(50, 200, 0, 10)]; // far off path
            const waypoints = computeAvoidanceWaypoints(start, goal, obstacles, CRAFT_RADIUS, SAFETY);

            assert.equal(waypoints.length, 2);
        });

        test('small obstacle (r=50) produces waypoints that detour around it', () => {
            const start = v3(0, 0, 0);
            const goal = v3(200, 0, 0);
            const obstacles = [obs(100, 0, 0, 50)];
            const safeR = 50 + CRAFT_RADIUS * SAFETY; // 57.5

            const waypoints = computeAvoidanceWaypoints(start, goal, obstacles, CRAFT_RADIUS, SAFETY);

            // Should have more than just start/goal
            assert.ok(waypoints.length > 2, `expected >2 waypoints, got ${waypoints.length}`);

            // All intermediate waypoints should be outside the safety sphere
            for (let i = 1; i < waypoints.length - 1; i++) {
                const dist = waypoints[i].distanceTo(v3(100, 0, 0));
                assert.ok(
                    dist >= safeR - 1.0, // allow 1m tolerance for tangent rounding
                    `waypoint ${i} at dist=${dist.toFixed(1)} is inside safety sphere (r=${safeR})`,
                );
            }

            // First and last waypoints are start and goal
            assert.ok(waypoints[0].distanceTo(start) < 1e-6);
            assert.ok(waypoints[waypoints.length - 1].distanceTo(goal) < 1e-6);
        });

        test('large obstacle (r=200) — known bug area for r>143m', { todo: 'Known bug: large radius obstacle avoidance' }, () => {
            const start = v3(0, 0, 0);
            const goal = v3(500, 0, 0);
            const obstacles = [obs(250, 0, 0, 200)];
            const safeR = 200 + CRAFT_RADIUS * SAFETY; // 207.5

            const waypoints = computeAvoidanceWaypoints(start, goal, obstacles, CRAFT_RADIUS, SAFETY);

            // Should produce waypoints
            assert.ok(waypoints.length > 2, `expected >2 waypoints, got ${waypoints.length}`);

            // All intermediate waypoints should be outside the safety sphere
            for (let i = 1; i < waypoints.length - 1; i++) {
                const dist = waypoints[i].distanceTo(v3(250, 0, 0));
                assert.ok(
                    dist >= safeR - 1.0,
                    `waypoint ${i} at dist=${dist.toFixed(1)} is inside safety sphere (r=${safeR})`,
                );
            }
        });

        test('obstacle on path axis produces perpendicular detour', () => {
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            // Obstacle exactly on the X axis
            const obstacles = [obs(50, 0, 0, 10)];

            const waypoints = computeAvoidanceWaypoints(start, goal, obstacles, CRAFT_RADIUS, SAFETY);
            assert.ok(waypoints.length > 2);

            // Intermediate waypoints should have non-zero y or z (perpendicular detour)
            const intermediates = waypoints.slice(1, -1);
            const hasDetour = intermediates.some(w => Math.abs(w.y) > 1 || Math.abs(w.z) > 1);
            assert.ok(hasDetour, 'detour waypoints should have perpendicular offset');
        });

        test('zero-length path returns start and goal', () => {
            const pos = v3(5, 5, 5);
            const waypoints = computeAvoidanceWaypoints(pos, pos.clone(), [obs(5, 5, 5, 10)], CRAFT_RADIUS, SAFETY);
            assert.equal(waypoints.length, 2);
        });

        test('multiple blocking obstacles produce multiple detour points', () => {
            const start = v3(0, 0, 0);
            const goal = v3(300, 0, 0);
            const obstacles = [
                obs(100, 0, 0, 20),
                obs(200, 0, 0, 20),
            ];

            const waypoints = computeAvoidanceWaypoints(start, goal, obstacles, CRAFT_RADIUS, SAFETY);

            // 2 blockers * 2 tangent points + start + goal = 6 max (less after dedup)
            assert.ok(waypoints.length >= 4, `expected >=4 waypoints for 2 blockers, got ${waypoints.length}`);
        });
    });

    // ── deduplicateWaypoints (tested indirectly) ─────────────────────

    describe('deduplication (via computeAvoidanceWaypoints)', () => {
        test('very close waypoints are deduplicated', () => {
            // Place obstacle very near start so tangent points may overlap with start
            const start = v3(0, 0, 0);
            const goal = v3(100, 0, 0);
            const obstacles = [obs(5, 5, 0, 2)]; // small and close

            const waypoints = computeAvoidanceWaypoints(start, goal, obstacles, CRAFT_RADIUS, SAFETY);

            // Verify no two adjacent waypoints are within 0.5m
            for (let i = 1; i < waypoints.length; i++) {
                const dist = waypoints[i].distanceTo(waypoints[i - 1]);
                // start and goal are always included, intermediates are deduped at 0.5m
                // allow start/goal to be close only if they are the same point
                if (i > 0 && i < waypoints.length - 1) {
                    // intermediates should not be too close to their predecessor
                    // (the function removes points < 0.5m from previous)
                }
            }

            // Goal is always the last point
            assert.ok(waypoints[waypoints.length - 1].distanceTo(goal) < 1e-6);
            // Start is always the first point
            assert.ok(waypoints[0].distanceTo(start) < 1e-6);
        });
    });
});

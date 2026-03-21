import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ManeuverPlanner } from '../../../src/controllers/autopilot/ManeuverPlanner';

const ACCEL = { x: 2.0, y: 2.0, z: 2.0 }; // 2 m/s² per axis
const V_MAX = 8.0; // m/s

describe('ManeuverPlanner', () => {

    // ── Trapezoidal profiles (long distance) ─────────────────────────

    test('trapezoidal profile for long straight-line maneuver', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, // at rest
            { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, // 100m ahead, stop there
            ACCEL, V_MAX,
        );
        assert.equal(plan.profile, 'trapezoidal');
        assert.ok(plan.burnAccelTime > 0, 'must have accel burn');
        assert.ok(plan.coastTime > 0, 'must have coast phase');
        assert.ok(plan.burnDecelTime > 0, 'must have decel burn');
        assert.ok(Math.abs(plan.cruiseSpeed - V_MAX * 0.9) < 1.0, 'cruise near vMax * efficiency');
        // Verify total time is reasonable: ~100m at ~7m/s ≈ ~14s
        assert.ok(plan.totalTime > 5 && plan.totalTime < 30, `totalTime=${plan.totalTime}`);
    });

    test('trapezoidal coast fraction is significant for long distances', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            { x: 200, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            ACCEL, V_MAX,
        );
        assert.equal(plan.profile, 'trapezoidal');
        const coastFraction = plan.coastTime / plan.totalTime;
        assert.ok(coastFraction > 0.3, `coast should be >30% of maneuver, got ${(coastFraction * 100).toFixed(1)}%`);
    });

    // ── Triangular profiles (short distance) ─────────────────────────

    test('triangular profile for short distance', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            ACCEL, V_MAX,
        );
        assert.equal(plan.profile, 'triangular');
        assert.ok(plan.burnAccelTime > 0, 'must have accel burn');
        assert.equal(plan.coastTime, 0, 'no coast for short distances');
        assert.ok(plan.burnDecelTime > 0, 'must have decel burn');
    });

    test('triangular profile peak velocity is below vMax', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            { x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            ACCEL, V_MAX,
        );
        assert.ok(plan.cruiseSpeed < V_MAX, 'peak speed should be less than vMax for short maneuvers');
    });

    // ── Decel-only profile (already moving too fast) ─────────────────

    test('decel-only when already overshooting', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, // moving at 5 m/s
            { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },  // only 2m away
            ACCEL, V_MAX,
        );
        assert.equal(plan.profile, 'decel_only');
        assert.equal(plan.burnAccelTime, 0, 'no accel burn needed');
        assert.equal(plan.coastTime, 0, 'no coast');
        assert.ok(plan.burnDecelTime > 0, 'must brake');
    });

    // ── Moving away from target ──────────────────────────────────────

    test('handles spacecraft moving away from target', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }, // moving away at 3 m/s
            { x: 50, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            ACCEL, V_MAX,
        );
        assert.ok(plan.burnAccelTime > 0, 'must burn to reverse and then accelerate');
        assert.ok(plan.totalTime > 0);
    });

    // ── Zero distance ────────────────────────────────────────────────

    test('zero distance produces zero plan', () => {
        const plan = ManeuverPlanner.plan(
            { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            ACCEL, V_MAX,
        );
        assert.equal(plan.totalTime, 0);
        assert.equal(plan.burnAccelTime, 0);
        assert.equal(plan.coastTime, 0);
        assert.equal(plan.burnDecelTime, 0);
    });

    // ── 3D diagonal ──────────────────────────────────────────────────

    test('3D diagonal maneuver produces valid plan', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            { x: 30, y: 40, z: 0 }, { x: 0, y: 0, z: 0 }, // 50m diagonal
            ACCEL, V_MAX,
        );
        assert.ok(plan.totalTime > 0);
        // Direction should point toward target
        const dirLen = Math.sqrt(plan.direction.x ** 2 + plan.direction.y ** 2 + plan.direction.z ** 2);
        assert.ok(Math.abs(dirLen - 1) < 0.001, 'direction must be unit vector');
        assert.ok(plan.direction.x > 0 && plan.direction.y > 0, 'should point toward +x,+y');
    });

    // ── Effective acceleration ────────────────────────────────────────

    test('effectiveAccelAlongDirection uses axis limits correctly', () => {
        // Along X axis with x-cap of 2
        const aX = ManeuverPlanner.effectiveAccelAlongDirection(1, 0, 0, { x: 2, y: 5, z: 5 });
        assert.ok(Math.abs(aX - 2) < 0.01, `along X should be ~2, got ${aX}`);

        // Along Y axis with y-cap of 3
        const aY = ManeuverPlanner.effectiveAccelAlongDirection(0, 1, 0, { x: 5, y: 3, z: 5 });
        assert.ok(Math.abs(aY - 3) < 0.01, `along Y should be ~3, got ${aY}`);

        // Diagonal: effective should be less than any single axis
        const aDiag = ManeuverPlanner.effectiveAccelAlongDirection(
            1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3),
            { x: 2, y: 2, z: 2 }
        );
        assert.ok(Math.abs(aDiag - 2) < 0.01, `equal-axis diagonal should be ~2, got ${aDiag}`);
    });

    // ── Target velocity (rendezvous) ─────────────────────────────────

    test('plan with non-zero target velocity adjusts for rendezvous', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            { x: 50, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, // target moving at 2 m/s
            ACCEL, V_MAX,
        );
        assert.ok(plan.totalTime > 0);
        assert.ok(plan.cruiseSpeed > 0);
    });

    // ── Consistency checks ───────────────────────────────────────────

    test('burn times are non-negative', () => {
        const scenarios = [
            { from: { x: 0, y: 0, z: 0 }, to: { x: 100, y: 0, z: 0 } },
            { from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 } },
            { from: { x: 0, y: 0, z: 0 }, to: { x: 30, y: 40, z: 50 } },
        ];
        for (const s of scenarios) {
            const plan = ManeuverPlanner.plan(
                s.from, { x: 0, y: 0, z: 0 }, s.to, { x: 0, y: 0, z: 0 },
                ACCEL, V_MAX,
            );
            assert.ok(plan.burnAccelTime >= 0, `burnAccelTime negative for ${JSON.stringify(s)}`);
            assert.ok(plan.coastTime >= 0, `coastTime negative for ${JSON.stringify(s)}`);
            assert.ok(plan.burnDecelTime >= 0, `burnDecelTime negative for ${JSON.stringify(s)}`);
            assert.ok(plan.totalTime >= 0, `totalTime negative for ${JSON.stringify(s)}`);
        }
    });

    test('total time equals sum of phases', () => {
        const plan = ManeuverPlanner.plan(
            { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            { x: 80, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
            ACCEL, V_MAX,
        );
        const sum = plan.burnAccelTime + plan.coastTime + plan.burnDecelTime;
        assert.ok(Math.abs(plan.totalTime - sum) < 0.001,
            `totalTime=${plan.totalTime} != sum=${sum}`);
    });
});

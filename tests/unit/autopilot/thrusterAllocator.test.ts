import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import * as THREE from 'three';
import { ThrusterAllocator } from '../../../src/controllers/autopilot/ThrusterAllocator';
import type { ThrusterGroups } from '../../../src/config/spacecraftConfig';
import type { CapabilitySet } from '../../../src/controllers/autopilot/CapabilityCalculator';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const NUM_THRUSTERS = 24;
const THRUST = 100; // per-thruster max thrust
const EPSILON = 0.001;

/** Simple thruster groups: 2 thrusters per direction. */
function makeThrusterGroups(): ThrusterGroups {
    return {
        pitch:   [[0, 1], [2, 3]],       // [pitchUp, pitchDown]
        yaw:     [[4, 5], [6, 7]],       // [yawLeft, yawRight]
        roll:    [[8, 9], [10, 11]],      // [rollRight, rollLeft]
        forward: [[12, 13], [14, 15]],    // [+Z, -Z]
        up:      [[16, 17], [18, 19]],    // [+Y, -Y]
        left:    [[20, 21], [22, 23]],    // [-X, +X]
    };
}

function makeThrusterMax(): number[] {
    return new Array(NUM_THRUSTERS).fill(THRUST);
}

function makeCaps(): CapabilitySet {
    return {
        linForce: { x: 200, y: 200, z: 200 },
        linAccel: { x: 2, y: 2, z: 2 },
        inertia: { x: 1000, y: 1000, z: 1000 },
        angTorque: { x: 200, y: 200, z: 200 },
        angAccel: { x: 2, y: 2, z: 2 },
    };
}

function makeAllocator(overrides?: {
    alpha?: number;
    linAlpha?: number;
}): ThrusterAllocator {
    const alloc = new ThrusterAllocator(
        makeThrusterGroups(),
        THRUST,
        makeThrusterMax(),
        EPSILON,
        makeCaps,
    );
    // Disable smoothing for deterministic tests unless specified
    alloc.setRotSmoothAlpha(overrides?.alpha ?? 0);
    alloc.setLinSmoothAlpha(overrides?.linAlpha ?? 0);
    return alloc;
}

function zeroOut(): number[] {
    return new Array(NUM_THRUSTERS).fill(0);
}

describe('ThrusterAllocator', () => {

    // ── Rotation allocation ──────────────────────────────────────────

    describe('allocateRotation', () => {
        test('positive yaw (Y) activates yawLeft group (index 0)', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            // Positive Y command -> yaw[0] = [4, 5]
            alloc.allocateRotation(new THREE.Vector3(0, 50, 0), out);

            assert.ok(out[4] > 0, `thruster 4 should fire, got ${out[4]}`);
            assert.ok(out[5] > 0, `thruster 5 should fire, got ${out[5]}`);
            // Opposite yaw group should be zero
            assert.equal(out[6], 0);
            assert.equal(out[7], 0);
        });

        test('negative yaw (Y) activates yawRight group (index 1)', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(0, -50, 0), out);

            assert.ok(out[6] > 0, `thruster 6 should fire, got ${out[6]}`);
            assert.ok(out[7] > 0, `thruster 7 should fire, got ${out[7]}`);
            assert.equal(out[4], 0);
            assert.equal(out[5], 0);
        });

        test('positive pitch (X) activates pitchDown group (index 1)', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            // Positive X command -> pitch[1] = [2, 3]
            alloc.allocateRotation(new THREE.Vector3(50, 0, 0), out);

            assert.ok(out[2] > 0, `thruster 2 should fire`);
            assert.ok(out[3] > 0, `thruster 3 should fire`);
            assert.equal(out[0], 0);
            assert.equal(out[1], 0);
        });

        test('negative pitch (X) activates pitchUp group (index 0)', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(-50, 0, 0), out);

            assert.ok(out[0] > 0, `thruster 0 should fire`);
            assert.ok(out[1] > 0, `thruster 1 should fire`);
        });

        test('positive roll (Z) activates rollRight group (index 0)', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(0, 0, 50), out);

            assert.ok(out[8] > 0, `thruster 8 should fire`);
            assert.ok(out[9] > 0, `thruster 9 should fire`);
            assert.equal(out[10], 0);
            assert.equal(out[11], 0);
        });

        test('zero input produces zero output', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(0, 0, 0), out);

            for (let i = 0; i < NUM_THRUSTERS; i++) {
                assert.equal(out[i], 0, `thruster ${i} should be 0`);
            }
        });

        test('input below epsilon threshold produces zero output', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            // epsilon*2 = 0.002, so 0.001 is below threshold
            alloc.allocateRotation(new THREE.Vector3(0.001, 0.001, 0.001), out);

            for (let i = 0; i < NUM_THRUSTERS; i++) {
                assert.equal(out[i], 0, `thruster ${i} should be 0`);
            }
        });

        test('thrust values are capped at thruster maximum', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            // Very large command that would exceed per-thruster cap
            alloc.allocateRotation(new THREE.Vector3(0, 1e6, 0), out);

            // Thrusters 4, 5 should fire but not exceed THRUST
            assert.ok(out[4] <= THRUST, `thruster 4 should be <= ${THRUST}, got ${out[4]}`);
            assert.ok(out[5] <= THRUST, `thruster 5 should be <= ${THRUST}, got ${out[5]}`);
        });

        test('combined axes activate multiple groups', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(50, 50, 50), out);

            // Pitch positive -> group [2,3]
            assert.ok(out[2] > 0);
            // Yaw positive -> group [4,5]
            assert.ok(out[4] > 0);
            // Roll positive -> group [8,9]
            assert.ok(out[8] > 0);
        });
    });

    // ── Translation allocation ───────────────────────────────────────

    describe('allocateTranslation', () => {
        test('positive Z (forward) activates forward[0] group', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateTranslation(new THREE.Vector3(0, 0, 50), out);

            assert.ok(out[12] > 0, `thruster 12 should fire`);
            assert.ok(out[13] > 0, `thruster 13 should fire`);
            assert.equal(out[14], 0);
            assert.equal(out[15], 0);
        });

        test('negative Z (backward) activates forward[1] group', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateTranslation(new THREE.Vector3(0, 0, -50), out);

            assert.ok(out[14] > 0, `thruster 14 should fire`);
            assert.ok(out[15] > 0, `thruster 15 should fire`);
        });

        test('positive Y (up) activates up[0] group', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateTranslation(new THREE.Vector3(0, 50, 0), out);

            assert.ok(out[16] > 0, `thruster 16 should fire`);
            assert.ok(out[17] > 0, `thruster 17 should fire`);
        });

        test('negative Y (down) activates up[1] group', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateTranslation(new THREE.Vector3(0, -50, 0), out);

            assert.ok(out[18] > 0, `thruster 18 should fire`);
            assert.ok(out[19] > 0, `thruster 19 should fire`);
        });

        test('positive X activates left[1] group (sign inversion)', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            // X axis has positive: false, so positive val * -1 < 0 => groups[1]
            alloc.allocateTranslation(new THREE.Vector3(50, 0, 0), out);

            assert.ok(out[22] > 0 || out[23] > 0, 'left[1] group should fire for positive X');
        });

        test('negative X activates left[0] group', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            // negative val * -1 > 0 => groups[0]
            alloc.allocateTranslation(new THREE.Vector3(-50, 0, 0), out);

            assert.ok(out[20] > 0 || out[21] > 0, 'left[0] group should fire for negative X');
        });

        test('zero input produces zero output', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateTranslation(new THREE.Vector3(0, 0, 0), out);

            for (let i = 0; i < NUM_THRUSTERS; i++) {
                assert.equal(out[i], 0, `thruster ${i} should be 0`);
            }
        });

        test('thrust values are capped at per-thruster maximum', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            // Extremely large force
            alloc.allocateTranslation(new THREE.Vector3(0, 0, 1e6), out);

            for (let i = 0; i < NUM_THRUSTERS; i++) {
                assert.ok(out[i] <= THRUST, `thruster ${i} should be <= ${THRUST}, got ${out[i]}`);
            }
        });
    });

    // ── Smoothing ────────────────────────────────────────────────────

    describe('smoothing', () => {
        test('rotation smoothing: output changes gradually with alpha > 0', () => {
            const alloc = makeAllocator({ alpha: 0.5 });
            const out1 = zeroOut();
            const out2 = zeroOut();

            // First call: smoothed = 0 * 0.5 + command * 0.5 = half of command
            alloc.allocateRotation(new THREE.Vector3(0, 100, 0), out1);

            // Second call with zero: smoothed = prev * 0.5 + 0 * 0.5 = half of prev
            alloc.allocateRotation(new THREE.Vector3(0, 0, 0), out2);

            // The yaw group should still have some residual thrust from smoothing
            // (if the smoothed value is still above epsilon)
            // First call: smoothed.y = 0*0.5 + 100*0.5 = 50
            // Second call: smoothed.y = 50*0.5 + 0*0.5 = 25
            // Both are above eps*2 = 0.002
            assert.ok(out1[4] > 0, 'first call should fire yaw thrusters');
            assert.ok(out2[4] > 0, 'second call should still fire due to smoothing');
            assert.ok(out2[4] < out1[4], 'second call should be weaker than first');
        });

        test('translation smoothing: output changes gradually with alpha > 0', () => {
            const alloc = makeAllocator({ linAlpha: 0.5 });
            const out1 = zeroOut();
            const out2 = zeroOut();

            alloc.allocateTranslation(new THREE.Vector3(0, 0, 100), out1);
            alloc.allocateTranslation(new THREE.Vector3(0, 0, 0), out2);

            assert.ok(out1[12] > 0, 'first call should fire forward thrusters');
            assert.ok(out2[12] > 0, 'second call should still fire due to smoothing');
            assert.ok(out2[12] < out1[12], 'second call should be weaker');
        });

        test('resetSmoothing clears smoothing state', () => {
            const alloc = makeAllocator({ alpha: 0.9 }); // heavy smoothing
            const out1 = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(0, 100, 0), out1);
            alloc.resetSmoothing();

            const out2 = zeroOut();
            alloc.allocateRotation(new THREE.Vector3(0, 0, 0), out2);

            // After reset + zero command, no residual
            assert.equal(out2[4], 0, 'after reset, zero command should produce zero output');
            assert.equal(out2[5], 0);
        });
    });

    // ── Allocation scale ─────────────────────────────────────────────

    describe('allocationScale', () => {
        test('scale=0.5 reduces thrust by half', () => {
            const alloc = makeAllocator();
            const outFull = zeroOut();
            const outHalf = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(0, 100, 0), outFull);

            alloc.resetSmoothing();
            alloc.setAllocationScale(0.5);
            alloc.allocateRotation(new THREE.Vector3(0, 100, 0), outHalf);

            assert.ok(outFull[4] > 0);
            assert.ok(
                Math.abs(outHalf[4] - outFull[4] * 0.5) < 1,
                `half-scale should be ~half of full: ${outHalf[4]} vs ${outFull[4] * 0.5}`,
            );
        });

        test('scale is clamped to [0, 1]', () => {
            const alloc = makeAllocator();
            alloc.setAllocationScale(2.0);
            const out = zeroOut();
            alloc.allocateRotation(new THREE.Vector3(0, 100, 0), out);
            // Scale should be clamped to 1.0, so output is same as default
            assert.ok(out[4] > 0);
            assert.ok(out[4] <= THRUST);
        });
    });

    // ── Accumulation ─────────────────────────────────────────────────

    describe('accumulation into output array', () => {
        test('multiple allocateRotation calls accumulate into same array', () => {
            const alloc = makeAllocator();
            const out = zeroOut();

            alloc.allocateRotation(new THREE.Vector3(50, 0, 0), out);
            const afterFirst = out[2]; // pitch positive

            alloc.resetSmoothing();
            alloc.allocateRotation(new THREE.Vector3(50, 0, 0), out);

            assert.ok(out[2] > afterFirst, 'second call should add to first');
        });
    });
});

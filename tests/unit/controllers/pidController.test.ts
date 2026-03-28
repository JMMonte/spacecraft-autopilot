import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import * as THREE from 'three';
import { PIDController } from '../../../src/controllers/pidController';

// Helpers
function v3(x = 0, y = 0, z = 0) { return new THREE.Vector3(x, y, z); }

describe('PIDController', () => {
    let pid: PIDController;

    beforeEach(() => {
        // kp=1, ki=0, kd=0 — pure P controller by default
        pid = new PIDController(1, 0, 0);
    });

    // ── Proportional term ────────────────────────────────────────────

    describe('P term', () => {
        test('output is proportional to error', () => {
            const out = pid.update(v3(2, 0, 0), 0.1);
            // kp=1, so output.x should equal error.x = 2
            assert.ok(Math.abs(out.x - 2) < 1e-6, `expected ~2, got ${out.x}`);
            assert.ok(Math.abs(out.y) < 1e-6);
            assert.ok(Math.abs(out.z) < 1e-6);
        });

        test('output scales with kp', () => {
            const pid2 = new PIDController(3, 0, 0);
            const out = pid2.update(v3(1, 2, 3), 0.1);
            assert.ok(Math.abs(out.x - 3) < 1e-6, `expected 3, got ${out.x}`);
            assert.ok(Math.abs(out.y - 6) < 1e-6, `expected 6, got ${out.y}`);
            assert.ok(Math.abs(out.z - 9) < 1e-6, `expected 9, got ${out.z}`);
        });

        test('negative error produces negative output', () => {
            const out = pid.update(v3(-5, 0, 0), 0.1);
            assert.ok(out.x < 0, `expected negative, got ${out.x}`);
            assert.ok(Math.abs(out.x - (-5)) < 1e-6);
        });
    });

    // ── Integral term ────────────────────────────────────────────────

    describe('I term', () => {
        test('integral accumulates over repeated updates', () => {
            const pidI = new PIDController(0, 1, 0); // pure I controller
            const dt = 0.1;
            const error = v3(1, 0, 0);

            pidI.update(error, dt);
            const out2 = pidI.update(error, dt);

            // After 2 updates: integral = error * dt * 2 = 0.2
            // output = ki * integral = 1 * 0.2 = 0.2
            assert.ok(Math.abs(out2.x - 0.2) < 1e-6, `expected ~0.2, got ${out2.x}`);
        });

        test('integral is clamped by maxIntegral', () => {
            const pidI = new PIDController(0, 1, 0);
            pidI.setMaxIntegral(0.5);
            const dt = 1.0;
            const error = v3(10, 0, 0);

            // Single update: integral = 10*1 = 10, but clamped to 0.5
            const out = pidI.update(error, dt);
            // output = ki * clamped_integral = 1 * 0.5 = 0.5
            assert.ok(Math.abs(out.x - 0.5) < 1e-6, `expected 0.5, got ${out.x}`);
        });

        test('integral clamp works for multi-axis errors', () => {
            const pidI = new PIDController(0, 1, 0);
            pidI.setMaxIntegral(1.0);
            const dt = 1.0;
            const error = v3(10, 10, 10); // magnitude = 10*sqrt(3) >> 1

            const out = pidI.update(error, dt);
            // integral magnitude clamped to 1.0, then output = ki * integral
            const outMag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
            assert.ok(Math.abs(outMag - 1.0) < 1e-6, `expected magnitude ~1.0, got ${outMag}`);
        });
    });

    // ── Derivative term ──────────────────────────────────────────────

    describe('D term', () => {
        test('derivative responds to change in error', () => {
            const pidD = new PIDController(0, 0, 1); // pure D controller
            pidD.setDerivativeAlpha(0); // no filtering — raw derivative

            // First update: lastError = 0, so derivative = (error - 0) / dt
            pidD.update(v3(0, 0, 0), 0.1);

            // Second update: error changes from 0 to 1
            const out = pidD.update(v3(1, 0, 0), 0.1);
            // derivative = (1 - 0) / 0.1 = 10, kd=1 => output.x = 10
            assert.ok(Math.abs(out.x - 10) < 1e-6, `expected 10, got ${out.x}`);
        });

        test('derivative is zero when error is constant', () => {
            const pidD = new PIDController(0, 0, 1);
            pidD.setDerivativeAlpha(0);

            const error = v3(5, 0, 0);
            pidD.update(error, 0.1); // first update sets lastError
            const out = pidD.update(v3(5, 0, 0), 0.1); // same error

            // derivative = (5 - 5) / 0.1 = 0
            assert.ok(Math.abs(out.x) < 1e-6, `expected ~0, got ${out.x}`);
        });

        test('derivative filtering with alpha > 0 smooths output', () => {
            const pidD = new PIDController(0, 0, 1);
            pidD.setDerivativeAlpha(0.9); // heavy filtering

            pidD.update(v3(0, 0, 0), 0.1);
            const out = pidD.update(v3(1, 0, 0), 0.1);

            // With alpha=0.9, filtered derivative = 0.9*0 + 0.1*(1/0.1) = 1.0
            // output = kd * filtered = 1.0
            assert.ok(Math.abs(out.x - 1.0) < 1e-6, `expected ~1.0, got ${out.x}`);
        });
    });

    // ── Reset ────────────────────────────────────────────────────────

    describe('reset via setGain to rebuild', () => {
        test('new PIDController has zero integral state', () => {
            const pidI = new PIDController(0, 1, 0);
            pidI.update(v3(10, 0, 0), 1.0); // builds up integral

            // Create fresh controller — integral should be 0
            const fresh = new PIDController(0, 1, 0);
            const out = fresh.update(v3(0, 0, 0), 0.1);
            // integral = 0*0.1 = 0, output = 0
            assert.ok(Math.abs(out.x) < 1e-6, 'fresh controller should have zero integral');
        });
    });

    // ── Combined PID ─────────────────────────────────────────────────

    describe('combined PID', () => {
        test('output is weighted sum of P, I, D terms', () => {
            const combined = new PIDController(2, 0.5, 0.1);
            combined.setDerivativeAlpha(0); // raw derivative
            const dt = 0.1;

            // First update to set lastError
            combined.update(v3(0, 0, 0), dt);

            // Second update with error = (1, 0, 0)
            const out = combined.update(v3(1, 0, 0), dt);

            // P = kp * error = 2 * 1 = 2
            // I = ki * integral; integral = 0*dt + 1*dt = 0.1; I = 0.5 * 0.1 = 0.05
            // D = kd * derivative; derivative = (1-0)/0.1 = 10; D = 0.1 * 10 = 1.0
            // total = 2 + 0.05 + 1.0 = 3.05
            assert.ok(Math.abs(out.x - 3.05) < 0.01, `expected ~3.05, got ${out.x}`);
        });
    });

    // ── Edge cases ───────────────────────────────────────────────────

    describe('edge cases', () => {
        test('very large error produces proportional output', () => {
            const out = pid.update(v3(1e6, 0, 0), 0.1);
            assert.ok(Math.abs(out.x - 1e6) < 1, `expected ~1e6, got ${out.x}`);
        });

        test('zero error produces zero output', () => {
            const out = pid.update(v3(0, 0, 0), 0.1);
            assert.ok(Math.abs(out.x) < 1e-9);
            assert.ok(Math.abs(out.y) < 1e-9);
            assert.ok(Math.abs(out.z) < 1e-9);
        });

        test('negative gains invert output', () => {
            const pidNeg = new PIDController(-1, 0, 0);
            const out = pidNeg.update(v3(5, 0, 0), 0.1);
            assert.ok(Math.abs(out.x - (-5)) < 1e-6, `expected -5, got ${out.x}`);
        });
    });

    // ── Gain accessors ───────────────────────────────────────────────

    describe('gain accessors', () => {
        test('getGain returns constructor values', () => {
            const p = new PIDController(1.5, 2.5, 3.5);
            assert.equal(p.getGain('Kp'), 1.5);
            assert.equal(p.getGain('Ki'), 2.5);
            assert.equal(p.getGain('Kd'), 3.5);
        });

        test('setGain updates the gains', () => {
            pid.setGain('Kp', 10);
            assert.equal(pid.getGain('Kp'), 10);
            pid.setGain('Ki', 20);
            assert.equal(pid.getGain('Ki'), 20);
            pid.setGain('Kd', 30);
            assert.equal(pid.getGain('Kd'), 30);
        });
    });

    // ── tuneFromTau ──────────────────────────────────────────────────

    describe('tuneFromTau', () => {
        test('attitude domain sets clamped gains', () => {
            pid.tuneFromTau('attitude', 1.0);
            const kp = pid.getGain('Kp');
            const kd = pid.getGain('Kd');
            const ki = pid.getGain('Ki');
            assert.ok(kp >= 0.05 && kp <= 0.6, `kp out of range: ${kp}`);
            assert.ok(kd >= 0.02 && kd <= 0.25, `kd out of range: ${kd}`);
            assert.equal(ki, 0.0);
        });

        test('rotCancel domain sets clamped gains', () => {
            pid.tuneFromTau('rotCancel', 1.0);
            const kp = pid.getGain('Kp');
            assert.ok(kp >= 0.05 && kp <= 1.2, `kp out of range: ${kp}`);
        });

        test('position domain sets non-zero ki', () => {
            pid.tuneFromTau('position', 1.0);
            assert.equal(pid.getGain('Ki'), 0.0005);
        });

        test('linMomentum domain sets clamped gains', () => {
            pid.tuneFromTau('linMomentum', 1.0);
            const kp = pid.getGain('Kp');
            assert.ok(kp >= 0.3 && kp <= 6.0, `kp out of range: ${kp}`);
        });

        test('very small tau clamps to upper bound', () => {
            pid.tuneFromTau('attitude', 0.001);
            const kp = pid.getGain('Kp');
            assert.equal(kp, 0.6, 'should clamp to max kp for attitude');
        });
    });
});

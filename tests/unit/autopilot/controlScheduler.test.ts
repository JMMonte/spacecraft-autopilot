import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import { ControlScheduler } from '../../../src/controllers/autopilot/ControlScheduler';

describe('ControlScheduler', () => {
    let sched: ControlScheduler;

    beforeEach(() => {
        // 10 Hz = 0.1s interval, no random phase
        sched = new ControlScheduler(10, false);
    });

    // ── Basic consume behavior ───────────────────────────────────────

    describe('consume', () => {
        test('returns null when accumulated time < interval', () => {
            const result = sched.consume(0.05); // 50ms < 100ms interval
            assert.equal(result, null);
        });

        test('returns interval when accumulated time >= interval', () => {
            const result = sched.consume(0.1); // exactly 100ms
            assert.equal(result, 0.1);
        });

        test('returns interval when accumulated time > interval', () => {
            const result = sched.consume(0.15); // 150ms > 100ms
            assert.equal(result, 0.1); // returns the interval, not the dt
        });

        test('multiple small dt accumulations eventually trigger', () => {
            assert.equal(sched.consume(0.03), null); // 30ms
            assert.equal(sched.consume(0.03), null); // 60ms
            assert.equal(sched.consume(0.03), null); // 90ms
            const result = sched.consume(0.03); // 120ms -> triggers
            assert.equal(result, 0.1);
        });

        test('accumulator wraps via modulo after triggering', () => {
            // First trigger at 120ms: accumulator becomes 120 % 100 = 20ms
            sched.consume(0.12);
            // Next: 20ms + 50ms = 70ms < 100ms
            assert.equal(sched.consume(0.05), null);
            // 70ms + 40ms = 110ms >= 100ms -> triggers
            const result = sched.consume(0.04);
            assert.equal(result, 0.1);
        });
    });

    // ── Invalid dt handling ──────────────────────────────────────────

    describe('invalid dt', () => {
        test('returns null for dt = 0', () => {
            assert.equal(sched.consume(0), null);
        });

        test('returns null for negative dt', () => {
            assert.equal(sched.consume(-0.1), null);
        });

        test('returns null for NaN dt', () => {
            assert.equal(sched.consume(NaN), null);
        });

        test('returns null for Infinity dt', () => {
            assert.equal(sched.consume(Infinity), null);
        });
    });

    // ── Rate Hz ──────────────────────────────────────────────────────

    describe('getRateHz / setRateHz', () => {
        test('getRateHz returns the configured rate', () => {
            assert.equal(sched.getRateHz(), 10);
        });

        test('setRateHz changes the interval', () => {
            sched.setRateHz(20); // 50ms interval
            assert.equal(sched.getRateHz(), 20);

            // Should trigger at 50ms now
            assert.equal(sched.consume(0.04), null);
            assert.equal(sched.consume(0.02), 0.05);
        });

        test('setRateHz clamps to min 5', () => {
            const clamped = sched.setRateHz(1);
            assert.equal(clamped, 5);
            assert.equal(sched.getRateHz(), 5);
        });

        test('setRateHz clamps to max 120', () => {
            const clamped = sched.setRateHz(500);
            assert.equal(clamped, 120);
            assert.equal(sched.getRateHz(), 120);
        });

        test('setRateHz clamps invalid values to 30', () => {
            const clamped = sched.setRateHz(NaN);
            assert.equal(clamped, 30);
        });

        test('setRateHz clamps accumulator to new interval', () => {
            // Accumulate 80ms toward the 100ms interval
            sched.consume(0.08);
            // Switch to 50ms interval — accumulator (80ms) is clamped to 50ms
            sched.setRateHz(20);
            // Next consume should trigger immediately since 50ms >= 50ms
            const result = sched.consume(0.001);
            assert.equal(result, 0.05);
        });
    });

    // ── Reset ────────────────────────────────────────────────────────

    describe('reset', () => {
        test('reset clears accumulator to zero', () => {
            sched.consume(0.08); // accumulate 80ms
            sched.reset(false);
            // Now need full interval again
            assert.equal(sched.consume(0.09), null);
            assert.equal(sched.consume(0.02), 0.1);
        });

        test('reset with randomizePhase sets non-zero accumulator', () => {
            // Since random, just verify it does not throw
            sched.reset(true);
            // The scheduler should still work after reset
            const result = sched.consume(0.2); // large enough to trigger
            assert.equal(result, 0.1);
        });
    });

    // ── Constructor defaults ─────────────────────────────────────────

    describe('constructor', () => {
        test('default rate is 30 Hz', () => {
            const defaultSched = new ControlScheduler();
            assert.ok(Math.abs(defaultSched.getRateHz() - 30) < 1e-6);
        });

        test('invalid constructor rate defaults to 30', () => {
            const badSched = new ControlScheduler(-5);
            assert.equal(badSched.getRateHz(), 30);
        });
    });
});

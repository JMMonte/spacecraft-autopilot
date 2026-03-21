import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
    AutopilotLLMInterface,
    type AutopilotCommand,
    type Vec3,
    type Quat,
} from '../../../src/controllers/autopilot/AutopilotLLMInterface';

// ─── Minimal mocks ───────────────────────────────────────────────────────────
// These stubs satisfy the interface without needing THREE.js or the real
// Autopilot/Spacecraft at all — keeping the test fast and dependency-free.

function makeVec3(x = 0, y = 0, z = 0) {
    return {
        x, y, z,
        clone() { return makeVec3(this.x, this.y, this.z); },
        copy(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
        set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; },
        distanceTo(v: any) {
            const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        },
    };
}

function makeQuat(x = 0, y = 0, z = 0, w = 1) {
    return {
        x, y, z, w,
        clone() { return makeQuat(this.x, this.y, this.z, this.w); },
        copy(q: any) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; },
        set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this; },
    };
}

function createMockSpacecraft() {
    return {
        name: 'TestCraft',
        getWorldPosition: () => makeVec3(1, 2, 3),
        getWorldVelocity: () => makeVec3(0.1, 0, 0),
        getWorldOrientation: () => makeQuat(0, 0, 0, 1),
        getWorldAngularVelocity: () => makeVec3(0, 0, 0),
        getMass: () => 1200,
    } as any;
}

function createMockAutopilot() {
    const state = {
        enabled: false,
        modes: {
            orientationMatch: false,
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            goToPosition: false,
        },
        targetPos: makeVec3(0, 0, 0),
        targetOrient: makeQuat(0, 0, 0, 1),
        targetObject: null as any,
        pathWaypoints: null as Vec3[] | null,
    };

    return {
        _state: state,

        getAutopilotEnabled: () => state.enabled,
        getActiveAutopilots: () => ({ ...state.modes }),

        setTargetPosition(pos: any) {
            state.targetPos.copy(pos);
        },
        getTargetPosition: () => state.targetPos,

        setTargetOrientation(q: any) {
            state.targetOrient.copy(q);
        },
        getTargetOrientation: () => state.targetOrient,

        getTargetObject: () => state.targetObject,

        setMode(mode: string, enabled: boolean) {
            (state.modes as any)[mode] = enabled;
            state.enabled = Object.values(state.modes).some(Boolean);
        },

        resetAllModes() {
            for (const k of Object.keys(state.modes)) {
                (state.modes as any)[k] = false;
            }
            state.enabled = false;
        },

        setPathWaypoints(wps: any[]) {
            state.pathWaypoints = wps.map((w: any) => ({ x: w.x, y: w.y, z: w.z }));
        },

        getPathProgress: () => null,
        getPathCarrot: () => null,

        getGoToPositionTelemetry: () => null,
        getPointToPositionTelemetry: () => null,
        getOrientationMatchTelemetry: () => null,
        getPathFollowerTelemetry: () => null,
    } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AutopilotLLMInterface', () => {
    let llm: AutopilotLLMInterface;
    let autopilot: ReturnType<typeof createMockAutopilot>;
    let spacecraft: ReturnType<typeof createMockSpacecraft>;

    beforeEach(() => {
        autopilot = createMockAutopilot();
        spacecraft = createMockSpacecraft();
        llm = new AutopilotLLMInterface(autopilot as any, spacecraft as any);
    });

    // ── getTools ──────────────────────────────────────────────────────────

    test('getTools returns non-empty array of tool definitions', () => {
        const tools = llm.getTools();
        assert.ok(Array.isArray(tools));
        assert.ok(tools.length >= 10, `Expected >= 10 tools, got ${tools.length}`);
    });

    test('every tool has name, description, and parameter schema', () => {
        for (const tool of llm.getTools()) {
            assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `tool.name is empty`);
            assert.ok(typeof tool.description === 'string' && tool.description.length > 10, `${tool.name}: description too short`);
            assert.ok(tool.parameters.type === 'object', `${tool.name}: parameters.type must be "object"`);
            assert.ok(Array.isArray(tool.parameters.required), `${tool.name}: missing required array`);
        }
    });

    // ── getStatus ─────────────────────────────────────────────────────────

    test('getStatus returns complete serialisable snapshot', () => {
        const s = llm.getStatus();
        // Top-level fields
        assert.equal(typeof s.enabled, 'boolean');
        assert.ok(Array.isArray(s.activeModes));
        // Spacecraft
        assert.equal(s.spacecraft.position.x, 1);
        assert.equal(s.spacecraft.position.y, 2);
        assert.equal(s.spacecraft.position.z, 3);
        assert.equal(s.spacecraft.mass, 1200);
        // Target
        assert.equal(typeof s.target.distance, 'number');
        // Navigation
        assert.equal(s.navigation.pathActive, false);
        // Telemetry
        assert.equal(s.telemetry.goToPosition, null);
        // Serialisable
        const json = JSON.stringify(s);
        assert.ok(json.length > 0, 'Status must be JSON-serialisable');
    });

    // ── execute: go_to_position ───────────────────────────────────────────

    test('go_to_position sets target and activates mode', () => {
        const result = llm.execute({
            action: 'go_to_position',
            params: { position: { x: 100, y: 0, z: -50 } },
        });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.modes.goToPosition, true);
        assert.equal(autopilot._state.targetPos.x, 100);
        assert.equal(autopilot._state.targetPos.z, -50);
        assert.ok(result.status.enabled);
    });

    // ── execute: point_at_position ────────────────────────────────────────

    test('point_at_position sets target and activates pointing mode', () => {
        const result = llm.execute({
            action: 'point_at_position',
            params: { position: { x: 0, y: 50, z: 0 } },
        });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.modes.pointToPosition, true);
    });

    // ── execute: match_orientation ────────────────────────────────────────

    test('match_orientation sets quaternion and activates mode', () => {
        const result = llm.execute({
            action: 'match_orientation',
            params: { orientation: { x: 0, y: 0.707, z: 0, w: 0.707 } },
        });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.modes.orientationMatch, true);
        assert.ok(Math.abs(autopilot._state.targetOrient.y - 0.707) < 0.001);
    });

    // ── execute: cancel_rotation ──────────────────────────────────────────

    test('cancel_rotation activates rotation damping', () => {
        const result = llm.execute({ action: 'cancel_rotation' });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.modes.cancelRotation, true);
    });

    // ── execute: cancel_linear_motion ─────────────────────────────────────

    test('cancel_linear_motion activates braking', () => {
        const result = llm.execute({ action: 'cancel_linear_motion' });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.modes.cancelLinearMotion, true);
    });

    // ── execute: stop_all_motion ──────────────────────────────────────────

    test('stop_all_motion activates both cancel modes', () => {
        const result = llm.execute({ action: 'stop_all_motion' });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.modes.cancelRotation, true);
        assert.equal(autopilot._state.modes.cancelLinearMotion, true);
    });

    // ── execute: follow_path ──────────────────────────────────────────────

    test('follow_path sets waypoints and activates goToPosition', () => {
        const result = llm.execute({
            action: 'follow_path',
            params: {
                waypoints: [
                    { x: 0, y: 0, z: 0 },
                    { x: 50, y: 10, z: 0 },
                    { x: 100, y: 0, z: -20 },
                ],
            },
        });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.modes.goToPosition, true);
        assert.equal(autopilot._state.pathWaypoints?.length, 3);
    });

    test('follow_path rejects fewer than 2 waypoints', () => {
        const result = llm.execute({
            action: 'follow_path',
            params: { waypoints: [{ x: 0, y: 0, z: 0 }] },
        });
        assert.equal(result.success, false);
        assert.ok(result.message.includes('2 waypoints'));
    });

    // ── execute: set_target_position ──────────────────────────────────────

    test('set_target_position sets target without activating any mode', () => {
        const result = llm.execute({
            action: 'set_target_position',
            params: { position: { x: 42, y: 0, z: 0 } },
        });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.targetPos.x, 42);
        assert.equal(autopilot._state.enabled, false);
    });

    // ── execute: set_target_orientation ────────────────────────────────────

    test('set_target_orientation sets quaternion without activating any mode', () => {
        const result = llm.execute({
            action: 'set_target_orientation',
            params: { orientation: { x: 0, y: 0, z: 1, w: 0 } },
        });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.targetOrient.z, 1);
        assert.equal(autopilot._state.enabled, false);
    });

    // ── execute: disable ──────────────────────────────────────────────────

    test('disable turns off all modes', () => {
        // First enable something
        llm.execute({ action: 'cancel_rotation' });
        assert.equal(autopilot._state.enabled, true);
        // Now disable
        const result = llm.execute({ action: 'disable' });
        assert.equal(result.success, true);
        assert.equal(autopilot._state.enabled, false);
        assert.ok(result.status.activeModes.length === 0);
    });

    // ── execute: get_status ───────────────────────────────────────────────

    test('get_status returns current state without side effects', () => {
        const before = llm.getStatus();
        const result = llm.execute({ action: 'get_status' });
        const after = llm.getStatus();
        assert.equal(result.success, true);
        assert.deepEqual(before, after);
    });

    // ── Error handling ────────────────────────────────────────────────────

    test('unknown action returns failure with helpful message', () => {
        const result = llm.execute({ action: 'warp_drive' as any });
        assert.equal(result.success, false);
        assert.ok(result.message.includes('Unknown action'));
    });

    test('missing required param returns failure', () => {
        const result = llm.execute({ action: 'go_to_position', params: {} });
        assert.equal(result.success, false);
        assert.ok(result.message.includes('position'));
    });

    test('invalid vec3 returns failure', () => {
        const result = llm.execute({
            action: 'go_to_position',
            params: { position: { x: 'not a number', y: 0, z: 0 } },
        });
        assert.equal(result.success, false);
        assert.ok(result.message.includes('numeric'));
    });

    test('invalid quaternion returns failure', () => {
        const result = llm.execute({
            action: 'match_orientation',
            params: { orientation: { x: 0, y: 0, z: 0 } }, // missing w
        });
        assert.equal(result.success, false);
    });

    // ── Result always includes status ─────────────────────────────────────

    test('every result includes full status snapshot', () => {
        const actions: AutopilotCommand[] = [
            { action: 'get_status' },
            { action: 'cancel_rotation' },
            { action: 'go_to_position', params: { position: { x: 1, y: 2, z: 3 } } },
            { action: 'disable' },
            { action: 'warp_drive' as any }, // unknown — still gets status
        ];
        for (const cmd of actions) {
            const result = llm.execute(cmd);
            assert.ok(result.status, `${cmd.action}: result.status is missing`);
            assert.ok(typeof result.status.enabled === 'boolean', `${cmd.action}: status.enabled missing`);
            assert.ok(result.status.spacecraft, `${cmd.action}: status.spacecraft missing`);
            assert.ok(result.status.target, `${cmd.action}: status.target missing`);
        }
    });

    // ── JSON round-trip ───────────────────────────────────────────────────

    test('command results survive JSON round-trip', () => {
        const result = llm.execute({
            action: 'go_to_position',
            params: { position: { x: 10, y: 20, z: 30 } },
        });
        const json = JSON.stringify(result);
        const parsed = JSON.parse(json);
        assert.equal(parsed.success, true);
        assert.equal(parsed.status.spacecraft.position.x, 1); // mock spacecraft pos
    });

    test('tool definitions survive JSON round-trip', () => {
        const tools = llm.getTools();
        const json = JSON.stringify(tools);
        const parsed = JSON.parse(json);
        assert.equal(parsed.length, tools.length);
        assert.equal(parsed[0].name, tools[0].name);
    });
});

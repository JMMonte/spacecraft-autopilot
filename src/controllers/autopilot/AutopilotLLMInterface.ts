/**
 * AutopilotLLMInterface — A plain-JSON adapter that lets an LLM control the
 * spacecraft autopilot through structured tool-use / function-calling.
 *
 * Design goals:
 *   1. Zero THREE.js in the public surface — all inputs and outputs are
 *      serialisable plain objects ({x,y,z}, {x,y,z,w}, primitives).
 *   2. Single entry-point: `execute(command)` returns a typed result envelope.
 *   3. Self-describing: `getTools()` returns an array of tool definitions that
 *      can be fed directly into an LLM's tool/function-calling schema.
 *   4. Rich status: `getStatus()` merges spacecraft state, autopilot state,
 *      path progress, and telemetry into one snapshot.
 */

import * as THREE from 'three';
import type { Autopilot } from './Autopilot';
import type { Spacecraft } from '../../core/spacecraft';
import type { AutopilotModeName } from './types';

// ─── Plain JSON geometry types ────────────────────────────────────────────────

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
}

// ─── Command definitions ──────────────────────────────────────────────────────

export type AutopilotCommandName =
    | 'go_to_position'
    | 'point_at_position'
    | 'match_orientation'
    | 'cancel_rotation'
    | 'cancel_linear_motion'
    | 'stop_all_motion'
    | 'follow_path'
    | 'set_target_position'
    | 'set_target_orientation'
    | 'disable'
    | 'get_status';

export interface AutopilotCommand {
    action: AutopilotCommandName;
    params?: Record<string, unknown>;
}

// ─── Result envelope ──────────────────────────────────────────────────────────

export interface CommandResult {
    success: boolean;
    action: string;
    message: string;
    status: AutopilotStatus;
}

// ─── Status snapshot ──────────────────────────────────────────────────────────

export interface AutopilotStatus {
    enabled: boolean;
    activeModes: AutopilotModeName[];

    spacecraft: {
        position: Vec3;
        velocity: Vec3;
        orientation: Quat;
        angularVelocity: Vec3;
        mass: number;
    };

    target: {
        position: Vec3;
        orientation: Quat;
        distance: number;
        objectName: string | null;
    };

    navigation: {
        pathActive: boolean;
        pathProgressFraction: number | null;
        remainingDistance: number | null;
        done: boolean | null;
    };

    telemetry: {
        goToPosition: Record<string, unknown> | null;
        pointToPosition: Record<string, unknown> | null;
        orientationMatch: Record<string, unknown> | null;
        pathFollower: Record<string, unknown> | null;
    };
}

// ─── Tool definition (matches common LLM function-calling schemas) ────────────

export interface ToolParameterProperty {
    type: string;
    description: string;
    items?: { type: string; properties?: Record<string, ToolParameterProperty>; required?: string[] };
    properties?: Record<string, ToolParameterProperty>;
    required?: string[];
    enum?: string[];
}

export interface ToolDefinition {
    name: AutopilotCommandName;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ToolParameterProperty>;
        required: string[];
    };
}

// ─── The adapter class ────────────────────────────────────────────────────────

export class AutopilotLLMInterface {
    private autopilot: Autopilot;
    private spacecraft: Spacecraft;

    constructor(autopilot: Autopilot, spacecraft: Spacecraft) {
        this.autopilot = autopilot;
        this.spacecraft = spacecraft;
    }

    // ── Self-describing tool list ─────────────────────────────────────────

    /** Returns tool definitions ready for LLM function-calling. */
    getTools(): ToolDefinition[] {
        return TOOL_DEFINITIONS;
    }

    // ── Single command entry point ────────────────────────────────────────

    /** Execute an autopilot command from plain JSON. Returns a result with status. */
    execute(command: AutopilotCommand): CommandResult {
        const { action, params = {} } = command;

        try {
            switch (action) {
                case 'go_to_position':
                    return this.goToPosition(params as { position: Vec3 });

                case 'point_at_position':
                    return this.pointAtPosition(params as { position: Vec3 });

                case 'match_orientation':
                    return this.matchOrientation(params as { orientation: Quat });

                case 'cancel_rotation':
                    return this.doCancelRotation();

                case 'cancel_linear_motion':
                    return this.doCancelLinearMotion();

                case 'stop_all_motion':
                    return this.stopAllMotion();

                case 'follow_path':
                    return this.followPath(params as { waypoints: Vec3[] });

                case 'set_target_position':
                    return this.doSetTargetPosition(params as { position: Vec3 });

                case 'set_target_orientation':
                    return this.doSetTargetOrientation(params as { orientation: Quat });

                case 'disable':
                    return this.disableAll();

                case 'get_status':
                    return this.ok('get_status', 'Current autopilot status.');

                default:
                    return this.fail(action, `Unknown action "${action}". Use get_status to see available commands.`);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return this.fail(action, `Error executing "${action}": ${msg}`);
        }
    }

    // ── Status snapshot ───────────────────────────────────────────────────

    /** Full serialisable status snapshot. */
    getStatus(): AutopilotStatus {
        const pos = this.spacecraft.getWorldPosition();
        const vel = this.spacecraft.getWorldVelocity();
        const orient = this.spacecraft.getWorldOrientation();
        const angVel = this.spacecraft.getWorldAngularVelocity();
        const tgtPos = this.autopilot.getTargetPosition();
        const tgtOr = this.autopilot.getTargetOrientation();
        const tgtObj = this.autopilot.getTargetObject();

        const activeModes = Object.entries(this.autopilot.getActiveAutopilots())
            .filter(([, v]) => v)
            .map(([k]) => k as AutopilotModeName);

        const pathProgress = this.autopilot.getPathProgress();

        return {
            enabled: this.autopilot.getAutopilotEnabled(),
            activeModes,

            spacecraft: {
                position: v3(pos),
                velocity: v3(vel),
                orientation: q4(orient),
                angularVelocity: v3(angVel),
                mass: this.spacecraft.getMass(),
            },

            target: {
                position: v3(tgtPos),
                orientation: q4(tgtOr),
                distance: pos.distanceTo(tgtPos),
                objectName: tgtObj ? (tgtObj as any).name ?? null : null,
            },

            navigation: {
                pathActive: pathProgress !== null,
                pathProgressFraction: pathProgress
                    ? (pathProgress.sTotal > 0 ? pathProgress.sCur / pathProgress.sTotal : null)
                    : null,
                remainingDistance: pathProgress ? pathProgress.sRem : null,
                done: pathProgress ? pathProgress.done : null,
            },

            telemetry: {
                goToPosition: this.autopilot.getGoToPositionTelemetry() ?? null,
                pointToPosition: this.autopilot.getPointToPositionTelemetry() ?? null,
                orientationMatch: this.autopilot.getOrientationMatchTelemetry() ?? null,
                pathFollower: this.autopilot.getPathFollowerTelemetry() ?? null,
            },
        };
    }

    // ── Command implementations ───────────────────────────────────────────

    private goToPosition(p: { position: Vec3 }): CommandResult {
        const v = requireVec3(p.position, 'position');
        this.autopilot.setTargetPosition(toV3(v));
        this.autopilot.setMode('goToPosition', true);
        return this.ok('go_to_position', `Navigating to (${v.x}, ${v.y}, ${v.z}).`);
    }

    private pointAtPosition(p: { position: Vec3 }): CommandResult {
        const v = requireVec3(p.position, 'position');
        this.autopilot.setTargetPosition(toV3(v));
        this.autopilot.setMode('pointToPosition', true);
        return this.ok('point_at_position', `Pointing at (${v.x}, ${v.y}, ${v.z}).`);
    }

    private matchOrientation(p: { orientation: Quat }): CommandResult {
        const q = requireQuat(p.orientation, 'orientation');
        this.autopilot.setTargetOrientation(toQ4(q));
        this.autopilot.setMode('orientationMatch', true);
        return this.ok('match_orientation', `Matching orientation (${q.x}, ${q.y}, ${q.z}, ${q.w}).`);
    }

    private doCancelRotation(): CommandResult {
        this.autopilot.setMode('cancelRotation', true);
        return this.ok('cancel_rotation', 'Cancelling rotational motion.');
    }

    private doCancelLinearMotion(): CommandResult {
        this.autopilot.setMode('cancelLinearMotion', true);
        return this.ok('cancel_linear_motion', 'Cancelling linear motion.');
    }

    private stopAllMotion(): CommandResult {
        this.autopilot.setMode('cancelRotation', true);
        this.autopilot.setMode('cancelLinearMotion', true);
        return this.ok('stop_all_motion', 'Cancelling all motion (rotation + linear).');
    }

    private followPath(p: { waypoints: Vec3[] }): CommandResult {
        if (!Array.isArray(p.waypoints) || p.waypoints.length < 2) {
            return this.fail('follow_path', 'At least 2 waypoints are required.');
        }
        const wps = p.waypoints.map((w, i) => toV3(requireVec3(w, `waypoints[${i}]`)));
        this.autopilot.setPathWaypoints(wps);
        this.autopilot.setMode('goToPosition', true);
        return this.ok('follow_path', `Following path with ${wps.length} waypoints.`);
    }

    private doSetTargetPosition(p: { position: Vec3 }): CommandResult {
        const v = requireVec3(p.position, 'position');
        this.autopilot.setTargetPosition(toV3(v));
        return this.ok('set_target_position', `Target position set to (${v.x}, ${v.y}, ${v.z}). Activate a mode to begin.`);
    }

    private doSetTargetOrientation(p: { orientation: Quat }): CommandResult {
        const q = requireQuat(p.orientation, 'orientation');
        this.autopilot.setTargetOrientation(toQ4(q));
        return this.ok('set_target_orientation', `Target orientation set. Activate a mode to begin.`);
    }

    private disableAll(): CommandResult {
        this.autopilot.resetAllModes();
        return this.ok('disable', 'All autopilot modes disabled.');
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private ok(action: string, message: string): CommandResult {
        return { success: true, action, message, status: this.getStatus() };
    }

    private fail(action: string, message: string): CommandResult {
        return { success: false, action, message, status: this.getStatus() };
    }
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

function v3(v: THREE.Vector3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

function q4(q: THREE.Quaternion): Quat {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function toV3(v: Vec3): THREE.Vector3 {
    return new THREE.Vector3(v.x, v.y, v.z);
}

function toQ4(q: Quat): THREE.Quaternion {
    return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

function requireVec3(v: unknown, name: string): Vec3 {
    if (!v || typeof v !== 'object') throw new Error(`"${name}" must be an object with x, y, z.`);
    const o = v as Record<string, unknown>;
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.z !== 'number') {
        throw new Error(`"${name}" must have numeric x, y, z properties.`);
    }
    return { x: o.x as number, y: o.y as number, z: o.z as number };
}

function requireQuat(q: unknown, name: string): Quat {
    if (!q || typeof q !== 'object') throw new Error(`"${name}" must be an object with x, y, z, w.`);
    const o = q as Record<string, unknown>;
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.z !== 'number' || typeof o.w !== 'number') {
        throw new Error(`"${name}" must have numeric x, y, z, w properties.`);
    }
    return { x: o.x as number, y: o.y as number, z: o.z as number, w: o.w as number };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
// These are designed to be passed directly to an LLM's tool-use / function-calling
// configuration. Each tool maps 1:1 to an `execute()` action.

const vec3Schema: ToolParameterProperty = {
    type: 'object',
    description: 'A 3D position in world coordinates (meters).',
    properties: {
        x: { type: 'number', description: 'X coordinate (meters)' },
        y: { type: 'number', description: 'Y coordinate (meters)' },
        z: { type: 'number', description: 'Z coordinate (meters)' },
    },
    required: ['x', 'y', 'z'],
};

const quatSchema: ToolParameterProperty = {
    type: 'object',
    description: 'A rotation as a unit quaternion (x, y, z, w).',
    properties: {
        x: { type: 'number', description: 'X component' },
        y: { type: 'number', description: 'Y component' },
        z: { type: 'number', description: 'Z component' },
        w: { type: 'number', description: 'W (scalar) component' },
    },
    required: ['x', 'y', 'z', 'w'],
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        name: 'go_to_position',
        description:
            'Navigate the spacecraft to a target position in 3D space. ' +
            'The autopilot will plan a path (avoiding obstacles if any), ' +
            'orient the spacecraft toward the target, accelerate, cruise, ' +
            'and brake to arrive at the specified coordinates. ' +
            'This is the primary command for moving the spacecraft.',
        parameters: {
            type: 'object',
            properties: {
                position: { ...vec3Schema, description: 'The destination coordinates in world space (meters).' },
            },
            required: ['position'],
        },
    },
    {
        name: 'point_at_position',
        description:
            'Rotate the spacecraft to point its forward axis toward a position ' +
            'in 3D space, without translating. Useful for aiming sensors, cameras, ' +
            'or docking ports at a target before approaching.',
        parameters: {
            type: 'object',
            properties: {
                position: { ...vec3Schema, description: 'The position to point at in world space (meters).' },
            },
            required: ['position'],
        },
    },
    {
        name: 'match_orientation',
        description:
            'Rotate the spacecraft to match a specific orientation (quaternion). ' +
            'Useful for aligning docking ports or matching a target spacecraft\'s attitude.',
        parameters: {
            type: 'object',
            properties: {
                orientation: { ...quatSchema, description: 'The target orientation as a unit quaternion.' },
            },
            required: ['orientation'],
        },
    },
    {
        name: 'cancel_rotation',
        description:
            'Stop all rotational motion. The spacecraft will fire thrusters to ' +
            'bring angular velocity to zero. Useful when the spacecraft is tumbling.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'cancel_linear_motion',
        description:
            'Stop all linear (translational) motion. The spacecraft will brake ' +
            'to bring velocity to zero. Useful when you want to hold position.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'stop_all_motion',
        description:
            'Emergency stop — cancel both rotational and linear motion simultaneously. ' +
            'The spacecraft will fire thrusters to come to a complete halt.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'follow_path',
        description:
            'Navigate the spacecraft along a sequence of waypoints. ' +
            'The autopilot will smoothly interpolate between points using curved ' +
            'path following with obstacle avoidance. At least 2 waypoints are required. ' +
            'The spacecraft will navigate to the first waypoint, then proceed through each successive one.',
        parameters: {
            type: 'object',
            properties: {
                waypoints: {
                    type: 'array',
                    description: 'Ordered list of positions to fly through (minimum 2).',
                    items: {
                        type: 'object',
                        properties: {
                            x: { type: 'number', description: 'X coordinate (meters)' },
                            y: { type: 'number', description: 'Y coordinate (meters)' },
                            z: { type: 'number', description: 'Z coordinate (meters)' },
                        },
                        required: ['x', 'y', 'z'],
                    },
                },
            },
            required: ['waypoints'],
        },
    },
    {
        name: 'set_target_position',
        description:
            'Set the target position without activating any mode. Use this to ' +
            'configure a destination before choosing which mode to activate. ' +
            'Call go_to_position or point_at_position afterward to start moving.',
        parameters: {
            type: 'object',
            properties: {
                position: { ...vec3Schema, description: 'The target coordinates in world space (meters).' },
            },
            required: ['position'],
        },
    },
    {
        name: 'set_target_orientation',
        description:
            'Set the target orientation without activating any mode. Use this to ' +
            'configure a desired attitude before calling match_orientation.',
        parameters: {
            type: 'object',
            properties: {
                orientation: { ...quatSchema, description: 'The target orientation as a unit quaternion.' },
            },
            required: ['orientation'],
        },
    },
    {
        name: 'disable',
        description:
            'Turn off all autopilot modes. The spacecraft will coast with its ' +
            'current velocity and angular velocity (no active control).',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_status',
        description:
            'Query the current autopilot and spacecraft state. Returns position, ' +
            'velocity, orientation, active modes, target info, path progress, and ' +
            'telemetry. Use this to understand the situation before issuing commands.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
];

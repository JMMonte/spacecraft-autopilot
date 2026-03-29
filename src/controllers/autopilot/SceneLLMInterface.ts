/**
 * SceneLLMInterface — A plain-JSON adapter that lets an LLM manage scene
 * presets (list, load) through structured tool-use / function-calling.
 *
 * Exposed at `window.__scene` alongside the autopilot interface at `window.__autopilot`.
 */

import type { BasicWorld } from '../../core/BasicWorld';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SceneCommandResult {
    success: boolean;
    action: string;
    message: string;
    data?: unknown;
}

export interface SceneToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, { type: string; description: string; enum?: string[] }>;
        required: string[];
    };
}

// ─── The adapter class ───────────────────────────────────────────────────────

export class SceneLLMInterface {
    private world: BasicWorld;

    constructor(world: BasicWorld) {
        this.world = world;
    }

    /** Returns tool definitions for LLM function-calling. */
    getTools(): SceneToolDefinition[] {
        const presetIds = this.world.getScenePresets().map(p => p.id);
        return [
            {
                name: 'list_scenes',
                description:
                    'List all available scene presets. Returns an array of presets ' +
                    'with id, name, and description. Use this to discover what scenes ' +
                    'are available before loading one.',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
            {
                name: 'load_scene',
                description:
                    'Load a scene preset by id. This replaces all spacecraft and asteroids ' +
                    'in the current scene with the preset configuration. The renderer, ' +
                    'physics engine, and camera are preserved. Use list_scenes first to ' +
                    'see available preset ids.',
                parameters: {
                    type: 'object',
                    properties: {
                        preset_id: {
                            type: 'string',
                            description: 'The scene preset id to load.',
                            enum: presetIds,
                        },
                    },
                    required: ['preset_id'],
                },
            },
            {
                name: 'get_current_scene',
                description:
                    'Get information about the currently loaded scene, including ' +
                    'the preset id (if loaded from a preset), spacecraft count, ' +
                    'and asteroid count.',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
        ];
    }

    /** Execute a scene command from plain JSON. */
    async execute(command: { action: string; params?: Record<string, unknown> }): Promise<SceneCommandResult> {
        const { action, params = {} } = command;

        try {
            switch (action) {
                case 'list_scenes':
                    return this.listScenes();

                case 'load_scene':
                    return await this.loadScene(params as { preset_id: string });

                case 'get_current_scene':
                    return this.getCurrentScene();

                default:
                    return { success: false, action, message: `Unknown action "${action}". Use list_scenes to see available commands.` };
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, action, message: `Error executing "${action}": ${msg}` };
        }
    }

    private listScenes(): SceneCommandResult {
        const presets = this.world.getScenePresets();
        return {
            success: true,
            action: 'list_scenes',
            message: `${presets.length} scene presets available.`,
            data: presets,
        };
    }

    private async loadScene(p: { preset_id: string }): Promise<SceneCommandResult> {
        if (!p.preset_id || typeof p.preset_id !== 'string') {
            return { success: false, action: 'load_scene', message: '"preset_id" is required.' };
        }
        const loaded = await this.world.loadScenePreset(p.preset_id);
        if (!loaded) {
            const available = this.world.getScenePresets().map(s => s.id).join(', ');
            return { success: false, action: 'load_scene', message: `Unknown preset "${p.preset_id}". Available: ${available}` };
        }
        const scCount = this.world.getSpacecraftList().length;
        return {
            success: true,
            action: 'load_scene',
            message: `Scene "${p.preset_id}" loaded with ${scCount} spacecraft.`,
            data: { preset_id: p.preset_id, spacecraftCount: scCount },
        };
    }

    private getCurrentScene(): SceneCommandResult {
        const presetId = this.world.getCurrentScenePresetId();
        const scCount = this.world.getSpacecraftList().length;
        const asteroidCount = this.world.getAsteroidObstacles().length;
        return {
            success: true,
            action: 'get_current_scene',
            message: `Current scene: ${presetId ?? 'custom'}`,
            data: {
                preset_id: presetId,
                spacecraftCount: scCount,
                asteroidCount,
                availablePresets: this.world.getScenePresets(),
            },
        };
    }
}

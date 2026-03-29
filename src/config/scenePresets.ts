/**
 * Scene presets — predefined scene configurations that can be loaded at runtime.
 *
 * Each preset defines the initial spacecraft, asteroids, and focus for a scene.
 * The scene config shape matches WorldConfig from BasicWorld (minus debug/physicsEngine
 * which are set once at init).
 */

import type { AsteroidModelId } from '../objects/AsteroidModel';
import type { AsteroidSystemConfig } from '../objects/AsteroidSystem';

// ─── Scene config (subset of WorldConfig relevant to object population) ──────

export interface SceneObjectConfig {
    asteroids?: Array<{
        position: { x: number; y: number; z: number };
        diameter: number;
        model: AsteroidModelId;
    }>;
    asteroidSystem?: AsteroidSystemConfig;
    initialSpacecraft?: Array<{
        position: { x: number; y: number; z: number };
        width?: number;
        height?: number;
        depth?: number;
        initialConeVisibility?: boolean;
        name?: string;
        blueprintType?: 'mover' | 'node' | 'solar';
        portCount?: 2 | 4 | 6;
        solarParams?: Record<string, unknown>;
        thrusterStrengths?: number[];
    }>;
    initialFocus?: number;
}

// ─── Preset metadata ─────────────────────────────────────────────────────────

export interface ScenePreset {
    id: string;
    name: string;
    description: string;
    config: SceneObjectConfig;
}

// ─── Helper to generate grid positions ───────────────────────────────────────

function gridPositions(count: number, spacing: number): Array<{ x: number; y: number; z: number }> {
    const cols = Math.ceil(Math.sqrt(count));
    const positions: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        positions.push({
            x: (col - (cols - 1) / 2) * spacing,
            y: 0,
            z: (row - (Math.ceil(count / cols) - 1) / 2) * spacing,
        });
    }
    return positions;
}

// ─── Seeded random for deterministic asteroid placement ──────────────────────

/** Simple mulberry32 PRNG so asteroid layouts are deterministic across reloads. */
function seededRng(seed: number) {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ASTEROID_MODELS: AsteroidModelId[] = ['1a', '1e', '2a', '2b'];

/** Generate `count` asteroids randomly placed in a box centered at `center`. */
function randomAsteroids(
    count: number,
    opts: {
        center?: { x: number; y: number; z: number };
        extentX?: number;
        extentY?: number;
        extentZ?: number;
        minDiameter?: number;
        maxDiameter?: number;
        seed?: number;
    } = {},
): Array<{ position: { x: number; y: number; z: number }; diameter: number; model: AsteroidModelId }> {
    const cx = opts.center?.x ?? 0;
    const cy = opts.center?.y ?? 0;
    const cz = opts.center?.z ?? 0;
    const ex = opts.extentX ?? 400;
    const ey = opts.extentY ?? 150;
    const ez = opts.extentZ ?? 400;
    const minD = opts.minDiameter ?? 3;
    const maxD = opts.maxDiameter ?? 40;
    const rng = seededRng(opts.seed ?? 42);

    const asteroids: Array<{ position: { x: number; y: number; z: number }; diameter: number; model: AsteroidModelId }> = [];
    for (let i = 0; i < count; i++) {
        asteroids.push({
            position: {
                x: cx + (rng() - 0.5) * ex,
                y: cy + (rng() - 0.5) * ey,
                z: cz + (rng() - 0.5) * ez,
            },
            diameter: minD + rng() * (maxD - minD),
            model: ASTEROID_MODELS[Math.floor(rng() * ASTEROID_MODELS.length)],
        });
    }
    return asteroids;
}

// ─── Preset definitions ──────────────────────────────────────────────────────

export const SCENE_PRESETS: ScenePreset[] = [
    {
        id: 'default',
        name: 'Default',
        description: 'Mixed fleet: 7 movers, 2 hubs, 1 coupler, 2 solar spacecraft',
        config: {
            initialSpacecraft: [
                { name: 'Alpha',     blueprintType: 'mover', position: { x: 0,   y: 0, z: 20  }, width: 1, height: 1, depth: 2 },
                { name: 'Bravo',     blueprintType: 'mover', position: { x: 0,   y: 0, z: -20 }, width: 1, height: 1, depth: 2 },
                { name: 'Charlie',   blueprintType: 'mover', position: { x: 40,  y: 0, z: 20  }, width: 1, height: 1, depth: 1.5 },
                { name: 'Delta',     blueprintType: 'mover', position: { x: 40,  y: 0, z: -20 }, width: 1, height: 1, depth: 2 },
                { name: 'Echo',      blueprintType: 'mover', position: { x: -40, y: 0, z: 20  }, width: 1, height: 1, depth: 1.5 },
                { name: 'Hub-1',     blueprintType: 'node',  position: { x: 0,   y: 0, z: 0   }, portCount: 6, width: 1 },
                { name: 'Hub-2',     blueprintType: 'node',  position: { x: 80,  y: 0, z: 0   }, portCount: 4, width: 1 },
                { name: 'Coupler-1', blueprintType: 'node',  position: { x: -40, y: 0, z: -20 }, portCount: 2, width: 1 },
                { name: 'Solar-1',   blueprintType: 'solar', position: { x: -40, y: 0, z: 0   }, solarParams: { panelCount: 6, placement: 'both', startDeployed: false } },
                { name: 'Solar-2',   blueprintType: 'solar', position: { x: 40,  y: 0, z: 0   }, solarParams: { panelCount: 4, placement: 'both', startDeployed: false } },
                { name: 'Foxtrot',   blueprintType: 'mover', position: { x: 0,   y: 0, z: -40 }, width: 1, height: 1, depth: 2 },
                { name: 'Golf',      blueprintType: 'mover', position: { x: 80,  y: 0, z: 20  }, width: 1, height: 1, depth: 1.5 },
            ],
            initialFocus: 0,
        },
    },

    {
        id: 'solo',
        name: 'Solo',
        description: 'Single spacecraft in empty space',
        config: {
            initialSpacecraft: [
                { name: 'Explorer', blueprintType: 'mover', position: { x: 0, y: 0, z: 0 }, width: 1, height: 1, depth: 2 },
            ],
            initialFocus: 0,
        },
    },

    {
        id: 'pair',
        name: 'Docking Pair',
        description: '2 spacecraft facing each other for docking practice',
        config: {
            initialSpacecraft: [
                { name: 'Alpha', blueprintType: 'mover', position: { x: 0, y: 0, z: 10  }, width: 1, height: 1, depth: 2 },
                { name: 'Bravo', blueprintType: 'mover', position: { x: 0, y: 0, z: -10 }, width: 1, height: 1, depth: 2 },
            ],
            initialFocus: 0,
        },
    },

    {
        id: 'station',
        name: 'Station Assembly',
        description: '4 movers + 3 hubs + 2 couplers for building a station',
        config: {
            initialSpacecraft: [
                { name: 'Builder-1',  blueprintType: 'mover', position: { x: -15, y: 0,  z: 15  }, width: 1, height: 1, depth: 2 },
                { name: 'Builder-2',  blueprintType: 'mover', position: { x: 15,  y: 0,  z: 15  }, width: 1, height: 1, depth: 2 },
                { name: 'Builder-3',  blueprintType: 'mover', position: { x: -15, y: 0,  z: -15 }, width: 1, height: 1, depth: 2 },
                { name: 'Builder-4',  blueprintType: 'mover', position: { x: 15,  y: 0,  z: -15 }, width: 1, height: 1, depth: 2 },
                { name: 'Hub-A',      blueprintType: 'node',  position: { x: 0,   y: 0,  z: 0   }, portCount: 6, width: 1 },
                { name: 'Hub-B',      blueprintType: 'node',  position: { x: 0,   y: 5,  z: 0   }, portCount: 6, width: 1 },
                { name: 'Hub-C',      blueprintType: 'node',  position: { x: 0,   y: -5, z: 0   }, portCount: 4, width: 1 },
                { name: 'Coupler-1',  blueprintType: 'node',  position: { x: 5,   y: 0,  z: 0   }, portCount: 2, width: 1 },
                { name: 'Coupler-2',  blueprintType: 'node',  position: { x: -5,  y: 0,  z: 0   }, portCount: 2, width: 1 },
            ],
            initialFocus: 0,
        },
    },

    {
        id: 'fleet',
        name: 'Fleet',
        description: '16 movers in a 4x4 grid formation',
        config: {
            initialSpacecraft: gridPositions(16, 12).map((pos, i) => ({
                name: `Ship-${String(i + 1).padStart(2, '0')}`,
                blueprintType: 'mover' as const,
                position: pos,
                width: 1,
                height: 1,
                depth: 2,
            })),
            initialFocus: 0,
        },
    },

    {
        id: 'large-fleet',
        name: 'Large Fleet',
        description: '36 spacecraft in a 6x6 grid — performance stress test',
        config: {
            initialSpacecraft: gridPositions(36, 10).map((pos, i) => ({
                name: `Unit-${String(i + 1).padStart(2, '0')}`,
                blueprintType: 'mover' as const,
                position: pos,
                width: 1,
                height: 1,
                depth: 2,
            })),
            initialFocus: 0,
        },
    },

    {
        id: 'asteroid-field',
        name: 'Asteroid Field',
        description: '3 spacecraft + asteroid system with moons + 60 scattered rocks',
        config: {
            initialSpacecraft: [
                { name: 'Miner-1', blueprintType: 'mover', position: { x: 0,   y: 0, z: 200  }, width: 1, height: 1, depth: 2 },
                { name: 'Miner-2', blueprintType: 'mover', position: { x: 100, y: 0, z: 200  }, width: 1, height: 1, depth: 2 },
                { name: 'Miner-3', blueprintType: 'mover', position: { x: -100, y: 0, z: 200 }, width: 1, height: 1, depth: 1.5 },
            ],
            asteroidSystem: {
                timeScale: 1,
                substeps: 2,
                origin: { x: 0, y: 0, z: -600 },
                inclinationDeg: 17,
                raanDeg: 45,
                argPeriapsisDeg: 0,
                primary: {
                    name: '(87) Sylvia',
                    diameter: 286,
                    model: '2b',
                    spinPeriodSec: 86400,
                    densityKgM3: 1500,
                },
                moons: [
                    { name: 'Romulus',  diameter: 58, semiMajorAxis: 1356, eccentricity: 0.12, meanAnomalyDeg: 0,   model: '1a' },
                    { name: 'Remus',    diameter: 27, semiMajorAxis: 2706, eccentricity: 0.18, meanAnomalyDeg: 180, model: '1e' },
                    { name: 'Ecceles',  diameter: 65, semiMajorAxis: 4000, eccentricity: 0.5,  meanAnomalyDeg: 90,  model: '2a' },
                ],
            },
            asteroids: randomAsteroids(60, { center: { x: 0, y: 0, z: -200 }, extentX: 600, extentY: 200, extentZ: 600, minDiameter: 5, maxDiameter: 50, seed: 101 }),
            initialFocus: 0,
        },
    },

    {
        id: 'dense-asteroids',
        name: 'Dense Asteroids',
        description: '2 spacecraft navigating 80 asteroids spread across a vast field',
        config: {
            initialSpacecraft: [
                { name: 'Navigator', blueprintType: 'mover', position: { x: 0, y: 0, z: 0 }, width: 1, height: 1, depth: 2 },
                { name: 'Scout',     blueprintType: 'mover', position: { x: 50, y: 0, z: 0 }, width: 1, height: 1, depth: 1.5 },
            ],
            asteroids: [
                // One massive asteroid nearby
                { position: { x: -200, y: -80, z: 500 }, diameter: 500, model: '2b' as const },
                // A few large bodies very far apart
                ...randomAsteroids(5, { extentX: 8000, extentY: 1000, extentZ: 8000, minDiameter: 80, maxDiameter: 180, seed: 1 }),
                // Medium rocks spread over a huge volume
                ...randomAsteroids(25, { extentX: 10000, extentY: 2000, extentZ: 10000, minDiameter: 20, maxDiameter: 70, seed: 2 }),
                // Smaller debris across the whole field
                ...randomAsteroids(50, { extentX: 12000, extentY: 3000, extentZ: 12000, minDiameter: 3, maxDiameter: 25, seed: 3 }),
            ],
            initialFocus: 0,
        },
    },

    {
        id: 'solar-array',
        name: 'Solar Array',
        description: '5 solar spacecraft + 2 movers for solar panel testing',
        config: {
            initialSpacecraft: [
                { name: 'Tug-1',    blueprintType: 'mover', position: { x: -20, y: 0, z: 0  }, width: 1, height: 1, depth: 2 },
                { name: 'Tug-2',    blueprintType: 'mover', position: { x: 20,  y: 0, z: 0  }, width: 1, height: 1, depth: 2 },
                { name: 'Solar-A',  blueprintType: 'solar', position: { x: -10, y: 0, z: 15 }, solarParams: { panelCount: 8, placement: 'both', startDeployed: true } },
                { name: 'Solar-B',  blueprintType: 'solar', position: { x: 0,   y: 0, z: 15 }, solarParams: { panelCount: 6, placement: 'both', startDeployed: false } },
                { name: 'Solar-C',  blueprintType: 'solar', position: { x: 10,  y: 0, z: 15 }, solarParams: { panelCount: 4, placement: 'left', startDeployed: true } },
                { name: 'Solar-D',  blueprintType: 'solar', position: { x: -5,  y: 0, z: -15 }, solarParams: { panelCount: 10, placement: 'both', startDeployed: false } },
                { name: 'Solar-E',  blueprintType: 'solar', position: { x: 5,   y: 0, z: -15 }, solarParams: { panelCount: 3, placement: 'right', startDeployed: true } },
            ],
            initialFocus: 0,
        },
    },

    {
        id: 'scattered',
        name: 'Scattered',
        description: '8 spacecraft spread across a large volume',
        config: {
            initialSpacecraft: [
                { name: 'Far-1',  blueprintType: 'mover', position: { x: 0,    y: 0,   z: 0    }, width: 1, height: 1, depth: 2 },
                { name: 'Far-2',  blueprintType: 'mover', position: { x: 200,  y: 50,  z: 100  }, width: 1, height: 1, depth: 2 },
                { name: 'Far-3',  blueprintType: 'mover', position: { x: -150, y: -30, z: 200  }, width: 1, height: 1, depth: 1.5 },
                { name: 'Far-4',  blueprintType: 'mover', position: { x: 100,  y: 80,  z: -150 }, width: 1, height: 1, depth: 2 },
                { name: 'Far-5',  blueprintType: 'solar', position: { x: -200, y: 0,   z: -100 }, solarParams: { panelCount: 6, placement: 'both', startDeployed: true } },
                { name: 'Far-6',  blueprintType: 'mover', position: { x: 50,   y: -60, z: 250  }, width: 1, height: 1, depth: 2 },
                { name: 'Node-1', blueprintType: 'node',  position: { x: -50,  y: 20,  z: -50  }, portCount: 6, width: 1 },
                { name: 'Far-7',  blueprintType: 'mover', position: { x: 300,  y: 0,   z: 0    }, width: 1, height: 1, depth: 1.5 },
            ],
            initialFocus: 0,
        },
    },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

export function getScenePreset(id: string): ScenePreset | undefined {
    return SCENE_PRESETS.find(p => p.id === id);
}

export function getScenePresetIds(): string[] {
    return SCENE_PRESETS.map(p => p.id);
}

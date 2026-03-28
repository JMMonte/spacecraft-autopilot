# AGENTS.md — Spacecraft Autopilot Simulator

> Context file for AI coding agents (Codex, etc.). Keep in sync with CLAUDE.md.
> **Update this file** when you make architectural changes or resolve known issues.

## Project

Three.js + React cockpit simulator with physics-backed 6-DOF spacecraft and modular autopilot. Rapier (WASM) rigid-body dynamics, web worker for autopilot computation, custom Zustand-like store for UI state.

## Commands

```bash
pnpm install              # Install (pnpm 10+, Node 22.x)
pnpm run dev              # Dev server :3000
pnpm run build            # Production → dist/
pnpm run check:ts         # TypeScript check
pnpm run test             # All tests (unit + integration + architecture)
pnpm run test:unit        # Unit tests
pnpm run test:integration # Integration tests
pnpm run test:architecture # Import boundary enforcement
```

**Always run `pnpm run test` before committing. All tests must pass.**

## Architecture

### Layer Separation (TEST-ENFORCED)

Simulation code (`src/core/`, `src/controllers/`, `src/physics/`, `src/scenes/`, `src/objects/`, `src/helpers/`, `src/workers/`) **MUST NOT** import from `src/state/*`. This is enforced by `tests/architecture/importBoundaries.test.ts`.

```
Simulation Layer → emits domain events
    ↓
domainStateBridge.ts → mutates store
    ↓
React hooks (useSyncExternalStore) → UI components
```

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/controllers/autopilot/` | 5 autopilot modes, worker client, LLM interface |
| `src/core/` | World init, renderer, spacecraft entity |
| `src/physics/` | Rapier wrapper |
| `src/state/` | Custom store, domain bridge, React hooks |
| `src/components/` | Cockpit HUD, draggable windows, UI primitives |
| `src/workers/` | Autopilot compute web worker |
| `tests/` | unit/, integration/, architecture/ |
| `tools/` | Autopilot tuner, legacy test scripts |

### Autopilot Modes

| Mode | Purpose |
|------|---------|
| `orientationMatch` | Align attitude to target quaternion (PID) |
| `pointToPosition` | Face a target position (bang-bang) |
| `cancelRotation` | Damp angular velocity to zero |
| `cancelLinearMotion` | Brake to zero linear velocity |
| `goToPosition` | Full 6-DOF rendezvous (velocity profile + attitude) |

Orchestrated by `Autopilot.ts`. Force calculations offloaded to web worker. LLM interface at `window.__autopilot`.

### RCS Visuals & Performance

`src/scenes/objects/rcsVisuals.ts` — 24 thrusters per spacecraft with exhaust cones, point lights, and sprite-based particles. Both lights and particles have global toggles (`setThrusterLightsEnabled()`, `setThrusterParticlesEnabled()`) controlled from `SettingsWindow.tsx` which applies to ALL spacecraft. At 18 spacecraft, both systems tank FPS (~3 FPS) — toggling both off restores ~60 FPS. Needs instanced rendering.

### State Management

Custom store in `appState.ts` — NOT Redux. React hooks via `useSyncExternalStore`. Domain events for cross-layer communication.

## Conventions

- TypeScript strict mode (no implicit any, no unused locals/params)
- No Redux — use the custom store pattern
- Domain events for cross-layer communication (`simulationEvents.ts`)
- Scratch vectors — autopilot modes reuse pre-allocated THREE vectors (zero-alloc)
- Pure math where possible — ManeuverPlanner has zero THREE.js deps
- Worker offload for heavy computation
- Tailwind CSS v4 with CSS custom properties for theming (3 themes: a/b/c)
- Vite 7, 10 path aliases (@, @components, @core, etc.)

## Testing

- Framework: Node.js native `node:test` with `assert/strict` — NOT Jest or Vitest
- Architecture tests enforce import boundaries automatically
- Test files: `tests/unit/`, `tests/integration/`, `tests/architecture/`

## Known Issues & TODOs

**See `TODO.md` for the full actionable checklist.** Pick a task, do the work, **delete it** from the file (git history is the changelog). If you discover new issues, add them there.

## Memory Protocol

After completing work on this project, update:
1. This file (`AGENTS.md`) if architecture changed or known issues resolved
2. `CLAUDE.md` with the same changes (keep them in sync)
3. Memory files in the Claude project directory if using Claude Code

This ensures continuity across sessions and agents.

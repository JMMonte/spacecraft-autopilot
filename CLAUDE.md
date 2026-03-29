# CLAUDE.md — Spacecraft Autopilot Simulator

> This file is the primary context for any AI agent working on this project.
> **Update this file** whenever you make architectural changes, add new modules, or discover important patterns.

## Project Overview

Three.js + React cockpit simulator with physics-backed 6-DOF spacecraft and modular autopilot system. Uses Rapier (WASM) for rigid-body dynamics, a web worker for autopilot computation, and a custom store for UI state.

## Quick Reference

```bash
pnpm install              # Install deps (pnpm 10+, Node 22.x required)
pnpm run dev              # Dev server on :3000
pnpm run build            # Production build → dist/
pnpm run check:ts         # TypeScript check (no emit)
pnpm run test             # TypeScript + unit + integration + architecture
pnpm run validate         # CI contract: test + build
pnpm run test:unit        # Unit tests only
pnpm run test:integration # Integration tests
pnpm run test:architecture # Import boundary enforcement
pnpm run tune             # Test current autopilot params
pnpm run tune:optimize    # Auto-optimize autopilot params
```

## Architecture

### Layer Separation (ENFORCED BY TESTS)

```
Simulation Layer (MUST NOT import src/state/*)
├── src/core/          — World init, renderer, spacecraft entity
├── src/controllers/   — Autopilot, trajectory, docking, visualization
├── src/physics/       — Rapier wrapper, engine abstraction
├── src/scenes/        — Scene setup, objects
├── src/objects/        — Asteroids, planetary systems
├── src/helpers/       — Math utilities, helpers
└── src/workers/       — Web worker (autopilot compute)

UI State Layer
├── src/state/appState.ts               — Custom store (Zustand-like)
├── src/state/store.ts                  — React hooks (useSyncExternalStore)
├── src/state/domainStateBridge.ts      — Simulation events → state mutations
└── src/state/simulationRuntimeStatePort.ts — Read-only port for simulation→UI

Presentation Layer
├── src/components/Cockpit.tsx          — Main HUD, window orchestration
├── src/components/windows/             — Draggable UI windows
├── src/components/hud/                 — HUD elements
└── src/components/ui/                  — Shared primitives
```

**Data flow is unidirectional:** Simulation emits domain events → domainStateBridge mutates store → React subscribes via hooks.

The architecture boundary is tested in `tests/architecture/importBoundaries.test.ts`. Simulation code must never import from `src/state/`.

### Autopilot System

Five modes, orchestrated by `src/controllers/autopilot/Autopilot.ts`:

| Mode | Key | Purpose |
|------|-----|---------|
| `orientationMatch` | T | Align attitude to target quaternion (PID) |
| `pointToPosition` | Y | Face a target position (bang-bang) |
| `cancelRotation` | R | Damp angular velocity to zero |
| `cancelLinearMotion` | G | Brake to zero linear velocity |
| `goToPosition` | B | Full 6-DOF rendezvous (velocity profile + attitude) |

**Key components:**
- `AutopilotMode.ts` — Base class with shared scratch vectors, inertia calc, thruster capacity tracking
- `ManeuverPlanner.ts` — Pure math (no THREE.js), bang-coast-bang velocity profiles
- `ManeuverExecutor.ts` — State machine executing plans with closed-loop braking
- `ObstacleAvoidance.ts` — O(n) tangent-point waypoint algorithm
- `PathManager.ts` — Multi-segment path following with obstacle detection
- `WorkerClient.ts` — Worker lifecycle, message routing, async scheduling
- `ControlScheduler.ts` — Accumulator-based frame rate control
- `ModeRegistry.ts` — Mutual exclusivity within rotation/translation groups
- `TargetTracker.ts` — Target pose refresh (center/front/back + docking ports)
- `AutopilotLLMInterface.ts` — JSON-in/JSON-out API exposed on `window.__autopilot`

**Worker architecture:** GoToPosition and force calculations run in `src/workers/autopilot.worker.ts`. Main thread sends state snapshots; worker returns forces + telemetry. Obstacles sent via `cachedObstacles` field.

### Docking System

**Compound body docking** — docked spacecraft merge into a single Rapier rigid body with multiple colliders (no joint constraints). Eliminates joint solver instability.

**Key components:**
- `DockingController.ts` — Orchestrates approach → align → dock phases with speed limiting
- `DockingOrchestrator.ts` — Passive proximity detection, triggers `dock()` when thresholds met
- `DockingInfo.ts` — Builds per-frame docking telemetry (port positions, directions, distances)
- `DockingUtils.ts` — Orientation quaternion computation for port-to-port alignment
- `BasicWorld.onSpacecraftListChanged()` — Multi-subscriber registry hook used by docking controllers to track spacecraft additions/removals safely

**Compound body architecture (`spacecraft.ts`):**
- `dock(ourPort, otherSpacecraft, theirPort)` — Merges guest into compound body:
  1. Resolves compound root (prefers hub with more ports)
  2. Computes guest position from **port geometry** (not world positions) — port faces snap perfectly
  3. Redirects guest's `RigidBodyProxy` to root body with local offset
  4. Attaches guest's box collider to root body
  5. Syncs guest mesh immediately after redirect
- `undock(portId)` — Detaches guest, creates new rigid body, restores individual physics
- `getCompoundMembers()` — Walks docked partners transitively to find all members

**Obstacle exclusions during docking:**
- `Autopilot.setObstacleExclusions(spacecraft[])` — Excludes spacecraft from `PathManager.collectObstacles()`
- `DockingController` excludes the **entire target compound** (target + all docked to it) during approach and dock phases
- Cleared on cancel/complete

**Hub/Node spacecraft:**
- Configurable 2/4/6-port docking nodes (no thrusters, no solar panels)
- Created via `BasicWorld.addNodeSpacecraft(position, portCount)`
- Hub stays compound root due to port-count tiebreaker in root selection
- Supports chain docking (multiple craft to one hub)

**Docking test harness (`src/debug/DockingTestHarness.ts`):**
- Exposes `window.__dockingTest` for programmatic docking tests
- Methods: `setup()`, `start()`, `cancel()`, `status()`, `statusLine()`
- Text-based telemetry for automated verification without screenshots

### RCS Visuals & Thruster Effects

`src/scenes/objects/rcsVisuals.ts` — 24 thrusters per spacecraft with exhaust cones, point lights, and particle effects.

- **Point Lights**: Per-thruster `THREE.PointLight` for plume glow. Togglable via `setThrusterLightsEnabled()`.
- **Exhaust Particles**: Sprite-based particle system (1800 particles/sec/thruster at full thrust). Togglable via `setThrusterParticlesEnabled()`.
- **Display Settings UI**: `SettingsWindow.tsx` has global toggles (applies to ALL spacecraft via `world.getSpacecraftList()`).
- **Performance**: Both systems are major bottlenecks at scale. 18 spacecraft with effects ON = ~3 FPS. With both OFF = ~60 FPS. Needs instanced rendering for particles and light merging/limiting for point lights.

### State Management

- No Redux. Custom store in `appState.ts` with `getState()/subscribe()/setState()`.
- React hooks: `useAutopilot()`, `useUi()`, `useSettings()`, `useTraceSettings()`
- State shape: `{ autopilot, ui, settings, traces, traceSettings, dockingPlan? }`
- `simulationRuntimeStatePort.ts` provides equality-checked, frozen snapshots for the simulation layer

### Theming

Three themes (a/b/c) via CSS custom properties in `src/styles/global.css`. Theme switching is runtime via `setUiTheme()`. Tailwind CSS v4.

### Build

- Vite 7 with manual chunks: vendor (Three.js), loaders, scenes, controllers
- 19 path aliases (keep vite.config.ts and tsconfig.json in sync): @, @components, @config, @controllers, @core, @debug, @domain, @effects, @helpers, @hooks, @objects, @physics, @scenes, @shaders, @state, @styles, @types, @utils, @workers
- WASM bundle (Rapier) causes large chunks — `chunkSizeWarningLimit: 2500` is intentional

## Testing

- Framework: Node.js native test runner (`node:test`) with `assert/strict`
- Test dirs: `tests/unit/`, `tests/integration/`, `tests/architecture/`
- Legacy tool tests: `tools/tests/autopilot.test.ts`, `tools/tests/trajectory.test.ts`
- Tuner tests: `tools/autopilot-tuner/`

Run `pnpm run test` before committing. All tests must pass.

## Conventions

- **TypeScript strict mode** — no implicit any, no unused locals/params
- **No Redux** — use the custom store pattern in `src/state/`
- **Domain events** for cross-layer communication (`src/state/domain/simulationEvents.ts`)
- **Scratch vectors** — autopilot modes reuse pre-allocated THREE vectors (zero-alloc hot path)
- **Pure math where possible** — ManeuverPlanner has zero THREE.js deps for testability
- **Worker offload** — computationally intensive autopilot work goes to the web worker

## Known Issues & Active Work

**See `TODO.md` for the full actionable checklist.** Pick a task, do the work, mark it done.

Also see `memory/` files in the Claude project directory for development context. Always verify against actual code.

## Memory Protocol

AI agents working on this project MUST maintain these files:

1. **`TODO.md`** — Delete tasks when done (git history is the changelog), add new issues when discovered
2. **`CLAUDE.md`** / **`AGENTS.md`** — Update if architecture changes (keep in sync)
3. **Memory files** (Claude Code only) — Update project status after completing work

This ensures continuity across sessions and across different AI tools.

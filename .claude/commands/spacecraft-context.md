Load comprehensive context about this spacecraft autopilot simulator codebase. Use this at the start of a session to avoid redundant exploration. Read CLAUDE.md for the full reference, then use this as a quick-access cheat sheet.

---

# Spacecraft Autopilot Simulator — Session Context

## Tech Stack
- Three.js + React (Vite 7, TypeScript strict, Tailwind CSS v4)
- Rapier WASM physics (compound rigid-body docking, no joint constraints)
- Web worker for autopilot compute (`src/workers/autopilot.worker.ts`)
- Custom Zustand-like store (no Redux) in `src/state/appState.ts`
- Node.js native test runner (`node:test`)
- pnpm 10+, Node 22.x

## Commands
```
pnpm run dev              # Dev server :3000
pnpm run build            # Production build
pnpm run test             # Full: TS + unit + integration + architecture
pnpm run check:ts         # TypeScript only
pnpm run test:unit        # Unit tests only
pnpm run test:architecture # Import boundary enforcement
```

## Architecture (3 layers, boundaries enforced by `tests/architecture/importBoundaries.test.ts`)

**Data flow:** Simulation emits domain events -> domainStateBridge mutates store -> React subscribes via hooks.

### Simulation Layer (MUST NOT import src/state/*)
| Directory | Purpose |
|-----------|---------|
| `src/core/` | BasicWorld (scene lifecycle, spacecraft creation), Spacecraft (entity + compound docking), InputRouter |
| `src/controllers/autopilot/` | Autopilot (5 modes), ManeuverPlanner, PathManager, WorkerClient |
| `src/controllers/docking/` | DockingController (approach/align/dock phases), DockingUtils, DockingInfo |
| `src/core/DockingOrchestrator.ts` | Passive proximity auto-docking (runs every frame, can be disabled) |
| `src/physics/` | Rapier wrapper, engine abstraction |
| `src/scenes/` | SceneCamera, SceneLights, objects (rcsVisuals, InfiniteGrid) |
| `src/scenes/modules/` | Blueprint system (mover/node/solar), ModuleRegistry |
| `src/objects/` | AsteroidModel, AsteroidSystem (Keplerian orbits) |
| `src/workers/` | autopilot.worker.ts (GoToPosition offloaded to worker) |

### UI State Layer
| File | Purpose |
|------|---------|
| `src/state/appState.ts` | Custom store: getState/subscribe/setState |
| `src/state/domainStateBridge.ts` | Simulation events -> state mutations |
| `src/state/simulationRuntimeStatePort.ts` | Read-only frozen snapshots for sim layer |

### Presentation Layer
| Directory | Purpose |
|-----------|---------|
| `src/components/Cockpit.tsx` | Main HUD, window orchestration |
| `src/components/windows/` | Draggable UI windows (autopilot, docking, settings, etc.) |
| `src/components/hud/` | HUD elements |

## Spacecraft Types & Docking Ports

| Type | Blueprint | Ports | Capabilities |
|------|-----------|-------|-------------|
| **Mover** | `createMoverBlueprint()` | `front`(+Z), `back`(-Z) | RCS thrusters, fuel tank |
| **Node 2-port** | `createNodeBlueprint(2)` | `front`, `back` | Passive coupler, no thrusters |
| **Node 4-port** | `createNodeBlueprint(4)` | `front`, `back`, `right`(+X), `left`(-X) | Passive hub, no thrusters |
| **Node 6-port** | `createNodeBlueprint(6)` | + `top`(+Y), `bottom`(-Y) | Passive hub, no thrusters |
| **Solar** | `createSolarSpacecraftBlueprint()` | `front`, `back` | RCS, fuel, deployable solar panels |

Blueprints defined in `src/scenes/modules/blueprints.ts`.

## Docking System

### Compound Body Architecture (`src/core/spacecraft.ts`)
- `spacecraft.dock(ourPort, otherSpacecraft, theirPort)` — merges into single Rapier rigid body
- **Root selection**: prefers spacecraft with more ports (hubs stay root)
- **Position from port geometry**: world position computed from port face alignment, not initial positions
- `spacecraft.undock(portId)` — separates with impulse, creates new rigid body
- `getCompoundMembers()` — walks docked partners transitively

### DockingController Phases (`src/controllers/docking/DockingController.ts`)
1. **approach** — GoToPosition flies to standoff point along target port axis. Only target spacecraft excluded from obstacles (compound members ARE avoided). Speed limited near target.
2. **align** — CancelLinearMotion + OrientationMatch. Holds position, aligns port axis and roll.
3. **dock** — GoToPosition + OrientationMatch to final contact. Full compound excluded from obstacles. Range-based speed ramp-down.
4. **docked** — Complete. Autopilot reset on both spacecraft.

### DockingOrchestrator (`src/core/DockingOrchestrator.ts`)
- Passive auto-docking: checks all spacecraft pairs every frame
- Triggers `dock()` when `canDockWithinThresholds()` is met
- **Can be disabled** via `world.dockingOrchestrator.setEnabled(false)` (e.g. during scripted sequences)

### Pre-docking at Scene Load
`initialDocking` array in scene config with `{ sourceIndex, sourcePort, targetIndex, targetPort }` pairs.
Processed in `BasicWorld.initializeWorld()` and `loadSceneConfig()` after all spacecraft are created.

### Key Pitfalls
- **Approach phase obstacle exclusions**: Only the target spacecraft is excluded, NOT compound members. Compound members are treated as obstacles so the approach path avoids them.
- **Port occupancy**: `DockingController.startDocking()` validates port availability before starting.
- **DockingOrchestrator interference**: Disable during scripted sequences to prevent port stealing.
- **Blueprint ports include depth offset** — do not double-add when configuring.

## Autopilot System (`src/controllers/autopilot/`)

| Mode | Key | Control | File |
|------|-----|---------|------|
| orientationMatch | T | PID attitude control | `modes/OrientationMatch.ts` |
| pointToPosition | Y | Bang-bang face target | `modes/PointToPosition.ts` |
| cancelRotation | R | Damp angular velocity | `modes/CancelRotation.ts` |
| cancelLinearMotion | G | Brake to zero | `modes/CancelLinearMotion.ts` |
| goToPosition | B | 6-DOF rendezvous (worker) | `modes/GoToPosition.ts` |

**Key components:**
- `Autopilot.ts` — Mode orchestrator, worker dispatch, obstacle exclusion management
- `ManeuverPlanner.ts` — Pure math (no THREE.js deps), bang-coast-bang profiles
- `ManeuverExecutor.ts` — State machine for executing plans
- `PathManager.ts` — Multi-segment paths, obstacle detection, exclusion filtering
- `ObstacleAvoidance.ts` — O(n) tangent-point waypoint algorithm
- `ModeRegistry.ts` — Mutual exclusivity within rotation/translation groups
- `WorkerClient.ts` — Worker lifecycle, message routing

## Scene System

### Presets (`src/config/scenePresets.ts`)
default, solo, pair, station, fleet, large-fleet, asteroid-field, dense-asteroids, solar-array, scattered.
Runtime config: `src/config/config.json`. Load: `__scene.loadPreset('solo')`.

### SceneObjectConfig Fields
- `initialSpacecraft[]` — position, blueprintType, name, portCount, solarParams, etc.
- `initialDocking[]` — pre-dock pairs (sourceIndex/sourcePort/targetIndex/targetPort)
- `asteroids[]`, `asteroidSystem` — static and orbital asteroid configs
- `initialFocus` — index of initially active spacecraft

## Debug Interfaces (browser console)
- `window.__autopilot` — AutopilotLLMInterface: `getStatus()`, `getTools()`, tool calls
- `window.__dockingTest` — DockingTestHarness:
  - `setup()`, `start()`, `cancel()`, `status()`, `statusLine()`
  - `dockSequence([{source, sourcePort, target, targetPort}])` — sequential multi-dock
  - `abortSequence()` — cancel running sequence
  - `monitorSummary()`, `monitorLog()` — collision/clearance tracking
- `window.__scene` — SceneLLMInterface: `loadPreset()`, `getAvailablePresets()`
- Access world: `window.__scene.world` (BasicWorld instance)

## Performance Notes
- **RCS visuals** are the main bottleneck: point lights + particle sprites per thruster
- Disable for many spacecraft: `s.rcsVisuals.setThrusterLightsEnabled(false)` / `setThrusterParticlesEnabled(false)`
- 12 spacecraft + effects = ~2 FPS; effects off = 120 FPS
- Apply to all: `world.getSpacecraftList().forEach(s => { s.rcsVisuals.setThrusterLightsEnabled(false); s.rcsVisuals.setThrusterParticlesEnabled(false); })`

## Files to Read First

| Task | Key Files |
|------|-----------|
| Scene/spacecraft | `src/config/scenePresets.ts`, `src/core/BasicWorld.ts`, `src/core/spacecraft.ts` |
| Autopilot | `src/controllers/autopilot/Autopilot.ts`, `src/controllers/autopilot/modes/` |
| Docking | `src/controllers/docking/DockingController.ts`, `src/core/spacecraft.ts` (dock/undock) |
| Docking debug | `src/debug/DockingTestHarness.ts`, `src/core/DockingOrchestrator.ts` |
| UI | `src/components/Cockpit.tsx`, `src/components/windows/` |
| Blueprints | `src/scenes/modules/blueprints.ts`, `src/scenes/modules/SpacecraftBlueprint.ts` |
| State | `src/state/appState.ts`, `src/state/domainStateBridge.ts` |
| Physics | `src/physics/`, `src/core/spacecraft.ts` (RigidBodyProxy, compound body) |

## Path Aliases (keep vite.config.ts + tsconfig.json in sync)
@, @components, @config, @controllers, @core, @debug, @domain, @effects, @helpers, @hooks, @objects, @physics, @scenes, @shaders, @state, @styles, @types, @utils, @workers

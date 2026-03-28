# Copilot Instructions — Spacecraft Autopilot Simulator

## Project Context

Three.js + React 19 cockpit simulator with Rapier (WASM) physics, modular autopilot (5 modes), and web worker computation. TypeScript strict mode. Vite 7. Tailwind CSS v4. pnpm 10+, Node 22.x.

## Critical Rules

1. **Never import `src/state/*` from simulation code** (`src/core/`, `src/controllers/`, `src/physics/`, `src/scenes/`, `src/objects/`, `src/helpers/`, `src/workers/`). This boundary is test-enforced.
2. **No Redux** — use the custom store in `src/state/appState.ts`.
3. **Domain events** for cross-layer communication, not direct store access from simulation.
4. **Zero-allocation hot paths** — autopilot modes use pre-allocated scratch vectors. Don't create new THREE.Vector3/Quaternion in update loops.
5. **Worker offload** — computationally intensive autopilot logic runs in `src/workers/autopilot.worker.ts`.
6. **Tests use `node:test`** with `assert/strict` — NOT Jest or Vitest.

## Architecture

```
Simulation (core/, controllers/, physics/, scenes/, workers/)
    → emits domain events (simulationEvents.ts)
    → domainStateBridge.ts mutates store
    → React hooks (useSyncExternalStore) → components
```

## Autopilot System

5 modes in `src/controllers/autopilot/`: orientationMatch, pointToPosition, cancelRotation, cancelLinearMotion, goToPosition. Base class `AutopilotMode.ts` provides scratch vectors, inertia calc, thruster capacity tracking.

Key: `ManeuverPlanner.ts` is pure math (no THREE.js). `AutopilotLLMInterface.ts` exposes JSON API on `window.__autopilot`.

## Style

- Tailwind CSS v4 with CSS custom properties for 3 themes (a=cyan, b=slate, c=sky)
- 10 Vite path aliases: @, @components, @styles, @scenes, @controllers, @helpers, @core, @utils, @config
- Rapier WASM causes large chunks — `chunkSizeWarningLimit: 2500` is intentional

## TODOs

See `TODO.md` for the actionable task list with priorities.

## When Suggesting Code

- Prefer editing existing files over creating new ones
- Follow the existing custom store pattern, not Redux
- Use domain events for simulation→UI communication
- Keep ManeuverPlanner-style modules THREE.js-free for testability
- Run `pnpm run test` to validate changes

# Spacecraft Autopilot Simulator

A Three.js + React cockpit simulator with a physics-backed spacecraft and modular autopilot modes.

## Features

- Realistic rigid‑body dynamics via Rapier (WASM)
- Modular autopilot: orientation match, cancel rotation/linear motion, point‑to‑position, go‑to‑position
- RCS thruster visualization and helper arrows
- Docking ports with cameras and optional lights
- React UI windows for telemetry, PID tuning, docking, cameras, etc.

## Requirements

- Node.js 22.12.0 (recommended). Vite supports 20.19+ or 22.12+.
- npm 10+ (bundled with Node 22)

Use `nvm use` to match `.nvmrc`.

## Setup

1) Install dependencies

```bash
npm install
```

2) Start dev server

```bash
npm run dev
```

3) Production build

```bash
npm run build
```

## Testing & Tuning

### Automated Autopilot Testing

The project includes an automated testing and parameter optimization framework for the autopilot system.

**Quick Start:**

```bash
# Test current autopilot parameters
npm run tune

# Optimize parameters (finds best settings automatically)
npm run tune:optimize

# Visualize optimization results
npm run tune:visualize
```

**Why use this?**

- Automatically test collision avoidance across 7 diverse scenarios
- Find optimal PID and guidance parameters without manual trial-and-error
- Measure safety metrics: collision counts, minimum distances, success rates
- Compare parameter configurations objectively

See `tools/autopilot-tuner/README.md` for detailed guide.

### Other Useful Scripts

- `npm run check:ts` – TypeScript check
- `npm run test:physics` – Rapier collision sanity test
- `npm run test:ap` – Autopilot unit tests
- `npm run test:traj` – Trajectory planner tests

## Controls

Manual translation (local axes)

- U/O: +Z forward / −Z backward
- J/L: −X left / +X right
- K/I: +Y up / −Y down

Manual rotation

- W/S: +pitch / −pitch
- A/D: +yaw / −yaw
- Q/E: +roll / −roll

Autopilot toggles

- T: Orientation Match
- Y: Point To Position
- R: Cancel Rotation
- G: Cancel Linear Motion
- B: Go To Position

Open the Autopilot window to set a custom position target or follow another spacecraft.

## Notes

- Large WASM/vendor chunks are expected (Rapier). Build warnings are suppressed via `chunkSizeWarningLimit`.
- If you see Node version warnings, upgrade to Node 22.12.0 (`nvm use`).

## Project Structure (high level)

```text
src/
  components/           # React cockpit windows & UI
  controllers/          # Autopilot modes, docking, visualization
  core/                 # World, renderer, spacecraft shell
  objects/              # Scene objects (asteroids, systems)
  physics/              # Engine abstraction + Rapier wrapper
  scenes/               # Scene setup, helpers, objects
  styles/               # Global styles
  workers/              # Autopilot compute worker
```

## License

ISC

## Deployment

Vercel (recommended)

- Connect this GitHub repository to Vercel (New Project → Import Git Repository).
- Framework Preset: Vite (auto-detected).
- Build Command: `npm run build` (auto-detected).
- Output Directory: `dist` (auto-detected).
- Node.js Version: 22.x. Vercel respects the `engines.node` field in `package.json` and you can also set it in Project Settings → General → Node.js Version.

Environment

- No runtime env vars are required by default.
- If you add any, configure them in Vercel Project Settings → Environment Variables.

Production flow

- Pushing to `main` triggers a production deployment.
- Pull requests create preview deployments per-branch.

Status badge (optional)

- In Vercel Project → Settings → Git → Badges, enable and copy the Markdown to add a live status badge at the top of this README.

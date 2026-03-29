# TODO — Spacecraft Autopilot Simulator

> **For AI agents:** Pick a task, do the work, then **delete it** from this file.
> Log what you did in your commit message — that's the record.
> If you discover new issues while working, add them here.
> Keep this file short. No completed section — git history is the changelog.

## Critical — Bugs

- [ ] **Asteroid-scale obstacle avoidance** — tangent-point waypoints produce wrong detour paths for obstacles >143m radius. `ObstacleAvoidance.computeAvoidanceWaypoints()` detects blocking correctly but entry/tangent/exit point geometry is incorrect for large radii. This is the primary active bug.
- [ ] **TrajectoryPlanner.ts voxel A* scaling** — 18K-line file, voxel grid can't handle asteroid-scale obstacles (grid becomes too large). Needs rethink — either adaptive resolution, hierarchical grid, or replace with the tangent-point approach once it's fixed.

## High Priority — Missing Features

- [ ] **SettingsWindow.tsx enhancements** — theme selector, attitude sphere texture picker, and thruster effects toggles (point lights + exhaust particles) are done. Could still add: camera mode toggle (follow/free), grid visibility toggle, trace settings, performance display options. Low priority since these controls exist in other windows (HelperArrowsWindow has grid/trace, top bar has camera mode).
- [ ] **Unit tests for ObstacleAvoidance** — the tangent-point math (where the critical bug is) has zero unit tests. Write targeted tests before attempting the fix.

## Medium Priority — Performance

- [ ] **Thruster particle system scaling** — exhaust particles use individual THREE.Sprite per particle (1800/sec/thruster × 24 thrusters = 43K sprites/sec per spacecraft). With 18 spacecraft this kills FPS (~3 FPS). Needs instanced rendering (InstancedMesh or InstancedBufferGeometry) or GPU particle system. Toggle exists in Display Settings as workaround.
- [ ] **Thruster point light scaling** — 24 PointLights per spacecraft (432 total with 18 craft) also tanks FPS to ~3. Consider baked lighting, light merging, or limiting active lights. Toggle exists in Display Settings as workaround.

## Medium Priority — Code Quality

- [ ] **ESLint + Prettier setup** — no linting or formatting config exists. Add configs compatible with React 19, TypeScript 5.9, Tailwind v4.
- [ ] **spacecraftController.ts:194 placeholder** — `handleManualControl()` has a placeholder comment with empty key-handling logic. Verify if this is dead code or needs implementation.

## Low Priority — Future Enhancements

- [ ] **Docking alignment mode** — target docking ports are referenced in `TargetTracker.ts` but no full docking protocol (soft-capture, alignment sequence) exists
- [ ] **Graphical debug overlays** — no visualization for control vectors, deadbands, trajectory predictions, or avoidance waypoints
- [ ] **Energy/fuel tracking** — no fuel consumption or specific impulse modeling beyond thruster force magnitudes
- [ ] **Sensor simulation** — no IMU noise model, sensor fusion, or accelerometer/gyro simulation
- [ ] **Thruster failure recovery** — no degraded-mode operation or fault detection
- [ ] **Multi-spacecraft coordination** — other spacecraft treated as static obstacles in PathManager

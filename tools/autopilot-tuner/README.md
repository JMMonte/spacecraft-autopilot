# Autopilot Tuner

Automated collision testing and parameter optimization for the spacecraft autopilot.

## Quick Commands

```bash
# Test current parameters
npm run tune

# Optimize (takes 10-15 min)
npm run tune:optimize

# Full-physics test with real autopilot (fuel-focused)
npm run tune:full

# Full-physics optimization (fuel-focused)
npm run tune:optimize:full

# Tighten all scenario fuel budgets by 20%
npm run tune -- --engine full --objective fuel --fuel-budget-scale 0.8

# Evaluate scenarios in parallel per candidate parameter set
npm run tune -- --mode optimize --engine full --objective fuel --parallel-tests 4

# Visualize results
npm run tune:visualize
```

## Key Improvements

✅ **Proper Safety Boxes**: Now uses actual spacecraft dimensions (half-extents: 0.5x0.5x1.0m) and adds configurable safety margins (default 0.75m) around all obstacles

✅ **Surface-to-Surface Distance**: Measures minimum clearance between surfaces, not centers

✅ **Realistic Obstacle Sizes**: All test scenarios use half-extents matching the physics collider format

✅ **Collision Detection**: Physics simulation with Rapier matches your actual game

## How It Works

1. **Scenarios** - 7 test scenarios with obstacles of varying sizes
2. **Physics Sim** - Rapier headless simulation matches game physics exactly
3. **Full Mode** - Optional real `Autopilot` + real thruster mapping in the loop (`--engine full`)
4. **Fuel Objective** - Optional fuel-prioritized scoring (`--objective fuel`)
5. **Hard Fuel Budget Gate** - Each scenario has a fuel budget; runs over budget score as failure
6. **Safety Margins** - Obstacles are inflated by `safetyMargin` (0.75m default) to test conservative navigation
7. **Metrics** - Collisions, minimum clearance, success rate, time, fuel usage
8. **Optimization** - Tries different parameter combinations, finds best scores

## Custom Spacecraft Sizes

Edit `ScenarioGenerator.ts` to match your spacecraft:

```typescript
private static readonly DEFAULT_SPACECRAFT_HALF_EXTENTS = new THREE.Vector3(0.5, 0.5, 1.0);
private static readonly DEFAULT_SAFETY_MARGIN = 0.75;
```

## Safety Margin Tuning

- **0.5m** - Aggressive, risky navigation
- **0.75m** - Default, balanced
- **1.0m+** - Conservative, slower but safer

The tuner inflates obstacle colliders by this amount during testing, so the autopilot learns to keep proper clearance.

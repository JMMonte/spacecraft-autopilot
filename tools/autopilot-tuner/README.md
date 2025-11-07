# Autopilot Tuner

Automated collision testing and parameter optimization for the spacecraft autopilot.

## Quick Commands

```bash
# Test current parameters
npm run tune

# Optimize (takes 10-15 min)
npm run tune:optimize

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
3. **Safety Margins** - Obstacles are inflated by `safetyMargin` (0.75m default) to test conservative navigation
4. **Metrics** - Collisions, minimum clearance, success rate, time, fuel usage
5. **Optimization** - Tries different parameter combinations, finds best scores

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

/**
 * Test Scenario Generator
 * Creates diverse test scenarios for autopilot collision testing
 */

import * as THREE from 'three';
import type { TestScenario } from './CollisionTester';

export class ScenarioGenerator {
  // Default spacecraft dimensions (half-extents matching game default: 1x1x2 => 0.5, 0.5, 1.0)
  private static readonly DEFAULT_SPACECRAFT_HALF_EXTENTS = new THREE.Vector3(0.5, 0.5, 1.0);
  private static readonly DEFAULT_SPACECRAFT_MASS = 1000;
  private static readonly DEFAULT_SAFETY_MARGIN = 0.75; // meters clearance around obstacles

  /**
   * Generate a simple corridor scenario with walls
   */
  static corridor(
    length: number = 50,
    width: number = 8,
    numObstacles: number = 5
  ): TestScenario {
    const obstacles: TestScenario['obstacles'] = [];

    // Create corridor walls
    for (let i = 0; i < numObstacles; i++) {
      const z = (i / (numObstacles - 1)) * length - length / 2;

      // Left wall segment (half-extents)
      obstacles.push({
        position: new THREE.Vector3(-width / 2, 0, z),
        halfExtents: new THREE.Vector3(1, 2, 3), // 2x4x6 full size
        type: 'box'
      });

      // Right wall segment
      obstacles.push({
        position: new THREE.Vector3(width / 2, 0, z),
        halfExtents: new THREE.Vector3(1, 2, 3),
        type: 'box'
      });
    }

    return {
      name: 'corridor',
      startPosition: new THREE.Vector3(0, 0, -length / 2 + 5),
      startOrientation: new THREE.Quaternion(),
      targetPosition: new THREE.Vector3(0, 0, length / 2 - 5),
      obstacles,
      spacecraftHalfExtents: this.DEFAULT_SPACECRAFT_HALF_EXTENTS,
      spacecraftMass: this.DEFAULT_SPACECRAFT_MASS,
      maxSimulationTime: 120,
      successThreshold: 1.0,
      safetyMargin: this.DEFAULT_SAFETY_MARGIN
    };
  }

  /**
   * Generate a slalom scenario with alternating obstacles
   */
  static slalom(numGates: number = 6, spacing: number = 12): TestScenario {
    const obstacles: TestScenario['obstacles'] = [];

    for (let i = 0; i < numGates; i++) {
      const z = i * spacing;
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * 5;

      obstacles.push({
        position: new THREE.Vector3(x, 0, z),
        halfExtents: new THREE.Vector3(1.5, 1.5, 1.5), // 3m diameter sphere
        type: 'sphere'
      });
    }

    return {
      name: 'slalom',
      startPosition: new THREE.Vector3(0, 0, -10),
      startOrientation: new THREE.Quaternion(),
      targetPosition: new THREE.Vector3(0, 0, numGates * spacing + 10),
      obstacles,
      spacecraftHalfExtents: this.DEFAULT_SPACECRAFT_HALF_EXTENTS,
      spacecraftMass: this.DEFAULT_SPACECRAFT_MASS,
      maxSimulationTime: 120,
      successThreshold: 1.0,
      safetyMargin: this.DEFAULT_SAFETY_MARGIN
    };
  }

  /**
   * Generate a dense asteroid field scenario
   */
  static asteroidField(
    fieldSize: number = 60,
    numAsteroids: number = 20,
    seed: number = 42
  ): TestScenario {
    const obstacles: TestScenario['obstacles'] = [];
    const random = this.seededRandom(seed);

    // Create a path corridor by avoiding placing obstacles in a direct line
    const start = new THREE.Vector3(-fieldSize / 2, 0, 0);
    const target = new THREE.Vector3(fieldSize / 2, 0, 0);
    const pathDir = new THREE.Vector3().subVectors(target, start).normalize();

    for (let i = 0; i < numAsteroids; i++) {
      let position: THREE.Vector3;
      let attempts = 0;

      // Try to place asteroid not directly in the path
      do {
        position = new THREE.Vector3(
          (random() - 0.5) * fieldSize,
          (random() - 0.5) * fieldSize * 0.3,
          (random() - 0.5) * fieldSize * 0.3
        );

        // Check distance to direct path
        const toPoint = new THREE.Vector3().subVectors(position, start);
        const projection = toPoint.dot(pathDir);
        const closestOnPath = start.clone().add(pathDir.clone().multiplyScalar(projection));
        const distanceToPath = position.distanceTo(closestOnPath);

        if (distanceToPath > 8 || attempts > 20) break;
        attempts++;
      } while (attempts < 30);

      const radius = 1 + random() * 2; // 2-6m diameter asteroids

      obstacles.push({
        position,
        halfExtents: new THREE.Vector3(radius, radius, radius),
        type: 'sphere'
      });
    }

    return {
      name: 'asteroidField',
      startPosition: start.clone(),
      startOrientation: new THREE.Quaternion(),
      targetPosition: target.clone(),
      obstacles,
      spacecraftHalfExtents: this.DEFAULT_SPACECRAFT_HALF_EXTENTS,
      spacecraftMass: this.DEFAULT_SPACECRAFT_MASS,
      maxSimulationTime: 180,
      successThreshold: 1.0,
      safetyMargin: this.DEFAULT_SAFETY_MARGIN
    };
  }

  /**
   * Generate a tight space docking scenario
   */
  static docking(approachDistance: number = 20): TestScenario {
    const obstacles: TestScenario['obstacles'] = [];

    // Station structure - create a box with an opening
    const stationSize = 30;

    // Top wall
    obstacles.push({
      position: new THREE.Vector3(0, stationSize / 2 + 5, 0),
      halfExtents: new THREE.Vector3(stationSize / 2, 1, stationSize / 2),
      type: 'box'
    });

    // Bottom wall
    obstacles.push({
      position: new THREE.Vector3(0, -stationSize / 2 - 5, 0),
      halfExtents: new THREE.Vector3(stationSize / 2, 1, stationSize / 2),
      type: 'box'
    });

    // Left wall (with opening)
    obstacles.push({
      position: new THREE.Vector3(-stationSize / 2 - 3, 0, -10),
      halfExtents: new THREE.Vector3(1, stationSize / 2, 5),
      type: 'box'
    });
    obstacles.push({
      position: new THREE.Vector3(-stationSize / 2 - 3, 0, 10),
      halfExtents: new THREE.Vector3(1, stationSize / 2, 5),
      type: 'box'
    });

    // Right wall
    obstacles.push({
      position: new THREE.Vector3(stationSize / 2 + 3, 0, 0),
      halfExtents: new THREE.Vector3(1, stationSize / 2, stationSize / 2),
      type: 'box'
    });

    // Back wall (with docking port)
    obstacles.push({
      position: new THREE.Vector3(0, 5, stationSize / 2 + 3),
      halfExtents: new THREE.Vector3(stationSize / 2, 5, 1),
      type: 'box'
    });
    obstacles.push({
      position: new THREE.Vector3(0, -5, stationSize / 2 + 3),
      halfExtents: new THREE.Vector3(stationSize / 2, 5, 1),
      type: 'box'
    });
    obstacles.push({
      position: new THREE.Vector3(-8, 0, stationSize / 2 + 3),
      halfExtents: new THREE.Vector3(5, 2.5, 1),
      type: 'box'
    });
    obstacles.push({
      position: new THREE.Vector3(8, 0, stationSize / 2 + 3),
      halfExtents: new THREE.Vector3(5, 2.5, 1),
      type: 'box'
    });

    return {
      name: 'docking',
      startPosition: new THREE.Vector3(-approachDistance, 0, 0),
      startOrientation: new THREE.Quaternion(),
      targetPosition: new THREE.Vector3(0, 0, stationSize / 2 - 2),
      obstacles,
      spacecraftHalfExtents: this.DEFAULT_SPACECRAFT_HALF_EXTENTS,
      spacecraftMass: this.DEFAULT_SPACECRAFT_MASS,
      maxSimulationTime: 180,
      successThreshold: 0.5,
      safetyMargin: this.DEFAULT_SAFETY_MARGIN
    };
  }

  /**
   * Generate a narrow gap scenario
   */
  static narrowGap(gapWidth: number = 4): TestScenario {
    const obstacles: TestScenario['obstacles'] = [];

    // Large obstacles on either side
    obstacles.push({
      position: new THREE.Vector3(-5, 0, 20),
      halfExtents: new THREE.Vector3(4, 7.5, 4),
      type: 'box'
    });

    obstacles.push({
      position: new THREE.Vector3(5, 0, 20),
      halfExtents: new THREE.Vector3(4, 7.5, 4),
      type: 'box'
    });

    // Additional obstacles after the gap
    obstacles.push({
      position: new THREE.Vector3(0, 7, 35),
      halfExtents: new THREE.Vector3(2, 2, 2),
      type: 'sphere'
    });

    return {
      name: 'narrowGap',
      startPosition: new THREE.Vector3(0, 0, 0),
      startOrientation: new THREE.Quaternion(),
      targetPosition: new THREE.Vector3(0, 0, 50),
      obstacles,
      spacecraftHalfExtents: this.DEFAULT_SPACECRAFT_HALF_EXTENTS,
      spacecraftMass: this.DEFAULT_SPACECRAFT_MASS,
      maxSimulationTime: 120,
      successThreshold: 1.0,
      safetyMargin: this.DEFAULT_SAFETY_MARGIN
    };
  }

  /**
   * Generate an emergency avoidance scenario
   * Spacecraft starts heading toward obstacle, must avoid quickly
   */
  static emergencyAvoidance(): TestScenario {
    const obstacles: TestScenario['obstacles'] = [];

    // Large obstacle directly in path
    obstacles.push({
      position: new THREE.Vector3(0, 0, 15),
      halfExtents: new THREE.Vector3(5, 5, 5),
      type: 'sphere'
    });

    return {
      name: 'emergencyAvoidance',
      startPosition: new THREE.Vector3(0, 0, 0),
      startOrientation: new THREE.Quaternion(),
      targetPosition: new THREE.Vector3(0, 0, 40),
      obstacles,
      spacecraftHalfExtents: this.DEFAULT_SPACECRAFT_HALF_EXTENTS,
      spacecraftMass: this.DEFAULT_SPACECRAFT_MASS,
      maxSimulationTime: 90,
      successThreshold: 1.0,
      safetyMargin: this.DEFAULT_SAFETY_MARGIN
    };
  }

  /**
   * Generate a multi-obstacle maze scenario
   */
  static maze(): TestScenario {
    const obstacles: TestScenario['obstacles'] = [];

    // Create a simple maze pattern
    const wallConfigs = [
      { x: -8, z: 10, width: 8, depth: 2 },
      { x: 8, z: 10, width: 8, depth: 2 },
      { x: 0, z: 25, width: 12, depth: 2 },
      { x: -8, z: 40, width: 8, depth: 2 },
      { x: 8, z: 40, width: 8, depth: 2 },
    ];

    for (const wall of wallConfigs) {
      obstacles.push({
        position: new THREE.Vector3(wall.x, 0, wall.z),
        halfExtents: new THREE.Vector3(wall.width / 2, 3, wall.depth / 2),
        type: 'box'
      });
    }

    return {
      name: 'maze',
      startPosition: new THREE.Vector3(0, 0, 0),
      startOrientation: new THREE.Quaternion(),
      targetPosition: new THREE.Vector3(0, 0, 55),
      obstacles,
      spacecraftHalfExtents: this.DEFAULT_SPACECRAFT_HALF_EXTENTS,
      spacecraftMass: this.DEFAULT_SPACECRAFT_MASS,
      maxSimulationTime: 150,
      successThreshold: 1.0,
      safetyMargin: this.DEFAULT_SAFETY_MARGIN
    };
  }

  /**
   * Get all predefined scenarios
   */
  static getAllScenarios(): TestScenario[] {
    return [
      this.corridor(),
      this.slalom(),
      this.asteroidField(),
      this.docking(),
      this.narrowGap(),
      this.emergencyAvoidance(),
      this.maze()
    ];
  }

  /**
   * Simple seeded random number generator for reproducible tests
   */
  private static seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }
}


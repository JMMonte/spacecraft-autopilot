/**
 * Collision Testing Framework for Autopilot
 * Simulates spacecraft navigation with physics to detect collisions and measure safety
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface TestScenario {
  name: string;
  startPosition: THREE.Vector3;
  startOrientation: THREE.Quaternion;
  targetPosition: THREE.Vector3;
  obstacles: Array<{
    position: THREE.Vector3;
    halfExtents: THREE.Vector3; // Half-extents (same as spacecraft dimensions)
    type: 'box' | 'sphere';
  }>;
  spacecraftHalfExtents: THREE.Vector3; // Half-extents matching getMainBodyDimensions()
  spacecraftMass: number;
  maxSimulationTime: number; // seconds
  successThreshold: number; // distance to target to consider success
  safetyMargin: number; // Additional clearance around obstacles (meters)
}

export interface CollisionEvent {
  time: number;
  position: THREE.Vector3;
  obstacleIndex: number;
  velocity: number;
  severity: 'minor' | 'major' | 'critical';
}

export interface SafetyMetrics {
  collisions: CollisionEvent[];
  minDistanceToObstacles: number;
  timeToTarget: number;
  success: boolean;
  finalDistance: number;
  pathEfficiency: number; // actual path length / direct distance
  averageSpeed: number;
  maxSpeed: number;
  fuelUsed: number; // total thrust magnitude integrated over time
}

export interface AutopilotParameters {
  // Position PID
  positionKp: number;
  positionKi: number;
  positionKd: number;

  // Velocity PID
  velocityKp: number;
  velocityKi: number;
  velocityKd: number;

  // Guidance
  maxApproachSpeed: number;
  brakingMargin: number;

  // Alignment gate
  alignGateOnDeg: number;
  alignGateOffDeg: number;

  // Path planning
  deviationThreshold: number;
  replanInterval: number;
}

export interface SimulationState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  orientation: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  time: number;
}

/**
 * Physics-based collision tester for autopilot evaluation
 */
export class CollisionTester {
  private RAPIER: typeof RAPIER | null = null;

  constructor() { }

  async initialize(): Promise<void> {
    const R = await import('@dimforge/rapier3d-compat');
    await R.init();
    this.RAPIER = R;
  }

  /**
   * Run a complete test scenario and return safety metrics
   */
  async runScenario(
    scenario: TestScenario,
    params: AutopilotParameters,
    onProgress?: (state: SimulationState, metrics: Partial<SafetyMetrics>) => void
  ): Promise<SafetyMetrics> {
    if (!this.RAPIER) throw new Error('RAPIER not initialized');

    const R = this.RAPIER;
    const world = new R.World({ x: 0, y: 0, z: 0 }); // zero gravity for space

    // Create spacecraft rigid body
    const spacecraftDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(scenario.startPosition.x, scenario.startPosition.y, scenario.startPosition.z)
      .setRotation({
        x: scenario.startOrientation.x,
        y: scenario.startOrientation.y,
        z: scenario.startOrientation.z,
        w: scenario.startOrientation.w
      })
      .setLinearDamping(0)
      .setAngularDamping(0);

    const spacecraftBody = world.createRigidBody(spacecraftDesc);

    // Use half-extents directly (matching spacecraft.getMainBodyDimensions())
    const spacecraftCollider = R.ColliderDesc.cuboid(
      scenario.spacecraftHalfExtents.x,
      scenario.spacecraftHalfExtents.y,
      scenario.spacecraftHalfExtents.z
    ).setMass(scenario.spacecraftMass)
      .setSensor(false);

    world.createCollider(spacecraftCollider, spacecraftBody);

    // Create obstacles with safety margins
    const obstacleHandles: RAPIER.RigidBody[] = [];
    for (let i = 0; i < scenario.obstacles.length; i++) {
      const obs = scenario.obstacles[i];
      const obstacleDesc = R.RigidBodyDesc.fixed()
        .setTranslation(obs.position.x, obs.position.y, obs.position.z);
      const obstacleBody = world.createRigidBody(obstacleDesc);

      let colliderDesc: RAPIER.ColliderDesc;
      if (obs.type === 'sphere') {
        // For sphere, add safety margin to radius
        const baseRadius = Math.max(obs.halfExtents.x, obs.halfExtents.y, obs.halfExtents.z);
        const safeRadius = baseRadius + scenario.safetyMargin;
        colliderDesc = R.ColliderDesc.ball(safeRadius);
      } else {
        // For box, add safety margin to each half-extent
        colliderDesc = R.ColliderDesc.cuboid(
          obs.halfExtents.x + scenario.safetyMargin,
          obs.halfExtents.y + scenario.safetyMargin,
          obs.halfExtents.z + scenario.safetyMargin
        );
      }

      world.createCollider(colliderDesc, obstacleBody);
      obstacleHandles.push(obstacleBody);
    }

    // Simulation parameters
    const dt = 1 / 60; // 60 Hz simulation
    const maxSteps = Math.floor(scenario.maxSimulationTime / dt);

    // Metrics tracking
    const collisions: CollisionEvent[] = [];
    let minDistanceToObstacles = Infinity;
    let totalPathLength = 0;
    let totalThrustMagnitude = 0;
    let maxSpeed = 0;
    let success = false;
    let finalDistance = Infinity;

    let previousPosition = scenario.startPosition.clone();

    // Simulation loop
    for (let step = 0; step < maxSteps; step++) {
      const time = step * dt;

      // Get current state
      const trans = spacecraftBody.translation();
      const rot = spacecraftBody.rotation();
      const linVel = spacecraftBody.linvel();
      const angVel = spacecraftBody.angvel();

      const currentPosition = new THREE.Vector3(trans.x, trans.y, trans.z);
      const currentVelocity = new THREE.Vector3(linVel.x, linVel.y, linVel.z);
      const currentOrientation = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
      const currentAngularVelocity = new THREE.Vector3(angVel.x, angVel.y, angVel.z);

      // Calculate distance to target
      const distanceToTarget = currentPosition.distanceTo(scenario.targetPosition);
      finalDistance = distanceToTarget;

      // Check for success
      if (distanceToTarget <= scenario.successThreshold) {
        success = true;
        break;
      }

      // Update path length
      totalPathLength += currentPosition.distanceTo(previousPosition);
      previousPosition.copy(currentPosition);

      // Track max speed
      const speed = currentVelocity.length();
      maxSpeed = Math.max(maxSpeed, speed);

      // Calculate minimum distance to obstacles (surface-to-surface)
      const spacecraftRadius = Math.max(
        scenario.spacecraftHalfExtents.x,
        scenario.spacecraftHalfExtents.y,
        scenario.spacecraftHalfExtents.z
      );

      for (let i = 0; i < scenario.obstacles.length; i++) {
        const obs = scenario.obstacles[i];
        const centerDistance = currentPosition.distanceTo(obs.position);

        // Calculate surface-to-surface distance
        let obstacleRadius: number;
        if (obs.type === 'sphere') {
          obstacleRadius = Math.max(obs.halfExtents.x, obs.halfExtents.y, obs.halfExtents.z);
        } else {
          // For box, use max half-extent as approximate radius
          obstacleRadius = Math.max(obs.halfExtents.x, obs.halfExtents.y, obs.halfExtents.z);
        }

        const surfaceDistance = centerDistance - spacecraftRadius - obstacleRadius;
        minDistanceToObstacles = Math.min(minDistanceToObstacles, Math.max(0, surfaceDistance));
      }

      // Check for collisions
      world.contactPairsWith(spacecraftBody.collider(0), (otherCollider) => {
        const otherBody = otherCollider.parent();
        if (!otherBody) return;

        const obstacleIndex = obstacleHandles.findIndex(h => h.handle === otherBody.handle);
        if (obstacleIndex >= 0) {
          const severity = speed > 2.0 ? 'critical' : speed > 0.5 ? 'major' : 'minor';
          collisions.push({
            time,
            position: currentPosition.clone(),
            obstacleIndex,
            velocity: speed,
            severity
          });
        }
      });

      // Calculate autopilot forces (simplified version for testing)
      const forces = this.calculateAutopilotForces(
        currentPosition,
        currentVelocity,
        currentOrientation,
        scenario.targetPosition,
        params,
        scenario.spacecraftMass,
        dt
      );

      totalThrustMagnitude += forces.linear.length() * dt;

      // Apply forces
      spacecraftBody.addForce({ x: forces.linear.x, y: forces.linear.y, z: forces.linear.z }, true);
      spacecraftBody.addTorque({ x: forces.angular.x, y: forces.angular.y, z: forces.angular.z }, true);

      // Step physics
      world.step();

      // Progress callback
      if (onProgress && step % 10 === 0) {
        onProgress(
          {
            position: currentPosition,
            velocity: currentVelocity,
            orientation: currentOrientation,
            angularVelocity: currentAngularVelocity,
            time
          },
          {
            minDistanceToObstacles,
            collisions: [...collisions],
            finalDistance
          }
        );
      }
    }

    // Calculate metrics
    const directDistance = scenario.startPosition.distanceTo(scenario.targetPosition);
    const pathEfficiency = directDistance > 0 ? directDistance / totalPathLength : 0;
    const timeToTarget = (previousPosition.distanceTo(scenario.startPosition) / dt) * dt;
    const averageSpeed = totalPathLength / Math.max(timeToTarget, 0.001);

    world.free();

    return {
      collisions,
      minDistanceToObstacles,
      timeToTarget,
      success,
      finalDistance,
      pathEfficiency,
      averageSpeed,
      maxSpeed,
      fuelUsed: totalThrustMagnitude
    };
  }

  /**
   * Simplified autopilot force calculation for testing
   * This mimics the GoToPosition controller logic
   */
  private calculateAutopilotForces(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    orientation: THREE.Quaternion,
    target: THREE.Vector3,
    params: AutopilotParameters,
    mass: number,
    dt: number
  ): { linear: THREE.Vector3; angular: THREE.Vector3 } {
    // Position error
    const posError = new THREE.Vector3().subVectors(target, position);
    const distance = posError.length();

    if (distance < 0.01) {
      return { linear: new THREE.Vector3(), angular: new THREE.Vector3() };
    }

    const direction = posError.clone().normalize();

    // Calculate safe approach velocity
    const aBrake = 2.0; // simplified braking acceleration
    const vSafe = Math.sqrt(2 * aBrake * distance) / params.brakingMargin;
    const vCmd = Math.min(params.maxApproachSpeed, vSafe);

    // Commanded velocity
    const vCmdVec = direction.clone().multiplyScalar(vCmd);

    // Velocity error
    const vError = new THREE.Vector3().subVectors(vCmdVec, velocity);

    // PID control on velocity
    const accel = vError.clone().multiplyScalar(params.velocityKp);
    const force = accel.clone().multiplyScalar(mass);

    // Limit force
    const maxForce = 100; // Newton
    if (force.length() > maxForce) {
      force.setLength(maxForce);
    }

    // For now, no orientation control (simplified)
    const angularForce = new THREE.Vector3();

    return { linear: force, angular: angularForce };
  }

  /**
   * Calculate a safety score from metrics (0 = worst, 1 = best)
   */
  static calculateSafetyScore(metrics: SafetyMetrics, scenario: TestScenario): number {
    let score = 0;

    // Success is paramount
    if (!metrics.success) return 0;

    score += 30; // base points for success

    // Collision penalties
    const criticalCollisions = metrics.collisions.filter(c => c.severity === 'critical').length;
    const majorCollisions = metrics.collisions.filter(c => c.severity === 'major').length;
    const minorCollisions = metrics.collisions.filter(c => c.severity === 'minor').length;

    score -= criticalCollisions * 100; // fail on critical collision
    score -= majorCollisions * 20;
    score -= minorCollisions * 5;

    // Minimum distance bonus (exponential reward for staying further away)
    // Safe distance should be at least the spacecraft's size plus safety margin
    const spacecraftMaxDim = Math.max(
      scenario.spacecraftHalfExtents.x,
      scenario.spacecraftHalfExtents.y,
      scenario.spacecraftHalfExtents.z
    );
    const safeDistance = spacecraftMaxDim + scenario.safetyMargin + 0.5;

    const distanceRatio = Math.min(1, metrics.minDistanceToObstacles / safeDistance);
    score += distanceRatio * 30;

    // Time efficiency (faster is better, but not too fast)
    const optimalTime = scenario.startPosition.distanceTo(scenario.targetPosition) / 1.5; // assume 1.5 m/s optimal
    const timeRatio = Math.min(1, optimalTime / Math.max(metrics.timeToTarget, 0.001));
    score += timeRatio * 20;

    // Path efficiency
    score += (metrics.pathEfficiency || 0) * 20;

    return Math.max(0, Math.min(100, score));
  }
}


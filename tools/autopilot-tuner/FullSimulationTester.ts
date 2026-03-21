/**
 * Full physics + real autopilot test harness.
 * Runs the actual Autopilot/GoToPosition stack against Rapier in headless mode.
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Autopilot } from '../../src/controllers/autopilot/Autopilot.ts';
import { buildBasicRcsThrusters, getBasicThrusterGroups } from '../../src/config/spacecraftConfig.ts';
import type { AutopilotParameters, CollisionEvent, SafetyMetrics, SimulationState, TestScenario } from './CollisionTester';

type ThrusterConfig = {
  position: THREE.Vector3;
  direction: THREE.Vector3; // local nozzle direction
};

class HeadlessSpacecraftAdapter {
  public objects: { box: { position: THREE.Vector3; quaternion: THREE.Quaternion } };
  public basicWorld: {
    getSpacecraftList: () => unknown[];
    getAsteroidObstacles: () => Array<{ position: THREE.Vector3; size: THREE.Vector3 }>;
  };

  private position = new THREE.Vector3();
  private orientation = new THREE.Quaternion();
  private linearVelocity = new THREE.Vector3();
  private angularVelocity = new THREE.Vector3();

  constructor(
    private body: RAPIER.RigidBody,
    private bodyDims: THREE.Vector3,
    private bodyMass: number,
    private thrusters: ThrusterConfig[],
    obstacles: Array<{ position: THREE.Vector3; halfExtents: THREE.Vector3 }>,
  ) {
    this.objects = {
      box: {
        position: this.position,
        quaternion: this.orientation,
      },
    };
    this.basicWorld = {
      getSpacecraftList: () => [],
      getAsteroidObstacles: () =>
        obstacles.map((o) => ({
          position: o.position.clone(),
          size: o.halfExtents.clone(),
        })),
    };
    this.syncFromPhysics();
  }

  public syncFromPhysics(): void {
    const p = this.body.translation();
    const q = this.body.rotation();
    const lv = this.body.linvel();
    const av = this.body.angvel();
    this.position.set(p.x, p.y, p.z);
    this.orientation.set(q.x, q.y, q.z, q.w);
    this.linearVelocity.set(lv.x, lv.y, lv.z);
    this.angularVelocity.set(av.x, av.y, av.z);
  }

  public getWorldPositionRef(): THREE.Vector3 { return this.position; }
  public getWorldPosition(): THREE.Vector3 { return this.position.clone(); }
  public getWorldOrientationRef(): THREE.Quaternion { return this.orientation; }
  public getWorldOrientation(): THREE.Quaternion { return this.orientation.clone(); }
  public getWorldVelocityRef(): THREE.Vector3 { return this.linearVelocity; }
  public getWorldVelocity(): THREE.Vector3 { return this.linearVelocity.clone(); }
  public getWorldAngularVelocityRef(): THREE.Vector3 { return this.angularVelocity; }
  public getWorldAngularVelocity(): THREE.Vector3 { return this.angularVelocity.clone(); }
  public getMass(): number { return this.bodyMass; }
  public getMainBodyDimensions(): THREE.Vector3 { return this.bodyDims.clone(); }
  public getThrusterConfigs(): ThrusterConfig[] { return this.thrusters; }
}

export class FullSimulationTester {
  private RAPIER: typeof RAPIER | null = null;

  async initialize(): Promise<void> {
    const R = await import('@dimforge/rapier3d-compat');
    await R.init();
    this.RAPIER = R;
  }

  async runScenario(
    scenario: TestScenario,
    params: AutopilotParameters,
    onProgress?: (state: SimulationState, metrics: Partial<SafetyMetrics>) => void
  ): Promise<SafetyMetrics> {
    if (!this.RAPIER) throw new Error('RAPIER not initialized');
    const R = this.RAPIER;
    const world = new R.World({ x: 0, y: 0, z: 0 });

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
    try { spacecraftBody.setCanSleep(false); } catch {}
    try { spacecraftBody.setCcdEnabled(true); } catch {}

    const spacecraftCollider = world.createCollider(
      R.ColliderDesc.cuboid(
        scenario.spacecraftHalfExtents.x,
        scenario.spacecraftHalfExtents.y,
        scenario.spacecraftHalfExtents.z
      ).setMass(scenario.spacecraftMass),
      spacecraftBody
    );

    const obstacleHandles = new Map<number, number>();
    for (let i = 0; i < scenario.obstacles.length; i++) {
      const obs = scenario.obstacles[i];
      const obstacleBody = world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(obs.position.x, obs.position.y, obs.position.z)
      );
      let colDesc: RAPIER.ColliderDesc;
      if (obs.type === 'sphere') {
        const baseR = Math.max(obs.halfExtents.x, obs.halfExtents.y, obs.halfExtents.z);
        colDesc = R.ColliderDesc.ball(baseR + scenario.safetyMargin);
      } else {
        colDesc = R.ColliderDesc.cuboid(
          obs.halfExtents.x + scenario.safetyMargin,
          obs.halfExtents.y + scenario.safetyMargin,
          obs.halfExtents.z + scenario.safetyMargin
        );
      }
      const col = world.createCollider(colDesc, obstacleBody);
      obstacleHandles.set(col.handle, i);
    }

    const fullDims = new THREE.Vector3(
      scenario.spacecraftHalfExtents.x * 2,
      scenario.spacecraftHalfExtents.y * 2,
      scenario.spacecraftHalfExtents.z * 2
    );
    const thrusterData = buildBasicRcsThrusters({
      width: fullDims.x,
      height: fullDims.y,
      depth: fullDims.z,
    }, 0.5);
    const thrusters: ThrusterConfig[] = thrusterData.map((t) => ({
      position: new THREE.Vector3(t.position[0], t.position[1], t.position[2]),
      direction: new THREE.Vector3(0, 1, 0).applyAxisAngle(t.rotation.axis, t.rotation.angle).normalize(),
    }));
    const thrusterGroups = getBasicThrusterGroups();
    const thrust = (scenario.spacecraftMass / 24) * 5;
    const thrusterMax = new Array(24).fill(thrust);

    const adapter = new HeadlessSpacecraftAdapter(
      spacecraftBody,
      fullDims,
      scenario.spacecraftMass,
      thrusters,
      scenario.obstacles
    );
    const autopilot = new Autopilot(
      adapter as unknown as any,
      thrusterGroups,
      thrust,
      thrusterMax,
      {
        maxForce: thrust * 24,
        dampingFactor: 1.5,
        useWorker: false,
      }
    );

    const cfg = autopilot.getConfig();
    if (Number.isFinite(params.maxApproachSpeed)) {
      cfg.limits.maxLinearVelocity = THREE.MathUtils.clamp(params.maxApproachSpeed, 0.2, 20);
    }
    autopilot.setGoToPositionTuning({
      velocityKp: Number.isFinite(params.velocityKp) ? params.velocityKp : 1.0,
      velocityKi: Number.isFinite(params.velocityKi) ? params.velocityKi : 0,
      velocityKd: Number.isFinite(params.velocityKd) ? params.velocityKd : 0,
      maxForce: (thrust * 24) * THREE.MathUtils.clamp(params.thrustBudgetScale ?? 0.6, 0.05, 1.0),
      velocityDeadbandCmd: THREE.MathUtils.clamp(params.velocityDeadband ?? 0.015, 0.001, 0.2),
      velocityDeadbandActual: THREE.MathUtils.clamp((params.velocityDeadband ?? 0.015) * 1.5, 0.002, 0.3),
      stopDistance: THREE.MathUtils.clamp(params.stopDistance ?? scenario.successThreshold * 0.6, 0.01, 2.0),
      velocityFilterAlpha: THREE.MathUtils.clamp(params.velocityFilterAlpha ?? 0.3, 0.01, 1.0),
    });
    if (Number.isFinite(params.deviationThreshold)) {
      autopilot.setPathTuning({
        deviationThreshold: params.deviationThreshold,
      });
    }
    if (Number.isFinite(params.replanInterval)) {
      autopilot.setPathTuning({
        replanInterval: params.replanInterval,
      });
    }

    autopilot.setTargetPosition(scenario.targetPosition.clone());
    autopilot.setMode('goToPosition', true);

    const dt = 1 / 60;
    const maxSteps = Math.floor(scenario.maxSimulationTime / dt);

    const collisions: CollisionEvent[] = [];
    const lastCollisionAt = new Map<number, number>();
    let minDistanceToObstacles = Infinity;
    let totalPathLength = 0;
    let totalThrustMagnitude = 0;
    let maxSpeed = 0;
    let success = false;
    let finalDistance = Infinity;
    let successTime = scenario.maxSimulationTime;
    let previousPosition = scenario.startPosition.clone();

    for (let step = 0; step < maxSteps; step++) {
      const time = step * dt;
      adapter.syncFromPhysics();

      const currentPosition = adapter.getWorldPositionRef();
      const currentVelocity = adapter.getWorldVelocityRef();
      const currentOrientation = adapter.getWorldOrientationRef();
      const currentAngularVelocity = adapter.getWorldAngularVelocityRef();

      finalDistance = currentPosition.distanceTo(scenario.targetPosition);
      if (finalDistance <= scenario.successThreshold) {
        success = true;
        successTime = time;
        break;
      }

      totalPathLength += currentPosition.distanceTo(previousPosition);
      previousPosition.copy(currentPosition);

      const speed = currentVelocity.length();
      if (speed > maxSpeed) maxSpeed = speed;

      for (let i = 0; i < scenario.obstacles.length; i++) {
        const obs = scenario.obstacles[i];
        const centerDistance = currentPosition.distanceTo(obs.position);
        const spacecraftRadius = Math.max(
          scenario.spacecraftHalfExtents.x,
          scenario.spacecraftHalfExtents.y,
          scenario.spacecraftHalfExtents.z
        );
        const obstacleRadius = Math.max(obs.halfExtents.x, obs.halfExtents.y, obs.halfExtents.z);
        const surfaceDistance = centerDistance - spacecraftRadius - obstacleRadius;
        if (surfaceDistance < minDistanceToObstacles) {
          minDistanceToObstacles = Math.max(0, surfaceDistance);
        }
      }

      world.contactPairsWith(spacecraftCollider, (otherCollider) => {
        const obstacleIndex = obstacleHandles.get(otherCollider.handle);
        if (obstacleIndex === undefined) return;

        const prev = lastCollisionAt.get(obstacleIndex) ?? -Infinity;
        if ((time - prev) < 0.25) return;
        lastCollisionAt.set(obstacleIndex, time);

        const severity = speed > 2.0 ? 'critical' : speed > 0.5 ? 'major' : 'minor';
        collisions.push({
          time,
          position: currentPosition.clone(),
          obstacleIndex,
          velocity: speed,
          severity,
        });
      });

      const thrusterForces = autopilot.calculateAutopilotForces(dt);
      const bodyPos = currentPosition.clone();
      const bodyQuat = currentOrientation.clone();
      for (let i = 0; i < Math.min(thrusters.length, thrusterForces.length); i++) {
        const fMag = Math.max(0, thrusterForces[i] || 0);
        if (fMag <= 0) continue;
        totalThrustMagnitude += fMag * dt;
        const localForce = thrusters[i].direction.clone().multiplyScalar(-fMag);
        const worldForce = localForce.applyQuaternion(bodyQuat);
        const worldPoint = thrusters[i].position.clone().applyQuaternion(bodyQuat).add(bodyPos);
        const impulse = worldForce.multiplyScalar(dt);
        spacecraftBody.applyImpulseAtPoint(
          { x: impulse.x, y: impulse.y, z: impulse.z },
          { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
          true
        );
      }

      world.step();

      if (onProgress && step % 10 === 0) {
        onProgress(
          {
            position: currentPosition.clone(),
            velocity: currentVelocity.clone(),
            orientation: currentOrientation.clone(),
            angularVelocity: currentAngularVelocity.clone(),
            time,
          },
          {
            minDistanceToObstacles,
            collisions: [...collisions],
            finalDistance,
          }
        );
      }
    }

    const directDistance = scenario.startPosition.distanceTo(scenario.targetPosition);
    const safePathLength = Math.max(totalPathLength, directDistance, 1e-6);
    const pathEfficiency = directDistance / safePathLength;
    const timeToTarget = success ? successTime : scenario.maxSimulationTime;
    const averageSpeed = totalPathLength / Math.max(timeToTarget, 1e-6);

    try { autopilot.cleanup(); } catch {}
    world.free();

    const fuelBudgetExceeded = Number.isFinite(scenario.fuelBudget as number)
      ? totalThrustMagnitude > (scenario.fuelBudget as number)
      : false;

    return {
      collisions,
      minDistanceToObstacles: Number.isFinite(minDistanceToObstacles) ? minDistanceToObstacles : 0,
      timeToTarget,
      success,
      finalDistance,
      pathEfficiency,
      averageSpeed,
      maxSpeed,
      fuelUsed: totalThrustMagnitude,
      fuelBudgetExceeded,
    };
  }

  static calculateFuelAwareScore(metrics: SafetyMetrics, scenario: TestScenario): number {
    if (!metrics.success) return 0;
    if (Number.isFinite(scenario.fuelBudget as number) && metrics.fuelUsed > (scenario.fuelBudget as number)) {
      return 0;
    }
    const critical = metrics.collisions.filter(c => c.severity === 'critical').length;
    if (critical > 0) return 0;

    const major = metrics.collisions.filter(c => c.severity === 'major').length;
    const minor = metrics.collisions.filter(c => c.severity === 'minor').length;
    const directDistance = Math.max(1e-6, scenario.startPosition.distanceTo(scenario.targetPosition));
    const fuelPerMeter = metrics.fuelUsed / directDistance;

    // Reference tuned to create useful spread for this simulator's scale.
    const fuelReference = Math.max(1, scenario.spacecraftMass * 1.0);
    const fuelScore = 100 * (1 / (1 + (fuelPerMeter / fuelReference)));

    const safetyDistance = Math.max(
      scenario.spacecraftHalfExtents.x,
      scenario.spacecraftHalfExtents.y,
      scenario.spacecraftHalfExtents.z
    ) + scenario.safetyMargin;
    const clearanceRatio = Math.min(1, metrics.minDistanceToObstacles / Math.max(1e-6, safetyDistance));
    const safetyScore = clearanceRatio * 100;

    const timeScore = Math.max(0, 100 * (1 - (metrics.timeToTarget / Math.max(1e-6, scenario.maxSimulationTime))));

    let composite = 0;
    composite += fuelScore * 0.60;   // fuel is primary objective
    composite += safetyScore * 0.25;
    composite += timeScore * 0.15;

    composite -= major * 10;
    composite -= minor * 2;

    return Math.max(0, Math.min(100, composite));
  }
}

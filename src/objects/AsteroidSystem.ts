import * as THREE from 'three';
import type { PhysicsEngine } from '../physics';
import { AsteroidModel, AsteroidModelId } from './AsteroidModel';

type Vec3 = { x: number; y: number; z: number };

export interface AsteroidSystemConfig {
  origin?: Vec3; // world origin for the system
  inclinationDeg?: number;
  raanDeg?: number;
  argPeriapsisDeg?: number;
  primary: {
    name?: string;
    diameter: number; // world units
    model?: AsteroidModelId;
  };
  moons: Array<{
    name?: string;
    diameter: number; // world units
    semiMajorAxis: number; // world units
    model?: AsteroidModelId;
    period?: number; // seconds (optional)
    meanMotion?: number; // rad/s (optional)
    inclinationDeg?: number;
    raanDeg?: number;
    argPeriapsisDeg?: number;
    meanAnomalyDeg?: number;
  }>;
}

export class AsteroidSystem {
  private scene: THREE.Scene;
  private physics?: PhysicsEngine;
  private config: AsteroidSystemConfig;
  private origin: THREE.Vector3;

  public primary!: AsteroidModel;
  public moons: Array<{
    asteroid: AsteroidModel;
    a_units: number; // semi-major axis in world units
    n_rad_s: number; // mean motion (rad/s)
    phase0_rad: number; // initial mean anomaly
    rot: THREE.Matrix4; // rotation from perifocal to world
  }> = [];

  constructor(scene: THREE.Scene, physics: PhysicsEngine | undefined, cfg: AsteroidSystemConfig) {
    this.scene = scene;
    this.physics = physics;
    this.config = cfg;
    const o = cfg.origin ?? { x: 0, y: 0, z: 0 };
    this.origin = new THREE.Vector3(o.x, o.y, o.z);
    this.setupSystem();
  }

  private setupSystem(): void {
    // Create primary asteroid at origin
    this.primary = new AsteroidModel(this.scene, {
      position: this.origin.clone(),
      diameter: this.config.primary.diameter,
      model: this.config.primary.model ?? '2b',
      physics: this.physics,
    });

    // Create moons with orbital parameters
    this.moons = this.config.moons.map((m, idx) => {
      const a_units = m.semiMajorAxis;

      // Mean motion (rad/s)
      let n_rad_s: number;
      if (typeof m.period === 'number' && m.period > 0) {
        n_rad_s = (2 * Math.PI) / m.period;
      } else if (typeof m.meanMotion === 'number' && m.meanMotion > 0) {
        n_rad_s = m.meanMotion;
      } else {
        // Reasonable default: one revolution per 120 seconds
        n_rad_s = (2 * Math.PI) / 120;
      }

      const phase0_rad = THREE.MathUtils.degToRad(m.meanAnomalyDeg ?? (idx * 360 / Math.max(1, this.config.moons.length)));

      const inc = THREE.MathUtils.degToRad(m.inclinationDeg ?? (this.config.inclinationDeg ?? 0));
      const raan = THREE.MathUtils.degToRad(m.raanDeg ?? (this.config.raanDeg ?? 0));
      const arg = THREE.MathUtils.degToRad(m.argPeriapsisDeg ?? (this.config.argPeriapsisDeg ?? 0));
      const rot = new THREE.Matrix4()
        .multiply(new THREE.Matrix4().makeRotationZ(raan))
        .multiply(new THREE.Matrix4().makeRotationX(inc))
        .multiply(new THREE.Matrix4().makeRotationZ(arg));

      // Initial position in orbital plane (circular orbit => r = a)
      const r0 = new THREE.Vector3(Math.cos(phase0_rad), 0, Math.sin(phase0_rad)).multiplyScalar(a_units);
      const worldPos = r0.clone().applyMatrix4(rot).add(this.origin);

      const asteroid = new AsteroidModel(this.scene, {
        position: worldPos,
        diameter: m.diameter,
        model: m.model ?? '1a',
        physics: undefined, // kinematic placement for moons
      });

      return { asteroid, a_units, n_rad_s, phase0_rad, rot };
    });
  }

  public update(elapsedSeconds: number): void {
    const primaryPos = this.primary.getPosition() ?? this.origin;
    this.moons.forEach((m) => {
      const angle = m.phase0_rad + m.n_rad_s * elapsedSeconds;
      const r_vec = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(m.a_units);
      const world = r_vec.applyMatrix4(m.rot).add(primaryPos);
      m.asteroid.setPosition(world);

      // Align spin axis with orbital plane normal and apply spin (default: tidally locked to mean motion)
      const axisLocal = new THREE.Vector3(0, 1, 0); // normal of local orbital plane (y-up in perifocal frame)
      const axisWorld = axisLocal.clone().applyMatrix4(m.rot).normalize();
      const spinAngle = angle; // tidal lock: spin rate equals mean motion
      const q = new THREE.Quaternion().setFromAxisAngle(axisWorld, spinAngle);
      m.asteroid.setQuaternion(q);
    });
  }

  public dispose(): void {
    this.moons.forEach(m => m.asteroid.dispose());
    this.moons = [];
    this.primary.dispose();
  }
}

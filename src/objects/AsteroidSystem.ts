import * as THREE from 'three';
import type { PhysicsEngine } from '../physics';
import { AsteroidModel, AsteroidModelId } from './AsteroidModel';

type Vec3 = { x: number; y: number; z: number };

export interface AsteroidSystemConfig {
  origin?: Vec3; // world origin for the system
  // Global orbital plane defaults (overridable per moon)
  inclinationDeg?: number;
  raanDeg?: number;
  argPeriapsisDeg?: number;
  // Simulation scaling/stability controls
  timeScale?: number; // 1 = real time
  substeps?: number;  // integrator sub-steps per frame
  primary: {
    name?: string;
    diameter: number; // world units
    model?: AsteroidModelId;
    spinPeriodSec?: number; // optional, for visual rotation
    mu?: number;           // optional, gravitational parameter (units^3/s^2)
    densityKgM3?: number;  // optional, bulk density to derive mu (kg/m^3); assumes 1 world unit = 1 meter
  };
  moons: Array<{
    name?: string;
    diameter: number; // world units
    semiMajorAxis: number; // world units
    model?: AsteroidModelId;
    period?: number; // seconds (optional)
    meanMotion?: number; // rad/s (optional)
    eccentricity?: number; // default 0
    inclinationDeg?: number;
    raanDeg?: number;
    argPeriapsisDeg?: number;
    meanAnomalyDeg?: number;
    spinPeriodSec?: number; // optional, else tidally locked
  }>;
}

export class AsteroidSystem {
  private scene: THREE.Scene;
  private physics?: PhysicsEngine;
  private config: AsteroidSystemConfig;
  private origin: THREE.Vector3;
  private timeScale: number = 1;
  private substeps: number = 1;
  private mu: number = 0;
  private lastTime: number | null = null;

  public primary!: AsteroidModel;
  public moons: Array<{
    asteroid: AsteroidModel;
    a_units: number; // semi-major axis in world units
    e: number; // eccentricity
    rot: THREE.Matrix4; // rotation from perifocal to world
    r_world: THREE.Vector3; // relative position to primary (world)
    v_world: THREE.Vector3; // velocity (world)
    h_mag: number; // |r x v|
    tidallyLocked: boolean;
    spinAxisWorld: THREE.Vector3;
    spinRateRadSec: number; // if not tidally locked
  }> = [];

  constructor(scene: THREE.Scene, physics: PhysicsEngine | undefined, cfg: AsteroidSystemConfig) {
    this.scene = scene;
    this.physics = physics;
    this.config = cfg;
    const o = cfg.origin ?? { x: 0, y: 0, z: 0 };
    this.origin = new THREE.Vector3(o.x, o.y, o.z);
    this.timeScale = Math.max(1, cfg.timeScale ?? 1);
    this.substeps = Math.max(1, Math.floor(cfg.substeps ?? 1));
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

    // Apply primary spin if provided
    if (this.config.primary.spinPeriodSec && this.config.primary.spinPeriodSec > 0) {
      const spinRate = (2 * Math.PI) / this.config.primary.spinPeriodSec;
      this.primary.setSpin(new THREE.Vector3(0, 1, 0), spinRate);
    }

    // Determine gravitational parameter (prefer physics from size/density, then explicit, then moons)
    this.mu =
      this.deriveMuFromPrimary(
        this.config.primary.diameter,
        this.config.primary.densityKgM3
      ) ??
      this.config.primary.mu ??
      this.deriveMuFromMoons();

    // Create moons with physically-based state vectors
    this.moons = this.config.moons.map((m, idx) => {
      const a_units = m.semiMajorAxis;
      const e = Math.max(0, Math.min(0.999, m.eccentricity ?? 0));

      const inc = THREE.MathUtils.degToRad(m.inclinationDeg ?? (this.config.inclinationDeg ?? 0));
      const raan = THREE.MathUtils.degToRad(m.raanDeg ?? (this.config.raanDeg ?? 0));
      const arg = THREE.MathUtils.degToRad(m.argPeriapsisDeg ?? (this.config.argPeriapsisDeg ?? 0));
      // Build classical rotation for Z-up (ECI): Rz(raan) Rx(inc) Rz(arg), then map Z-up -> Y-up via Rx(+90deg)
      const upfix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const rot = new THREE.Matrix4()
        .multiply(upfix)
        .multiply(new THREE.Matrix4().makeRotationZ(raan))
        .multiply(new THREE.Matrix4().makeRotationX(inc))
        .multiply(new THREE.Matrix4().makeRotationZ(arg));

      const M0 = THREE.MathUtils.degToRad(
        m.meanAnomalyDeg ?? (idx * 360 / Math.max(1, this.config.moons.length))
      );
      const E0 = this.solveKepler(M0, e);
      const cosE = Math.cos(E0);
      const sinE = Math.sin(E0);

      // Perifocal (p-q) plane is XY
      const r_pf = new THREE.Vector3(
        a_units * (cosE - e),
        a_units * Math.sqrt(1 - e * e) * sinE,
        0
      );
      const r_mag = r_pf.length();
      const v_scale = Math.sqrt(this.mu * a_units) / Math.max(1e-9, r_mag);
      const v_pf = new THREE.Vector3(
        -v_scale * sinE,
        v_scale * Math.sqrt(1 - e * e) * cosE,
        0
      );

      const r_world = r_pf.clone().applyMatrix4(rot);
      const v_world = v_pf.clone().applyMatrix4(rot);

      const worldPos = r_world.clone().add(this.origin);
      const asteroid = new AsteroidModel(this.scene, {
        position: worldPos,
        diameter: m.diameter,
        model: m.model ?? '1a',
        // Give moons colliders too; we manually set their kinematic pose each frame
        physics: this.physics,
      });

      // Spin: tidally locked by default. If custom period provided, use that.
      const tidallyLocked = !(m.spinPeriodSec && m.spinPeriodSec > 0);
      const spinRateRadSec = m.spinPeriodSec && m.spinPeriodSec > 0
        ? (2 * Math.PI) / m.spinPeriodSec
        : 0;
      const spinAxisWorld = new THREE.Vector3(0, 0, 1).applyMatrix4(rot).normalize();
      if (!tidallyLocked) asteroid.setSpin(spinAxisWorld, spinRateRadSec);

      return {
        asteroid,
        a_units,
        e,
        rot,
        r_world,
        v_world,
        h_mag: r_world.clone().cross(v_world).length(),
        tidallyLocked,
        spinAxisWorld,
        spinRateRadSec,
      };
    });
  }

  public update(elapsedSeconds: number): void {
    // Compute dt and scale
    if (this.lastTime === null) { this.lastTime = elapsedSeconds; return; }
    let dt = elapsedSeconds - this.lastTime;
    if (!(dt > 0)) return;
    this.lastTime = elapsedSeconds;
    const dtSim = dt * this.timeScale;

    const primaryPos = this.primary.getPosition() ?? this.origin;

    // Advance primary spin in real time (do not scale by timeScale)
    this.primary.advance(dt, 1);

    // Integrate moons with velocity-Verlet
    const steps = Math.max(1, this.substeps);
    const h = dtSim / steps;
    for (let s = 0; s < steps; s++) {
      for (const m of this.moons) {
        const r = m.r_world; // mutable
        const r2 = r.lengthSq();
        const rMag = Math.sqrt(Math.max(1e-9, r2));
        const a0 = r.clone().multiplyScalar(-this.mu / (rMag * rMag * rMag));
        const vHalf = m.v_world.clone().addScaledVector(a0, 0.5 * h);
        r.addScaledVector(vHalf, h);
        const r2n = r.lengthSq();
        const rMagn = Math.sqrt(Math.max(1e-9, r2n));
        const a1 = r.clone().multiplyScalar(-this.mu / (rMagn * rMagn * rMagn));
        m.v_world.copy(vHalf.addScaledVector(a1, 0.5 * h));
        m.h_mag = r.clone().cross(m.v_world).length();
      }
    }

    // Update transforms and spin per moon
    for (const m of this.moons) {
      const world = m.r_world.clone().add(primaryPos);
      m.asteroid.setPosition(world);
      if (m.tidallyLocked) {
        const axis = m.r_world.clone().cross(m.v_world).normalize();
        const rMag = Math.max(1e-9, m.r_world.length());
        const omega = m.h_mag / (rMag * rMag); // instantaneous angular velocity
        m.asteroid.setSpin(axis, omega);
        // Advance by simulation time to maintain lock with accelerated orbit
        m.asteroid.advance(dt, this.timeScale);
      } else {
        // Non-locked custom spins use real time
        m.asteroid.advance(dt, 1);
      }
    }
  }

  private deriveMuFromMoons(): number {
    const mus: number[] = [];
    for (const m of this.config.moons) {
      const a = m.semiMajorAxis;
      if (m.period && m.period > 0) {
        const n = (2 * Math.PI) / m.period; // rad/s
        mus.push(n * n * a * a * a);
      } else if (m.meanMotion && m.meanMotion > 0) {
        const n = m.meanMotion;
        mus.push(n * n * a * a * a);
      }
    }
    if (mus.length > 0) {
      return mus.reduce((acc, v) => acc + v, 0) / mus.length;
    }
    // Fallback nominal: 120s period at a=1 => mu = n^2 * a^3
    const n = (2 * Math.PI) / 120;
    return n * n;
  }

  private solveKepler(M: number, e: number): number {
    // Normalize M to [0, 2pi)
    let E = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const maxIter = 25;
    const tol = 1e-12;
    for (let i = 0; i < maxIter; i++) {
      const f = E - e * Math.sin(E) - M;
      const fp = 1 - e * Math.cos(E);
      const dE = -f / fp;
      E += dE;
      if (Math.abs(dE) < tol) break;
    }
    return E;
  }

  private deriveMuFromPrimary(diameterUnits: number, densityKgM3?: number): number | null {
    // Assume world units are meters. Use rubble-pile typical density if none provided.
    const rho = Math.max(100, densityKgM3 ?? 1500); // kg/m^3
    const R = Math.max(0.1, diameterUnits * 0.5);   // meters
    const volume = (4 / 3) * Math.PI * R * R * R;   // m^3
    const mass = rho * volume;                      // kg
    const G = 6.67430e-11;                          // m^3/(kg s^2)
    const mu = G * mass;                            // m^3/s^2 (== worldUnits^3/s^2)
    if (!isFinite(mu) || mu <= 0) return null;
    return mu;
  }

  public dispose(): void {
    this.moons.forEach(m => m.asteroid.dispose());
    this.moons = [];
    this.primary.dispose();
  }
}

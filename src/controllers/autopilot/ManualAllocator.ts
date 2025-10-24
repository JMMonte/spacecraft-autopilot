import * as THREE from 'three';
import { PIDController } from '../pidController';
import { AutopilotMode, AutopilotConfig } from './AutopilotMode';
import type { Spacecraft } from '../../core/spacecraft';
import type { ThrusterGroups } from '../../config/spacecraftConfig';

/**
 * Thin wrapper around AutopilotMode that exposes the internal allocation helpers
 * for manual control. No PID is used; we directly convert desired vectors into
 * per-thruster forces using the same distribution rules as the autopilot.
 */
export class ManualAllocator extends AutopilotMode {
  constructor(
    spacecraft: Spacecraft,
    config: AutopilotConfig,
    thrusterGroups: ThrusterGroups,
    thrust: number,
    thrusterMax?: number[],
  ) {
    super(
      spacecraft,
      config,
      thrusterGroups,
      thrust,
      // Dummy PID, not used
      new PIDController(0, 0, 0, 'linearMomentum'),
      thrusterMax
    );
  }

  // Allow external systems to adjust the scalar thrust budget
  public setThrust(value: number): void {
    super.setThrust(value);
  }

  /**
   * Allocate translational force in body-local space to thrusters.
   * Writes into `out` when provided, returns it for convenience.
   */
  public allocateTranslation(localForce: THREE.Vector3, out?: number[]): number[] {
    const arr = out ?? new Array(24).fill(0);
    // zero array if provided
    if (out) for (let i = 0; i < 24; i++) arr[i] = 0;
    this.applyTranslationalForcesToThrusterGroupsInPlace(localForce, arr);
    return arr;
  }

  /**
   * Allocate rotational command (use same mapping as rotational autopilot)
   * Writes into `out` when provided, returns it for convenience.
   * The input vector is interpreted like the autopilot's momentum-domain PID output.
   */
  public allocateRotation(rotCmd: THREE.Vector3, out?: number[]): number[] {
    const arr = out ?? new Array(24).fill(0);
    if (out) for (let i = 0; i < 24; i++) arr[i] = 0;
    this.applyPIDOutputToThrustersInPlace(rotCmd, arr);
    return arr;
  }

  // Not used by manual control
  calculateForces(_dt: number, _out?: number[]): number[] { return new Array(24).fill(0); }
}

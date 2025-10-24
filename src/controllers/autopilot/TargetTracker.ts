import * as THREE from 'three';
import type { Spacecraft } from '../../core/spacecraft';
import type { TargetPoint } from './types';

/**
 * Encapsulates target pose refresh and pointing computations.
 * Avoids duplicating this logic across Autopilot paths.
 */
export class TargetTracker {
  constructor(private self: Spacecraft) {}

  /**
   * Refresh target position/orientation from a target spacecraft and a selected point.
   * Updates the provided out vectors in-place (avoids allocations).
   */
  refreshPoseFromTarget(
    target: Spacecraft,
    targetPoint: TargetPoint,
    outPosition: THREE.Vector3,
    outOrientation: THREE.Quaternion,
    outPointVec?: THREE.Vector3,
  ): void {
    try {
      if (targetPoint === 'center') {
        outPosition.copy((target as any).objects?.box?.position || target.getWorldPosition());
      } else {
        const portPos = (target as any).getDockingPortWorldPosition?.(targetPoint);
        if (portPos) outPosition.copy(portPos); else outPosition.copy((target as any).objects?.box?.position || target.getWorldPosition());
      }
      const q = (target as any).objects?.box?.quaternion || target.getWorldOrientation();
      outOrientation.copy(q);
      if (outPointVec) {
        if (targetPoint === 'front') outPointVec.set(0, 0, 1);
        else if (targetPoint === 'back') outPointVec.set(0, 0, -1);
        else outPointVec.set(0, 0, 0);
      }
    } catch {
      // Leave outputs unchanged on error
    }
  }

  /**
   * Compute a world orientation that points this craft's +Z toward a target position.
   * Returns a normalized quaternion or null if degenerate.
   */
  computePointingOrientation(targetPosition: THREE.Vector3): THREE.Quaternion | null {
    try {
      const q = this.self.getWorldOrientationRef();
      const pos = this.self.getWorldPositionRef();
      const dir = new THREE.Vector3().copy(targetPosition).sub(pos);
      if (dir.lengthSq() <= 1e-10) return null;
      dir.normalize();
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const dq = new THREE.Quaternion().setFromUnitVectors(forward, dir);
      dq.multiply(q).normalize();
      return dq;
    } catch { return null; }
  }

  /** Return world velocity of the reference object (or null). */
  getReferenceVelocity(reference: Spacecraft | null): THREE.Vector3 | null {
    if (!reference) return null;
    try { return reference.getWorldVelocity(); } catch { return null; }
  }
}


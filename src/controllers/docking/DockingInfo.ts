import * as THREE from 'three';
import type { Spacecraft } from '../../core/spacecraft';
import type { DockingPortId } from './DockingUtils';

export type DockingInfo = {
  target: {
    position: THREE.Vector3;
    orientation: THREE.Quaternion;
    size: THREE.Vector3;          // half-extents
    fullDimensions: THREE.Vector3; // full extents
  };
  our: {
    position: THREE.Vector3;
    orientation: THREE.Quaternion;
    size: THREE.Vector3;          // half-extents
    fullDimensions: THREE.Vector3; // full extents
  };
  ports: {
    dimensions: THREE.Vector3; // radius, radius, length (as provided by our craft)
    ourPosition: THREE.Vector3;
    ourDirection: THREE.Vector3 | null;
    targetPosition: THREE.Vector3;
    targetDirection: THREE.Vector3 | null;
  };
  others: Array<{
    position: THREE.Vector3;
    size: THREE.Vector3;       // half-extents
    safetySize: THREE.Vector3; // safety extents
    orientation?: THREE.Quaternion;
  }>;
};

export function buildDockingInfo(
  our: Spacecraft,
  target: Spacecraft,
  ourPortId: DockingPortId,
  targetPortId: DockingPortId,
  others: Spacecraft[]
): DockingInfo | null {
  try {
    const portDimensions = new THREE.Vector3(
      our.objects.dockingPortRadius,
      our.objects.dockingPortRadius,
      our.objects.dockingPortLength
    );

    const ourPortDir = our.getDockingPortWorldDirection(ourPortId);
    const targetPortDir = target.getDockingPortWorldDirection(targetPortId);
    const ourPortPos = our.getDockingPortWorldPosition(ourPortId);
    const targetPortPos = target.getDockingPortWorldPosition(targetPortId);
    if (!ourPortPos || !targetPortPos) return null;

    return {
      target: {
        position: target.getWorldPosition(),
        orientation: target.getWorldOrientation(),
        size: new THREE.Vector3(
          target.getMainBodyDimensions().x,
          target.getMainBodyDimensions().y,
          target.getMainBodyDimensions().z
        ),
        fullDimensions: target.getFullDimensions(),
      },
      our: {
        position: our.getWorldPosition(),
        orientation: our.getWorldOrientation(),
        size: new THREE.Vector3(
          our.getMainBodyDimensions().x,
          our.getMainBodyDimensions().y,
          our.getMainBodyDimensions().z
        ),
        fullDimensions: our.getFullDimensions(),
      },
      ports: {
        dimensions: portDimensions,
        ourPosition: ourPortPos,
        ourDirection: ourPortDir,
        targetPosition: targetPortPos,
        targetDirection: targetPortDir,
      },
      others: others.map(s => ({
        position: s.getWorldPosition(),
        size: new THREE.Vector3(s.getMainBodyDimensions().x, s.getMainBodyDimensions().y, s.getMainBodyDimensions().z),
        safetySize: new THREE.Vector3(
          s.getFullDimensions().x * 1.5,
          s.getFullDimensions().y * 1.5,
          s.getFullDimensions().z * 1.5
        ),
        orientation: s.getWorldOrientation(),
      })),
    };
  } catch {
    return null;
  }
}


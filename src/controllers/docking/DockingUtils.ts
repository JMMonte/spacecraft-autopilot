import * as THREE from 'three';
import { Spacecraft } from '../../core/spacecraft';

export type DockingPortId = 'front' | 'back';

// Shared thresholds (kept in one place so UI + controllers stay consistent)
const ANGLE_THRESHOLD_DEG = 5;           // orientation between port axes
const CLOSING_SPEED_THRESHOLD = 0.05;    // m/s
const ANGULAR_VEL_THRESHOLD = 0.05;      // rad/s (sum)

function getPortFacePosition(spacecraft: Spacecraft, portId: DockingPortId): THREE.Vector3 | null {
    const dir = spacecraft.getDockingPortWorldDirection(portId);
    if (!dir) return null;

    const base = spacecraft.getWorldPosition();
    const boxDepth = spacecraft.objects.boxDepth;
    const portDepth = spacecraft.objects.dockingPortDepth || 0.3;
    const portLength = spacecraft.objects.dockingPortLength || 0.1;

    // Distance from center of mass to port FACE (tip) is depth + half-length
    const distance = (boxDepth / 2) + portDepth + (portLength * 0.5);
    return base.clone().add(dir.clone().multiplyScalar(distance));
}

/**
 * Evaluate whether two specific ports should physically dock based on
 * alignment, proximity, lateral offset, and relative motion thresholds.
 * This is independent of any active \"docking mode\" or guidance.
 */
export function canDockWithinThresholds(
    a: Spacecraft,
    aPort: DockingPortId,
    b: Spacecraft,
    bPort: DockingPortId
): boolean {
    // Ports must exist and be free
    const aInfo = a.dockingPorts?.[aPort];
    const bInfo = b.dockingPorts?.[bPort];
    if (!aInfo || !bInfo || aInfo.isOccupied || bInfo.isOccupied) return false;

    const aDir = a.getDockingPortWorldDirection(aPort);
    const bDir = b.getDockingPortWorldDirection(bPort);
    const aFace = getPortFacePosition(a, aPort);
    const bFace = getPortFacePosition(b, bPort);
    if (!aDir || !bDir || !aFace || !bFace) return false;

    // Alignment: ports should face each other (within a few degrees)
    const alignmentRad = aDir.angleTo(bDir.clone().multiplyScalar(-1));
    const alignmentDeg = THREE.MathUtils.radToDeg(alignmentRad);

    // Proximity: faces should be very close
    const separation = aFace.distanceTo(bFace);

    // Lateral offset: difference perpendicular to docking axis should be small
    const delta = new THREE.Vector3().subVectors(bFace, aFace);
    const axis = bDir.clone().normalize();
    const lateral = delta.clone().sub(axis.multiplyScalar(delta.dot(axis)));
    const lateralOffset = lateral.length();

    // Relative linear and angular motion near zero
    const relVel = new THREE.Vector3().subVectors(
        a.getWorldVelocity(),
        b.getWorldVelocity()
    );
    const closingSpeed = Math.abs(relVel.dot(bDir));
    const angVelMag = a.getWorldAngularVelocity().length() + b.getWorldAngularVelocity().length();

    // Thresholds scale with port geometry
    const portRadius = Math.min(
        a.objects.dockingPortRadius || 0.3,
        b.objects.dockingPortRadius || 0.3
    );
    const portLength = Math.min(
        a.objects.dockingPortLength || 0.1,
        b.objects.dockingPortLength || 0.1
    );

    const separationThreshold = Math.min(0.05, portLength * 0.6); // meters
    const lateralThreshold = Math.min(0.05, portRadius * 0.25);   // meters

    return (
        alignmentDeg <= ANGLE_THRESHOLD_DEG &&
        separation <= separationThreshold &&
        lateralOffset <= lateralThreshold &&
        closingSpeed <= CLOSING_SPEED_THRESHOLD &&
        angVelMag <= ANGULAR_VEL_THRESHOLD
    );
}


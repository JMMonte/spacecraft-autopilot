import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Trajectory } from '../trajectory';

export interface SafetyBox {
    min: THREE.Vector3;
    max: THREE.Vector3;
}

export class TrajectoryPlanner {
    /**
     * Calculates a safety box around a target position
     */
    public static calculateSafetyBox(targetPos: THREE.Vector3, targetSize: CANNON.Vec3): SafetyBox {
        const safetyMargin = 1.3; // 30% larger than actual size
        const halfWidth = targetSize.x * safetyMargin;
        const halfHeight = targetSize.y * safetyMargin;
        const halfDepth = targetSize.z * safetyMargin;

        return {
            min: new THREE.Vector3(
                targetPos.x - halfWidth,
                targetPos.y - halfHeight,
                targetPos.z - halfDepth
            ),
            max: new THREE.Vector3(
                targetPos.x + halfWidth,
                targetPos.y + halfHeight,
                targetPos.z + halfDepth
            )
        };
    }

    /**
     * Checks if a line intersects with a safety box
     */
    public static doesLineIntersectSafetyBox(
        start: THREE.Vector3,
        end: THREE.Vector3,
        box: SafetyBox
    ): boolean {
        // Ray-box intersection test
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        const boxMin = box.min;
        const boxMax = box.max;

        // Check if either point is inside the box
        if (this.isPointInBox(start, box) || this.isPointInBox(end, box)) {
            return true;
        }

        // Calculate intersection with each face of the box
        const tMin = new THREE.Vector3(
            (boxMin.x - start.x) / direction.x,
            (boxMin.y - start.y) / direction.y,
            (boxMin.z - start.z) / direction.z
        );

        const tMax = new THREE.Vector3(
            (boxMax.x - start.x) / direction.x,
            (boxMax.y - start.y) / direction.y,
            (boxMax.z - start.z) / direction.z
        );

        const t1 = new THREE.Vector3(
            Math.min(tMin.x, tMax.x),
            Math.min(tMin.y, tMax.y),
            Math.min(tMin.z, tMax.z)
        );

        const t2 = new THREE.Vector3(
            Math.max(tMin.x, tMax.x),
            Math.max(tMin.y, tMax.y),
            Math.max(tMin.z, tMax.z)
        );

        const tNear = Math.max(Math.max(t1.x, t1.y), t1.z);
        const tFar = Math.min(Math.min(t2.x, t2.y), t2.z);

        return tNear <= tFar && tFar >= 0;
    }

    /**
     * Checks if a point is inside a safety box
     */
    private static isPointInBox(point: THREE.Vector3, box: SafetyBox): boolean {
        return (
            point.x >= box.min.x && point.x <= box.max.x &&
            point.y >= box.min.y && point.y <= box.max.y &&
            point.z >= box.min.z && point.z <= box.max.z
        );
    }

    /**
     * Calculates waypoints for avoiding obstacles
     */
    public static calculateAvoidanceWaypoints(
        startPos: THREE.Vector3,
        endPos: THREE.Vector3,
        targetPos: THREE.Vector3,
        targetSize: CANNON.Vec3,
        targetDir: THREE.Vector3
    ): THREE.Vector3[] {
        const safetyBox = this.calculateSafetyBox(targetPos, targetSize);
        
        // Check if direct path intersects safety box
        const needsAvoidance = this.doesLineIntersectSafetyBox(startPos, endPos, safetyBox);
        if (!needsAvoidance) {
            return [endPos];
        }

        // Calculate box dimensions and clearance
        const boxWidth = safetyBox.max.x - safetyBox.min.x;
        const boxHeight = safetyBox.max.y - safetyBox.min.y;
        const boxDepth = safetyBox.max.z - safetyBox.min.z;
        const maxDimension = Math.max(boxWidth, boxHeight, boxDepth);
        const clearance = maxDimension * 0.3; // Reduced clearance for tighter paths

        // Get direction vectors
        const up = new THREE.Vector3(0, 1, 0);
        const forward = targetDir.clone();
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();

        // Find the point on the target's face where the docking port is
        const faceCenter = targetPos.clone().add(forward.clone().multiplyScalar(boxDepth * 0.5));

        // Calculate a curved path around the box towards the docking face
        const waypoints: THREE.Vector3[] = [startPos];

        // Calculate the side we should pass on based on current position
        const toStart = new THREE.Vector3().subVectors(startPos, targetPos);
        const sideSign = Math.sign(toStart.dot(right));
        
        // Calculate an intermediate point that's offset to the side and slightly in front
        const sideOffset = (boxWidth * 0.5 + clearance) * sideSign;
        const heightOffset = Math.sign(toStart.dot(up)) * (boxHeight * 0.5 + clearance);

        // Create a curved approach path
        const approachPoint = faceCenter.clone()
            .add(right.clone().multiplyScalar(sideOffset))
            .add(up.clone().multiplyScalar(heightOffset))
            .add(forward.clone().multiplyScalar(-boxDepth)); // Move back from the face

        // Add the curved approach point
        waypoints.push(approachPoint);

        // Add the final approach point
        waypoints.push(endPos);

        return waypoints;
    }

    /**
     * Creates a trajectory from waypoints
     */
    public static createTrajectory(waypoints: THREE.Vector3[], totalTime: number = 60): Trajectory {
        return new Trajectory(waypoints, totalTime);
    }
} 
import * as THREE from 'three';
import { Trajectory } from '../trajectory';

export interface SafetyBox {
    min: THREE.Vector3;
    max: THREE.Vector3;
    isTarget?: boolean;
}

interface VoxelGridCell {
    occupied: boolean;
    position: THREE.Vector3;
}

class VoxelGrid {
    private cells: Map<string, VoxelGridCell>;
    private voxelSize: number;
    private bounds: {
        min: THREE.Vector3;
        max: THREE.Vector3;
    };
    private dimensions: THREE.Vector3;

    constructor(bounds: { min: THREE.Vector3, max: THREE.Vector3 }, voxelSize: number) {
        this.cells = new Map();
        this.voxelSize = voxelSize;
        this.bounds = bounds;
        
        // Calculate grid dimensions
        this.dimensions = new THREE.Vector3(
            Math.ceil((bounds.max.x - bounds.min.x) / voxelSize),
            Math.ceil((bounds.max.y - bounds.min.y) / voxelSize),
            Math.ceil((bounds.max.z - bounds.min.z) / voxelSize)
        );

        // Initialize grid lazily - only create cells when needed
    }

    private getKey(x: number, y: number, z: number): string {
        return `${x},${y},${z}`;
    }

    private worldToGrid(position: THREE.Vector3): THREE.Vector3 {
        return new THREE.Vector3(
            Math.floor((position.x - this.bounds.min.x) / this.voxelSize),
            Math.floor((position.y - this.bounds.min.y) / this.voxelSize),
            Math.floor((position.z - this.bounds.min.z) / this.voxelSize)
        );
    }

    private gridToWorld(gridPos: THREE.Vector3): THREE.Vector3 {
        return new THREE.Vector3(
            this.bounds.min.x + (gridPos.x + 0.5) * this.voxelSize,
            this.bounds.min.y + (gridPos.y + 0.5) * this.voxelSize,
            this.bounds.min.z + (gridPos.z + 0.5) * this.voxelSize
        );
    }

    public markSafetyBox(box: SafetyBox): void {
        const minGrid = this.worldToGrid(box.min);
        const maxGrid = this.worldToGrid(box.max);

        // Add padding for safety
        const padding = box.isTarget ? 1 : 2;
        minGrid.subScalar(padding);
        maxGrid.addScalar(padding);

        for (let x = minGrid.x; x <= maxGrid.x; x++) {
            for (let y = minGrid.y; y <= maxGrid.y; y++) {
                for (let z = minGrid.z; z <= maxGrid.z; z++) {
                    const key = this.getKey(x, y, z);
                    if (!this.cells.has(key)) {
                        this.cells.set(key, {
                            occupied: true,
                            position: this.gridToWorld(new THREE.Vector3(x, y, z))
                        });
                    } else {
                        this.cells.get(key)!.occupied = true;
                    }
                }
            }
        }
    }

    public isPositionSafe(position: THREE.Vector3): boolean {
        const gridPos = this.worldToGrid(position);
        const key = this.getKey(gridPos.x, gridPos.y, gridPos.z);
        const cell = this.cells.get(key);
        return cell === undefined || !cell.occupied;
    }

    public getNeighbors(position: THREE.Vector3): THREE.Vector3[] {
        const gridPos = this.worldToGrid(position);
        const neighbors: THREE.Vector3[] = [];

        // Include diagonal movements for better paths
        const directions = [
            // Primary directions
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1],
            // Diagonal directions
            [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
            [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
            [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
            [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]
        ];

        for (const [dx, dy, dz] of directions) {
            const newX = gridPos.x + dx;
            const newY = gridPos.y + dy;
            const newZ = gridPos.z + dz;

            if (newX >= 0 && newX < this.dimensions.x &&
                newY >= 0 && newY < this.dimensions.y &&
                newZ >= 0 && newZ < this.dimensions.z) {
                const key = this.getKey(newX, newY, newZ);
                const cell = this.cells.get(key);
                if (!cell?.occupied) {
                    // Check if diagonal movement is safe (no obstacles in between)
                    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1) {
                        // For diagonal movement, check intermediate cells
                        const intermediateSafe = this.checkIntermediateCells(gridPos, dx, dy, dz);
                        if (!intermediateSafe) continue;
                    }
                    neighbors.push(this.gridToWorld(new THREE.Vector3(newX, newY, newZ)));
                }
            }
        }

        return neighbors;
    }

    private checkIntermediateCells(gridPos: THREE.Vector3, dx: number, dy: number, dz: number): boolean {
        // Check cells between current position and diagonal neighbor
        if (dx !== 0) {
            const key = this.getKey(gridPos.x + dx, gridPos.y, gridPos.z);
            if (this.cells.get(key)?.occupied) return false;
        }
        if (dy !== 0) {
            const key = this.getKey(gridPos.x, gridPos.y + dy, gridPos.z);
            if (this.cells.get(key)?.occupied) return false;
        }
        if (dz !== 0) {
            const key = this.getKey(gridPos.x, gridPos.y, gridPos.z + dz);
            if (this.cells.get(key)?.occupied) return false;
        }
        return true;
    }
}

export class TrajectoryPlanner {
    private static readonly VOXEL_SIZE = 2.0;
    private static readonly PATH_SMOOTHING_ITERATIONS = 5;
    private static readonly MAX_PATHFINDING_ITERATIONS = 3000;
    private static readonly APPROACH_DISTANCE = 10.0;

    /**
     * Calculates a safety box around a target position
     */
    public static calculateSafetyBox(
        targetPos: THREE.Vector3, 
        targetSize: THREE.Vector3,
        isTarget: boolean = false
    ): SafetyBox {
        // Use same safety margin for all spacecraft to ensure consistent avoidance
        const safetyMargin = 2.5;
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
            ),
            isTarget
        };
    }

    private static calculateHeuristic(a: THREE.Vector3, b: THREE.Vector3): number {
        // Use Euclidean distance for better paths
        return a.distanceTo(b);
    }

    private static findPath(
        start: THREE.Vector3,
        goal: THREE.Vector3,
        grid: VoxelGrid,
        isTargetPath: boolean = false,
        acceptanceRadius?: number
    ): THREE.Vector3[] {
        const openSet = new Set<string>();
        const closedSet = new Set<string>();
        const cameFrom = new Map<string, THREE.Vector3>();
        const gScore = new Map<string, number>();
        const fScore = new Map<string, number>();
        
        const startKey = `${start.x},${start.y},${start.z}`;
        openSet.add(startKey);
        gScore.set(startKey, 0);
        fScore.set(startKey, this.calculateHeuristic(start, goal));

        let iterations = 0;
        
        while (openSet.size > 0 && iterations < this.MAX_PATHFINDING_ITERATIONS) {
            iterations++;
            
            let currentKey = '';
            let lowestFScore = Infinity;
            for (const key of openSet) {
                const score = fScore.get(key) || Infinity;
                if (score < lowestFScore) {
                    lowestFScore = score;
                    currentKey = key;
                }
            }
            
            const current = new THREE.Vector3(...currentKey.split(',').map(Number));
            
            // Use provided acceptance radius or default based on path type
            const radius = acceptanceRadius || (isTargetPath ? this.VOXEL_SIZE : this.VOXEL_SIZE * 2);
            if (current.distanceTo(goal) < radius) {
                const path = [goal];
                let curr = current;
                while (cameFrom.has(`${curr.x},${curr.y},${curr.z}`)) {
                    curr = cameFrom.get(`${curr.x},${curr.y},${curr.z}`)!;
                    path.unshift(curr);
                }
                path.unshift(start);
                return path;
            }
            
            openSet.delete(currentKey);
            closedSet.add(currentKey);
            
            const neighbors = grid.getNeighbors(current);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.x},${neighbor.y},${neighbor.z}`;
                
                if (closedSet.has(neighborKey)) continue;
                
                const tentativeGScore = (gScore.get(currentKey) || Infinity) + current.distanceTo(neighbor);
                
                if (!openSet.has(neighborKey)) {
                    openSet.add(neighborKey);
                } else if (tentativeGScore >= (gScore.get(neighborKey) || Infinity)) {
                    continue;
                }
                
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeGScore);
                fScore.set(neighborKey, tentativeGScore + this.calculateHeuristic(neighbor, goal));
            }
        }
        
        return [];
    }

    /**
     * Calculates waypoints for avoiding obstacles using voxel-based pathfinding
     */
    public static calculateAvoidanceWaypoints(
        start: THREE.Vector3,
        goal: THREE.Vector3,
        otherObjects: Array<{
            position: THREE.Vector3;
            size: THREE.Vector3;
            isTarget: boolean;
        }>
    ): THREE.Vector3[] {
        // Calculate bounds for the voxel grid
        const bounds = this.calculateGridBounds(start, goal, otherObjects);
        const grid = new VoxelGrid(bounds, this.VOXEL_SIZE);

        // Mark safety boxes for all objects
        otherObjects.forEach(obj => {
            const safetyBox = this.calculateSafetyBox(obj.position, obj.size, obj.isTarget);
            grid.markSafetyBox(safetyBox);
        });

        // For target spacecraft, create an approach point
        const targetObject = otherObjects.find(obj => obj.isTarget);
        if (targetObject) {
            const dirToTarget = new THREE.Vector3().subVectors(goal, targetObject.position).normalize();
            const approachPoint = new THREE.Vector3().copy(goal).sub(
                dirToTarget.multiplyScalar(this.APPROACH_DISTANCE)
            );

            // First find path to approach point
            let pathToApproach = this.findPath(start, approachPoint, grid, false);
            if (pathToApproach.length === 0) {
                // If direct path fails, try intermediate points
                pathToApproach = this.findPathWithIntermediatePoints(start, approachPoint, grid);
            }

            // Then find path from approach point to goal
            let finalApproach = this.findPath(approachPoint, goal, grid, true);
            if (finalApproach.length === 0) {
                // If final approach fails, try with larger acceptance radius
                finalApproach = this.findPath(approachPoint, goal, grid, true, this.VOXEL_SIZE * 3);
            }

            // Combine paths
            const fullPath = [...pathToApproach];
            if (finalApproach.length > 1) {
                fullPath.push(...finalApproach.slice(1));
            }

            // Smooth the path
            return this.smoothPath(fullPath, grid);
        }

        // If no target object, just find direct path
        let path = this.findPath(start, goal, grid, false);
        if (path.length === 0) {
            path = this.findPathWithIntermediatePoints(start, goal, grid);
        }
        return this.smoothPath(path, grid);
    }

    private static calculateGridBounds(
        start: THREE.Vector3,
        goal: THREE.Vector3,
        objects: Array<{ position: THREE.Vector3; size: THREE.Vector3 }>
    ): { min: THREE.Vector3; max: THREE.Vector3 } {
        const points = [start, goal, ...objects.map(obj => obj.position)];
        const min = new THREE.Vector3(Infinity, Infinity, Infinity);
        const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

        points.forEach(point => {
            min.x = Math.min(min.x, point.x);
            min.y = Math.min(min.y, point.y);
            min.z = Math.min(min.z, point.z);
            max.x = Math.max(max.x, point.x);
            max.y = Math.max(max.y, point.y);
            max.z = Math.max(max.z, point.z);
        });

        // Add margin for safety boxes and path planning
        const margin = 20.0;
        min.subScalar(margin);
        max.addScalar(margin);

        return { min, max };
    }

    private static findPathWithIntermediatePoints(
        start: THREE.Vector3,
        goal: THREE.Vector3,
        grid: VoxelGrid
    ): THREE.Vector3[] {
        const dirToGoal = new THREE.Vector3().subVectors(goal, start).normalize();
        const distance = start.distanceTo(goal);
        const upVector = new THREE.Vector3(0, 1, 0);
        const rightVector = new THREE.Vector3().crossVectors(dirToGoal, upVector).normalize();

        // Try different intermediate points
        const offsets = [
            rightVector.clone().multiplyScalar(distance * 0.5),
            rightVector.clone().negate().multiplyScalar(distance * 0.5),
            upVector.clone().multiplyScalar(distance * 0.5),
            upVector.clone().negate().multiplyScalar(distance * 0.5)
        ];

        for (const offset of offsets) {
            const intermediatePoint = new THREE.Vector3()
                .addVectors(start, goal)
                .multiplyScalar(0.5)
                .add(offset);

            if (!grid.isPositionSafe(intermediatePoint)) continue;

            const firstHalf = this.findPath(start, intermediatePoint, grid, false);
            if (firstHalf.length === 0) continue;

            const secondHalf = this.findPath(intermediatePoint, goal, grid, false);
            if (secondHalf.length === 0) continue;

            // Combine paths
            return [...firstHalf, ...secondHalf.slice(1)];
        }

        return [];
    }

    private static smoothPath(path: THREE.Vector3[], grid: VoxelGrid): THREE.Vector3[] {
        if (path.length <= 2) return path;

        for (let iteration = 0; iteration < this.PATH_SMOOTHING_ITERATIONS; iteration++) {
            let changed = false;
            let i = 0;
            while (i < path.length - 2) {
                // Try to remove intermediate points if direct path is safe
                const start = path[i];
                const end = path[i + 2];
                
                if (this.isPathSafe(start, end, grid)) {
                    path.splice(i + 1, 1);
                    changed = true;
                } else {
                    i++;
                }
            }
            if (!changed) break;
        }

        return path;
    }

    private static isPathSafe(start: THREE.Vector3, end: THREE.Vector3, grid: VoxelGrid): boolean {
        const direction = new THREE.Vector3().subVectors(end, start);
        const distance = direction.length();
        direction.normalize();

        // Check points along the path
        const steps = Math.ceil(distance / (this.VOXEL_SIZE * 0.5));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const point = new THREE.Vector3()
                .copy(start)
                .add(direction.clone().multiplyScalar(distance * t));
            
            if (!grid.isPositionSafe(point)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Checks if a line intersects with any safety box in the scene
     */
    public static doesLineIntersectAnySafetyBox(
        start: THREE.Vector3,
        end: THREE.Vector3,
        safetyBoxes: SafetyBox[]
    ): boolean {
        return safetyBoxes.some(box => this.doesLineIntersectSafetyBox(start, end, box));
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
     * Creates a trajectory from waypoints
     */
    public static createTrajectory(waypoints: THREE.Vector3[], totalTime: number): Trajectory {
        return new Trajectory(waypoints, totalTime);
    }
} 

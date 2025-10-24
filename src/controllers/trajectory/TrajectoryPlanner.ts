import * as THREE from 'three';
import { Trajectory } from '../trajectory';

export interface SafetyBox {
    min: THREE.Vector3;
    max: THREE.Vector3;
    isTarget?: boolean;
}

// BVH for SafetyBox AABBs to accelerate LOS checks
class SafetyBoxBVH {
    private nodes: { min: THREE.Vector3; max: THREE.Vector3; left: number; right: number; start: number; count: number }[] = [];
    private indices: number[] = [];
    private boxes: SafetyBox[] = [];

    static fromBoxes(boxes: SafetyBox[]): SafetyBoxBVH {
        const b = new SafetyBoxBVH();
        b.boxes = boxes.slice();
        b.indices = boxes.map((_, i) => i);
        b.buildNode(0, boxes.length);
        return b;
    }

    private buildNode(start: number, end: number): number {
        if (start === 0 && end === 0) { this.nodes.push({ min: new THREE.Vector3(), max: new THREE.Vector3(), left: -1, right: -1, start, count: 0 }); return 0; }
        const nodeIndex = this.nodes.length;
        const node = { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), left: -1, right: -1, start, count: end - start };
        this.nodes.push(node);
        for (let i = start; i < end; i++) {
            const b = this.boxes[this.indices[i]];
            node.min.min(b.min); node.max.max(b.max);
        }
        if (end - start <= 4) return nodeIndex;
        // Split along longest axis using median of centers
        const extent = new THREE.Vector3().subVectors(node.max, node.min);
        const axis = extent.x >= extent.y && extent.x >= extent.z ? 0 : (extent.y >= extent.z ? 1 : 2);
        const centers = (i: number) => {
            const bb = this.boxes[this.indices[i]];
            const c = new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5);
            return axis === 0 ? c.x : axis === 1 ? c.y : c.z;
        };
        const midVal = (() => {
            const vals: number[] = [];
            for (let i = start; i < end; i++) vals.push(centers(i));
            vals.sort((a, b) => a - b);
            return vals[Math.floor(vals.length / 2)] || 0;
        })();
        let i = start, j = end - 1;
        while (i <= j) {
            while (i <= j && centers(i) <= midVal) i++;
            while (i <= j && centers(j) > midVal) j--;
            if (i < j) { const tmp = this.indices[i]; this.indices[i] = this.indices[j]; this.indices[j] = tmp; i++; j--; }
        }
        const mid = THREE.MathUtils.clamp(i, start + 1, end - 1);
        node.left = this.buildNode(start, mid);
        node.right = this.buildNode(mid, end);
        return nodeIndex;
    }

    private segIntersectsAABB(a: THREE.Vector3, b: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): boolean {
        // Robust slab segment test on [0,1]
        let tmin = 0.0; let tmax = 1.0;
        const update = (sa: number, sb: number, bmin: number, bmax: number): boolean => {
            const d = sb - sa;
            if (Math.abs(d) < 1e-9) return sa >= bmin && sa <= bmax;
            const inv = 1.0 / d; let t0 = (bmin - sa) * inv; let t1 = (bmax - sa) * inv; if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
            tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); return tmin <= tmax;
        };
        if (!update(a.x, b.x, min.x, max.x)) return false;
        if (!update(a.y, b.y, min.y, max.y)) return false;
        if (!update(a.z, b.z, min.z, max.z)) return false;
        return tmax >= 0 && tmin <= 1 && tmax >= tmin;
    }

    public segmentIntersects(a: THREE.Vector3, b: THREE.Vector3): boolean {
        const stack: number[] = [0];
        while (stack.length) {
            const ni = stack.pop()!;
            const node = this.nodes[ni]; if (!node) continue;
            if (!this.segIntersectsAABB(a, b, node.min, node.max)) continue;
            if (node.count <= 4 && node.left < 0 && node.right < 0) {
                for (let i = node.start; i < node.start + node.count; i++) {
                    const bb = this.boxes[this.indices[i]];
                    if (this.segIntersectsAABB(a, b, bb.min, bb.max)) return true;
                }
            } else {
                if (node.left >= 0) stack.push(node.left);
                if (node.right >= 0) stack.push(node.right);
            }
        }
        return false;
    }
}

class VoxelGrid {
    private blocked: Set<number>;
    private voxelSize: number;
    private bounds: { min: THREE.Vector3; max: THREE.Vector3 };
    private dimensions: THREE.Vector3; // integer components

    constructor(bounds: { min: THREE.Vector3; max: THREE.Vector3 }, voxelSize: number) {
        this.blocked = new Set<number>();
        this.voxelSize = voxelSize;
        this.bounds = bounds;
        this.dimensions = new THREE.Vector3(
            Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / voxelSize)),
            Math.max(1, Math.ceil((bounds.max.y - bounds.min.y) / voxelSize)),
            Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / voxelSize))
        );
    }

    public getVoxelSize(): number { return this.voxelSize; }
    public getDimensions(): THREE.Vector3 { return this.dimensions.clone(); }

    private idx(x: number, y: number, z: number): number {
        const ny = this.dimensions.y | 0, nz = this.dimensions.z | 0;
        return ((x | 0) * ny + (y | 0)) * nz + (z | 0);
    }

    private inBounds(x: number, y: number, z: number): boolean {
        return (
            x >= 0 && x < this.dimensions.x &&
            y >= 0 && y < this.dimensions.y &&
            z >= 0 && z < this.dimensions.z
        );
    }

    public worldToGrid(position: THREE.Vector3): THREE.Vector3 {
        return new THREE.Vector3(
            Math.floor((position.x - this.bounds.min.x) / this.voxelSize),
            Math.floor((position.y - this.bounds.min.y) / this.voxelSize),
            Math.floor((position.z - this.bounds.min.z) / this.voxelSize)
        );
    }

    public gridToWorld(gridPos: THREE.Vector3 | { x: number; y: number; z: number }): THREE.Vector3 {
        return new THREE.Vector3(
            this.bounds.min.x + ((gridPos.x as number) + 0.5) * this.voxelSize,
            this.bounds.min.y + ((gridPos.y as number) + 0.5) * this.voxelSize,
            this.bounds.min.z + ((gridPos.z as number) + 0.5) * this.voxelSize
        );
    }

    public markSafetyBox(box: SafetyBox): void {
        const minGrid = this.worldToGrid(box.min);
        const maxGrid = this.worldToGrid(box.max);

        const padding = 1; // minimal padding; absolute clearance handled in box inflation
        minGrid.subScalar(padding);
        maxGrid.addScalar(padding);

        const x0 = Math.max(0, Math.min(minGrid.x | 0, this.dimensions.x - 1));
        const y0 = Math.max(0, Math.min(minGrid.y | 0, this.dimensions.y - 1));
        const z0 = Math.max(0, Math.min(minGrid.z | 0, this.dimensions.z - 1));
        const x1 = Math.max(0, Math.min(maxGrid.x | 0, this.dimensions.x - 1));
        const y1 = Math.max(0, Math.min(maxGrid.y | 0, this.dimensions.y - 1));
        const z1 = Math.max(0, Math.min(maxGrid.z | 0, this.dimensions.z - 1));

        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                for (let z = z0; z <= z1; z++) {
                    this.blocked.add(this.idx(x, y, z));
                }
            }
        }
    }

    public isPositionSafe(position: THREE.Vector3): boolean {
        const gp = this.worldToGrid(position);
        // Treat out-of-bounds as free for LOS sampling/acceptance; grid A* stays in-bounds anyway
        if (!this.inBounds(gp.x, gp.y, gp.z)) return true;
        return !this.blocked.has(this.idx(gp.x, gp.y, gp.z));
    }

    public isCellFree(x: number, y: number, z: number): boolean {
        if (!this.inBounds(x, y, z)) return false;
        return !this.blocked.has(this.idx(x, y, z));
    }

    public getNeighborsInt(x: number, y: number, z: number): { x: number; y: number; z: number }[] {
        const out: { x: number; y: number; z: number }[] = [];
        const dirs = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1],
            [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
            [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
            [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
            [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
            [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]
        ];
        for (const [dx, dy, dz] of dirs) {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            if (!this.inBounds(nx, ny, nz)) continue;
            if (!this.isCellFree(nx, ny, nz)) continue;
            const steps = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            if (steps > 1) {
                // ensure no cutting corners: intermediate orthogonal cells must be free
                if (dx !== 0 && !this.isCellFree(x + dx, y, z)) continue;
                if (dy !== 0 && !this.isCellFree(x, y + dy, z)) continue;
                if (dz !== 0 && !this.isCellFree(x, y, z + dz)) continue;
            }
            out.push({ x: nx, y: ny, z: nz });
        }
        return out;
    }
}

export class TrajectoryPlanner {
    private static readonly VOXEL_SIZE = 2.0;
    private static readonly MIN_VOXEL_SIZE = 1.0;
    private static readonly MAX_VOXEL_SIZE = 250.0;
    private static readonly MAX_GRID_CELLS = 600_000;
    private static readonly PATH_SMOOTHING_ITERATIONS = 5;
    private static readonly MAX_PATHFINDING_ITERATIONS = 3000; // base; dynamically scaled per grid size
    private static readonly APPROACH_DISTANCE = 10.0;

    /**
     * Calculates a safety box around a target position
     */
    public static calculateSafetyBox(
        targetPos: THREE.Vector3,
        targetHalfExtents: THREE.Vector3,
        isTarget: boolean = false,
        clearance: number = 0.75
    ): SafetyBox {
        // targetHalfExtents are half-dimensions (for craft) or radius (for asteroids)
        // Expand by an absolute clearance instead of a large multiplicative factor.
        const expand = new THREE.Vector3(
            targetHalfExtents.x + clearance,
            targetHalfExtents.y + clearance,
            targetHalfExtents.z + clearance
        );

        return {
            min: new THREE.Vector3(
                targetPos.x - expand.x,
                targetPos.y - expand.y,
                targetPos.z - expand.z
            ),
            max: new THREE.Vector3(
                targetPos.x + expand.x,
                targetPos.y + expand.y,
                targetPos.z + expand.z
            ),
            isTarget
        };
    }

    // Heuristic now computed directly in findPath via hWorld

    private static findPath(
        start: THREE.Vector3,
        goal: THREE.Vector3,
        grid: VoxelGrid,
        isTargetPath: boolean = false,
        acceptanceRadius?: number
    ): THREE.Vector3[] {
        type Node = { x: number; y: number; z: number; g: number; f: number; id: number };

        class MinHeap {
            private a: Node[] = [];
            public size(): number { return this.a.length; }
            public push(n: Node): void { this.a.push(n); this.bubbleUp(this.a.length - 1); }
            public pop(): Node | undefined {
                if (this.a.length === 0) return undefined;
                const top = this.a[0];
                const last = this.a.pop()!;
                if (this.a.length > 0) { this.a[0] = last; this.bubbleDown(0); }
                return top;
            }
            private bubbleUp(i: number): void {
                while (i > 0) {
                    const p = (i - 1) >> 1;
                    if (this.a[p].f <= this.a[i].f) break;
                    const t = this.a[p]; this.a[p] = this.a[i]; this.a[i] = t; i = p;
                }
            }
            private bubbleDown(i: number): void {
                const n = this.a.length;
                while (true) {
                    let l = (i << 1) + 1, r = l + 1, s = i;
                    if (l < n && this.a[l].f < this.a[s].f) s = l;
                    if (r < n && this.a[r].f < this.a[s].f) s = r;
                    if (s === i) break; const t = this.a[i]; this.a[i] = this.a[s]; this.a[s] = t; i = s;
                }
            }
        }

        const startG = grid.worldToGrid(start);
        const goalG = grid.worldToGrid(goal);
        const dims = grid.getDimensions();

        const idx = (x: number, y: number, z: number) => ((x | 0) * (dims.y | 0) + (y | 0)) * (dims.z | 0) + (z | 0);
        const vSize = grid.getVoxelSize();
        const hEst = (x: number, y: number, z: number) => {
            const dx = (x | 0) - (goalG.x | 0);
            const dy = (y | 0) - (goalG.y | 0);
            const dz = (z | 0) - (goalG.z | 0);
            return vSize * Math.hypot(dx, dy, dz);
        };

        const heap = new MinHeap();
        const gMap = new Map<number, number>();
        const closed = new Set<number>();
        const parent = new Map<number, number>();

        const sId = idx(startG.x, startG.y, startG.z);

        const startNode: Node = { x: startG.x | 0, y: startG.y | 0, z: startG.z | 0, g: 0, f: hEst(startG.x, startG.y, startG.z), id: sId };
        heap.push(startNode);
        gMap.set(sId, 0);

        const defaultAccept = isTargetPath ? grid.getVoxelSize() : grid.getVoxelSize() * 2;
        const accept = Math.max(1, Math.ceil((acceptanceRadius ?? defaultAccept) / grid.getVoxelSize()));

        let iterations = 0;
        const dimsProd = Math.max(1, (dims.x | 0) * (dims.y | 0) * (dims.z | 0));
        // Allow more iterations on larger grids, but cap to avoid runaway
        const iterMax = Math.min(150_000, Math.max(this.MAX_PATHFINDING_ITERATIONS, Math.floor(0.12 * dimsProd)));
        while (heap.size() > 0 && iterations < iterMax) {
            iterations++;
            const cur = heap.pop()!;
            if (closed.has(cur.id)) continue;
            const curWorld = grid.gridToWorld(cur);
            if (curWorld.distanceTo(goal) <= accept * vSize && this.isPathSafe(curWorld, goal, grid)) {
                // reconstruct path
                const seq: THREE.Vector3[] = [];
                let id = cur.id;
                let node = cur;
                seq.push(goal.clone());
                // Rebuild using parent map
                while (true) {
                    const pId = parent.get(id);
                    const p = pId !== undefined ? pId : undefined;
                    const pos = grid.gridToWorld(node);
                    seq.unshift(pos);
                    if (p === undefined) break;
                    id = p;
                    const z = id % (dims.z | 0);
                    const y = ((id / (dims.z | 0)) | 0) % (dims.y | 0);
                    const x = ((id / ((dims.y | 0) * (dims.z | 0))) | 0);
                    node = { x, y, z, g: gMap.get(id) ?? 0, f: 0, id };
                    if (id === sId) { seq.unshift(grid.gridToWorld({ x, y, z })); break; }
                }
                // Ensure exact endpoints
                seq[0] = start.clone();
                seq[seq.length - 1] = goal.clone();
                return seq;
            }

            closed.add(cur.id);

            const neigh = grid.getNeighborsInt(cur.x, cur.y, cur.z);
            for (const n of neigh) {
                const nId = idx(n.x, n.y, n.z);
                if (closed.has(nId)) continue;

                const ddx = n.x - cur.x, ddy = n.y - cur.y, ddz = n.z - cur.z;
                const stepCost = vSize * Math.hypot(ddx, ddy, ddz);
                const tentativeG = (gMap.get(cur.id) ?? Infinity) + stepCost;
                if (tentativeG >= (gMap.get(nId) ?? Infinity)) continue;

                parent.set(nId, cur.id);
                gMap.set(nId, tentativeG);
                const f = tentativeG + hEst(n.x, n.y, n.z);
                heap.push({ x: n.x, y: n.y, z: n.z, g: tentativeG, f, id: nId });
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
        }>,
        clearance?: number
    ): THREE.Vector3[] {
        // Calculate bounds for the voxel grid
        const baseBounds = this.calculateGridBounds(start, goal, otherObjects);
        const voxelSize = this.chooseAdaptiveVoxelSize(baseBounds);
        const bounds = this.expandBounds(baseBounds, Math.max(40, voxelSize * 6));
        let grid = new VoxelGrid(bounds, voxelSize);

        // Mark safety boxes for all objects
        const clearanceUse = typeof clearance === 'number' ? Math.max(0.1, clearance) : 0.75;
        otherObjects.forEach(obj => {
            const safetyBox = this.calculateSafetyBox(obj.position, obj.size, obj.isTarget, clearanceUse);
            grid.markSafetyBox(safetyBox);
        });

        // Quick skirt bypass for large obstacles directly blocking S->G (fast path)
        const safetyBoxes = otherObjects.map(o => this.calculateSafetyBox(o.position, o.size, o.isTarget, clearanceUse));
        // If goal is inside an inflated safety box, push it just outside to avoid unreachable targets
        const goalSafe = (() => {
            const eps = Math.max(0.2, clearanceUse * 0.5);
            let pt = goal.clone();
            for (let iter = 0; iter < 3; iter++) {
                let adjusted = false;
                for (const b of safetyBoxes) {
                    if (pt.x >= b.min.x && pt.x <= b.max.x && pt.y >= b.min.y && pt.y <= b.max.y && pt.z >= b.min.z && pt.z <= b.max.z) {
                        const dxMin = Math.abs(pt.x - b.min.x), dxMax = Math.abs(b.max.x - pt.x);
                        const dyMin = Math.abs(pt.y - b.min.y), dyMax = Math.abs(b.max.y - pt.y);
                        const dzMin = Math.abs(pt.z - b.min.z), dzMax = Math.abs(b.max.z - pt.z);
                        const faces = [
                            { axis: 'x' as const, dir: -1, dist: dxMin, bound: b.min.x },
                            { axis: 'x' as const, dir: +1, dist: dxMax, bound: b.max.x },
                            { axis: 'y' as const, dir: -1, dist: dyMin, bound: b.min.y },
                            { axis: 'y' as const, dir: +1, dist: dyMax, bound: b.max.y },
                            { axis: 'z' as const, dir: -1, dist: dzMin, bound: b.min.z },
                            { axis: 'z' as const, dir: +1, dist: dzMax, bound: b.max.z },
                        ];
                        faces.sort((a, b2) => a.dist - b2.dist);
                        const f = faces[0];
                        if (f.axis === 'x') pt.x = f.bound + f.dir * eps;
                        if (f.axis === 'y') pt.y = f.bound + f.dir * eps;
                        if (f.axis === 'z') pt.z = f.bound + f.dir * eps;
                        adjusted = true;
                    }
                }
                if (!adjusted) break;
            }
            return pt;
        })();
        const directBlocked = this.doesLineIntersectAnySafetyBox(start, goalSafe, safetyBoxes);
        if (directBlocked) {
            const dir = new THREE.Vector3().subVectors(goalSafe, start);
            const L = Math.max(1e-6, dir.length());
            const d = dir.clone().multiplyScalar(1 / L);
            // Approximate obstacles as spheres using padded AABBs
            const obs = safetyBoxes.map(b => {
                const c = new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
                const half = new THREE.Vector3().subVectors(b.max, b.min).multiplyScalar(0.5);
                const r = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z);
                return { c, r };
            });
            const segClosest = (A: THREE.Vector3, B: THREE.Vector3, P: THREE.Vector3) => {
                const AB = B.clone().sub(A); const t = THREE.MathUtils.clamp(P.clone().sub(A).dot(AB) / Math.max(1e-9, AB.lengthSq()), 0, 1);
                return A.clone().add(AB.multiplyScalar(t));
            };
            const segHits = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, r: number) => segClosest(A, B, C).distanceToSquared(C) <= r * r;
            const pathClear = (pts: THREE.Vector3[]) => {
                for (let i = 0; i < pts.length - 1; i++) {
                    const A = pts[i], B = pts[i + 1];
                    for (const o of obs) if (segHits(A, B, o.c, o.r + Math.max(1.0, voxelSize))) return false;
                }
                return true;
            };
            const buildSkirt = (S: THREE.Vector3, G: THREE.Vector3): THREE.Vector3[] | null => {
                // Find first blocking obstacle along S->G
                let bestU = Infinity; let hit: { c: THREE.Vector3; r: number } | null = null; let contact = new THREE.Vector3();
                for (const o of obs) {
                    const u = THREE.MathUtils.clamp(o.c.clone().sub(S).dot(d), 0, L);
                    const pc = S.clone().add(d.clone().multiplyScalar(u));
                    if (pc.distanceToSquared(o.c) <= (o.r + Math.max(1.0, voxelSize)) ** 2) { if (u < bestU) { bestU = u; hit = o; contact.copy(pc); } }
                }
                if (!hit) return null;
                let side = contact.clone().sub(hit.c);
                if (side.lengthSq() < 1e-6) side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); else side.normalize();
                const margin = Math.max(1.0, voxelSize);
                const wpA = hit.c.clone().add(side.clone().multiplyScalar(hit.r + margin));
                const candA = [S.clone(), wpA.clone(), G.clone()];
                if (pathClear(candA)) return candA;
                const wpB = hit.c.clone().add(side.clone().multiplyScalar(-(hit.r + margin)));
                const candB = [S.clone(), wpB.clone(), G.clone()];
                if (pathClear(candB)) return candB;
                return null;
            };
            const skirt = buildSkirt(start, goalSafe);
            if (skirt && skirt.length >= 2) {
                return this.finalizePath(skirt, safetyBoxes, grid);
            }

            // Robust fallback: PRM graph around inflated boxes
            const prm = this.planPathPRM(start, goalSafe, safetyBoxes, { maxNodes: 400, kNeighbors: 10 });
            if (prm.length >= 2) return this.finalizePath(prm, safetyBoxes, grid);
        }

        // For target spacecraft, create an approach point
        const targetObject = otherObjects.find(obj => obj.isTarget);
        if (targetObject) {
            const dirToTarget = new THREE.Vector3().subVectors(goalSafe, targetObject.position).normalize();
            const approachPoint = new THREE.Vector3().copy(goalSafe).sub(
                dirToTarget.multiplyScalar(this.APPROACH_DISTANCE)
            );

            // First find path to approach point
            let pathToApproach = this.findPath(start, approachPoint, grid, false);
            if (pathToApproach.length === 0) {
                // If direct path fails, try intermediate points
                pathToApproach = this.findPathWithIntermediatePoints(start, approachPoint, grid);
                if (pathToApproach.length === 0) {
                    // Escalate bounds significantly and retry keeping resolution
                    const hugeBounds = this.expandBounds(baseBounds, Math.max(120, voxelSize * 20));
                    grid = new VoxelGrid(hugeBounds, voxelSize);
                    otherObjects.forEach(obj => grid.markSafetyBox(this.calculateSafetyBox(obj.position, obj.size, obj.isTarget)));
                    pathToApproach = this.findPath(start, approachPoint, grid, false);
                }
            }

            // Then find path from approach point to goal
            let finalApproach = this.findPath(approachPoint, goalSafe, grid, true);
            if (finalApproach.length === 0) {
                // If final approach fails, try with larger acceptance radius
                finalApproach = this.findPath(approachPoint, goalSafe, grid, true, grid.getVoxelSize() * 3);
            }

            // If grid was very coarse, refine near-goal with a fine local grid
            if (voxelSize > this.VOXEL_SIZE * 2) {
                const localRadius = Math.max(30, Math.max(targetObject.size.x, targetObject.size.y, targetObject.size.z) * 6);
                const localMin = goalSafe.clone().addScalar(-localRadius);
                const localMax = goalSafe.clone().addScalar(+localRadius);
                const localGrid = new VoxelGrid({ min: localMin, max: localMax }, this.VOXEL_SIZE);
                otherObjects.forEach(obj => localGrid.markSafetyBox(this.calculateSafetyBox(obj.position, obj.size, obj.isTarget, clearanceUse)));
                const anchor = finalApproach.length ? finalApproach[Math.max(0, finalApproach.length - 2)] : approachPoint;
                const refined = this.findPath(anchor, goalSafe, localGrid, true, localGrid.getVoxelSize() * 2);
                if (refined.length >= 2) {
                    // stitch: everything up to anchor from pathToApproach, then refined
                    const full = [...pathToApproach];
                    if (refined.length > 0) full.push(...refined.slice(1));
                    pathToApproach = full;
                    finalApproach = refined;
                }
            }

            // Combine paths
            let fullPath = [...pathToApproach];
            if (finalApproach.length > 1) {
                fullPath.push(...finalApproach.slice(1));
            }

            // Multi-resolution refinement for segments intersecting obstacles
            fullPath = this.refinePathMultiRes(fullPath, otherObjects, voxelSize, this.VOXEL_SIZE, clearanceUse);
            // Finalize with collision-safe smoothing
            const boxes = otherObjects.map(o => this.calculateSafetyBox(o.position, o.size, o.isTarget, clearanceUse));
            return this.finalizePath(fullPath, boxes, grid);
        }

        // If no target object, just find direct path
        let path = this.findPath(start, goalSafe, grid, false);
        if (path.length === 0) {
            // Try intermediate points with increasingly large detours
            path = this.findPathWithIntermediatePoints(start, goalSafe, grid);
        }
        if (path.length === 0) {
            // Escalate search region while keeping resolution
            const hugeBounds = this.expandBounds(baseBounds, Math.max(120, voxelSize * 20));
            grid = new VoxelGrid(hugeBounds, voxelSize);
            otherObjects.forEach(obj => grid.markSafetyBox(this.calculateSafetyBox(obj.position, obj.size, obj.isTarget, clearanceUse)));
            path = this.findPath(start, goalSafe, grid, false);
        }
        if (path.length === 0) {
            // Special handling for goal right-behind obstacle: plan to an approach point, then refine locally
            const dirToGoal = new THREE.Vector3().subVectors(goalSafe, start).normalize();
            const approachPoint = goalSafe.clone().sub(dirToGoal.multiplyScalar(Math.max(this.APPROACH_DISTANCE, grid.getVoxelSize() * 2)));
            let pathToApproach = this.findPath(start, approachPoint, grid, false);
            if (pathToApproach.length === 0) {
                pathToApproach = this.findPathWithIntermediatePoints(start, approachPoint, grid);
            }
            if (pathToApproach.length > 0) {
                // Fine local grid near goal
                const localRadius = Math.max(30, this.VOXEL_SIZE * 20);
                const localMin = goalSafe.clone().addScalar(-localRadius);
                const localMax = goalSafe.clone().addScalar(+localRadius);
                const localGrid = new VoxelGrid({ min: localMin, max: localMax }, this.VOXEL_SIZE);
                otherObjects.forEach(obj => localGrid.markSafetyBox(this.calculateSafetyBox(obj.position, obj.size, obj.isTarget, clearanceUse)));
                let finalApproach = this.findPath(approachPoint, goalSafe, localGrid, true, localGrid.getVoxelSize() * 2);
                if (finalApproach.length >= 2) {
                    const full = [...pathToApproach, ...finalApproach.slice(1)];
                    path = full;
                }
            }
        }
        // Multi-resolution refinement for segments intersecting obstacles
        path = this.refinePathMultiRes(path, otherObjects, voxelSize, this.VOXEL_SIZE, clearanceUse);
        return this.finalizePath(path, otherObjects.map(o => this.calculateSafetyBox(o.position, o.size, o.isTarget, clearanceUse)), grid);
    }

    private static calculateGridBounds(
        start: THREE.Vector3,
        goal: THREE.Vector3,
        objects: Array<{ position: THREE.Vector3; size: THREE.Vector3 }>
    ): { min: THREE.Vector3; max: THREE.Vector3 } {
        const min = new THREE.Vector3(Infinity, Infinity, Infinity);
        const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

        // Include start/goal directly
        const includePoint = (p: THREE.Vector3) => {
            min.x = Math.min(min.x, p.x);
            min.y = Math.min(min.y, p.y);
            min.z = Math.min(min.z, p.z);
            max.x = Math.max(max.x, p.x);
            max.y = Math.max(max.y, p.y);
            max.z = Math.max(max.z, p.z);
        };
        includePoint(start);
        includePoint(goal);

        // Expand by object extents with safety margin
        const safetyMargin = 2.5;
        for (const obj of objects) {
            const half = obj.size.clone().multiplyScalar(safetyMargin);
            const bmin = obj.position.clone().sub(half);
            const bmax = obj.position.clone().add(half);
            includePoint(bmin);
            includePoint(bmax);
        }

        // Add global planning margin
        const margin = 20.0;
        min.subScalar(margin);
        max.addScalar(margin);

        return { min, max };
    }

    private static expandBounds(bounds: { min: THREE.Vector3; max: THREE.Vector3 }, margin: number): { min: THREE.Vector3; max: THREE.Vector3 } {
        const min = bounds.min.clone().subScalar(margin);
        const max = bounds.max.clone().addScalar(margin);
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

        // Try different intermediate points with increasing detour scales
        const scales = [0.5, 1.0, 2.0];
        const bases = [
            rightVector.clone(), rightVector.clone().negate(),
            upVector.clone(), upVector.clone().negate()
        ];
        const offsets: THREE.Vector3[] = [];
        for (const s of scales) for (const b of bases) offsets.push(b.clone().multiplyScalar(distance * s));

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

    /**
     * Pick a voxel size that keeps grid cells under a target budget for huge scenes.
     */
    private static chooseAdaptiveVoxelSize(bounds: { min: THREE.Vector3; max: THREE.Vector3 }): number {
        const base = this.VOXEL_SIZE;
        const sizeX = Math.max(1e-6, bounds.max.x - bounds.min.x);
        const sizeY = Math.max(1e-6, bounds.max.y - bounds.min.y);
        const sizeZ = Math.max(1e-6, bounds.max.z - bounds.min.z);
        const dimsAtBase = new THREE.Vector3(
            Math.ceil(sizeX / base),
            Math.ceil(sizeY / base),
            Math.ceil(sizeZ / base)
        );
        const cellsAtBase = Math.max(1, (dimsAtBase.x | 0) * (dimsAtBase.y | 0) * (dimsAtBase.z | 0));
        if (cellsAtBase <= this.MAX_GRID_CELLS) return base;
        const scale = Math.cbrt(cellsAtBase / this.MAX_GRID_CELLS);
        const v = THREE.MathUtils.clamp(base * scale, this.MIN_VOXEL_SIZE, this.MAX_VOXEL_SIZE);
        return v;
    }

    /** Probabilistic Roadmap (deterministic anchors) fallback for robust large-obstacle routing. */
    private static planPathPRM(
        start: THREE.Vector3,
        goal: THREE.Vector3,
        safetyBoxes: SafetyBox[],
        opts?: { maxNodes?: number; kNeighbors?: number }
    ): THREE.Vector3[] {
        const maxNodes = Math.max(50, Math.min(800, opts?.maxNodes ?? 400));
        const kNeighbors = Math.max(4, Math.min(20, opts?.kNeighbors ?? 8));

        const nodes: THREE.Vector3[] = [start.clone(), goal.clone()];
        // Corridor-based filter to choose relevant obstacles
        const dir = new THREE.Vector3().subVectors(goal, start); const L = Math.max(1e-6, dir.length()); const d = dir.clone().multiplyScalar(1 / L);
        const nearBoxes = safetyBoxes.filter(b => {
            const c = new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
            const u = THREE.MathUtils.clamp(c.clone().sub(start).dot(d), 0, L);
            const closest = start.clone().add(d.clone().multiplyScalar(u));
            const half = new THREE.Vector3().subVectors(b.max, b.min).multiplyScalar(0.5);
            const r = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z);
            const margin = 5.0;
            return closest.distanceTo(c) <= (margin + r);
        });
        const inflate = (box: SafetyBox, pad: number): SafetyBox => ({ min: box.min.clone().addScalar(-pad), max: box.max.clone().addScalar(pad), isTarget: box.isTarget });
        const anchorsFromBox = (box: SafetyBox): THREE.Vector3[] => {
            const c = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
            const half = new THREE.Vector3().subVectors(box.max, box.min).multiplyScalar(0.5);
            const pts: THREE.Vector3[] = [];
            // 8 corners
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(new THREE.Vector3(c.x + sx * half.x, c.y + sy * half.y, c.z + sz * half.z));
            // 6 face centers
            pts.push(new THREE.Vector3(c.x + half.x, c.y, c.z)); pts.push(new THREE.Vector3(c.x - half.x, c.y, c.z));
            pts.push(new THREE.Vector3(c.x, c.y + half.y, c.z)); pts.push(new THREE.Vector3(c.x, c.y - half.y, c.z));
            pts.push(new THREE.Vector3(c.x, c.y, c.z + half.z)); pts.push(new THREE.Vector3(c.x, c.y, c.z - half.z));
            return pts;
        };
        const ringAnchors = (box: SafetyBox): THREE.Vector3[] => {
            const c = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
            const half = new THREE.Vector3().subVectors(box.max, box.min).multiplyScalar(0.5);
            const rBase = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z);
            const pad = 2.0;
            const radius = rBase + pad;
            const up = Math.abs(d.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
            const u = new THREE.Vector3().crossVectors(d, up).normalize();
            const v = new THREE.Vector3().crossVectors(d, u).normalize();
            const deg = [ -90, -60, -45, -30, 30, 45, 60, 90 ];
            const pts: THREE.Vector3[] = [];
            for (const ang of deg) {
                const rad = (ang * Math.PI) / 180;
                const dirRing = u.clone().multiplyScalar(Math.cos(rad)).add(v.clone().multiplyScalar(Math.sin(rad)));
                pts.push(c.clone().add(dirRing.multiplyScalar(radius)));
            }
            return pts;
        };
        // Build anchors until cap
        const pad = 2.0; // ensure nodes sit just outside inflated boxes
        for (const b of nearBoxes) {
            if (nodes.length >= maxNodes) break;
            const inf = inflate(b, pad);
            const pts = anchorsFromBox(inf).concat(ringAnchors(inf));
            for (const p of pts) { nodes.push(p); if (nodes.length >= maxNodes) break; }
            if (nodes.length >= maxNodes) break;
        }

        // Graph edges (k-NN) with LOS checks
        const N = nodes.length;
        const adj: number[][] = new Array(N).fill(null as any).map(() => []);
        const w: number[][] = new Array(N).fill(null as any).map(() => []);
        const neighborsOf = (i: number): number[] => {
            const dists: { j: number; d: number }[] = [];
            for (let j = 0; j < N; j++) if (j !== i) dists.push({ j, d: nodes[i].distanceTo(nodes[j]) });
            dists.sort((a, b) => a.d - b.d);
            const out: number[] = [];
            for (let k = 0; k < Math.min(kNeighbors * 2, dists.length); k++) out.push(dists[k].j);
            return out;
        };
        const segClear = (a: THREE.Vector3, b: THREE.Vector3) => !this.doesLineIntersectAnySafetyBox(a, b, safetyBoxes);
        for (let i = 0; i < N; i++) {
            const cand = neighborsOf(i);
            let added = 0;
            for (const j of cand) {
                if (added >= kNeighbors) break;
                const a = nodes[i], b = nodes[j];
                if (segClear(a, b)) {
                    adj[i].push(j); w[i].push(a.distanceTo(b)); added++;
                }
            }
        }

        // A* on this sparse graph
        const startIdx = 0, goalIdx = 1;
        type QNode = { i: number; g: number; f: number };
        class MinHeap { a: QNode[] = []; push(n: QNode){ this.a.push(n); this.up(this.a.length-1);} pop(){ if(!this.a.length) return undefined; const t=this.a[0]; const l=this.a.pop()!; if(this.a.length){ this.a[0]=l; this.down(0);} return t;} up(i:number){ while(i>0){const p=(i-1)>>1; if(this.a[p].f<=this.a[i].f) break; [this.a[p],this.a[i]]=[this.a[i],this.a[p]]; i=p;}} down(i:number){ const n=this.a.length; for(;;){ let l=i*2+1,r=l+1,s=i; if(l<n&&this.a[l].f<this.a[s].f) s=l; if(r<n&&this.a[r].f<this.a[s].f) s=r; if(s===i) break; [this.a[i],this.a[s]]=[this.a[s],this.a[i]]; i=s; }} size(){return this.a.length;} }
        const h = (i: number) => nodes[i].distanceTo(nodes[goalIdx]);
        const open = new MinHeap();
        const g = new Array(N).fill(Infinity);
        const parent = new Array(N).fill(-1);
        const closed = new Array(N).fill(false);
        g[startIdx] = 0; open.push({ i: startIdx, g: 0, f: h(startIdx) });
        let found = false;
        const iterMax = Math.min(100000, N * kNeighbors * 4);
        let it = 0;
        while (open.size() && it++ < iterMax) {
            const cur = open.pop()!;
            if (closed[cur.i]) continue;
            if (cur.i === goalIdx) { found = true; break; }
            closed[cur.i] = true;
            for (let k = 0; k < adj[cur.i].length; k++) {
                const j = adj[cur.i][k]; const cost = w[cur.i][k];
                if (closed[j]) continue;
                const ng = g[cur.i] + cost;
                if (ng < g[j]) { g[j] = ng; parent[j] = cur.i; open.push({ i: j, g: ng, f: ng + h(j) }); }
            }
        }
        if (!found && parent[goalIdx] === -1) return [];
        // Reconstruct
        const path: THREE.Vector3[] = [];
        let i = goalIdx; path.unshift(nodes[i].clone());
        while (i !== startIdx && parent[i] !== -1) { i = parent[i]; path.unshift(nodes[i].clone()); }
        return path.length >= 2 ? path : [];
    }

    /**
     * Refine any colliding segment by replanning locally with smaller voxels.
     */
    private static refinePathMultiRes(
        path: THREE.Vector3[],
        otherObjects: Array<{ position: THREE.Vector3; size: THREE.Vector3; isTarget: boolean }>,
        coarseVoxel: number,
        fineVoxel: number,
        clearance: number
    ): THREE.Vector3[] {
        if (path.length < 2) return path;
        const safetyBoxes = otherObjects.map(o => this.calculateSafetyBox(o.position, o.size, o.isTarget, clearance));

        const refineSegment = (A: THREE.Vector3, B: THREE.Vector3): THREE.Vector3[] | null => {
            // Local bounds around the segment, expanded by length and object scale
            const segLen = Math.max(1e-6, A.distanceTo(B));
            const center = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
            const half = Math.max(30, segLen * 0.6);
            const localMin = center.clone().addScalar(-half);
            const localMax = center.clone().addScalar(+half);
            // Filter obstacles that overlap local AABB to reduce marking cost
            const localObjs = otherObjects.filter(o => (
                o.position.x + o.size.x >= localMin.x && o.position.x - o.size.x <= localMax.x &&
                o.position.y + o.size.y >= localMin.y && o.position.y - o.size.y <= localMax.y &&
                o.position.z + o.size.z >= localMin.z && o.position.z - o.size.z <= localMax.z
            ));
            const tryVoxels = [Math.max(fineVoxel, coarseVoxel * 0.5), fineVoxel];
            for (const v of tryVoxels) {
                const grid = new VoxelGrid({ min: localMin, max: localMax }, v);
                for (const o of localObjs) grid.markSafetyBox(this.calculateSafetyBox(o.position, o.size, o.isTarget, clearance));
                const sub = this.findPath(A, B, grid, false, v * 2);
                if (sub.length >= 2) return sub;
            }
            return null;
        };

        let changed = false;
        let refinedCount = 0;
        const maxRefineSegments = 6;
        const out: THREE.Vector3[] = [path[0].clone()];
        for (let i = 0; i < path.length - 1; i++) {
            const A = path[i];
            const B = path[i + 1];
            if (!this.doesLineIntersectAnySafetyBox(A, B, safetyBoxes)) {
                out.push(B.clone());
                continue;
            }
            if (refinedCount >= maxRefineSegments) { out.push(B.clone()); continue; }
            const refined = refineSegment(A, B);
            if (refined && refined.length >= 2) {
                // stitch refined subpath (skip first point A; we already have it)
                for (let k = 1; k < refined.length; k++) out.push(refined[k].clone());
                changed = true;
                refinedCount++;
            } else {
                out.push(B.clone());
            }
        }
        return changed ? out : path;
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


    // Trim corners by pulling points on both sides of a corner toward the obstacle, keeping LOS safe.

    // Finalize: LOS smooth, round corners, LOS smooth again, then grid-based simplification
    private static finalizePath(initial: THREE.Vector3[], safetyBoxes: SafetyBox[], grid: VoxelGrid): THREE.Vector3[] {
        const bvh = SafetyBoxBVH.fromBoxes(safetyBoxes);
        const isSafe = (pts: THREE.Vector3[]): boolean => {
            for (let i = 0; i < pts.length - 1; i++) if (bvh.segmentIntersects(pts[i], pts[i + 1])) return false;
            return true;
        };
        const clone = (pts: THREE.Vector3[]) => pts.map(p => p.clone());
        const raw = clone(initial);
        let p = this.smoothPathLOS_BVH(raw, bvh);
        if (!isSafe(p)) p = clone(raw);
        let q = this.roundCorners_BVH(p, bvh);
        if (!isSafe(q)) q = p; else p = q;
        let r = this.smoothPathLOS_BVH(p, bvh);
        if (!isSafe(r)) r = p; else p = r;
        // final lightweight grid-based shortcut pass to remove redundant points; keep only if still safe
        const g = this.smoothPath(p, grid);
        if (isSafe(g)) p = g;
        const spline = this.trySplineSmooth(p, bvh, grid);
        if (spline && isSafe(spline)) p = spline;
        return p;
    }

    private static trySplineSmooth(path: THREE.Vector3[], bvh: SafetyBoxBVH, grid: VoxelGrid): THREE.Vector3[] | null {
        if (path.length < 3) return null;
        const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal', 0.5);
        const samples = Math.min(800, Math.max(24, (path.length - 1) * 12));
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            pts.push(curve.getPoint(t));
        }
        pts[0] = path[0].clone();
        pts[pts.length - 1] = path[path.length - 1].clone();
        // Deduplicate and enforce minimal spacing
        const spacing = Math.max(1.25, grid.getVoxelSize());
        const filtered: THREE.Vector3[] = [pts[0].clone()];
        for (let i = 1; i < pts.length - 1; i++) {
            if (pts[i].distanceTo(filtered[filtered.length - 1]) >= spacing * 0.45) {
                filtered.push(pts[i].clone());
            }
        }
        filtered.push(pts[pts.length - 1].clone());
        const los = this.smoothPathLOS_BVH(filtered.map(p => p.clone()), bvh);
        const decimated = this.decimateBySpacing(los, spacing * 0.8);
        const origLen = this.pathLength(path);
        const newLen = this.pathLength(decimated);
        if (!Number.isFinite(newLen) || newLen > origLen * 1.35) return null;
        for (let i = 0; i < decimated.length - 1; i++) {
            if (bvh.segmentIntersects(decimated[i], decimated[i + 1])) return null;
        }
        return decimated;
    }

    private static decimateBySpacing(path: THREE.Vector3[], spacing: number): THREE.Vector3[] {
        if (path.length <= 2) return path.map(p => p.clone());
        const out: THREE.Vector3[] = [path[0].clone()];
        let acc = 0;
        for (let i = 1; i < path.length - 1; i++) {
            const d = path[i].distanceTo(path[i - 1]);
            acc += d;
            if (acc >= spacing) {
                out.push(path[i].clone());
                acc = 0;
            }
        }
        out.push(path[path.length - 1].clone());
        return out;
    }

    private static pathLength(path: THREE.Vector3[]): number {
        if (!path || path.length < 2) return 0;
        let L = 0;
        for (let i = 1; i < path.length; i++) L += path[i].distanceTo(path[i - 1]);
        return L;
    }

    // Optimized LOS smoothing using BVH
    private static smoothPathLOS_BVH(path: THREE.Vector3[], bvh: SafetyBoxBVH): THREE.Vector3[] {
        if (path.length <= 2) return path;
        for (let iteration = 0; iteration < this.PATH_SMOOTHING_ITERATIONS; iteration++) {
            let changed = false;
            let i = 0;
            while (i < path.length - 2) {
                const a = path[i];
                const c = path[i + 2];
                if (!bvh.segmentIntersects(a, c)) {
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

    private static roundCorners_BVH(path: THREE.Vector3[], bvh: SafetyBoxBVH): THREE.Vector3[] {
        if (path.length < 3) return path;
        const out: THREE.Vector3[] = [path[0].clone()];
        for (let i = 1; i < path.length - 1; i++) {
            const A = path[i - 1], B = path[i], C = path[i + 1];
            const AB = B.clone().sub(A); const ABlen = Math.max(1e-6, AB.length()); const dAB = AB.clone().multiplyScalar(1 / ABlen);
            const BC = C.clone().sub(B); const BClen = Math.max(1e-6, BC.length()); const dBC = BC.clone().multiplyScalar(1 / BClen);
            const maxTrimA = Math.min(ABlen * 0.45, 30);
            const maxTrimC = Math.min(BClen * 0.45, 30);
            let bestPA = B.clone(); let bestQC = B.clone(); let bestPerim = A.distanceTo(B) + B.distanceTo(C);
            const steps = 8;
            for (let sa = 0; sa <= steps; sa++) {
                const ta = (sa / steps) * maxTrimA;
                const P = B.clone().sub(dAB.clone().multiplyScalar(Math.min(maxTrimA, ta)));
                for (let sc = 0; sc <= steps; sc++) {
                    const tc = (sc / steps) * maxTrimC;
                    const Q = B.clone().add(dBC.clone().multiplyScalar(Math.min(maxTrimC, tc)));
                    if (!bvh.segmentIntersects(P, Q)) {
                        const perim = A.distanceTo(P) + P.distanceTo(Q) + Q.distanceTo(C);
                        if (perim + 1e-6 < bestPerim) { bestPerim = perim; bestPA = P; bestQC = Q; }
                    }
                }
            }
            if (!bestPA.equals(B) || !bestQC.equals(B)) {
                out.push(bestPA.clone()); out.push(bestQC.clone());
            } else { out.push(B.clone()); }
        }
        out.push(path[path.length - 1].clone());
        return out;
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
        // Robust segment-AABB slab test on [0,1]
        const a = start; const b = end;
        let tmin = 0.0; let tmax = 1.0;
        const eps = 1e-3;
        const update = (sa: number, sb: number, bmin: number, bmax: number): boolean => {
            const d = sb - sa;
            if (Math.abs(d) < 1e-9) {
                // Segment parallel to slab; reject if outside
                return sa >= bmin && sa <= bmax;
            }
            const inv = 1.0 / d;
            let t0 = (bmin - sa) * inv;
            let t1 = (bmax - sa) * inv;
            if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
            tmin = Math.max(tmin, t0);
            tmax = Math.min(tmax, t1);
            return tmin <= tmax;
        };
        if (!update(a.x, b.x, box.min.x - eps, box.max.x + eps)) return false;
        if (!update(a.y, b.y, box.min.y - eps, box.max.y + eps)) return false;
        if (!update(a.z, b.z, box.min.z - eps, box.max.z + eps)) return false;
        return tmax >= 0 && tmin <= 1 && tmax >= tmin;
    }

    /**
     * Checks if a point is inside a safety box
     */
    // private static isPointInBox retained previously; slab test now handles segment cases

    /**
     * Creates a trajectory from waypoints
     */
    public static createTrajectory(waypoints: THREE.Vector3[], totalTime: number): Trajectory {
        return new Trajectory(waypoints, totalTime);
    }
} 

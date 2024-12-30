import * as THREE from 'three';

interface TrajectorySegment {
    start: THREE.Vector3;
    end: THREE.Vector3;
    distance: number;
}

interface TrajectoryUpdate {
    position: THREE.Vector3 | null;
    velocity: THREE.Vector3 | null;
}

export class Trajectory {
    private waypoints: THREE.Vector3[];
    private totalTime: number;
    private currentTime: number;
    private segments: TrajectorySegment[];
    private segmentTimes: number[];

    constructor(waypoints: THREE.Vector3[] = [], totalTime: number = 100) {
        this.waypoints = waypoints;
        this.totalTime = totalTime;
        this.currentTime = 0;

        // Precompute segments for efficiency
        this.segments = [];
        this.segmentTimes = [];
        this.computeSegments();
    }

    /**
     * Adds a waypoint to the trajectory.
     */
    public addWaypoint(waypoint: THREE.Vector3): void {
        this.waypoints.push(waypoint);
        this.computeSegments();
    }

    /**
     * Computes trajectory segments and timing based on waypoints.
     */
    private computeSegments(): void {
        this.segments = [];
        this.segmentTimes = [];

        if (this.waypoints.length < 2) return;

        // Calculate total distance
        const totalDistance = this.computeTotalDistance();
        if (totalDistance === 0) {
            console.warn('Total distance of trajectory is zero.');
            return;
        }

        let accumulatedTime = 0;

        for (let i = 0; i < this.waypoints.length - 1; i++) {
            const start = this.waypoints[i];
            const end = this.waypoints[i + 1];
            const distance = start.distanceTo(end);
            const segmentTime = (distance / totalDistance) * this.totalTime;
            this.segments.push({ start, end, distance });
            this.segmentTimes.push(segmentTime);
            accumulatedTime += segmentTime;
        }
    }

    /**
     * Computes the total distance of the trajectory.
     */
    private computeTotalDistance(): number {
        let distance = 0;
        for (let i = 0; i < this.waypoints.length - 1; i++) {
            distance += this.waypoints[i].distanceTo(this.waypoints[i + 1]);
        }
        return distance;
    }

    /**
     * Updates the current time and returns the desired position and velocity.
     */
    public update(dt: number): TrajectoryUpdate {
        if (this.waypoints.length < 2) {
            return { position: null, velocity: null };
        }

        this.currentTime += dt;
        if (this.currentTime > this.totalTime) {
            this.currentTime = this.totalTime;
        }

        // Determine current segment
        let elapsed = 0;
        let segmentIndex = 0;
        while (segmentIndex < this.segmentTimes.length && elapsed + this.segmentTimes[segmentIndex] < this.currentTime) {
            elapsed += this.segmentTimes[segmentIndex];
            segmentIndex++;
        }

        if (segmentIndex >= this.segments.length) {
            // Trajectory completed
            return {
                position: this.waypoints[this.waypoints.length - 1].clone(),
                velocity: new THREE.Vector3(0, 0, 0)
            };
        }

        const segment = this.segments[segmentIndex];
        const segmentTime = this.segmentTimes[segmentIndex];
        const t = (this.currentTime - elapsed) / segmentTime;

        // Linear interpolation for position
        const position = new THREE.Vector3().lerpVectors(segment.start, segment.end, t);

        // Simple velocity estimation
        const deltaT = 0.01; // Small time delta for velocity approximation
        const nextT = t + (deltaT / segmentTime);
        const nextTClamped = Math.min(nextT, 1);
        const nextPosition = new THREE.Vector3().lerpVectors(segment.start, segment.end, nextTClamped);
        const velocity = new THREE.Vector3().subVectors(nextPosition, position).divideScalar(deltaT);

        return { position, velocity };
    }

    /**
     * Resets the trajectory.
     */
    public reset(): void {
        this.currentTime = 0;
    }

    public getWaypoints(): THREE.Vector3[] {
        return this.waypoints;
    }
} 
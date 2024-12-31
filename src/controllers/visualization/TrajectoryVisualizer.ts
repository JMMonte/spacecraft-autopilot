import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class TrajectoryVisualizer {
    private debugObjects: THREE.Object3D[] = [];
    private scene: THREE.Scene;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    public visualizeTrajectory(
        waypoints: THREE.Vector3[],
        currentWaypointIndex: number,
        options?: {
            targetPosition?: THREE.Vector3;
            targetPortPosition?: THREE.Vector3;
            targetPortDirection?: THREE.Vector3;
            waypointThreshold?: number;
        }
    ): void {
        this.clearDebugObjects();

        // Create spheres for waypoints
        waypoints.forEach((point, index) => {
            let color;
            if (index === waypoints.length - 1) {
                // Final point is red unless it's been reached
                color = index < currentWaypointIndex ? 0x00ff00 : 0xff0000;
            } else if (index === currentWaypointIndex) {
                // Next waypoint is blue
                color = 0x0088ff;
            } else if (index < currentWaypointIndex) {
                // Passed waypoints are green
                color = 0x00ff00;
            } else {
                // Future waypoints are gray
                color = 0x888888;
            }
            
            // Create solid center sphere
            const sphere = this.createDebugSphere(point, color, 0.1);
            this.scene.add(sphere);
            this.debugObjects.push(sphere);

            // Create transparent threshold sphere if threshold is provided
            if (options?.waypointThreshold) {
                const thresholdSphere = this.createDebugSphere(point, color, options.waypointThreshold, 0.15);
                this.scene.add(thresholdSphere);
                this.debugObjects.push(thresholdSphere);
            }
        });

        // Create lines connecting waypoints, split into reached and unreached segments
        if (waypoints.length > 1) {
            // Reached segments (green)
            if (currentWaypointIndex > 0) {
                const reachedPoints = waypoints.slice(0, currentWaypointIndex + 1);
                const reachedLine = this.createDebugLine(reachedPoints, 0x00ff00);
                this.scene.add(reachedLine);
                this.debugObjects.push(reachedLine);
            }

            // Unreached segments (gray)
            if (currentWaypointIndex < waypoints.length - 1) {
                const unreachedPoints = waypoints.slice(currentWaypointIndex);
                const unreachedLine = this.createDebugLine(unreachedPoints, 0x888888);
                this.scene.add(unreachedLine);
                this.debugObjects.push(unreachedLine);
            }
        }

        // Visualize target position and port if provided
        if (options?.targetPosition) {
            const targetSphere = this.createDebugSphere(options.targetPosition, 0xff00ff, 0.3);
            this.scene.add(targetSphere);
            this.debugObjects.push(targetSphere);
        }

        if (options?.targetPortPosition) {
            const portSphere = this.createDebugSphere(options.targetPortPosition, 0xffff00, 0.2);
            this.scene.add(portSphere);
            this.debugObjects.push(portSphere);

            // Visualize port direction if provided
            if (options?.targetPortDirection) {
                const directionLength = 2.0;
                const directionEnd = new THREE.Vector3()
                    .copy(options.targetPortPosition)
                    .add(options.targetPortDirection.clone().multiplyScalar(directionLength));
                
                const directionLine = this.createDebugLine(
                    [options.targetPortPosition, directionEnd],
                    0xffff00
                );
                this.scene.add(directionLine);
                this.debugObjects.push(directionLine);
            }
        }
    }

    public visualizeSafetyBox(position: THREE.Vector3, size: CANNON.Vec3): void {
        const geometry = new THREE.BoxGeometry(
            size.x * 2.6,  // Make box slightly larger than the actual safety box
            size.y * 2.6,
            size.z * 2.6
        );
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            wireframe: true,
            transparent: true,
            opacity: 0.3
        });
        const box = new THREE.Mesh(geometry, material);
        box.position.copy(position);
        
        this.scene.add(box);
        this.debugObjects.push(box);
    }

    private createDebugSphere(
        position: THREE.Vector3,
        color: number,
        radius: number,
        opacity: number = 1.0
    ): THREE.Mesh {
        const geometry = new THREE.SphereGeometry(radius, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: opacity < 1.0,
            opacity: opacity
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(position);
        return sphere;
    }

    private createDebugLine(points: THREE.Vector3[], color: number): THREE.Line {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: color });
        return new THREE.Line(geometry, material);
    }

    public clearDebugObjects(): void {
        this.debugObjects.forEach(obj => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            } else if (obj instanceof THREE.Line) {
                obj.geometry.dispose();
                obj.material.dispose();
            }
            this.scene.remove(obj);
        });
        this.debugObjects = [];
    }

    public cleanup(): void {
        this.clearDebugObjects();
    }
} 
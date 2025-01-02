import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class TrajectoryVisualizer {
    private debugObjects: THREE.Object3D[] = [];
    private scene: THREE.Scene;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    public getScene(): THREE.Scene {
        return this.scene;
    }

    public visualizeTrajectory(
        waypoints: THREE.Vector3[],
        currentWaypointIndex: number,
        options?: {
            // Active spacecraft info
            ourPosition?: THREE.Vector3;
            ourSize?: CANNON.Vec3;
            ourOrientation?: THREE.Quaternion;
            ourPortPosition?: THREE.Vector3;
            ourPortDirection?: THREE.Vector3;
            ourPortOffset?: number;

            // Target spacecraft info
            targetPosition?: THREE.Vector3;
            targetSize?: CANNON.Vec3;
            targetOrientation?: THREE.Quaternion;
            targetPortPosition?: THREE.Vector3;
            targetPortDirection?: THREE.Vector3;
            targetPortOffset?: number;

            // Common info
            portDimensions?: CANNON.Vec3;
            waypointThreshold?: number;

            // Other spacecraft info
            otherSpacecraft?: Array<{
                position: THREE.Vector3;
                size: CANNON.Vec3;
                safetySize: CANNON.Vec3;
                orientation?: THREE.Quaternion;
            }>;
        }
    ): void {
        this.clearDebugObjects();

        // Create spheres for each waypoint
        waypoints.forEach((waypoint, index) => {
            const color = index === currentWaypointIndex ? 0xffff00 : 0x888888;
            const sphere = this.createDebugSphere(waypoint, color, 0.1, 1.0);
            this.scene.add(sphere);
            this.debugObjects.push(sphere);

            // Add threshold visualization for current waypoint
            if (index === currentWaypointIndex && options?.waypointThreshold) {
                const thresholdSphere = this.createDebugSphere(
                    waypoint,
                    0xffff00,
                    options.waypointThreshold,
                    0.1
                );
                this.scene.add(thresholdSphere);
                this.debugObjects.push(thresholdSphere);
            }
        });

        // Create lines connecting waypoints
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

        // Visualize active spacecraft
        if (options?.ourPosition && options?.ourSize) {
            // Create active spacecraft bounding box
            const ourBox = this.createBoundingBox(
                options.ourPosition,
                options.ourSize,
                0x00ffff, // Cyan
                0.2,
                options.ourOrientation,
                true // Uses half-extents
            );
            this.scene.add(ourBox);
            this.debugObjects.push(ourBox);

            // Create active spacecraft center
            const ourSphere = this.createDebugSphere(
                options.ourPosition,
                0x00ffff,
                0.3,
                1.0
            );
            this.scene.add(ourSphere);
            this.debugObjects.push(ourSphere);

            // Visualize active spacecraft docking port
            if (options.ourPortPosition && options.ourPortDirection && options.portDimensions) {
                this.visualizeDockingPort(
                    options.ourPortPosition,
                    options.ourPortDirection,
                    options.portDimensions,
                    0x00ffff // Cyan
                );
            }
        }

        // Visualize target spacecraft
        if (options?.targetPosition && options?.targetSize) {
            // Create target spacecraft bounding box
            const targetBox = this.createBoundingBox(
                options.targetPosition,
                options.targetSize,
                0xff00ff, // Magenta
                0.2,
                options.targetOrientation,
                true // Uses half-extents
            );
            this.scene.add(targetBox);
            this.debugObjects.push(targetBox);

            // Create target spacecraft center
            const targetSphere = this.createDebugSphere(
                options.targetPosition,
                0xff00ff,
                0.3,
                1.0
            );
            this.scene.add(targetSphere);
            this.debugObjects.push(targetSphere);

            // Visualize target spacecraft docking port
            if (options.targetPortPosition && options.targetPortDirection && options.portDimensions) {
                this.visualizeDockingPort(
                    options.targetPortPosition,
                    options.targetPortDirection,
                    options.portDimensions,
                    0xff00ff // Magenta
                );
            }
        }

        // Visualize other spacecraft (only non-participating spacecraft)
        if (options?.otherSpacecraft) {
            options.otherSpacecraft.forEach(spacecraft => {
                // Create actual bounding box
                const actualBox = this.createBoundingBox(
                    spacecraft.position,
                    spacecraft.size,
                    0xff8800, // Orange
                    0.2,
                    spacecraft.orientation,
                    true // Uses half-extents
                );
                this.scene.add(actualBox);
                this.debugObjects.push(actualBox);

                // Create safety box
                const safetyBox = this.createBoundingBox(
                    spacecraft.position,
                    spacecraft.safetySize,
                    0xff8800, // Orange
                    0.1,
                    spacecraft.orientation,
                    true // Uses half-extents
                );
                this.scene.add(safetyBox);
                this.debugObjects.push(safetyBox);

                // Create center sphere
                const centerSphere = this.createDebugSphere(
                    spacecraft.position,
                    0xff8800,
                    0.2,
                    1.0
                );
                this.scene.add(centerSphere);
                this.debugObjects.push(centerSphere);
            });
        }
    }

    private createBoundingBox(
        position: THREE.Vector3,
        size: CANNON.Vec3,
        color: number,
        opacity: number = 1.0,
        orientation?: THREE.Quaternion,
        isHalfExtents: boolean = true
    ): THREE.Mesh {
        const geometry = new THREE.BoxGeometry(
            isHalfExtents ? size.x * 2 : size.x, // Convert half-extents to full size if needed
            isHalfExtents ? size.y * 2 : size.y,
            isHalfExtents ? size.z * 2 : size.z
        );
        const material = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: true,
            transparent: true,
            opacity: opacity,
            depthTest: false, // Make visible through other objects
            depthWrite: false // Don't write to depth buffer
        });
        const box = new THREE.Mesh(geometry, material);
        box.position.copy(position);
        if (orientation) {
            box.quaternion.copy(orientation);
        }
        return box;
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
            opacity: opacity,
            depthTest: false, // Make visible through other objects
            depthWrite: false // Don't write to depth buffer
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(position);
        return sphere;
    }

    private createDebugLine(points: THREE.Vector3[], color: number): THREE.Line {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: color,
            depthTest: false, // Make visible through other objects
            depthWrite: false // Don't write to depth buffer
        });
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





    private visualizeDockingPort(
        position: THREE.Vector3,
        direction: THREE.Vector3,
        dimensions: CANNON.Vec3,
        color: number
    ): void {
        // Create port bounding box
        const portBox = this.createBoundingBox(
            position,
            new CANNON.Vec3(
                dimensions.x, // Use radius for width/height
                dimensions.x, // Use radius for width/height
                dimensions.z / 2 // Half the length since we're using full dimensions
            ),
            color,
            0.3,
            undefined,
            false // Uses full dimensions
        );
        this.scene.add(portBox);
        this.debugObjects.push(portBox);

        // Calculate the front face center of the docking port
        const frontFacePosition = position.clone();

        // Port sphere - place it at the front face center
        const portSphere = this.createDebugSphere(frontFacePosition, color, 0.2, 1.0);
        this.scene.add(portSphere);
        this.debugObjects.push(portSphere);

        // Visualize port direction - start from the front face center
        const directionLength = 1.0;
        const directionEnd = frontFacePosition.clone().add(
            direction.clone().multiplyScalar(directionLength)
        );
        
        const directionLine = this.createDebugLine(
            [frontFacePosition, directionEnd],
            color
        );
        this.scene.add(directionLine);
        this.debugObjects.push(directionLine);
    }
} 
import * as THREE from 'three';
import type { PhysicsEngine, RigidBody } from '../../physics';

export class DockingPortManager {
    constructor(
        private boxDepth: number,
        public readonly dockingPortRadius: number,
        public readonly dockingPortLength: number,
        public readonly dockingPortDepth: number
    ) {}

    private colliderHandles: unknown[] = [];
    public cameras: Partial<Record<'front' | 'back', THREE.PerspectiveCamera>> = {};

    public addDockingPorts(
        box: THREE.Mesh,
        _boxBody: any,
        material: THREE.Material,
        rigid?: RigidBody | null,
        physics?: PhysicsEngine | null
    ): void {
        const portPositions = [
            { name: "dockingPortFront", id: 'front' as const, z: this.boxDepth / 2 + this.dockingPortDepth, angle: 0 },
            { name: "dockingPortBack", id: 'back' as const, z: -this.boxDepth / 2 - this.dockingPortDepth, angle: Math.PI }
        ];

        portPositions.forEach(({ name, id, z, angle }) => {
            // Create the main cylinder
            const cylinderGeometry = new THREE.CylinderGeometry(
                this.dockingPortRadius,
                this.dockingPortRadius,
                this.dockingPortLength,
                32
            );
            const cylinder = new THREE.Mesh(cylinderGeometry, material);
            cylinder.name = name;
            cylinder.rotation.x = Math.PI / 2;
            cylinder.position.z = z;
            cylinder.castShadow = true;
            cylinder.receiveShadow = true;
            box.add(cylinder);

            // Create the outer ring (torus)
            const torusGeometry = new THREE.TorusGeometry(
                this.dockingPortRadius,
                0.05,
                16,
                100
            );
            const torus = new THREE.Mesh(torusGeometry, material);
            torus.name = `${name}Ring`;
            torus.rotation.y = angle;
            torus.position.z = z;
            torus.castShadow = true;
            torus.receiveShadow = true;
            box.add(torus);

            // Attach physics collider if a physics engine/body is provided (Rapier supported)
            if (physics?.attachCylinderCollider && rigid) {
                // Rapier's cylinder is along Y; rotate it so it extends along Z like the mesh
                const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
                const handle = physics.attachCylinderCollider(rigid, this.dockingPortRadius, this.dockingPortLength, {
                    translation: { x: 0, y: 0, z },
                    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
                    isSensor: false,
                    friction: 0.6,
                    restitution: 0.1,
                });
                if (handle) this.colliderHandles.push(handle);
            }

            // Create and attach a perspective camera at this docking port
            // Use a large far plane to leverage logarithmic depth precision
            const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e9);
            camera.name = `${name}Camera`;
            // Place the camera slightly outside the port so geometry doesn't clip
            const offset = (this.dockingPortLength / 2) + 0.05;
            camera.position.set(0, 0, z + (id === 'front' ? offset : -offset));
            // Cameras in Three.js look down -Z by default.
            // Front port needs to look along +Z; back port along -Z.
            // Since camera is parented to the box, rotate Y by PI only for the front port.
            if (id === 'front') {
                camera.rotation.y = Math.PI;
            }
            // Add to the main box so it inherits spacecraft transforms
            box.add(camera);
            camera.updateProjectionMatrix();
            this.cameras[id] = camera;
        });
    }

    public removeDockingPorts(box: THREE.Mesh, _boxBody: any, physics?: PhysicsEngine | null): void {
        // Remove visual elements
        const visualToRemove = box.children.filter(
            child =>
                child.name === 'dockingPortFront' ||
                child.name === 'dockingPortBack' ||
                child.name === 'dockingPortFrontRing' ||
                child.name === 'dockingPortBackRing' ||
                child.name === 'dockingPortFrontCamera' ||
                child.name === 'dockingPortBackCamera'
        );
        visualToRemove.forEach(obj => {
            box.remove(obj);
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                }
            }
            if (obj instanceof THREE.Camera) {
                // Nothing to dispose for Camera, but ensure it's removed
            }
        });

        // Remove physics colliders if we created any
        if (physics?.removeCollider && this.colliderHandles.length) {
            this.colliderHandles.forEach(h => physics.removeCollider?.(h));
        }
        this.colliderHandles = [];
        this.cameras = {};
    }

    public updateDockingPorts(
        box: THREE.Mesh,
        boxBody: any,
        material: THREE.Material,
        rigid?: RigidBody | null,
        physics?: PhysicsEngine | null
    ): void {
        this.removeDockingPorts(box, boxBody, physics);
        this.addDockingPorts(box, boxBody, material, rigid, physics);
    }
}

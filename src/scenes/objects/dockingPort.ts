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
    private spotlights: Partial<Record<'front' | 'back', THREE.SpotLight>> = {};
    private lightTargets: Partial<Record<'front' | 'back', THREE.Object3D>> = {};
    private lampMeshes: Partial<Record<'front' | 'back', THREE.Mesh>> = {};
    private lightsState: Partial<Record<'front' | 'back', boolean>> = { front: false, back: false };

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
                    // Use sensor to avoid heavy contact resolution between port geometry and other colliders.
                    // Physical coupling is handled by the docking joint.
                    isSensor: true,
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

            // Add a small off-center cylinder acting as a lamp housing
            const lampRadius = Math.max(this.dockingPortRadius * 0.1, 0.02);
            const lampLength = Math.max(this.dockingPortLength * 0.2, 0.03);
            const lampGeom = new THREE.CylinderGeometry(lampRadius, lampRadius, lampLength, 16);
            const lampMat = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: this.lightsState[id] ? 0xffffbb : 0x000000,
                emissiveIntensity: this.lightsState[id] ? 2.0 : 0.0,
                metalness: 0.3,
                roughness: 0.5,
            });
            const lamp = new THREE.Mesh(lampGeom, lampMat);
            lamp.name = `${name}Lamp`;
            lamp.castShadow = true;
            lamp.receiveShadow = true;
            // Align cylinder along Z (default is Y), and position off-center on X
            lamp.rotation.x = Math.PI / 2;
            // Place lamp slightly off-center near the rim (not too far out)
            const radialOffset = Math.max(this.dockingPortRadius * 1.0, lampRadius);
            const zClearance = (this.dockingPortLength / 2) + (lampLength / 2) + 0;
            lamp.position.set(radialOffset, 0, z + (id === 'front' ? zClearance : -zClearance));
            box.add(lamp);
            this.lampMeshes[id] = lamp;

            // Create a SpotLight near the lamp, pointing outward along port direction
            const spot = new THREE.SpotLight(0xffffff, 2.0, 20, Math.PI / 8, 0.3, 1.0);
            spot.name = `${name}SpotLight`;
            spot.castShadow = true;
            // Soften shadows a bit
            spot.shadow.mapSize.width = 1024;
            spot.shadow.mapSize.height = 1024;
            spot.shadow.bias = -0.0001;
            // Place light slightly ahead of the lamp so it doesn't self-shadow harshly
            const forward = zClearance + 0.05;
            spot.position.set(radialOffset, 0, z + (id === 'front' ? forward : -forward));
            spot.visible = !!this.lightsState[id];

            // Create and place target so the light points straight out of the port
            const target = new THREE.Object3D();
            target.name = `${name}SpotTarget`;
            target.position.set(radialOffset, 0, z + (id === 'front' ? forward + 2 : -forward - 2));
            box.add(target);
            spot.target = target;

            box.add(spot);
            this.spotlights[id] = spot;
            this.lightTargets[id] = target;
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
                child.name === 'dockingPortBackCamera' ||
                child.name === 'dockingPortFrontLamp' ||
                child.name === 'dockingPortBackLamp' ||
                child.name === 'dockingPortFrontSpotLight' ||
                child.name === 'dockingPortBackSpotLight' ||
                child.name === 'dockingPortFrontSpotTarget' ||
                child.name === 'dockingPortBackSpotTarget'
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
        this.spotlights = {};
        this.lightTargets = {};
        this.lampMeshes = {};
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

    public setDockingLightsEnabled(enabled: boolean): void {
        this.setDockingLightEnabled('front', enabled);
        this.setDockingLightEnabled('back', enabled);
    }

    public setDockingLightEnabled(id: 'front' | 'back', enabled: boolean): void {
        this.lightsState[id] = enabled;
        const light = this.spotlights[id];
        if (light) light.visible = enabled;
        const lamp = this.lampMeshes[id];
        if (lamp && lamp.material && (lamp.material as any).emissive) {
            const mat = lamp.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(enabled ? 0xffffbb : 0x000000);
            mat.emissiveIntensity = enabled ? 2.0 : 0.0;
            mat.needsUpdate = true;
        }
    }
}

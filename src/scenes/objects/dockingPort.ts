import * as THREE from 'three';
import type { PhysicsEngine, RigidBody } from '../../physics';

export interface PortConfig {
    id: string;
    /** Local position of the port face center */
    localPosition: { x: number; y: number; z: number };
    /** Local direction the port faces (unit vector) */
    localDirection: { x: number; y: number; z: number };
}

/** Common prefix used to tag all port-related children for cleanup. */
const PORT_TAG = '__dockingPort__';

export class DockingPortManager {
    constructor(
        private boxDepth: number,
        public readonly dockingPortRadius: number,
        public readonly dockingPortLength: number,
        public readonly dockingPortDepth: number,
        private readonly dockingPortMaterialDensity: number = 2700
    ) {}

    private colliderHandles: unknown[] = [];
    public cameras: Record<string, THREE.PerspectiveCamera> = {};
    private spotlights: Record<string, THREE.SpotLight> = {};
    private lightTargets: Record<string, THREE.Object3D> = {};
    private lampMeshes: Record<string, THREE.Mesh> = {};
    private lightsState: Record<string, boolean> = {};
    private portConfigs: PortConfig[] = [];
    private spotlightParams: { intensity: number; angle: number; distance: number; decay: number; penumbra: number } = {
        // Stronger default flashlight power
        intensity: 10.0,
        // Default narrow beam (radians; Three.js uses half-angle)
        angle: Math.PI / 8,
        distance: 60,
        decay: 1.0,
        penumbra: 0.3,
    };

    public setPortConfigs(configs: PortConfig[]): void {
        this.portConfigs = configs;
    }

    /** Build default front/back port configs from box depth. */
    private getEffectiveConfigs(): Array<{ name: string; id: string; localPos: THREE.Vector3; dirVec: THREE.Vector3 }> {
        const configs = this.portConfigs.length > 0 ? this.portConfigs : [
            { id: 'front', localPosition: { x: 0, y: 0, z: this.boxDepth / 2 + this.dockingPortDepth }, localDirection: { x: 0, y: 0, z: 1 } },
            { id: 'back', localPosition: { x: 0, y: 0, z: -this.boxDepth / 2 - this.dockingPortDepth }, localDirection: { x: 0, y: 0, z: -1 } },
        ];
        return configs.map(c => ({
            name: `dockingPort_${c.id}`,
            id: c.id,
            localPos: new THREE.Vector3(c.localPosition.x, c.localPosition.y, c.localPosition.z),
            dirVec: new THREE.Vector3(c.localDirection.x, c.localDirection.y, c.localDirection.z).normalize(),
        }));
    }

    public addDockingPorts(
        box: THREE.Mesh,
        _boxBody: any,
        material: THREE.Material,
        rigid?: RigidBody | null,
        physics?: PhysicsEngine | null
    ): void {
        const portEntries = this.getEffectiveConfigs();

        portEntries.forEach(({ name, id, localPos, dirVec }) => {
            // Compute rotation quaternion: rotate cylinder Y-axis to match port direction
            const cylAxisDefault = new THREE.Vector3(0, 1, 0);
            const rotQuat = new THREE.Quaternion().setFromUnitVectors(cylAxisDefault, dirVec);

            // Create the main cylinder
            const cylinderGeometry = new THREE.CylinderGeometry(
                this.dockingPortRadius,
                this.dockingPortRadius,
                this.dockingPortLength,
                32
            );
            const cylinder = new THREE.Mesh(cylinderGeometry, material);
            cylinder.name = name;
            cylinder.userData[PORT_TAG] = true;
            cylinder.quaternion.copy(rotQuat);
            cylinder.position.copy(localPos);
            cylinder.castShadow = true;
            cylinder.receiveShadow = true;
            box.add(cylinder);

            // Create the outer ring (torus)
            // Torus lies in XY plane by default; we need it perpendicular to dirVec
            const torusGeometry = new THREE.TorusGeometry(
                this.dockingPortRadius,
                0.05,
                16,
                100
            );
            const torus = new THREE.Mesh(torusGeometry, material);
            torus.name = `${name}Ring`;
            torus.userData[PORT_TAG] = true;
            // Torus default normal is Z; rotate so normal aligns with dirVec
            const torusQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirVec);
            torus.quaternion.copy(torusQuat);
            torus.position.copy(localPos);
            torus.castShadow = true;
            torus.receiveShadow = true;
            box.add(torus);

            // Attach physics collider if a physics engine/body is provided (Rapier supported)
            if (physics?.attachCylinderCollider && rigid) {
                // Rapier's cylinder is along Y; rotate it to align with port direction
                const handle = physics.attachCylinderCollider(rigid, this.dockingPortRadius, this.dockingPortLength, {
                    translation: { x: localPos.x, y: localPos.y, z: localPos.z },
                    rotation: { x: rotQuat.x, y: rotQuat.y, z: rotQuat.z, w: rotQuat.w },
                    isSensor: false,
                    density: this.dockingPortMaterialDensity,
                    friction: 0.6,
                    restitution: 0.1,
                });
                if (handle) this.colliderHandles.push(handle);
            }

            // Create and attach a perspective camera at this docking port
            const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e9);
            camera.name = `${name}Camera`;
            camera.userData[PORT_TAG] = true;
            // Place the camera slightly outside the port face
            const camOffset = (this.dockingPortLength / 2) + 0.05;
            const camPos = localPos.clone().add(dirVec.clone().multiplyScalar(camOffset));
            camera.position.copy(camPos);
            // Camera looks down -Z by default; rotate so it looks along dirVec
            // We want the camera's -Z to point along dirVec, so align +Z with -dirVec
            const camLookQuat = new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 0, -1),
                dirVec
            );
            camera.quaternion.copy(camLookQuat);
            box.add(camera);
            camera.updateProjectionMatrix();
            this.cameras[id] = camera;

            // Lamp housing
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
            lamp.userData[PORT_TAG] = true;
            lamp.castShadow = true;
            lamp.receiveShadow = true;
            // Align lamp cylinder along port direction
            lamp.quaternion.copy(rotQuat);
            // Place lamp at port face + clearance, offset to the side
            const radialOffset = Math.max(this.dockingPortRadius * 1.0, lampRadius);
            const zClearance = (this.dockingPortLength / 2) + (lampLength / 2);
            // Compute a perpendicular vector for radial offset
            const perpVec = this.computePerpendicular(dirVec);
            const lampPos = localPos.clone()
                .add(dirVec.clone().multiplyScalar(zClearance))
                .add(perpVec.clone().multiplyScalar(radialOffset));
            lamp.position.copy(lampPos);
            box.add(lamp);
            this.lampMeshes[id] = lamp;

            // SpotLight
            const spot = new THREE.SpotLight(
                0xffffff,
                this.spotlightParams.intensity,
                this.spotlightParams.distance,
                this.spotlightParams.angle,
                this.spotlightParams.penumbra,
                this.spotlightParams.decay
            );
            spot.name = `${name}SpotLight`;
            spot.userData[PORT_TAG] = true;
            spot.castShadow = true;
            spot.shadow.mapSize.width = 1024;
            spot.shadow.mapSize.height = 1024;
            spot.shadow.bias = -0.0001;
            const spotForward = zClearance + 0.05;
            const spotPos = localPos.clone()
                .add(dirVec.clone().multiplyScalar(spotForward))
                .add(perpVec.clone().multiplyScalar(radialOffset));
            spot.position.copy(spotPos);
            spot.visible = !!this.lightsState[id];

            // SpotLight target
            const target = new THREE.Object3D();
            target.name = `${name}SpotTarget`;
            target.userData[PORT_TAG] = true;
            const targetPos = localPos.clone()
                .add(dirVec.clone().multiplyScalar(spotForward + 2))
                .add(perpVec.clone().multiplyScalar(radialOffset));
            target.position.copy(targetPos);
            box.add(target);
            spot.target = target;

            box.add(spot);
            this.spotlights[id] = spot;
            this.lightTargets[id] = target;
        });
    }

    /** Compute an arbitrary perpendicular vector to the given direction. */
    private computePerpendicular(dir: THREE.Vector3): THREE.Vector3 {
        const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        return new THREE.Vector3().crossVectors(dir, up).normalize();
    }

    public removeDockingPorts(box: THREE.Mesh, _boxBody: any, physics?: PhysicsEngine | null): void {
        // Remove all children tagged with our port marker
        const toRemove = box.children.filter(child => child.userData[PORT_TAG]);
        toRemove.forEach(obj => {
            box.remove(obj);
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                }
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
        for (const id of Object.keys(this.spotlights)) {
            this.setDockingLightEnabled(id, enabled);
        }
        // Also handle ports that may not have spotlights yet
        for (const id of Object.keys(this.lampMeshes)) {
            if (!(id in this.spotlights)) {
                this.setDockingLightEnabled(id, enabled);
            }
        }
    }

    public setDockingLightEnabled(id: string, enabled: boolean): void {
        this.lightsState[id] = enabled;
        const light = this.spotlights[id];
        if (light) light.visible = enabled;
        const mat = this.lampMeshes[id]?.material as THREE.MeshStandardMaterial | undefined;
        if (mat?.emissive) {
            mat.emissive.setHex(enabled ? 0xffffbb : 0x000000);
            mat.emissiveIntensity = enabled ? 2.0 : 0.0;
            mat.needsUpdate = true;
        }
    }

    /** Get current spotlight parameters (shared across ports). */
    public getDockingLightParams(): { intensity: number; angle: number; distance: number; decay: number; penumbra: number } {
        // Prefer reading from an existing spotlight to reflect runtime changes
        const spotIds = Object.keys(this.spotlights);
        const ref = spotIds.length > 0 ? this.spotlights[spotIds[0]] : undefined;
        if (ref) {
            return {
                intensity: ref.intensity,
                angle: ref.angle,
                distance: ref.distance,
                decay: ref.decay,
                penumbra: ref.penumbra,
            };
        }
        return { ...this.spotlightParams };
    }

    /**
     * Set spotlight parameters for all docking port lights on this craft.
     * Any omitted field is left unchanged.
     */
    public setDockingLightParams(params: Partial<{ intensity: number; angle: number; distance: number; decay: number; penumbra: number }>): void {
        // Clamp and store defaults for future light creations
        const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
        if (params.intensity !== undefined) this.spotlightParams.intensity = clamp(params.intensity, 0, 100);
        if (params.angle !== undefined) this.spotlightParams.angle = clamp(params.angle, Math.PI / 180 * 1, Math.PI / 2);
        if (params.distance !== undefined) this.spotlightParams.distance = clamp(params.distance, 0, 1e6);
        if (params.decay !== undefined) this.spotlightParams.decay = clamp(params.decay, 0, 4);
        if (params.penumbra !== undefined) this.spotlightParams.penumbra = clamp(params.penumbra, 0, 1);

        // Apply to existing lights
        for (const id of Object.keys(this.spotlights)) {
            const light = this.spotlights[id];
            if (!light) continue;
            if (params.intensity !== undefined) light.intensity = this.spotlightParams.intensity;
            if (params.angle !== undefined) light.angle = this.spotlightParams.angle;
            if (params.distance !== undefined) light.distance = this.spotlightParams.distance;
            if (params.decay !== undefined) light.decay = this.spotlightParams.decay;
            if (params.penumbra !== undefined) light.penumbra = this.spotlightParams.penumbra;
        }
    }
}

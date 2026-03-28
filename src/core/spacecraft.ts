import * as THREE from 'three';
import { RCSVisuals } from '../scenes/objects/rcsVisuals';
import { SpacecraftModel } from '../scenes/objects/spacecraftModel';
import { SceneHelpers } from '../scenes/sceneHelpers';
import { SpacecraftController } from '../controllers/spacecraftController';
import { DockingController } from '../controllers/docking/DockingController';
import { BasicWorld } from './BasicWorld';
import type { PhysicsEngine } from '../physics';
import { emitTraceSamplesCleared } from '../domain/simulationEvents';
import type { SimulationRuntimeStatePort } from '../domain/runtimeStatePort';
import type { SpacecraftRegistry } from '../domain/spacecraftRegistry';

interface DockingPortInfo {
    position: THREE.Vector3;
    direction: THREE.Vector3;
    isOccupied: boolean;
    dockedTo: {
        spacecraft: Spacecraft;
        port: string;
    } | null;
}

interface DockingPorts {
    [key: string]: DockingPortInfo;
}

export interface SpacecraftOptions {
    /** Which docking ports to create. Default: ['front', 'back'] */
    ports?: Array<{ id: string; position: THREE.Vector3; direction: THREE.Vector3 }>;
    /** Whether to create RCS thrusters. Default: true */
    includeThrusters?: boolean;
    /** Display name */
    name?: string;
}

export class Spacecraft {
    public basicWorld: BasicWorld;
    /** Narrow interface for cross-spacecraft queries (replaces basicWorld coupling). */
    public registry: SpacecraftRegistry | null = null;
    public initialPosition: THREE.Vector3 | { x: number; y: number; z: number };
    public objects: SpacecraftModel;
    public rcsVisuals: RCSVisuals;
    public helpers: SceneHelpers;
    public spacecraftController: SpacecraftController;
    public dockingController: DockingController;
    public showVelocityArrow: boolean;
    public showAngularVelocityArrow: boolean;
    public showTraceLines: boolean;
    public dockingPorts: DockingPorts;
    public name: string;
    public uuid: string;
    public dockingLights: Record<string, boolean> = { front: false, back: false };
    private debugObjects: THREE.Object3D[] = [];
    private physics?: import('../physics').PhysicsEngine;
    private dockingHandle?: unknown;
    /** Collider handle for a guest spacecraft's box shape attached to this (host) body during compound docking. */
    private compoundColliderHandles: Map<string, unknown> = new Map(); // guest UUID → collider handle

    constructor(
        world: any,
        scene: THREE.Scene & { userData: { camera: THREE.Camera; light: THREE.Light } },
        initialPosition: THREE.Vector3 | { x: number; y: number; z: number } = new THREE.Vector3(0, 0, 2),
        width: number = 1,
        height: number = 1,
        depth: number = 2,
        basicWorld?: BasicWorld,
        physics?: PhysicsEngine,
        runtimeState?: SimulationRuntimeStatePort,
        options?: SpacecraftOptions
    ) {
        this.uuid = THREE.MathUtils.generateUUID();
        this.basicWorld = basicWorld as BasicWorld;
        this.physics = physics;
        this.initialPosition = initialPosition;

        this.objects = new SpacecraftModel(scene, world, width, height, depth, undefined, physics, {
            includeThrusters: options?.includeThrusters,
            includeFuelTank: options?.includeThrusters, // nodes have neither thrusters nor fuel tank
        });

        // If custom port configs are provided, rebuild docking ports on the model
        if (options?.ports) {
            const dockingPortDepth = this.objects.dockingPortDepth;
            this.objects.setPortConfigs(options.ports.map(p => ({
                id: p.id,
                localPosition: {
                    x: p.position.x + p.direction.x * dockingPortDepth,
                    y: p.position.y + p.direction.y * dockingPortDepth,
                    z: p.position.z + p.direction.z * dockingPortDepth,
                },
                localDirection: { x: p.direction.x, y: p.direction.y, z: p.direction.z },
            })));
        }

        if (options?.includeThrusters === false) {
            // Create a no-op stub that satisfies the RCSVisuals interface
            this.rcsVisuals = {
                update(_dt: number) {},
                cleanup() {},
                getConeMeshes() { return []; },
                getThrusterConfigs() { return []; },
                getThrusterData() { return []; },
                applyForce() {},
                updateThrusterCones() {},
                showCones() {},
                hideCones() {},
                setThrusterLightsEnabled() {},
                getThrusterLightsEnabled() { return false; },
                setThrusterParticlesEnabled() {},
                getThrusterParticlesEnabled() { return false; },
            } as unknown as RCSVisuals;
        } else if (this.objects.rigid) {
            this.rcsVisuals = new RCSVisuals(this.objects, this.objects.rigid);
        } else {
            this.rcsVisuals = new RCSVisuals(this.objects, {
                setPosition: (x: number, y: number, z: number) => { this.objects.boxBody.position.set(x, y, z); },
                setQuaternion: (x: number, y: number, z: number, w: number) => { this.objects.boxBody.quaternion.set(x, y, z, w); },
                getPosition: () => this.objects.boxBody.position as unknown as { x: number; y: number; z: number },
                getQuaternion: () => this.objects.boxBody.quaternion as unknown as { x: number; y: number; z: number; w: number },
                setMass: (m: number) => { this.objects.boxBody.mass = m; },
                getMass: () => this.objects.boxBody.mass,
                setDamping: () => {},
                applyForce: () => {},
                getLinearVelocity: () => this.objects.boxBody.velocity as unknown as { x: number; y: number; z: number },
                setLinearVelocity: (v: { x: number; y: number; z: number }) => { this.objects.boxBody.velocity.set(v.x, v.y, v.z); },
                getAngularVelocity: () => this.objects.boxBody.angularVelocity as unknown as { x: number; y: number; z: number },
                setAngularVelocity: (v: { x: number; y: number; z: number }) => { this.objects.boxBody.angularVelocity.set(v.x, v.y, v.z); },
                getNative: <T>() => this.objects.boxBody as unknown as T,
            } as any);
        }
        this.objects.rcsVisuals = this.rcsVisuals;

        // Set initial position through model (supports engine abstraction)
        if (this.objects.rigid) {
            const p = initialPosition as any;
            this.objects.rigid.setPosition(p.x, p.y, p.z);
        } else {
            const p = initialPosition as any;
            this.objects.boxBody.position.set(p.x, p.y, p.z);
        }

        // Get the camera from the scene
        const camera = scene.userData.camera;
        this.helpers = new SceneHelpers(scene, scene.userData.light, camera, runtimeState);
        this.helpers.disableHelpers();

        this.spacecraftController = new SpacecraftController(this, this.objects.box, this.helpers);
        this.dockingController = new DockingController(this, scene);

        // Initialize helper arrow visibility
        this.showVelocityArrow = false;
        this.showAngularVelocityArrow = false;
        this.showTraceLines = false;
        (this as any).showPath = false;
        // Initialize docking ports
        const portConfigs = options?.ports ?? [
            { id: 'front', position: new THREE.Vector3(0, 0, depth/2), direction: new THREE.Vector3(0, 0, 1) },
            { id: 'back', position: new THREE.Vector3(0, 0, -depth/2), direction: new THREE.Vector3(0, 0, -1) },
        ];
        this.dockingPorts = {};
        this.dockingLights = {};
        for (const pc of portConfigs) {
            this.dockingPorts[pc.id] = {
                position: pc.position.clone(),
                direction: pc.direction.clone(),
                isOccupied: false,
                dockedTo: null,
            };
            this.dockingLights[pc.id] = false;
        }

        this.name = options?.name ?? 'Spacecraft';

        // Add a listener for RCS visuals updates
        this.objects.onRCSVisualsUpdate = (newRcsVisuals: RCSVisuals) => {
            this.rcsVisuals = newRcsVisuals;
            // Propagate new thruster transforms into controller/autopilot
            try { this.spacecraftController?.refreshThrusterGroups?.(); } catch {}
        };
    }

    public update(): void {
        this.objects.update();
        this.dockingController.update();
        // Update trace line regardless of autopilot state
        if (this.helpers) {
            this.helpers.updateTrace(this.uuid, this.getWorldPosition(), this.getWorldVelocity());
        }
    }

    public cleanup(): void {
        this.objects.cleanup?.();
        this.rcsVisuals.cleanup?.();
        this.helpers.cleanup?.();
        this.spacecraftController.cleanup?.();
    }

    // Conversion helpers removed; all math uses THREE types

    /**
     * Get the world position of the spacecraft's center
     */
    public getWorldPosition(): THREE.Vector3 {
        // Read from the rendered transform to avoid querying Rapier during stepping
        return this.objects.box.position.clone();
    }

    /**
     * Zero-allocation reference accessors for hot paths (autopilots, rendering).
     * Callers MUST treat the returned objects as read-only snapshots for the frame.
     */
    public getWorldPositionRef(): THREE.Vector3 {
        return this.objects.box.position;
    }

    /**
     * Get all Three.js objects that can be clicked to select this spacecraft
     */
    public getThreeObjects(): THREE.Object3D[] {
        return [this.objects.box];
    }

    /**
     * Get the world position of a docking port center (at the base of the port cylinder).
     * Uses forward axis with proper offset so it stays consistent with visual geometry.
     */
    public getDockingPortWorldPosition(portId: string): THREE.Vector3 | null {
        const dir = this.getDockingPortWorldDirection(portId);
        if (!dir) return null;
        const offset = this.getPortOffset(portId);
        return this.getWorldPosition().clone().add(dir.multiplyScalar(offset));
    }

    /**
     * Get the world direction of a docking port axis.
     * Reads the local direction from the port definition and transforms it to world space.
     */
    public getDockingPortWorldDirection(portId: string): THREE.Vector3 | null {
        const port = this.dockingPorts[portId as string];
        if (!port) return null;
        const q = this.getWorldOrientation();
        return port.direction.clone().applyQuaternion(q).normalize();
    }

    /**
     * Check if a docking port is available
     */
    public isDockingPortAvailable(portId: string): boolean {
        const port = this.dockingPorts[portId];
        return port && !port.isOccupied;
    }

    /**
     * Dock with another spacecraft
     */
    public dock(
        ourPortId: string,
        otherSpacecraft: Spacecraft,
        theirPortId: string
    ): boolean {
        const ourPort = this.dockingPorts[ourPortId];
        const theirPort = otherSpacecraft.dockingPorts[theirPortId];

        if (!ourPort || !theirPort) return false;
        if (ourPort.isOccupied || theirPort.isOccupied) return false;

        // Mark ports as occupied
        ourPort.isOccupied = true;
        theirPort.isOccupied = true;
        ourPort.dockedTo = { spacecraft: otherSpacecraft, port: theirPortId };
        theirPort.dockedTo = { spacecraft: this, port: ourPortId };

        // Merge into a compound rigid body (preferred) or fall back to joint constraint.
        // Compound body: guest's RigidBody wrapper redirects to the root host, native body disabled,
        // guest's collider shape attached to root. Result: one physics object, no joint solver.
        if (this.physics && this.objects.rigid && otherSpacecraft.objects.rigid) {
            // Resolve the compound root — check BOTH sides.
            // If either spacecraft is already a compound root (non-redirected with members),
            // or is part of a compound, we must find the existing root and keep it.
            // The guest (the one that gets redirected) is always the one that's NOT the root.
            const findCompoundRoot = (craft: Spacecraft): Spacecraft => {
                if (!craft.objects.rigid?.isRedirected?.()) return craft;
                const visited = new Set<string>();
                const walk = (c: Spacecraft): Spacecraft | null => {
                    if (visited.has(c.uuid)) return null;
                    visited.add(c.uuid);
                    if (!c.objects.rigid?.isRedirected?.()) return c;
                    for (const portInfo of Object.values(c.dockingPorts)) {
                        if (portInfo.dockedTo) {
                            const result = walk(portInfo.dockedTo.spacecraft as Spacecraft);
                            if (result) return result;
                        }
                    }
                    return null;
                };
                return walk(craft) ?? craft;
            };

            const rootA = findCompoundRoot(this);
            const rootB = findCompoundRoot(otherSpacecraft);

            // Decide which side is the compound root and which is the guest.
            // If otherSpacecraft's root already has compound members, IT stays the root
            // and `this` side becomes the guest. Otherwise, `this` side's root stays.
            let rootCraft: Spacecraft;
            let guestCraft: Spacecraft;
            if (rootB !== otherSpacecraft && rootB === rootA) {
                // Both already in the same compound — shouldn't happen, but handle gracefully
                rootCraft = rootA;
                guestCraft = otherSpacecraft;
            } else if (rootB.compoundColliderHandles.size > 0 && rootA.compoundColliderHandles.size === 0) {
                // Other side has an existing compound — keep it as root
                rootCraft = rootB;
                guestCraft = this;
            } else if (rootA.compoundColliderHandles.size > 0 && rootB.compoundColliderHandles.size === 0) {
                // Our side has an existing compound — keep it as root
                rootCraft = rootA;
                guestCraft = otherSpacecraft;
            } else {
                // Neither or both have compounds — pick the one with more docking ports as root
                // (hubs/stations should be roots, individual craft should be guests)
                const portsA = Object.keys(this.dockingPorts).length;
                const portsB = Object.keys(otherSpacecraft.dockingPorts).length;
                if (portsB > portsA) {
                    // Other side has more ports — it's the station/hub, make it root
                    rootCraft = rootB;
                    guestCraft = this;
                } else {
                    // Same or we have more — `this` is root
                    rootCraft = rootA;
                    guestCraft = otherSpacecraft;
                }
            }
            const rootRigid = rootCraft.objects.rigid!;

            // Zero velocities on the compound root before merging
            rootRigid.setLinearVelocity({ x: 0, y: 0, z: 0 });
            rootRigid.setAngularVelocity({ x: 0, y: 0, z: 0 });
            // Also zero the guest
            otherSpacecraft.objects.rigid.setLinearVelocity({ x: 0, y: 0, z: 0 });
            otherSpacecraft.objects.rigid.setAngularVelocity({ x: 0, y: 0, z: 0 });

            const supportsRedirect = typeof guestCraft.objects.rigid?.redirectTo === 'function';
            const supportsAttachBox = typeof this.physics.attachBoxCollider === 'function';

            if (supportsRedirect && supportsAttachBox && guestCraft.objects.rigid) {
                // --- Compound body path ---
                // Compute where the guest SHOULD be so port faces touch perfectly.
                // This is derived from port geometry, NOT from current world positions.
                const rootQuat = rootCraft.getWorldOrientation();
                const rootQuatInv = rootQuat.clone().invert();

                // Determine which port belongs to root vs guest
                const rootIsThis = (rootCraft === this || rootCraft.uuid === findCompoundRoot(this).uuid);
                const rootPortId = rootIsThis ? ourPortId : theirPortId;
                const guestPortId = rootIsThis ? theirPortId : ourPortId;
                const rootSc = rootIsThis ? this : otherSpacecraft;
                const guestSc = rootIsThis ? otherSpacecraft : this;

                // Port world positions and directions on the root side
                const rootPortWorldPos = rootSc.getDockingPortWorldPosition(rootPortId as string)
                    ?? rootCraft.getWorldPosition();
                const rootPortWorldDir = rootSc.getDockingPortWorldDirection(rootPortId as string)
                    ?? new THREE.Vector3(0, 0, 1);

                // Guest port: local offset from guest center to guest port face
                const guestPortInfo = guestSc.dockingPorts[guestPortId as string];
                const guestPortLocalDir = guestPortInfo?.direction?.clone().normalize() ?? new THREE.Vector3(0, 0, -1);
                const guestBoxDepth = guestSc.objects.boxDepth ?? 1;
                const guestPortDepth = guestSc.objects.dockingPortDepth ?? 0.3;
                const guestPortLength = guestSc.objects.dockingPortLength ?? 0.1;
                const guestFaceDist = (guestBoxDepth / 2) + guestPortDepth + (guestPortLength * 0.5);

                // Root port face tip position (where the guest port face should meet)
                const rootPortLength = rootSc.objects.dockingPortLength ?? 0.1;
                const dockPoint = rootPortWorldPos.clone().add(
                    rootPortWorldDir.clone().multiplyScalar(rootPortLength * 0.5)
                );

                // Guest orientation: align guest port axis opposite to root port axis
                // qGuest = rotation that maps guestPortLocalDir to -rootPortWorldDir (in world space)
                const guestTargetDir = rootPortWorldDir.clone().negate().normalize();
                const guestPortLocalDirN = guestPortLocalDir.clone().normalize();
                const qAlign = new THREE.Quaternion().setFromUnitVectors(guestPortLocalDirN, guestTargetDir);
                const guestWorldQuat = qAlign; // Guest orientation in world space

                // Guest center position: port face is at dockPoint, center is faceDist BEHIND it.
                // portDir points outward from center → center = face - portDir * faceDist
                const guestPortWorldDir = guestPortLocalDirN.clone().applyQuaternion(guestWorldQuat);
                const guestWorldPos = dockPoint.clone().sub(
                    guestPortWorldDir.clone().multiplyScalar(guestFaceDist)
                );

                // Convert to local offset relative to root body
                const rootPos = rootCraft.getWorldPosition();
                const deltaWorld = new THREE.Vector3().subVectors(guestWorldPos, rootPos);
                const localOffsetPos = deltaWorld.applyQuaternion(rootQuatInv);
                const localOffsetRot = rootQuatInv.clone().multiply(guestWorldQuat);

                const offset = {
                    position: { x: localOffsetPos.x, y: localOffsetPos.y, z: localOffsetPos.z },
                    rotation: { x: localOffsetRot.x, y: localOffsetRot.y, z: localOffsetRot.z, w: localOffsetRot.w },
                };

                // Redirect guest wrapper to ROOT body
                guestCraft.objects.rigid.redirectTo!(rootRigid, offset);

                // Immediately sync the guest's mesh to the computed position/orientation
                // (getWorldPosition/Orientation read from mesh, not physics proxy)
                const derivedPos = guestCraft.objects.rigid.getPosition();
                const derivedQuat = guestCraft.objects.rigid.getQuaternion();
                guestCraft.objects.box.position.set(derivedPos.x, derivedPos.y, derivedPos.z);
                guestCraft.objects.box.quaternion.set(derivedQuat.x, derivedQuat.y, derivedQuat.z, derivedQuat.w);

                // Attach guest's box collider to ROOT body at the offset
                const guestDims = guestCraft.getMainBodyDimensions();
                const guestMass = guestCraft.getMass?.() || 100;
                const guestVol = 8 * guestDims.x * guestDims.y * guestDims.z;
                const guestDensity = guestVol > 0 ? guestMass / guestVol : 1;

                const colliderHandle = this.physics.attachBoxCollider!(rootRigid, {
                    x: guestDims.x, y: guestDims.y, z: guestDims.z
                }, {
                    translation: offset.position,
                    rotation: offset.rotation,
                    density: guestDensity,
                });
                if (colliderHandle != null) {
                    rootCraft.compoundColliderHandles.set(guestCraft.uuid, colliderHandle);
                }

                // Update ROOT mass facade
                rootCraft.objects.boxBody.mass += guestMass;
            } else {
                // --- Fallback: joint-based docking ---
                const ourPortInfo = this.dockingPorts[ourPortId as string];
                const theirPortInfo = otherSpacecraft.dockingPorts[theirPortId as string];
                const ourFaceDist = (this.objects.boxDepth / 2) + (this.objects.dockingPortDepth || 0.3) + (this.objects.dockingPortLength || 0.1) * 0.5;
                const theirFaceDist = (otherSpacecraft.objects.boxDepth / 2) + (otherSpacecraft.objects.dockingPortDepth || 0.3) + (otherSpacecraft.objects.dockingPortLength || 0.1) * 0.5;
                const ourDir = ourPortInfo.direction.clone().normalize();
                const theirDir = theirPortInfo.direction.clone().normalize();
                const localA = { x: ourDir.x * ourFaceDist, y: ourDir.y * ourFaceDist, z: ourDir.z * ourFaceDist };
                const localB = { x: theirDir.x * theirFaceDist, y: theirDir.y * theirFaceDist, z: theirDir.z * theirFaceDist };
                const qA = this.getWorldOrientation();
                const qB = otherSpacecraft.getWorldOrientation();
                const qAinv = new THREE.Quaternion(qA.x, qA.y, qA.z, qA.w).invert();
                const qBinv = new THREE.Quaternion(qB.x, qB.y, qB.z, qB.w).invert();
                this.dockingHandle = this.physics.createFixedConstraint(this.objects.rigid, otherSpacecraft.objects.rigid, {
                    frameA: { position: localA, rotation: { x: qAinv.x, y: qAinv.y, z: qAinv.z, w: qAinv.w } },
                    frameB: { position: localB, rotation: { x: qBinv.x, y: qBinv.y, z: qBinv.z, w: qBinv.w } },
                });
            }
        } else {
            console.warn('Docking: physics not available. Visual docking only.');
        }

        // After creating the hard constraint, ensure both crafts' autopilots are quiescent.
        // This avoids fighting the joint with stale guidance modes or references.
        try {
            const apA = this.spacecraftController?.autopilot;
            const apB = otherSpacecraft.spacecraftController?.autopilot;
            if (apA) {
                apA.resetAllModes();
                apA.setReferenceObject(null);
                apA.setEnabled(false);
            }
            if (apB) {
                apB.resetAllModes();
                apB.setReferenceObject(null);
                apB.setEnabled(false);
            }
            // Clear any latched RCS pulses on both controllers
            this.spacecraftController?.resetThrusterLatch?.();
            otherSpacecraft.spacecraftController?.resetThrusterLatch?.();
            // Recompute thruster grouping for both crafts relative to the
            // combined center of mass so rotational groups act in unison.
            try { this.spacecraftController?.refreshThrusterGroups?.(); } catch {}
            try { otherSpacecraft.spacecraftController?.refreshThrusterGroups?.(); } catch {}
            // Apply cluster-aware thrust/strength scaling immediately
            try { (this.spacecraftController as any)?.applyClusterScalingNow?.(); } catch {}
            try { (otherSpacecraft.spacecraftController as any)?.applyClusterScalingNow?.(); } catch {}
        } catch {}

        return true;
    }

    /**
     * Undock from a specific port
     */
    public undock(portId: string): boolean {
        const port = this.dockingPorts[portId];
        if (!port || !port.isOccupied || !port.dockedTo) return false;

        const otherSpacecraft = port.dockedTo.spacecraft;
        const otherPort = port.dockedTo.port;

        // Clear docking information
        port.isOccupied = false;
        otherSpacecraft.dockingPorts[otherPort].isOccupied = false;
        port.dockedTo = null;
        otherSpacecraft.dockingPorts[otherPort].dockedTo = null;

        // Decompose compound body or remove joint constraint
        if (this.physics) {
            const guestRigid = otherSpacecraft.objects.rigid;
            const isCompound = guestRigid?.isRedirected?.();
            if (isCompound && guestRigid) {
                // --- Compound body decomposition ---
                // Snapshot guest's current world pose from the redirect proxy BEFORE unredirecting
                const guestWorldPos = otherSpacecraft.getWorldPosition();
                const guestWorldQuat = otherSpacecraft.getWorldOrientation();
                const guestWorldVel = otherSpacecraft.getWorldVelocity();
                const guestWorldAngVel = otherSpacecraft.getWorldAngularVelocity();

                // Find the compound root — collider handles are stored on the root spacecraft
                let rootCraft: Spacecraft = this;
                if (this.objects.rigid?.isRedirected?.()) {
                    const visited = new Set<string>();
                    const findRoot = (craft: Spacecraft): Spacecraft | null => {
                        if (visited.has(craft.uuid)) return null;
                        visited.add(craft.uuid);
                        if (!craft.objects.rigid?.isRedirected?.()) return craft;
                        for (const pi of Object.values(craft.dockingPorts)) {
                            if (pi.dockedTo) {
                                const result = findRoot(pi.dockedTo.spacecraft as Spacecraft);
                                if (result) return result;
                            }
                        }
                        return null;
                    };
                    rootCraft = findRoot(this) ?? this;
                }

                // Remove guest's collider from root body (check both root and this for handles)
                const colliderHandle = rootCraft.compoundColliderHandles.get(otherSpacecraft.uuid)
                    ?? this.compoundColliderHandles.get(otherSpacecraft.uuid);
                if (colliderHandle != null) {
                    this.physics.removeCollider?.(colliderHandle);
                    rootCraft.compoundColliderHandles.delete(otherSpacecraft.uuid);
                    this.compoundColliderHandles.delete(otherSpacecraft.uuid);
                }

                // Unredirect guest — re-enables its native Rapier body
                guestRigid.unredirect?.();

                // Set guest's native body to the correct world pose
                guestRigid.setPosition(guestWorldPos.x, guestWorldPos.y, guestWorldPos.z);
                guestRigid.setQuaternion(guestWorldQuat.x, guestWorldQuat.y, guestWorldQuat.z, guestWorldQuat.w);
                guestRigid.setLinearVelocity(guestWorldVel);
                guestRigid.setAngularVelocity(guestWorldAngVel);

                // Restore root mass
                const guestMass = otherSpacecraft.getMass?.() || 0;
                rootCraft.objects.boxBody.mass = Math.max(1, rootCraft.objects.boxBody.mass - guestMass);

                // Small separation impulse along the undocking axis
                const sepDir = otherSpacecraft.getDockingPortWorldDirection(otherPort);
                if (sepDir) {
                    const sepForce = 0.3;
                    guestRigid.setLinearVelocity({
                        x: guestWorldVel.x + sepDir.x * sepForce,
                        y: guestWorldVel.y + sepDir.y * sepForce,
                        z: guestWorldVel.z + sepDir.z * sepForce,
                    });
                }
            } else if (this.dockingHandle) {
                // --- Fallback: remove joint ---
                this.physics.removeConstraint(this.dockingHandle);
                this.dockingHandle = undefined;
            }
        }

        // Recompute thruster grouping back to per-craft mapping and reset scaling
        try { this.spacecraftController?.refreshThrusterGroups?.(); } catch {}
        try { otherSpacecraft.spacecraftController?.refreshThrusterGroups?.(); } catch {}
        try { (this.spacecraftController as any)?.resetClusterScalingToBase?.(); } catch {}
        try { (otherSpacecraft.spacecraftController as any)?.resetClusterScalingToBase?.(); } catch {}

        return true;
    }

    /**
     * Toggle visibility of helper arrows
     */
    public toggleArrow(arrowType: 'velocity' | 'angularVelocity', visible: boolean): void {
        if (!this.helpers) return;

        switch (arrowType) {
            case 'velocity':
                this.showVelocityArrow = visible;
                if (this.helpers.velocityArrow) {
                    this.helpers.velocityArrow.visible = visible;
                }
                break;
            case 'angularVelocity':
                this.showAngularVelocityArrow = visible;
                if (this.helpers.rotationAxisArrow) {
                    this.helpers.rotationAxisArrow.visible = visible;
                }
                break;
        }
    }

    /** Toggle visibility of autopilot path (line + carrot) */
    public togglePath(visible: boolean): void {
        (this as any).showPath = visible;
        if (this.helpers) this.helpers.setPathVisible(visible);
    }
    public isPathVisible(): boolean { return !!(this as any).showPath; }

    /**
     * Toggle visibility of trace lines helper
     */
    public toggleTraceLines(visible: boolean): void {
        this.showTraceLines = visible;
        if (this.helpers) {
            this.helpers.setTraceVisible(visible);
        }
    }

    /** Clear the accumulated trace line points */
    public clearTraceLines(): void {
        if (this.helpers) {
            this.helpers.resetTrace();
        }
        try { emitTraceSamplesCleared(this.uuid); } catch {}
    }

    public getVelocity(): THREE.Vector3 {
        return this.getWorldVelocity();
    }

    public getAngularVelocity(): THREE.Vector3 {
        return this.getWorldAngularVelocity();
    }

    public getOrientation(): THREE.Quaternion {
        return this.getWorldOrientation();
    }

    public getMass(): number {
        return this.objects.boxBody.mass;
    }

    public getThrusterStatus(): boolean[] {
        return this.rcsVisuals.getConeMeshes().map(cone => cone.visible);
    }

    public getThrusterConfigs() {
        try {
            const cfg = (this.rcsVisuals as any)?.getThrusterConfigs?.();
            if (Array.isArray(cfg) && cfg.length) return cfg;
        } catch {}
        // Fallback to older static layout if needed
        const thrustersData = this.rcsVisuals.getThrusterData();
        return thrustersData.map(data => {
            const direction = new THREE.Vector3(0, 1, 0).applyAxisAngle(data.rotation.axis, data.rotation.angle);
            return {
                position: new THREE.Vector3(...data.position),
                direction,
            };
        });
    }

    public getMainBodyDimensions(): THREE.Vector3 {
        const shape: any = this.objects.boxBody.shapes[0];
        const he = shape?.halfExtents || { x: 0.5, y: 0.5, z: 1 };
        return new THREE.Vector3(he.x, he.y, he.z);
    }

    public getFullDimensions(): THREE.Vector3 {
        const mainBody = this.getMainBodyDimensions();
        const portDepth = this.objects.dockingPortDepth || 0.3;
        const portLength = this.objects.dockingPortLength || 0.1;
        const extraDepth = portDepth + portLength;

        return new THREE.Vector3(
            mainBody.x,
            mainBody.y,
            mainBody.z + extraDepth // Add docking port depth to each end
        );
    }

    public getPortDimensions(): THREE.Vector3 {
        return new THREE.Vector3(
            this.objects.dockingPortRadius || 0.3,
            this.objects.dockingPortRadius || 0.3,
            this.objects.dockingPortLength || 0.1
        );
    }

    public getPortOffset(portId: string): number {
        // Param kept for API compatibility; not used (direction carries sign)
        void portId;
        // Return a positive distance from the spacecraft center to the base of the port.
        // The port axis direction (front/back) already carries the sign; combining a signed
        // direction with a signed offset would cancel out and always place both ports on the same side.
        const boxDepth = this.objects.boxDepth;
        const dockingPortDepth = this.objects.dockingPortDepth || 0.3;
        return (boxDepth / 2) + dockingPortDepth;
    }

    public getDockingPortCamera(portId: string): THREE.PerspectiveCamera | undefined {
        return this.objects.getDockingPortCamera(portId as string);
    }

    public getDockingPortCameras(): Record<string, THREE.PerspectiveCamera> {
        return this.objects.getDockingPortCameras();
    }

    /**
     * Return a list of spacecraft currently docked to any of our ports.
     */
    public getDockedSpacecrafts(): Spacecraft[] {
        const partners: Spacecraft[] = [];
        for (const pid of Object.keys(this.dockingPorts)) {
            const p = this.dockingPorts[pid];
            if (p?.isOccupied && p.dockedTo?.spacecraft) {
                partners.push(p.dockedTo.spacecraft);
            }
        }
        // Deduplicate in case multiple ports connect to the same craft
        const seen = new Set<string>();
        return partners.filter((s) => {
            if (seen.has(s.uuid)) return false;
            seen.add(s.uuid);
            return true;
        });
    }

    /** Returns ALL spacecraft in the same compound body (transitive walk through docked ports). */
    public getCompoundMembers(): Spacecraft[] {
        const visited = new Set<string>();
        const result: Spacecraft[] = [];
        const walk = (craft: Spacecraft) => {
            if (visited.has(craft.uuid)) return;
            visited.add(craft.uuid);
            result.push(craft);
            for (const p of Object.values(craft.dockingPorts)) {
                if (p?.isOccupied && p.dockedTo?.spacecraft) {
                    walk(p.dockedTo.spacecraft);
                }
            }
        };
        walk(this);
        return result;
    }

    /** True when any docking port is occupied. */
    public isDocked(): boolean {
        return Object.values(this.dockingPorts).some(p => p?.isOccupied === true);
    }

    public setDockingLights(enabled: boolean): void {
        for (const pid of Object.keys(this.dockingPorts)) {
            this.dockingLights[pid] = enabled;
        }
        this.objects.setDockingLightsEnabled(enabled);
    }

    public setDockingLight(portId: string, enabled: boolean): void {
        this.dockingLights[portId] = enabled;
        this.objects.setDockingLightEnabled(portId, enabled);
    }

    public isDockingLightOn(portId: string): boolean {
        return !!this.dockingLights[portId];
    }

    public getDockingLightParams(): { intensity: number; angle: number; distance: number; decay: number; penumbra: number } | null {
        return this.objects.getDockingLightParams();
    }

    /**
     * Adjust docking flashlight parameters for both ports on this craft.
     * angle is in radians (Three.js SpotLight half-angle).
     */
    public setDockingLightParams(params: Partial<{ intensity: number; angle: number; distance: number; decay: number; penumbra: number }>): void {
        this.objects.setDockingLightParams(params);
    }

    public getWorldOrientation(): THREE.Quaternion {
        // Read from the rendered transform to avoid querying Rapier during stepping
        return this.objects.box.quaternion.clone();
    }

    public getWorldOrientationRef(): THREE.Quaternion {
        return this.objects.box.quaternion;
    }

    public getWorldVelocity(): THREE.Vector3 {
        // Synced in SpacecraftModel.update()
        return this.objects.boxBody.velocity.clone();
    }

    public getWorldVelocityRef(): THREE.Vector3 {
        return this.objects.boxBody.velocity;
    }

    public getWorldAngularVelocity(): THREE.Vector3 {
        // Synced in SpacecraftModel.update()
        return this.objects.boxBody.angularVelocity.clone();
    }

    public getWorldAngularVelocityRef(): THREE.Vector3 {
        return this.objects.boxBody.angularVelocity;
    }

    public visualizeDebugObjects(scene: THREE.Scene): void {
        // Create debug objects for visualization
        const debugObjects: THREE.Object3D[] = [];

        // Create spacecraft center sphere
        const centerSphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.3),
            new THREE.MeshBasicMaterial({
                color: 0xff8800,
                transparent: true,
                opacity: 0.5,
                depthTest: false,
                depthWrite: false
            })
        );
        centerSphere.position.copy(this.getWorldPosition());
        scene.add(centerSphere);
        debugObjects.push(centerSphere);

        // Create bounding box
        const size = this.getFullDimensions();
        const boxGeometry = new THREE.BoxGeometry(size.x * 2, size.y * 2, size.z * 2);
        const boxMaterial = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            wireframe: true,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
            depthWrite: false
        });
        const box = new THREE.Mesh(boxGeometry, boxMaterial);
        box.position.copy(this.getWorldPosition());
        box.quaternion.copy(this.getWorldOrientation());
        scene.add(box);
        debugObjects.push(box);

        // Store debug objects for cleanup
        this.debugObjects = debugObjects;
    }

    public clearDebugObjects(): void {
        if (this.debugObjects) {
            this.debugObjects.forEach(obj => {
                if (obj instanceof THREE.Mesh) {
                    obj.geometry.dispose();
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
                obj.parent?.remove(obj);
            });
            this.debugObjects = [];
        }
    }
}

// initializeSpacecraft helper removed (engine-driven creation now lives in BasicWorld)

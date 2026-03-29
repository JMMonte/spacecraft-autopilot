import type * as THREE from 'three';
import type { PhysicsEngine } from '../../physics';
import type { RigidBody } from '../../physics/types';

/** Context passed to every module during build. */
export interface ModuleBuildContext {
    /** The spacecraft box mesh — modules parent their geometry here. */
    box: THREE.Mesh;
    /** Box half-extents. */
    boxWidth: number;
    boxHeight: number;
    boxDepth: number;
    /** Scene reference (for modules that need scene-level objects). */
    scene: THREE.Scene;
    /** Material provider — modules request named materials. */
    getMaterial: (name: string) => THREE.Material;
    /** Physics engine (nullable for physics-free tests). */
    physics: PhysicsEngine | null;
    /** Rigid body of the spacecraft (nullable). */
    rigid: RigidBody | null;
}

/** Result returned by a module after building. */
export interface ModuleBuildResult {
    /** Mass contribution in kg. */
    mass: number;
    /** Optional physics collider handles for cleanup. */
    colliderHandles?: unknown[];
}

/**
 * A self-contained spacecraft component that can build geometry,
 * contribute mass, update per-frame, and clean up after itself.
 */
export interface SpacecraftModule {
    /** Unique type identifier (e.g., 'truss', 'fuelTank', 'solarPanel'). */
    readonly type: string;

    /** Build geometry, attach to box, create physics shapes. Returns mass contribution. */
    build(ctx: ModuleBuildContext): ModuleBuildResult;

    /** Per-frame update (optional — most modules are static). */
    update?(dt: number): void;

    /** Remove geometry, dispose materials/geometries, remove colliders. */
    cleanup(): void;

    /** Rebuild after dimension change (optional). */
    rebuild?(ctx: ModuleBuildContext): ModuleBuildResult;
}

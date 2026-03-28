import type * as THREE from 'three';

/** Minimal read-only view of a spacecraft for cross-referencing by controllers and managers. */
export interface SpacecraftLike {
    uuid: string;
    name: string;
    getWorldPosition(): THREE.Vector3;
    getWorldVelocity(): THREE.Vector3;
    getWorldAngularVelocity(): THREE.Vector3;
    getWorldOrientation(): THREE.Quaternion;
    getMass(): number;
    getFullDimensions(): THREE.Vector3;
}

/**
 * Registry interface that breaks the BasicWorld ↔ Spacecraft bidirectional coupling.
 * Implemented by SpacecraftManager (future) or BasicWorld (current).
 * Lives in src/domain/ so simulation-layer code can depend on it without violating architecture boundaries.
 */
export interface SpacecraftRegistry {
    getSpacecraftList(): ReadonlyArray<SpacecraftLike>;
    getAsteroidObstacles(): Array<{ position: THREE.Vector3; size: THREE.Vector3 }>;
    onSpacecraftListChanged(callback: () => void): () => void;
}

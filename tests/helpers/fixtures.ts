/**
 * Reusable test fixture builders.
 *
 * These produce plain objects (no THREE.js dependency) suitable for any test
 * that works with position/velocity/orientation data.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** Create a plain {x,y,z} vector. */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
    return { x, y, z };
}

/** Create a plain {x,y,z,w} quaternion. Defaults to identity. */
export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
    return { x, y, z, w };
}

export interface MockSpacecraft {
    name: string;
    position: Vec3;
    velocity: Vec3;
    orientation: Quat;
    angularVelocity: Vec3;
    mass: number;
    getWorldPosition: () => Vec3;
    getWorldVelocity: () => Vec3;
    getWorldOrientation: () => Quat;
    getWorldAngularVelocity: () => Vec3;
    getMass: () => number;
}

/** Minimal spacecraft mock with sensible defaults. Override any field. */
export function mockSpacecraft(overrides?: Partial<MockSpacecraft>): MockSpacecraft {
    const defaults: MockSpacecraft = {
        name: 'TestCraft',
        position: vec3(),
        velocity: vec3(),
        orientation: quat(),
        angularVelocity: vec3(),
        mass: 1000,
        getWorldPosition() { return this.position; },
        getWorldVelocity() { return this.velocity; },
        getWorldOrientation() { return this.orientation; },
        getWorldAngularVelocity() { return this.angularVelocity; },
        getMass() { return this.mass; },
    };
    return { ...defaults, ...overrides };
}

export interface MockObstacle {
    position: Vec3;
    radius: number;
}

/** Create an obstacle at a given center with a given radius. */
export function mockObstacle(center: Vec3, radius: number): MockObstacle {
    return { position: center, radius };
}

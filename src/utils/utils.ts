import * as math from 'mathjs';
import * as THREE from 'three';

export interface ThrusterConfig {
    position: THREE.Vector3;
    direction: THREE.Vector3;
}

export function constructThrusterConfigurationMatrix(thrusterConfigs: ThrusterConfig[]): number[][] {
    return thrusterConfigs.map(({ position: r, direction: f }) => [
        r.y * f.z - r.z * f.y,
        r.z * f.x - r.x * f.z,
        r.x * f.y - r.y * f.x,
    ]);
}

export function adjustForces(initialForces: number[], groups: { [key: string]: number[][] }): number[] {
    let adjustedForces = [...initialForces];
    Object.values(groups).forEach(groupArray => {
        groupArray.forEach(group => {
            const averageForce = group.reduce((sum, index) => sum + initialForces[index], 0) / group.length;
            group.forEach(index => {
                adjustedForces[index] = averageForce;
            });
        });
    });
    return adjustedForces;
}

export function solveForThrusterForces(tcm: number[][], desiredTorqueVec3: THREE.Vector3 | number[]): number[] {
    // Convert inputs to a format compatible with mathjs if they're not already
    const tcmArray = Array.isArray(tcm) ? tcm : []; // Adjust based on expected input structure
    let desiredTorqueArray: number[];

    if (Array.isArray(desiredTorqueVec3)) {
        desiredTorqueArray = desiredTorqueVec3;
    } else if (desiredTorqueVec3 instanceof THREE.Vector3) {
        desiredTorqueArray = [desiredTorqueVec3.x, desiredTorqueVec3.y, desiredTorqueVec3.z];
    } else {
        throw new Error("Unexpected format for desiredTorqueVec3");
    }

    // Use mathjs functions to create matrices and perform calculations
    try {
        const A = math.matrix(tcmArray);
        const b = math.matrix([[desiredTorqueArray[0]], [desiredTorqueArray[1]], [desiredTorqueArray[2]]]); // Ensure b is a column vector

        const At = math.transpose(A);
        const AtA = math.multiply(At, A);
        const AtA_inv = math.inv(AtA);
        const pseudoInverseA = math.multiply(AtA_inv, At);
        const x = math.multiply(pseudoInverseA, b);

        const result = math.flatten(x).toArray() as number[];
        return result;
    } catch (error) {
        console.error('Error in solveForThrusterForces:', error);
        throw error; // Allows further handling or logging outside this function
    }
}

export function calculateAndAdjustThrusterForces(
    desiredForce: THREE.Vector3,
    thrusterConfigs: ThrusterConfig[],
    thrusterGroups: { [key: string]: number[][] }
): number[] {
    const tcm = constructThrusterConfigurationMatrix(thrusterConfigs);
    const initialForces = solveForThrusterForces(tcm, desiredForce);
    return adjustForces(initialForces, thrusterGroups);
}

// --- Dynamic thruster grouping -------------------------------------------------
import type { ThrusterGroups } from '../config/spacecraftConfig';

/**
 * Build thruster groups from actual nozzle directions and positions.
 * - Translation groups: classify by force component along axes
 * - Rotation groups: classify by torque sign about principal axes
 */
export function computeThrusterGroups(thrusters: ThrusterConfig[], eps: number = 1e-3): ThrusterGroups {
    const forward: number[][] = [[], []]; // [ +Z, -Z ]
    const up: number[][] = [[], []];      // [ +Y, -Y ]
    const left: number[][] = [[], []];    // [ -X, +X ] (kept naming for compatibility)
    const pitch: number[][] = [[], []];   // [ tau.x < 0, tau.x > 0 ] => code uses idx 1 for x>=0
    const yaw: number[][] = [[], []];     // [ tau.y > 0, tau.y < 0 ] => code uses idx 0 for y>=0
    const roll: number[][] = [[], []];    // [ tau.z > 0, tau.z < 0 ] => code uses idx 0 for z>=0

    thrusters.forEach((t, i) => {
        const dir = t.direction.clone().normalize();
        const F = dir.clone().multiplyScalar(-1); // force is opposite exhaust direction

        // Translation classification
        if (F.z > eps) forward[0].push(i); else if (F.z < -eps) forward[1].push(i);
        if (F.y > eps) up[0].push(i);      else if (F.y < -eps)  up[1].push(i);
        if (F.x < -eps) left[0].push(i);   else if (F.x > eps)   left[1].push(i);

        // Rotation classification by torque sign about axes
        const tau = t.position.clone().cross(F); // r x F
        if (tau.x < -eps) pitch[0].push(i); else if (tau.x > eps) pitch[1].push(i);
        if (tau.y > eps)  yaw[0].push(i);   else if (tau.y < -eps) yaw[1].push(i);
        if (tau.z > eps)  roll[0].push(i);  else if (tau.z < -eps) roll[1].push(i);
    });

    return { forward, up, left, pitch, yaw, roll };
}

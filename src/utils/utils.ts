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
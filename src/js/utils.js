import * as math from 'mathjs';
import * as THREE from 'three';

export function constructThrusterConfigurationMatrix(thrusterConfigs) {
    return thrusterConfigs.map(({ position: r, direction: f }) => [
        r.y * f.z - r.z * f.y,
        r.z * f.x - r.x * f.z,
        r.x * f.y - r.y * f.x,
    ]);
}

export function adjustForces(initialForces, groups) {
    let adjustedForces = [...initialForces];
    Object.values(groups).forEach(group => {
        const averageForce = group.reduce((sum, index) => sum + initialForces[index], 0) / group.length;
        group.forEach(index => adjustedForces[index] = averageForce);
    });
    return adjustedForces;
}

export function solveForThrusterForces(tcm, desiredTorqueVec3) {
    // Convert inputs to a format compatible with mathjs if they're not already
    const tcmArray = Array.isArray(tcm) ? tcm : []; // Adjust based on expected input structure
    let desiredTorqueArray;

    if (Array.isArray(desiredTorqueVec3)) {
        desiredTorqueArray = desiredTorqueVec3;
    } else if (desiredTorqueVec3 !== undefined && typeof desiredTorqueVec3 === 'object') {
        // Assuming desiredTorqueVec3 is an object with x, y, z properties
        desiredTorqueArray = [desiredTorqueVec3.x, desiredTorqueVec3.y, desiredTorqueVec3.z];
    } else {
        // Handle unexpected format
        console.error("Unexpected format for desiredTorqueVec3", desiredTorqueVec3);
        return []; // or throw an error
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

        return x.toArray().map(row => row[0]);
    } catch (error) {
        console.error('Error in solveForThrusterForces:', error);
        throw error; // Allows further handling or logging outside this function
    }
}



export function calculateAndAdjustThrusterForces(desiredTorque, thrusterConfigs, thrusterGroups) {
    const tcm = constructThrusterConfigurationMatrix(thrusterConfigs);
    const initialForces = solveForThrusterForces(tcm, [desiredTorque.x, desiredTorque.y, desiredTorque.z]);
    return adjustForces(initialForces, thrusterGroups);
}

export function applyQuaternionToVector(quaternion, vector) {
    const q = new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    const v = new THREE.Vector3(vector.x, vector.y, vector.z);
    const result = v.applyQuaternion(q);
    return { x: result.x, y: result.y, z: result.z };
}

export function adjustForRotationalSymmetry(angles, symmetry) {
    return angles.map(angle => {
        if (angle > symmetry) {
            return angle - symmetry;
        } else if (angle < -symmetry) {
            return angle + symmetry;
        }
        return angle;
    });
}

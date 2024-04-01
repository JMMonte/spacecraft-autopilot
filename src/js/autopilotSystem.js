import * as THREE from 'three';
import CANNON from 'cannon';
import { PIDController } from './pidController';


export class AutopilotSystem {
    constructor(spacecraft) {
        this.spacecraft = spacecraft;
        this.enabled = false;
        this.targetOrientation = new THREE.Quaternion();
        this.targetAngularVelocity = new CANNON.Vec3();
        this.pidController = new PIDController(5, 0.05, 2);
    }

    toggle() {
        this.enabled = !this.enabled;
        console.log(`Autopilot ${this.enabled ? 'enabled' : 'disabled'}.`);
        if (this.enabled) {
            this.setTargetOrientation(this.spacecraft.objects.boxBody.quaternion);
        }
    }

    setTargetOrientation(quaternion) {
        this.targetOrientation.copy(quaternion);
    }

    update(deltaTime) {
        if (!this.enabled) return;

        const currentOrientation = this.spacecraft.objects.boxBody.quaternion;
        const currentAngularVelocity = this.spacecraft.objects.boxBody.angularVelocity;
        
        const orientationErrorQuat = new THREE.Quaternion().multiplyQuaternions(
            this.targetOrientation,
            currentOrientation.clone().invert()
        );
        
        const orientationError = this.quaternionErrorToVector(orientationErrorQuat);
        const angularVelocityError = currentAngularVelocity.clone().vsub(this.targetAngularVelocity);
        
        return this.pidController.update(orientationError, angularVelocityError, deltaTime);
    }

    quaternionErrorToVector(quaternion) {
        if (quaternion.w > 1) quaternion.normalize(); // Ensure quaternion is normalized
        const angle = 2 * Math.acos(quaternion.w);
        const s = Math.sqrt(1 - quaternion.w * quaternion.w); // assuming quaternion normalised then w is less than 1, so term always positive.
        const factor = angle / (s < 0.001 ? 1 : s); // Avoid division by zero

        return new CANNON.Vec3(quaternion.x * factor, quaternion.y * factor, quaternion.z * factor);
    }
}
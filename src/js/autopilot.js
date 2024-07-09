import * as THREE from 'three';
import * as CANNON from 'cannon';
import { PIDController } from './pidController';

export class Autopilot {
    constructor(spacecraft, thrusterGroups) {
        this.spacecraft = spacecraft;
        this.thrusterGroups = thrusterGroups;
        this.targetOrientation = new THREE.Quaternion(0, 0, 0, 1);
        this.pidController = new PIDController(5, 0.05, 2);
        this.orientationPidController = new PIDController(0.1, 0.01, 0.05);
        this.thrust = 1200;
        this.maxAngularMomentum = 100;
        this.maxAngularVelocity = 10;
        this.autopilotThreshold = 0.2;
        this.phase = 0;
        this.minAngularMomentumMagnitude = 0.2;
        this.isAutopilotEnabled = false;
        this.isRotationCancelOnly = false;
        this.isTrackingTarget = false; // New flag to indicate continuous target tracking
        this.targetPosition = new THREE.Vector3(0, 0, 0); // New property to store target position
    }

    setTargetOrientation() {
        if (this.spacecraft?.objects.boxBody) {
            this.targetOrientation.copy(this.spacecraft.objects.boxBody.quaternion);
        }
    }

    calculateOrientationToTargetPosition() {
        const currentPosition = new THREE.Vector3();
        currentPosition.copy(this.spacecraft.objects.boxBody.position);
        const direction = new THREE.Vector3().subVectors(this.targetPosition, currentPosition).normalize();

        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, direction).normalize();
        const newUp = new THREE.Vector3().crossVectors(direction, right).normalize();

        const matrix = new THREE.Matrix4().makeBasis(right, newUp, direction);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
        this.targetOrientation.copy(quaternion);
    }

    cancelAndAlign() {
        this.isAutopilotEnabled = !this.isAutopilotEnabled;
        this.phase = 0;
        this.isRotationCancelOnly = false;

        document.dispatchEvent(new CustomEvent('autopilotStateChanged', { detail: { enabled: this.isAutopilotEnabled, type: 'align' } }));
    }

    cancelRotation() {
        this.isAutopilotEnabled = !this.isAutopilotEnabled;
        this.phase = 1;
        this.isRotationCancelOnly = true;

        document.dispatchEvent(new CustomEvent('autopilotStateChanged', { detail: { enabled: this.isAutopilotEnabled, type: 'rotation' } }));
    }

    calculateAutopilotForces() {
        const {
            currentQuaternion,
            errorQuaternion,
            orientationError,
            momentOfInertia,
            currentAngularMomentum,
            currentAngularMomentumMagnitude
        } = this.calculateAutopilotParameters();

        const { angularMomentumIsLow, orientationNeedsCorrection } = this.determineAutopilotConditions(currentAngularMomentumMagnitude, orientationError);

        if (this.isTrackingTarget) {
            this.calculateOrientationToTargetPosition();
        }

        if (this.isRotationCancelOnly) {
            if (angularMomentumIsLow) {
                return Array(24).fill(0); // Stop firing thrusters
            }
            this.phase = 1; // Only apply damping to cancel rotation
        } else {
            this.updateAutopilotPhase(angularMomentumIsLow, orientationNeedsCorrection);
        }

        return this.executeAutopilotPhase(currentAngularMomentum, currentQuaternion, errorQuaternion, momentOfInertia);
    }

    calculateAutopilotParameters() {
        const currentQuaternion = new THREE.Quaternion().copy(this.spacecraft.objects.boxBody.quaternion).normalize();
        const targetQuaternion = this.targetOrientation.normalize();
        const errorQuaternion = targetQuaternion.clone().multiply(currentQuaternion.invert()).normalize();
        const orientationError = 2 * Math.acos(Math.min(1, Math.abs(errorQuaternion.w)));
        const currentAngularVelocity = new THREE.Vector3().copy(this.spacecraft.objects.boxBody.angularVelocity);
        const momentOfInertia = this.calculateMomentOfInertia();
        const currentAngularMomentum = currentAngularVelocity.clone().multiplyScalar(momentOfInertia);
        const currentAngularMomentumMagnitude = currentAngularMomentum.length();

        return {
            currentQuaternion,
            targetQuaternion,
            errorQuaternion,
            orientationError,
            currentAngularVelocity,
            momentOfInertia,
            currentAngularMomentum,
            currentAngularMomentumMagnitude
        };
    }

    determineAutopilotConditions(currentAngularMomentumMagnitude, orientationError) {
        const isMomentumLow = currentAngularMomentumMagnitude <= this.minAngularMomentumMagnitude;
        const isOrientationClose = orientationError <= this.autopilotThreshold;
        const shouldStop = currentAngularMomentumMagnitude < 0.0009 && isOrientationClose;

        return {
            angularMomentumIsLow: isMomentumLow,
            orientationNeedsCorrection: orientationError > this.autopilotThreshold,
            shouldStopAutopilot: shouldStop
        };
    }

    updateAutopilotPhase(angularMomentumIsLow, orientationNeedsCorrection) {
        if (this.phase !== 3 && !angularMomentumIsLow) {
            this.phase = 1; // Angular momentum damping phase
        } else if (angularMomentumIsLow && orientationNeedsCorrection) {
            this.phase = 3; // Orientation correction phase
        }
        console.log("Phase: ", this.phase);
    }

    executeAutopilotPhase(currentAngularMomentum, currentQuaternion, errorQuaternion, momentOfInertia) {
        const { shouldStopAutopilot } = this.determineAutopilotConditions(currentAngularMomentum.length(), 2 * Math.acos(Math.abs(errorQuaternion.w)));

        if (shouldStopAutopilot && !this.isRotationCancelOnly) {
            console.log("Stopping autopilot as angular momentum and orientation error are below thresholds");
            return Array(24).fill(0); // Stop firing thrusters
        }

        if (this.phase === 1) {
            console.log("Applying damping");
            return this.applyDamping(currentAngularMomentum, currentQuaternion, true);
        } else if (this.phase === 3) {
            console.log("Adjusting angular velocity for orientation");
            return this.adjustAngularVelocityForOrientation(errorQuaternion, currentAngularMomentum, currentQuaternion, momentOfInertia);
        }

        return Array(24).fill(0); // No action if no conditions are met
    }

    applyDamping(currentAngularMomentum, currentQuaternion, fullDamp = false) {
        const dampingFactor = fullDamp ? 1.0 : 0.1;
        const angularMomentumError = currentAngularMomentum.clone().negate().multiplyScalar(dampingFactor);
        let pidOutput = this.pidController.update(new CANNON.Vec3(angularMomentumError.x, angularMomentumError.y, angularMomentumError.z), 1 / 60);
        let pidOutputVector = new THREE.Vector3(pidOutput.x, pidOutput.y, pidOutput.z);
        pidOutputVector = this.transformLocalToGlobal(pidOutputVector, currentQuaternion);
        return this.applyPIDOutputToThrusters(pidOutputVector);
    }

    adjustAngularVelocityForOrientation(errorQuaternion, currentAngularMomentum, currentQuaternion, momentOfInertia) {
        const controlSignal = this.calculateControlSignal(errorQuaternion);
        let desiredAngularVelocity = this.quaternionToAngularVelocity(errorQuaternion, true);
        desiredAngularVelocity.multiplyScalar(controlSignal);
        const desiredAngularMomentum = desiredAngularVelocity.multiplyScalar(momentOfInertia);
        const angularMomentumError = desiredAngularMomentum.sub(currentAngularMomentum);
        let pidOutput = this.pidController.update(new CANNON.Vec3(angularMomentumError.x, angularMomentumError.y, angularMomentumError.z), 1 / 60);
        let pidOutputVector = new THREE.Vector3(pidOutput.x, pidOutput.y, pidOutput.z);
        pidOutputVector = this.transformLocalToGlobal(pidOutputVector, currentQuaternion);
        return this.applyPIDOutputToThrusters(pidOutputVector);
    }

    applyPIDOutputToThrusters(pidOutput) {
        const thrusterForces = Array(24).fill(0);

        const pitchForcePerThruster = this.calculateForcePerThruster(pidOutput.x, 'pitch');
        const yawForcePerThruster = this.calculateForcePerThruster(pidOutput.y, 'yaw');
        const rollForcePerThruster = this.calculateForcePerThruster(pidOutput.z, 'roll');

        this.applyForceToGroup(this.thrusterGroups.pitch[pidOutput.x >= 0 ? 1 : 0], pitchForcePerThruster, thrusterForces);
        this.applyForceToGroup(this.thrusterGroups.yaw[pidOutput.y >= 0 ? 0 : 1], yawForcePerThruster, thrusterForces);
        this.applyForceToGroup(this.thrusterGroups.roll[pidOutput.z >= 0 ? 0 : 1], rollForcePerThruster, thrusterForces);

        return thrusterForces;
    }

    calculateMomentOfInertia() {
        const mass = this.spacecraft.objects.boxBody.mass;
        const size = this.spacecraft.objects.boxBody.shapes[0].halfExtents;

        const w = size.x;
        const h = size.y;
        const d = size.z;

        const Ix = (1/12) * mass * (h*h + d*d);
        const Iy = (1/12) * mass * (w*w + d*d);
        const Iz = (1/12) * mass * (w*w + h*h);

        return Math.max(Ix, Iy, Iz);
    }

    calculateControlSignal(errorQuaternion) {
        let orientationError = 2 * Math.acos(Math.abs(errorQuaternion.w));
        orientationError /= Math.PI;
        const maxControlSignal = 0.5;
        return Math.min(orientationError, maxControlSignal);
    }

    quaternionToAngularVelocity(quaternion, ensureShortestPath = false) {
        let angle = 2 * Math.acos(quaternion.w);
        let sinHalfAngle = Math.sqrt(1 - quaternion.w * quaternion.w);
        let axis = new THREE.Vector3(quaternion.x, quaternion.y, quaternion.z);

        if (sinHalfAngle > 0.01) {
            axis.normalize().multiplyScalar(angle / sinHalfAngle);
        } else {
            axis.set(0, 0, 0);
        }

        if (ensureShortestPath && angle > Math.PI) {
            angle = 2 * Math.PI - angle;
            axis.negate();
        }

        if (ensureShortestPath) {
            axis.multiplyScalar(sinHalfAngle > 0.001 ? angle / sinHalfAngle : 0);
        }

        return axis;
    }

    transformLocalToGlobal(localVector, currentQuaternion) {
        let globalVector = localVector.clone();
        globalVector.applyQuaternion(currentQuaternion);
        return globalVector;
    }

    calculateForcePerThruster(torqueComponent, controlAxis) {
        const numThrusters = this.thrusterGroups[controlAxis][0].length + this.thrusterGroups[controlAxis][1].length;
        return Math.abs(torqueComponent) * this.thrust / numThrusters;
    }

    applyForceToGroup(thrusterGroup, forcePerThruster, thrusterForces) {
        thrusterGroup.forEach(index => {
            thrusterForces[index] += Math.min(forcePerThruster, this.thrust);
        });
    }
}

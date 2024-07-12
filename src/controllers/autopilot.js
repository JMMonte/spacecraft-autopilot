import * as THREE from 'three';
import * as CANNON from 'cannon';
import { PIDController } from './pidController';

export class Autopilot {
    constructor(spacecraft, thrusterGroups, thrust) {
        this.spacecraft = spacecraft;
        this.thrusterGroups = thrusterGroups;
        this.targetOrientation = new THREE.Quaternion(0, 0, 0, 1);
        this.targetPosition = new THREE.Vector3(0, 0, 0);
        this.pidController = new PIDController(5, 0.05, 2);
        this.orientationPidController = new PIDController(0.1, 0.01, 0.05);
        this.linearPidController = new PIDController(10, 0.1, 5);
        this.thrust = thrust;
        this.maxAngularMomentum = 100;
        this.maxAngularVelocity = 10;
        this.autopilotThreshold = 0.01;
        this.phase = 0;
        this.minAngularMomentumMagnitude = 0.1;
        this.isAutopilotEnabled = false;
        this.isRotationCancelOnly = false;
        this.isTrackingTarget = false;
        this.isLinearMotionCancelationEnabled = false; // New flag for linear motion cancellation
        this.activeAutopilots = {
            cancelAndAlign: false,
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            goToPosition: false
        };
        this.maxForce = 400; // Maximum combined force from 4 thrusters
        this.dampingFactor = 3.0; // Adjust this value to change damping strength
        this.spacecraftMass = spacecraft.objects.boxBody.mass; // Assuming this is in kg
        this.positionReference = this.spacecraft.objects.boxBody.position;
    }

    setTargetOrientation() {
        if (this.spacecraft?.objects.boxBody) {
            this.targetOrientation.copy(this.spacecraft.objects.boxBody.quaternion);
        }
    }

    calculateOrientationToTargetPosition(position) {
        const currentPosition = new THREE.Vector3();
        currentPosition.copy(position);
        const direction = new THREE.Vector3().subVectors(this.targetPosition, currentPosition).normalize();

        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, direction).normalize();
        const newUp = new THREE.Vector3().crossVectors(direction, right).normalize();

        const matrix = new THREE.Matrix4().makeBasis(right, newUp, direction);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
        this.targetOrientation.copy(quaternion);
    }

    cancelAndAlign() {
        this.activeAutopilots.cancelAndAlign = !this.activeAutopilots.cancelAndAlign;
        if (this.activeAutopilots.cancelAndAlign) {
            this.activeAutopilots.cancelRotation = false;
            this.activeAutopilots.pointToPosition = false;
        }
        this.updateAutopilotState();
    }

    cancelRotation() {
        this.activeAutopilots.cancelRotation = !this.activeAutopilots.cancelRotation;
        if (this.activeAutopilots.cancelRotation) {
            this.activeAutopilots.cancelAndAlign = false;
            this.activeAutopilots.pointToPosition = false;
        }
        this.updateAutopilotState();
    }

    pointToPosition() {
        this.activeAutopilots.pointToPosition = !this.activeAutopilots.pointToPosition;
        this.isTrackingTarget = this.activeAutopilots.pointToPosition;
        if (this.activeAutopilots.pointToPosition) {
            this.activeAutopilots.cancelAndAlign = false;
            this.activeAutopilots.cancelRotation = false;
        }
        this.updateAutopilotState();
    }

    cancelLinearMotion() {
        this.activeAutopilots.cancelLinearMotion = !this.activeAutopilots.cancelLinearMotion;
        if (this.activeAutopilots.cancelLinearMotion) {
            this.activeAutopilots.goToPosition = false; // Disable goToPosition if cancelLinearMotion is enabled
        }
        this.updateAutopilotState();
    }

    goToPosition() {
        this.activeAutopilots.goToPosition = !this.activeAutopilots.goToPosition;
        if (this.activeAutopilots.goToPosition) {
            this.activeAutopilots.cancelLinearMotion = false; // Disable cancelLinearMotion if goToPosition is enabled
        }
        this.updateAutopilotState();
    }


    updateAutopilotState() {
        this.isAutopilotEnabled = Object.values(this.activeAutopilots).some(value => value);
        document.dispatchEvent(new CustomEvent('autopilotStateChanged', { detail: { enabled: this.isAutopilotEnabled, activeAutopilots: this.activeAutopilots } }));
    }

    calculateAutopilotForces() {
        const params = this.calculateAutopilotParameters();

        let forces = Array(24).fill(0);

        if (this.activeAutopilots.cancelLinearMotion) {
            forces = this.mergeForces(forces, this.calculateLinearMotionCancelationForces());
        }

        if (this.activeAutopilots.cancelRotation) {
            forces = this.mergeForces(forces, this.applyDamping(params.currentAngularMomentum, params.currentQuaternion, true));
        }

        if (this.activeAutopilots.cancelAndAlign || this.activeAutopilots.pointToPosition) {
            if (this.activeAutopilots.pointToPosition) {
                this.calculateOrientationToTargetPosition(this.positionReference);
            }
            forces = this.mergeForces(forces, this.adjustAngularVelocityForOrientation(params.errorQuaternion, params.currentAngularMomentum, params.currentQuaternion, params.momentOfInertia));
        }

        if (this.activeAutopilots.goToPosition) {
            this.calculateOrientationToTargetPosition(this.positionReference);
            forces = this.mergeForces(forces, this.calculateGoToPositionForces(params));
        }

        return forces;
    }

    calculateGoToPositionForces(params) {
        const currentPosition = new THREE.Vector3().copy(this.positionReference);
        const targetPosition = new THREE.Vector3().copy(this.targetPosition);
        const currentVelocity = new THREE.Vector3().copy(this.spacecraft.objects.boxBody.velocity);
        
        // Calculate position error
        const positionError = new THREE.Vector3().subVectors(targetPosition, currentPosition);

        // Calculate distance to target
        const distanceToTarget = positionError.length();

        // Use PID controller to calculate the force needed
        const pidOutput = this.linearPidController.update(new CANNON.Vec3(positionError.x, positionError.y, positionError.z), 1 / 60);

        // Calculate the desired force based on PID output
        let force = new THREE.Vector3(pidOutput.x, pidOutput.y, pidOutput.z).multiplyScalar(this.spacecraftMass);

        // Apply velocity damping
        const dampingForce = currentVelocity.clone().multiplyScalar(-this.dampingFactor * this.spacecraftMass);
        force.add(dampingForce);

        // Calculate the maximum allowable velocity based on distance, mass, and thrust capability
        const maxVelocity = Math.sqrt(2 * this.thrust * distanceToTarget / this.spacecraftMass);

        // Adjust the force to ensure it respects the max velocity
        const maxForce = maxVelocity * this.spacecraftMass / (1 / 60); // Force needed to achieve max velocity in one timestep
        if (force.length() > maxForce) {
            force.normalize().multiplyScalar(maxForce);
        }

        // Limit the force to the maximum allowed force
        if (force.length() > this.maxForce) {
            force.normalize().multiplyScalar(this.maxForce);
        }

        // Convert force to spacecraft's local coordinate system
        const localForce = this.spacecraft.objects.boxBody.quaternion.inverse().vmult(new CANNON.Vec3(force.x, force.y, force.z));
        
        // Apply the force using thruster groups
        return this.applyTranslationalForcesToThrusterGroups(localForce);
    }

    applyTranslationalForcesToThrusterGroups(localForce) {
        const forces = Array(24).fill(0);
        const epsilon = 0.01; // Small threshold to avoid activating thrusters unnecessarily

        // Forward/Backward
        if (Math.abs(localForce.z) > epsilon) {
            const thrusterGroup = localForce.z > 0 ? this.thrusterGroups.forward[0] : this.thrusterGroups.forward[1];
            const thrusterForce = Math.min(Math.abs(localForce.z) / 4, this.thrust);
            thrusterGroup.forEach(index => forces[index] = thrusterForce);
        }

        // Up/Down
        if (Math.abs(localForce.y) > epsilon) {
            const thrusterGroup = localForce.y > 0 ? this.thrusterGroups.up[0] : this.thrusterGroups.up[1];
            const thrusterForce = Math.min(Math.abs(localForce.y) / 4, this.thrust);
            thrusterGroup.forEach(index => forces[index] = thrusterForce);
        }

        // Left/Right
        if (Math.abs(localForce.x) > epsilon) {
            const thrusterGroup = localForce.x > 0 ? this.thrusterGroups.left[1] : this.thrusterGroups.left[0];
            const thrusterForce = Math.min(Math.abs(localForce.x) / 4, this.thrust);
            thrusterGroup.forEach(index => forces[index] = thrusterForce);
        }

        return forces;
    }

    mergeForces(forces1, forces2) {
        return forces1.map((force, index) => force + forces2[index]);
    }

    calculateLinearMotionCancelationForces() {
        const forces = Array(24).fill(0);

        // Get the velocity in the local reference frame
        const worldVelocity = this.spacecraft.objects.boxBody.velocity.clone();
        const localVelocity = this.spacecraft.objects.boxBody.quaternion.inverse().vmult(worldVelocity);

        // Calculate PID output for each axis
        const velocityError = localVelocity.negate();
        const pidOutput = this.linearPidController.update(new CANNON.Vec3(velocityError.x, velocityError.y, velocityError.z), 1 / 60);

        // Calculate forces per thruster group
        const forwardForce = Math.abs(pidOutput.z) * this.thrust / 4;
        const upForce = Math.abs(pidOutput.y) * this.thrust / 4;
        const leftForce = Math.abs(pidOutput.x) * this.thrust / 4;

        // Apply forces to the appropriate thruster groups
        this.applyForceToGroup(this.thrusterGroups.forward[pidOutput.z > 0 ? 0 : 1], forwardForce, forces);
        this.applyForceToGroup(this.thrusterGroups.up[pidOutput.y > 0 ? 0 : 1], upForce, forces);
        this.applyForceToGroup(this.thrusterGroups.left[pidOutput.x < 0 ? 0 : 1], leftForce, forces);

        return forces;
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
        } else if (this.phase === 2) {
            console.log("Pointing to target position");
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

        const Ix = (1 / 12) * mass * (h * h + d * d);
        const Iy = (1 / 12) * mass * (w * w + d * d);
        const Iz = (1 / 12) * mass * (w * w + h * h);

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

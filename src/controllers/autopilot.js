/*******************************************
 * autopilot.js
 *******************************************/

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Matrix, pseudoInverse } from 'ml-matrix';

import { PIDController } from './pidController.js';

/**
 * A small helper to clamp a value between min and max.
 */
function clamp(value, minVal, maxVal) {
    return Math.max(minVal, Math.min(maxVal, value));
}

export class Autopilot {
    /**
     * @param {object} spacecraft - your spacecraft, includes boxBody
     * @param {object} thrusterGroups - for older 24-thruster logic
     * @param {number} thrust
     * @param {object[]} thrusters - optional array for dynamic allocation
     * @param {object} options - includes pidGains, maxForce, dampingFactor, etc.
     */
    constructor(
        spacecraft,
        thrusterGroups,
        thrust,
        thrusters = [],
        {
            // Lower default PID gains, integral=0, smaller kd, etc.
            pidGains = {
                orientation: { kp: 0.05, ki: 0.0, kd: 0.02 },
                linear: { kp: 5.0, ki: 0.0, kd: 2.0 },
                general: { kp: 3.0, ki: 0.0, kd: 1.0 },
            },
            maxForce = 400,
            dampingFactor = 3.0,
            derivativeAlpha = 0.9,
            maxIntegral = 1.0,
        } = {}
    ) {
        // Basic references
        this.spacecraft = spacecraft;
        this.thrusterGroups = thrusterGroups;
        this.thrusters = thrusters;
        this.numThrusters = thrusters.length;
        this.thrust = thrust;

        // We'll keep track of dt from the caller, so we don't hardcode 1/60
        this.lastDt = 1 / 60;

        // "Smooth" final net force/torque to reduce abrupt changes
        this.smoothedForce = new THREE.Vector3();
        this.smoothedTorque = new THREE.Vector3();
        this.smoothingAlpha = 0.1; // blend factor for lerp

        // Key autopilot targets
        this.targetOrientation = new THREE.Quaternion();
        this.targetPosition = new THREE.Vector3();
        this.targetObject = null;  // Reference to target spacecraft
        this.targetPoint = 'center';  // 'center' or 'dockingPort'

        // Config
        this.config = {
            pid: {
                orientation: pidGains.orientation,
                linear: pidGains.linear,
                general: pidGains.general,
            },
            derivativeAlpha,
            maxIntegral,
            limits: {
                maxAngularMomentum: 100,
                maxAngularVelocity: 10,
                maxForce,    // used for both max braking & forward thrust in this example
                minAngularMomentumMagnitude: 0.1,
                autopilotThreshold: 0.01,
                epsilon: 0.01,
            },
            damping: {
                factor: dampingFactor,
            },
        };

        // Build PIDs with our advanced features
        this.pidController = this.createPID(this.config.pid.general);
        this.orientationPidController = this.createPID(this.config.pid.orientation);
        this.linearPidController = this.createPID(this.config.pid.linear);

        // Physics references
        this.spacecraftMass = spacecraft.objects.boxBody.mass;
        this.positionReference = spacecraft.objects.boxBody.position;

        // Autopilot modes
        this.isAutopilotEnabled = false;
        this.isRotationCancelOnly = false;
        this.isTrackingTarget = false;
        this.isLinearMotionCancelationEnabled = false;
        this.phase = 0;

        this.activeAutopilots = {
            cancelAndAlign: false,
            cancelRotation: false,
            cancelLinearMotion: false,
            pointToPosition: false,
            goToPosition: false,
        };

        // Dynamic allocation matrix
        this.allocationMatrix = null;
        this.allocationMatrixInv = null;
        if (this.numThrusters > 0) {
            this.buildAllocationMatrix();
        }
    }

    /**
     * Factory method to create a PID with anti-windup & derivative filter
     */
    createPID(gains) {
        const pid = new PIDController(gains.kp, gains.ki, gains.kd);
        pid.maxIntegral = this.config.maxIntegral;
        pid.derivativeAlpha = this.config.derivativeAlpha;
        return pid;
    }

    /**
     * Build 6×N matrix for thrusters => pseudo-inverse => dynamic allocation
     */
    buildAllocationMatrix() {
        const A = [];
        for (let row = 0; row < 6; row++) {
            A[row] = new Array(this.numThrusters).fill(0);
        }

        for (let i = 0; i < this.numThrusters; i++) {
            const thruster = this.thrusters[i];
            const r = thruster.position;   // CANNON.Vec3
            const dir = thruster.direction; // CANNON.Vec3

            // F = dir, T = r x dir (unit basis, ignoring maxThrust for now)
            const Fx = dir.x;
            const Fy = dir.y;
            const Fz = dir.z;

            const Tx = r.y * Fz - r.z * Fy;
            const Ty = r.z * Fx - r.x * Fz;
            const Tz = r.x * Fy - r.y * Fx;

            A[0][i] = Fx;
            A[1][i] = Fy;
            A[2][i] = Fz;
            A[3][i] = Tx;
            A[4][i] = Ty;
            A[5][i] = Tz;
        }

        this.allocationMatrix = A;
        const mat = new Matrix(A);
        this.allocationMatrixInv = pseudoInverse(mat);
    }

    /************************************************
     * AUTOPILOT MODE METHODS
     ************************************************/

    resetAllModes() {
        Object.keys(this.activeAutopilots).forEach((mode) => {
            this.activeAutopilots[mode] = false;
        });
        this.isTrackingTarget = false;
    }

    setMode(mode, enabled = true) {
        const rotationModes = [
            'cancelAndAlign',
            'cancelRotation',
            'pointToPosition',
        ];
        const translationModes = [
            'cancelLinearMotion',
            'goToPosition',
        ];

        if (enabled) {
            // Turn off other modes in the same group
            if (rotationModes.includes(mode)) {
                rotationModes.forEach((m) => {
                    if (m !== mode) this.activeAutopilots[m] = false;
                });
            }
            if (translationModes.includes(mode)) {
                translationModes.forEach((m) => {
                    if (m !== mode) this.activeAutopilots[m] = false;
                });
            }
        }

        this.activeAutopilots[mode] = enabled;
        this.isTrackingTarget = this.activeAutopilots.pointToPosition;
        this.updateAutopilotState();
    }

    cancelAndAlign() {
        this.setMode('cancelAndAlign', !this.activeAutopilots.cancelAndAlign);
    }

    cancelRotation() {
        this.setMode('cancelRotation', !this.activeAutopilots.cancelRotation);
    }

    pointToPosition() {
        this.setMode('pointToPosition', !this.activeAutopilots.pointToPosition);
    }

    cancelLinearMotion() {
        this.setMode('cancelLinearMotion', !this.activeAutopilots.cancelLinearMotion);
    }

    goToPosition() {
        this.setMode('goToPosition', !this.activeAutopilots.goToPosition);
    }

    updateAutopilotState() {
        this.isAutopilotEnabled = Object.values(this.activeAutopilots).some(v => v);
        document.dispatchEvent(
            new CustomEvent('autopilotStateChanged', {
                detail: {
                    enabled: this.isAutopilotEnabled,
                    activeAutopilots: this.activeAutopilots,
                },
            })
        );
    }

    /************************************************
     * MAIN UPDATE
     ************************************************/
    /**
     * Called each simulation step with dt.
     */
    calculateAutopilotForces(dt) {
        if (!dt || dt <= 0) dt = 1 / 60;
        this.lastDt = dt;

        // Update target position if we're tracking an object
        if (this.targetObject) {
            this.updateTargetFromObject();
        }

        const anyActive = Object.values(this.activeAutopilots).some((v) => v);
        if (!anyActive) {
            // If no autopilot mode is active => zero
            return this.numThrusters > 0
                ? Array(this.numThrusters).fill(0)
                : Array(24).fill(0);
        }

        // If we have no dynamic thrusters defined => fallback to old 24-thruster method
        if (this.numThrusters === 0) {
            const params = this.calculateAutopilotParameters();
            let forces = Array(24).fill(0);
            forces = this.applyActiveModeForces(forces, params, dt);
            return forces;
        } else {
            // We do dynamic thruster allocation
            const desired6 = this.computeDesired6D(dt);
            const thrusterScales = this.allocateThrusters(desired6);
            // Convert thruster scales => actual thrust
            return thrusterScales.map((scale, i) => {
                const clampedVal = clamp(scale, 0, 1);
                return clampedVal * this.thrusters[i].maxThrust;
            });
        }
    }

    /**
     * Compute the final net force & torque (6D) using active modes,
     * then LERP them for smoothing.
     */
    computeDesired6D(dt) {
        const params = this.calculateAutopilotParameters();
        let rawForce = new THREE.Vector3();
        let rawTorque = new THREE.Vector3();

        // Translation modes
        if (this.activeAutopilots.goToPosition) {
            rawForce.copy(this.computeTranslationForce(dt));
        }
        // Rotation modes
        if (this.activeAutopilots.cancelRotation) {
            rawTorque.copy(this.computeCancelRotationTorque(params, dt));
        } else if (
            this.activeAutopilots.cancelAndAlign ||
            this.activeAutopilots.pointToPosition
        ) {
            rawTorque.copy(this.computeOrientationTorque(params, dt));
        }

        // Smoothing
        this.smoothedForce.lerp(rawForce, this.smoothingAlpha);
        this.smoothedTorque.lerp(rawTorque, this.smoothingAlpha);

        return [
            this.smoothedForce.x,
            this.smoothedForce.y,
            this.smoothedForce.z,
            this.smoothedTorque.x,
            this.smoothedTorque.y,
            this.smoothedTorque.z,
        ];
    }

    allocateThrusters(desired6) {
        if (!this.allocationMatrixInv) {
            return Array(this.numThrusters).fill(0);
        }
        const desiredVec = Matrix.columnVector(desired6);
        const uMatrix = this.allocationMatrixInv.mmul(desiredVec);
        return uMatrix.to1DArray();
    }

    /************************************************
     * Old (24-thruster) approach
     ************************************************/
    applyActiveModeForces(forces, params, dt) {
        const modeForces = {
            cancelLinearMotion: () =>
                this.calculateLinearMotionCancelationForces(dt),
            cancelRotation: () =>
                this.applyDamping(params.currentAngularMomentum, params.currentQuaternion, true, dt),
            cancelAndAlign: () =>
                this.adjustAngularVelocityForOrientation(
                    params.errorQuaternion,
                    params.currentAngularMomentum,
                    params.currentQuaternion,
                    params.momentOfInertia,
                    dt
                ),
            pointToPosition: () => {
                // Look at target before adjusting orientation
                this.calculateOrientationToTargetPosition(this.positionReference);
                return this.adjustAngularVelocityForOrientation(
                    params.errorQuaternion,
                    params.currentAngularMomentum,
                    params.currentQuaternion,
                    params.momentOfInertia,
                    dt
                );
            },
            goToPosition: () => {
                // Orient toward target, then generate translational forces
                this.calculateOrientationToTargetPosition(this.positionReference);
                return this.calculateGoToPositionForces(params, dt);
            },
        };

        Object.entries(this.activeAutopilots).forEach(([mode, isActive]) => {
            if (isActive && modeForces[mode]) {
                const newForces = modeForces[mode]();
                forces = this.mergeForces(forces, newForces);
            }
        });
        return forces;
    }

    /**
     * This method now includes a clamp on the approach speed
     * so we don't exceed a velocity we can't brake from.
     */
    calculateGoToPositionForces(params, dt) {
        const currentPosition = new THREE.Vector3().copy(this.positionReference);
        const targetPosition = new THREE.Vector3().copy(this.targetPosition);
        const currentVelocity = new THREE.Vector3().copy(this.spacecraft.objects.boxBody.velocity);

        const positionError = new THREE.Vector3().subVectors(targetPosition, currentPosition);
        const distanceToTarget = positionError.length();

        // Compute safe max speed: v = sqrt(2*a*d)
        // We'll use maxForce for braking in any direction. 
        const maxDeceleration = this.config.limits.maxForce / this.spacecraftMass;
        const safeMaxSpeed = Math.sqrt(2 * maxDeceleration * distanceToTarget);

        // If current speed is already above safeMaxSpeed, optionally we can clamp it.
        // (One approach is to reduce velocity directly; or you can feed that into your PID
        // as a big negative velocity error. For simplicity, we'll do direct velocity clamp.)
        const speed = currentVelocity.length();
        if (speed > safeMaxSpeed && speed > 1e-8) {
            // Scale velocity down so we won't keep accelerating forward
            const ratio = safeMaxSpeed / speed;
            currentVelocity.multiplyScalar(ratio);

            // Write it back to the physics body if you want immediate clamp,
            // or just keep it local in the autopilot math. Up to you:
            this.spacecraft.objects.boxBody.velocity.set(
                currentVelocity.x,
                currentVelocity.y,
                currentVelocity.z
            );
        }

        // Now do position PID
        const pidOut = this.linearPidController.update(
            new CANNON.Vec3(positionError.x, positionError.y, positionError.z),
            dt
        );
        let force = new THREE.Vector3(pidOut.x, pidOut.y, pidOut.z)
            .multiplyScalar(this.spacecraftMass);

        // Add damping force (helps slow you down)
        const dampingForce = currentVelocity
            .clone()
            .multiplyScalar(-this.config.damping.factor * this.spacecraftMass);
        force.add(dampingForce);

        // Then also do a final clamp to keep from over-forcing
        // maxVelocity here is an older approach; we can keep it for extra safety:
        const maxVelocity = Math.sqrt(
            (2 * this.thrust * distanceToTarget) / this.spacecraftMass
        );
        const maxForce = (maxVelocity * this.spacecraftMass) / dt;

        if (force.length() > maxForce) {
            force.normalize().multiplyScalar(maxForce);
        }
        if (force.length() > this.config.limits.maxForce) {
            force.normalize().multiplyScalar(this.config.limits.maxForce);
        }

        // Convert to local space and apply old 24-thruster logic
        const localForce = this.spacecraft.objects.boxBody.quaternion
            .inverse()
            .vmult(new CANNON.Vec3(force.x, force.y, force.z));

        return this.applyTranslationalForcesToThrusterGroups(localForce);
    }

    calculateLinearMotionCancelationForces(dt) {
        const body = this.spacecraft.objects.boxBody;
        const worldVelocity = body.velocity.clone();
        const localVelocity = body.quaternion.inverse().vmult(worldVelocity);

        const velocityError = localVelocity.clone().negate();
        const pidOut = this.linearPidController.update(velocityError, dt);

        const localForce = new CANNON.Vec3(
            pidOut.x * this.spacecraftMass,
            pidOut.y * this.spacecraftMass,
            pidOut.z * this.spacecraftMass
        );

        const dampingForce = localVelocity.clone()
            .scale(-this.config.damping.factor * this.spacecraftMass);
        localForce.vadd(dampingForce, localForce);

        if (localForce.length() > this.config.limits.maxForce) {
            localForce.scale(this.config.limits.maxForce / localForce.length());
        }

        return this.applyTranslationalForcesToThrusterGroups(localForce);
    }

    applyTranslationalForcesToThrusterGroups(localForce) {
        const forces = Array(24).fill(0);
        const axes = [
            { axis: 'z', groups: this.thrusterGroups.forward, positive: true },
            { axis: 'y', groups: this.thrusterGroups.up, positive: true },
            { axis: 'x', groups: this.thrusterGroups.left, positive: false },
        ];

        axes.forEach(({ axis, groups, positive }) => {
            const val = localForce[axis];
            if (Math.abs(val) > this.config.limits.epsilon) {
                const thrusterGroup =
                    val * (positive ? 1 : -1) > 0 ? groups[0] : groups[1];
                const thrusterForce = Math.min(Math.abs(val) / 4, this.thrust);
                thrusterGroup.forEach((index) => {
                    forces[index] = thrusterForce;
                });
            }
        });
        return forces;
    }

    /************************************************
     * Rotation (Classic)
     ************************************************/
    applyDamping(currentAngularMomentum, currentQuaternion, fullDamp, dt) {
        const dampingFactor = fullDamp ? 1.0 : 0.1;
        const angularMomentumError = currentAngularMomentum.clone().negate().multiplyScalar(dampingFactor);

        const pidOut = this.pidController.update(
            new CANNON.Vec3(
                angularMomentumError.x,
                angularMomentumError.y,
                angularMomentumError.z
            ),
            dt
        );
        let pidVector = new THREE.Vector3(pidOut.x, pidOut.y, pidOut.z);
        pidVector = this.transformLocalToGlobal(pidVector, currentQuaternion);

        return this.applyPIDOutputToThrusters(pidVector);
    }

    adjustAngularVelocityForOrientation(
        errorQuaternion,
        currentAngularMomentum,
        currentQuaternion,
        momentOfInertia,
        dt
    ) {
        const controlSignal = this.calculateControlSignal(errorQuaternion, 0.2);
        let desiredAngVel = this.quaternionToAngularVelocity(errorQuaternion, true);
        desiredAngVel.multiplyScalar(controlSignal);

        const desiredAngularMomentum = desiredAngVel.multiplyScalar(momentOfInertia);
        const angularMomentumError = desiredAngularMomentum.sub(currentAngularMomentum);

        const pidOut = this.orientationPidController.update(
            new CANNON.Vec3(
                angularMomentumError.x,
                angularMomentumError.y,
                angularMomentumError.z
            ),
            dt
        );
        let pidVector = new THREE.Vector3(pidOut.x, pidOut.y, pidOut.z);
        pidVector = this.transformLocalToGlobal(pidVector, currentQuaternion);

        return this.applyPIDOutputToThrusters(pidVector);
    }

    applyPIDOutputToThrusters(pidOutput) {
        const thrusterForces = Array(24).fill(0);

        const pitchForce = this.calculateForcePerThruster(pidOutput.x, 'pitch');
        const yawForce = this.calculateForcePerThruster(pidOutput.y, 'yaw');
        const rollForce = this.calculateForcePerThruster(pidOutput.z, 'roll');

        // If pidOutput.x >= 0 => thrusterGroups.pitch[1], else thrusterGroups.pitch[0], etc.
        this.applyForceToGroup(
            this.thrusterGroups.pitch[pidOutput.x >= 0 ? 1 : 0],
            pitchForce,
            thrusterForces
        );
        this.applyForceToGroup(
            this.thrusterGroups.yaw[pidOutput.y >= 0 ? 0 : 1],
            yawForce,
            thrusterForces
        );
        this.applyForceToGroup(
            this.thrusterGroups.roll[pidOutput.z >= 0 ? 0 : 1],
            rollForce,
            thrusterForces
        );

        return thrusterForces;
    }

    calculateForcePerThruster(torqueComponent, controlAxis) {
        const numThrusters =
            this.thrusterGroups[controlAxis][0].length +
            this.thrusterGroups[controlAxis][1].length;
        return (Math.abs(torqueComponent) * this.thrust) / numThrusters;
    }

    applyForceToGroup(thrusterGroup, forcePerThruster, thrusterForces) {
        thrusterGroup.forEach((index) => {
            thrusterForces[index] += Math.min(forcePerThruster, this.thrust);
        });
    }

    computeCancelRotationTorque(params, dt) {
        const body = this.spacecraft.objects.boxBody;
        const angVel = new THREE.Vector3().copy(body.angularVelocity);
        const I = params.momentOfInertia;
        const currentAngMom = angVel.multiplyScalar(I);
        const errorMom = currentAngMom.clone().multiplyScalar(-1);

        const pidOut = this.orientationPidController.update(
            new CANNON.Vec3(errorMom.x, errorMom.y, errorMom.z),
            dt
        );
        let torque = new THREE.Vector3(pidOut.x, pidOut.y, pidOut.z);

        if (torque.length() > this.config.limits.maxForce) {
            torque.normalize().multiplyScalar(this.config.limits.maxForce);
        }
        return torque;
    }

    computeOrientationTorque(params, dt) {
        // Align to targetOrientation
        const body = this.spacecraft.objects.boxBody;
        const errorQ = params.errorQuaternion;

        const controlSignal = this.calculateControlSignal(errorQ, 0.2);
        let desiredAngVel = this.quaternionToAngularVelocity(errorQ, true);
        desiredAngVel.multiplyScalar(controlSignal);

        const I = params.momentOfInertia;
        const desiredAngMom = desiredAngVel.multiplyScalar(I);

        const currentAngVel = new THREE.Vector3().copy(body.angularVelocity);
        const currentAngMom = currentAngVel.multiplyScalar(I);
        const angMomError = desiredAngMom.sub(currentAngMom);

        const pidOut = this.orientationPidController.update(
            new CANNON.Vec3(angMomError.x, angMomError.y, angMomError.z),
            dt
        );

        let torque = new THREE.Vector3(pidOut.x, pidOut.y, pidOut.z);
        if (torque.length() > this.config.limits.maxForce) {
            torque.normalize().multiplyScalar(this.config.limits.maxForce);
        }
        return torque;
    }

    computeTranslationForce(dt) {
        const body = this.spacecraft.objects.boxBody;
        const currentPos = new THREE.Vector3().copy(body.position);
        const currentVel = new THREE.Vector3().copy(body.velocity);
        const error = new THREE.Vector3().subVectors(this.targetPosition, currentPos);

        const pidOut = this.linearPidController.update(
            new CANNON.Vec3(error.x, error.y, error.z),
            dt
        );
        const force = new THREE.Vector3(pidOut.x, pidOut.y, pidOut.z)
            .multiplyScalar(this.spacecraftMass);

        // damping
        const dampingForce = currentVel
            .clone()
            .multiplyScalar(-this.config.damping.factor * this.spacecraftMass);
        force.add(dampingForce);

        // Also clamp to maxForce if needed
        if (force.length() > this.config.limits.maxForce) {
            force.normalize().multiplyScalar(this.config.limits.maxForce);
        }
        return force;
    }

    /************************************************
     * Utility
     ************************************************/

    /**
     * Calculate orientation so that local +Z (by default) looks at this.targetPosition,
     * then optionally apply a desired roll.
     */
    calculateOrientationToTargetPosition(position, desiredRoll = 0) {
        // Bail out if there's no real difference
        const dir = new THREE.Vector3().subVectors(this.targetPosition, position);
        if (dir.lengthSq() < 1e-8) return;

        // 1) Create a temporary object
        const tmpObj = new THREE.Object3D();
        tmpObj.position.copy(position);

        // 2) local +Z looks at target:
        tmpObj.lookAt(this.targetPosition);

        // 3) Convert to Euler, then set desired roll
        const eul = new THREE.Euler().setFromQuaternion(tmpObj.quaternion, 'YXZ');
        // eul.x => pitch, eul.y => yaw, eul.z => roll (in 'YXZ' mode)
        eul.z = desiredRoll;
        tmpObj.quaternion.setFromEuler(eul);

        // 4) Copy final orientation
        this.targetOrientation.copy(tmpObj.quaternion);
    }

    calculateAutopilotParameters() {
        const body = this.spacecraft.objects.boxBody;

        const currentQuaternion = new THREE.Quaternion()
            .copy(body.quaternion)
            .normalize();
        const targetQuaternion = this.targetOrientation.clone().normalize();
        const errorQuaternion = targetQuaternion
            .multiply(currentQuaternion.invert())
            .normalize();

        const currentAngularVelocity = new THREE.Vector3().copy(body.angularVelocity);
        const momentOfInertia = this.calculateMomentOfInertia();
        const currentAngularMomentum = currentAngularVelocity.clone().multiplyScalar(momentOfInertia);

        return {
            currentQuaternion,
            targetQuaternion,
            errorQuaternion,
            orientationError: 2 * Math.acos(Math.min(1, Math.abs(errorQuaternion.w))),
            currentAngularVelocity,
            momentOfInertia,
            currentAngularMomentum,
            currentAngularMomentumMagnitude: currentAngularMomentum.length(),
        };
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

    /**
     * We clamp orientationError to e.g. 0.2 to reduce overshoot
     */
    calculateControlSignal(errorQuaternion, maxControlSignal = 0.2) {
        let orientationError = 2 * Math.acos(Math.abs(errorQuaternion.w));
        orientationError /= Math.PI; // normalized 0..1 across 0..180°
        return Math.min(orientationError, maxControlSignal);
    }

    quaternionToAngularVelocity(quaternion, ensureShortestPath = false) {
        let angle = 2 * Math.acos(quaternion.w);
        let sinHalfAngle = Math.sqrt(1 - quaternion.w * quaternion.w);
        const axis = new THREE.Vector3(quaternion.x, quaternion.y, quaternion.z);

        if (sinHalfAngle > 0.01) {
            axis.normalize().multiplyScalar(angle / sinHalfAngle);
        } else {
            axis.set(0, 0, 0);
        }

        // Ensure we rotate the "short way around" if asked
        if (ensureShortestPath && angle > Math.PI) {
            angle = 2 * Math.PI - angle;
            axis.negate();
        }
        if (ensureShortestPath && sinHalfAngle > 0.001) {
            axis.multiplyScalar(angle / sinHalfAngle);
        }
        return axis;
    }

    transformLocalToGlobal(localVector, currentQuaternion) {
        const globalVector = localVector.clone();
        globalVector.applyQuaternion(currentQuaternion);
        return globalVector;
    }

    mergeForces(a, b) {
        return a.map((val, i) => val + b[i]);
    }

    // Add method to set target object
    setTargetObject(spacecraft, point = 'center') {
        this.targetObject = spacecraft;
        this.targetPoint = point;

        // Update target position immediately
        this.updateTargetFromObject();
    }

    // Add method to clear target object
    clearTargetObject() {
        this.targetObject = null;
        this.targetPoint = 'center';
    }

    // Add method to update target position from object
    updateTargetFromObject() {
        if (!this.targetObject) return;

        if (this.targetPoint === 'center') {
            // Use center of mass (position of the physics body)
            this.targetPosition.copy(this.targetObject.objects.boxBody.position);
        } else if (this.targetPoint === 'front' || this.targetPoint === 'back') {
            // Fallback to center if getDockingPortWorldPosition isn't available
            if (typeof this.targetObject.getDockingPortWorldPosition !== 'function') {
                console.warn('getDockingPortWorldPosition not available, falling back to center');
                this.targetPosition.copy(this.targetObject.objects.boxBody.position);
                return;
            }
            
            // Use the specified docking port position
            const portPosition = this.targetObject.getDockingPortWorldPosition(this.targetPoint);
            if (portPosition) {
                this.targetPosition.copy(portPosition);
            } else {
                // Fallback to center if port not found
                this.targetPosition.copy(this.targetObject.objects.boxBody.position);
            }
        }
    }
}
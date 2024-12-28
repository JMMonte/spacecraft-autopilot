import * as CANNON from 'cannon-es';

export class PIDController {
    constructor(kp, ki, kd) {
        this.kp = kp;
        this.ki = ki;
        this.kd = kd;
        this.integral = new CANNON.Vec3();
        this.previousError = new CANNON.Vec3();
        this.tempErrorVector = new CANNON.Vec3();
        this.derivative = new CANNON.Vec3();
        this.output = new CANNON.Vec3();
        this.errorHistory = [];
        this.maxHistoryLength = 1000;
        this.adaptiveTuningEnabled = true;
        this.maxIntegral = 1.0;  // Default value
        this.derivativeAlpha = 0.9;  // Default value
    }

    update(currentError, deltaTime) {
        // currentError is a CANNON.Vec3 (e.g. position error or angular momentum error)
        this.tempErrorVector.set(currentError.x, currentError.y, currentError.z);

        // Integral accumulation
        this.integral.vadd(this.tempErrorVector.scale(deltaTime), this.integral);

        // Derivative = (error - previousError) / dt
        this.derivative
            .copy(this.tempErrorVector)
            .vsub(this.previousError)
            .scale(1 / deltaTime);

        // Store current error as previous
        this.previousError.copy(this.tempErrorVector);

        // Output = Kp * error + Ki * integral + Kd * derivative
        this.output
            .copy(this.tempErrorVector)
            .scale(this.kp)
            .vadd(this.integral.scale(this.ki))
            .vadd(this.derivative.scale(this.kd));

        if (this.adaptiveTuningEnabled) {
            this.updatePIDParameters(currentError.length());
        }

        return this.output; // CANNON.Vec3
    }

    reset() {
        this.integral.set(0, 0, 0);
        this.previousError.set(0, 0, 0);
        this.errorHistory = [];
    }

    updatePIDParameters(currentErrorMagnitude) {
        this.errorHistory.push(currentErrorMagnitude);

        if (this.errorHistory.length > this.maxHistoryLength) {
            this.errorHistory.shift(); // keep array at fixed length
        }

        // Wait until we have enough data
        if (this.errorHistory.length < this.maxHistoryLength) {
            return;
        }

        // Compute average error
        const averageError =
            this.errorHistory.reduce((acc, err) => acc + err, 0) /
            this.errorHistory.length;

        // Simple heuristic-based tuning
        if (averageError > 0.1) {
            // Error is "too big," gently raise PID gains
            this.kp *= 1.05;
            this.ki *= 1.05;
            this.kd *= 1.05;
        } else if (averageError < 0.01) {
            // Error is "very small," gently lower PID gains
            this.kp *= 0.95;
            this.ki *= 0.95;
            this.kd *= 0.95;
        }
    }
}
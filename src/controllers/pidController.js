import * as CANNON from 'cannon';

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
    }

    update(currentError, deltaTime) {
        this.tempErrorVector.set(currentError.x, currentError.y, currentError.z);
        this.integral.vadd(this.tempErrorVector.scale(deltaTime), this.integral);
        this.derivative.copy(this.tempErrorVector).vsub(this.previousError).scale(1 / deltaTime);
        this.previousError.copy(this.tempErrorVector);
        this.output.copy(this.tempErrorVector).scale(this.kp)
            .vadd(this.integral.scale(this.ki))
            .vadd(this.derivative.scale(this.kd));

        if (this.adaptiveTuningEnabled) {
            this.updatePIDParameters(currentError.length());
        }

        return this.output;
    }

    reset() {
        this.integral.set(0, 0, 0);
        this.previousError.set(0, 0, 0);
        this.errorHistory = [];
    }

    updatePIDParameters(currentErrorMagnitude) {
        this.errorHistory.push(currentErrorMagnitude);

        if (this.errorHistory.length > this.maxHistoryLength) {
            this.errorHistory.shift(); // Maintain a fixed length of error history
        }

        if (this.errorHistory.length < this.maxHistoryLength) {
            return; // Not enough data to adjust PID parameters yet
        }

        const averageError = this.errorHistory.reduce((acc, err) => acc + err, 0) / this.errorHistory.length;
        
        // Simple heuristic-based adjustment
        if (averageError > 0.1) { // Error threshold for tuning
            this.kp *= 1.05; // Increase proportional gain
            this.ki *= 1.05; // Increase integral gain
            this.kd *= 1.05; // Increase derivative gain
        } else if (averageError < 0.01) { // Another error threshold
            this.kp *= 0.95; // Decrease proportional gain
            this.ki *= 0.95; // Decrease integral gain
            this.kd *= 0.95; // Decrease derivative gain
        }
    }
}
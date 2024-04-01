import * as CANNON from 'cannon';

export class PIDController {
    constructor(kp, ki, kd) {
        this.kp = kp;
        this.ki = ki;
        this.kd = kd;
        this.integral = new CANNON.Vec3();
        this.previousError = new CANNON.Vec3();
        // Temp variables to reduce allocations
        this.tempErrorVector = new CANNON.Vec3();
        this.derivative = new CANNON.Vec3();
        this.output = new CANNON.Vec3();
    }

    // Update the PID controller based on the current error and time interval
    update(currentError, deltaTime) {
        // Set the temporary error vector based on the current error
        this.tempErrorVector.set(currentError.x, currentError.y, currentError.z);

        // Update the integral term by adding the scaled error vector
        this.integral.vadd(this.tempErrorVector.scale(deltaTime), this.integral);

        // Calculate the derivative term by subtracting the previous error from the current error and scaling it by the inverse of the time interval
        this.derivative.copy(this.tempErrorVector).vsub(this.previousError).scale(1 / deltaTime);

        // Update the previous error with the current error
        this.previousError.copy(this.tempErrorVector);

        // Calculate the output by scaling the error vector by the proportional gain (kp), adding the integral term scaled by the integral gain (ki), and adding the derivative term scaled by the derivative gain (kd)
        this.output.copy(this.tempErrorVector).scale(this.kp)
            .vadd(this.integral.scale(this.ki))
            .vadd(this.derivative.scale(this.kd));

        // Return the calculated output
        return this.output;
    }
    reset() {
        this.integral.set(0, 0, 0);
        this.previousError.set(0, 0, 0);
    }
}


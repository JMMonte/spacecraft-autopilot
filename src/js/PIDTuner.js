export class PIDTuner {
    constructor(pidController, updateInterval, spacecraft) {
        this.pidController = pidController;
        this.updateInterval = updateInterval;
        this.criticalGain = null;
        this.criticalPeriod = null;
        this.oscillationDetected = false;
        this.lastError = 0;
        this.oscillationStartTime = null;
        this.targetOrientation = null;
        this.spacecraft = spacecraft;
    }

    tuneController() {
        this.pidController.setKi(0);
        this.pidController.setKd(0);
        this.pidController.setKp(0.1); // Start with a small Kp
    
        const tuningLoop = setInterval(() => {
            // Calculate the current error
            const currentOrientation = this.spacecraft.objects.boxBody.quaternion;
            const targetOrientation = this.targetOrientation;
            const orientationError = new CANNON.Quaternion().copy(targetOrientation)
                .inverse()
                .multiply(currentOrientation);
    
            const orientationErrorVector = new CANNON.Vec3(
                orientationError.x,
                orientationError.y,
                orientationError.z
            );
    
            const output = this.pidController.update(orientationErrorVector, this.updateInterval);
    
            // Apply the output to the system
            const thrusterForces = this.calculateAutopilotForces(output);
            this.applyForcesToThrusters(thrusterForces);
    
            // Check for oscillations
            if (!this.oscillationDetected && orientationErrorVector.lengthSquared() > 0.001) {
                if (orientationErrorVector.dot(this.lastError) < 0) {
                    this.oscillationDetected = true;
                    this.oscillationStartTime = Date.now();
                }
            } else if (this.oscillationDetected) {
                const now = Date.now();
                const elapsedTime = now - this.oscillationStartTime;
                if (elapsedTime > 5 * this.criticalPeriod) {
                    // Oscillations have stabilized, stop tuning
                    clearInterval(tuningLoop);
                    this.calculateAndUpdatePIDGains();
                }
            }
    
            this.lastError = orientationErrorVector;
    
            if (!this.criticalGain && this.oscillationDetected) {
                this.criticalGain = this.pidController.getKp();
                this.oscillationStartTime = Date.now();
            } else if (this.criticalGain && !this.criticalPeriod && this.oscillationDetected) {
                const elapsedTime = Date.now() - this.oscillationStartTime;
                if (elapsedTime > 5 * this.updateInterval) {
                    this.criticalPeriod = elapsedTime / 5;
                    this.pidController.setKp(this.criticalGain * 1.2); // Increase Kp to maintain oscillations
                }
            }
        }, this.updateInterval);
    }

    calculateAndUpdatePIDGains() {
        const Kp = 0.6 * this.criticalGain;
        const Ki = 2 * Kp / this.criticalPeriod;
        const Kd = Kp * this.criticalPeriod / 8;

        this.pidController.setKp(Kp);
        this.pidController.setKi(Ki);
        this.pidController.setKd(Kd);
    }
}
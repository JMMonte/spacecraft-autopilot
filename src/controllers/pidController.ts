import * as CANNON from 'cannon-es';

export class PIDController {
    private kp: number;
    private ki: number;
    private kd: number;
    private maxIntegral: number;
    private derivativeAlpha: number;
    private integral: CANNON.Vec3;
    private lastError: CANNON.Vec3;
    private lastDerivative: CANNON.Vec3;
    private tempErrorVector: CANNON.Vec3;
    private output: CANNON.Vec3;
    private calibrationData: {
        samples: { error: number; time: number }[];
        startTime: number;
        isCalibrating: boolean;
        type: 'linearMomentum' | 'position' | 'angularMomentum';
    };

    constructor(
        kp: number, 
        ki: number, 
        kd: number, 
        type: 'linearMomentum' | 'position' | 'angularMomentum' = 'position'
    ) {
        this.kp = kp;
        this.ki = ki;
        this.kd = kd;
        this.maxIntegral = 1.0;
        this.derivativeAlpha = 0.9;
        this.integral = new CANNON.Vec3();
        this.lastError = new CANNON.Vec3();
        this.lastDerivative = new CANNON.Vec3();
        this.tempErrorVector = new CANNON.Vec3();
        this.output = new CANNON.Vec3();
        this.calibrationData = {
            samples: [],
            startTime: 0,
            isCalibrating: false,
            type
        };
    }

    public setMaxIntegral(maxIntegral: number): void {
        this.maxIntegral = maxIntegral;
    }

    public setDerivativeAlpha(alpha: number): void {
        this.derivativeAlpha = alpha;
    }

    public async autoCalibrate(): Promise<void> {
        this.calibrationData.isCalibrating = true;
        this.calibrationData.samples = [];
        this.calibrationData.startTime = Date.now();

        try {
            // Reset gains and accumulators
            this.integral = new CANNON.Vec3();
            this.lastError = new CANNON.Vec3();
            this.lastDerivative = new CANNON.Vec3();

            // Start with zero gains
            this.kp = 0;
            this.ki = 0;
            this.kd = 0;

            // Wait for initial error samples
            await new Promise(resolve => setTimeout(resolve, 500));

            // Set initial gains based on type
            switch (this.calibrationData.type) {
                case 'linearMomentum':
                    this.kp = 0.5;  // Start conservative
                    this.kd = 0.1;  // Small derivative for damping
                    this.ki = 0.01; // Minimal integral
                    this.setMaxIntegral(0.5);
                    this.setDerivativeAlpha(0.8);
                    break;

                case 'position':
                    this.kp = 0.05; // Very conservative
                    this.kd = 0.1;  // More derivative for smooth approach
                    this.ki = 0.001; // Minimal integral
                    this.setMaxIntegral(0.1);
                    this.setDerivativeAlpha(0.95);
                    break;

                case 'angularMomentum':
                    this.kp = 0.2;  // Moderate start
                    this.kd = 0.05; // Small derivative
                    this.ki = 0.02; // Small integral
                    this.setMaxIntegral(0.3);
                    this.setDerivativeAlpha(0.9);
                    break;
            }

            // Let the system stabilize with new gains
            await new Promise(resolve => setTimeout(resolve, 1000));

            this.calibrationData.samples = [];
            this.calibrationData.isCalibrating = false;
        } catch (error) {
            this.calibrationData.isCalibrating = false;
            throw error;
        }
    }

    /**
     * Updates the PID controller with new error values and calculates the control output
     * @param error The current error vector
     * @param dt Time step in seconds
     * @returns Control output vector
     */
    public update(error: CANNON.Vec3, dt: number): CANNON.Vec3 {
        // If calibrating, collect samples
        if (this.calibrationData.isCalibrating) {
            this.calibrationData.samples.push({
                error: error.length(),
                time: (Date.now() - this.calibrationData.startTime) / 1000
            });

            // Keep only the last 100 samples
            if (this.calibrationData.samples.length > 100) {
                this.calibrationData.samples.shift();
            }
        }

        // Store error in temp vector
        this.tempErrorVector.copy(error);

        // Proportional term
        const p = error.clone().scale(this.kp);

        // Integral term
        this.integral.vadd(error.clone().scale(dt), this.integral);
        if (this.integral.length() > this.maxIntegral) {
            this.integral.normalize();
            this.integral.scale(this.maxIntegral);
        }
        const i = this.integral.clone().scale(this.ki);

        // Derivative term (with filtering)
        const errorDiff = error.clone().vsub(this.lastError);
        const currentDerivative = errorDiff.scale(1 / dt);
        this.lastDerivative.scale(this.derivativeAlpha)
            .vadd(currentDerivative.scale(1 - this.derivativeAlpha), this.lastDerivative);
        const d = this.lastDerivative.clone().scale(this.kd);

        // Update last error
        this.lastError.copy(error);

        // Combine terms
        this.output.copy(p);
        this.output.vadd(i, this.output);
        this.output.vadd(d, this.output);

        return this.output;
    }

    public getGain(key: 'Kp' | 'Ki' | 'Kd'): number {
        switch (key) {
            case 'Kp': return this.kp;
            case 'Ki': return this.ki;
            case 'Kd': return this.kd;
        }
    }

    public setGain(key: 'Kp' | 'Ki' | 'Kd', value: number): void {
        switch (key) {
            case 'Kp': this.kp = value; break;
            case 'Ki': this.ki = value; break;
            case 'Kd': this.kd = value; break;
        }
    }
} 
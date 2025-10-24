import * as THREE from 'three';

export class PIDController {
    private kp: number;
    private ki: number;
    private kd: number;
    private maxIntegral: number;
    private derivativeAlpha: number;
    private integral: THREE.Vector3;
    private lastError: THREE.Vector3;
    private lastDerivative: THREE.Vector3;
    private output: THREE.Vector3;
    // Scratch vectors to avoid per-update allocations
    private pTerm: THREE.Vector3;
    private iTerm: THREE.Vector3;
    private dTerm: THREE.Vector3;
    private errorDiff: THREE.Vector3;
    private currentDerivative: THREE.Vector3;
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
        this.integral = new THREE.Vector3();
        this.lastError = new THREE.Vector3();
        this.lastDerivative = new THREE.Vector3();
        this.output = new THREE.Vector3();
        this.pTerm = new THREE.Vector3();
        this.iTerm = new THREE.Vector3();
        this.dTerm = new THREE.Vector3();
        this.errorDiff = new THREE.Vector3();
        this.currentDerivative = new THREE.Vector3();
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

    public async autoCalibrate(durationMs: number = 1200): Promise<void> {
        this.calibrationData.isCalibrating = true;
        this.calibrationData.samples = [];
        this.calibrationData.startTime = Date.now();

        try {
            // Reset accumulators but keep current gains active during calibration
            this.integral.set(0, 0, 0);
            this.lastError.set(0, 0, 0);
            this.lastDerivative.set(0, 0, 0);

            // Set baseline gains based on type
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

            // Collect samples for a short window while simulation runs updates
            await new Promise<void>((resolve) => setTimeout(resolve, Math.max(200, durationMs)));

            // Future: compute gains from samples here
        } finally {
            this.calibrationData.isCalibrating = false;
        }
    }

    /**
     * Updates the PID controller with new error values and calculates the control output
     * @param error The current error vector
     * @param dt Time step in seconds
     * @returns Control output vector
     */
    public update(error: THREE.Vector3, dt: number): THREE.Vector3 {
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

        // Proportional term
        this.pTerm.copy(error).multiplyScalar(this.kp);

        // Integral term
        this.integral.addScaledVector(error, dt);
        if (this.integral.length() > this.maxIntegral) {
            this.integral.normalize();
            this.integral.multiplyScalar(this.maxIntegral);
        }
        this.iTerm.copy(this.integral).multiplyScalar(this.ki);

        // Derivative term (with filtering)
        this.errorDiff.subVectors(error, this.lastError);
        this.currentDerivative.copy(this.errorDiff).multiplyScalar(1 / dt);
        this.lastDerivative.multiplyScalar(this.derivativeAlpha)
            .addScaledVector(this.currentDerivative, 1 - this.derivativeAlpha);
        this.dTerm.copy(this.lastDerivative).multiplyScalar(this.kd);

        // Update last error
        this.lastError.copy(error);

        // Combine terms
        this.output.copy(this.pTerm).add(this.iTerm).add(this.dTerm);

        return this.output;
    }

    public isCalibrating(): boolean { return this.calibrationData.isCalibrating; }
    public getCalibrationSamples(): { error: number; time: number }[] { return this.calibrationData.samples.slice(); }
    public getCalibrationType(): 'linearMomentum' | 'position' | 'angularMomentum' { return this.calibrationData.type; }

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

    // --- Auto-tune helpers (PID-side gain mapping) ---------------------------
    private clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

    /**
     * Set gains from a measured time constant tau using controller-specific rules.
     * The mapping mirrors the profile used in Autopilot's active tuning.
     */
    public tuneFromTau(domain: 'attitude' | 'rotCancel' | 'position' | 'linMomentum', tau: number): void {
        const t = Math.max(1e-6, tau);
        if (domain === 'attitude') {
            const kp = this.clamp(0.15 / t, 0.05, 0.6);
            const kd = this.clamp(0.08 * t, 0.02, 0.25);
            const ki = 0.0;
            this.setGain('Kp', kp); this.setGain('Kd', kd); this.setGain('Ki', ki);
            return;
        }
        if (domain === 'rotCancel') {
            const kp = this.clamp(0.35 / t, 0.05, 1.2);
            const kd = this.clamp(0.12 * t, 0.02, 0.35);
            const ki = 0.0;
            this.setGain('Kp', kp); this.setGain('Kd', kd); this.setGain('Ki', ki);
            return;
        }
        if (domain === 'position') {
            const kp = this.clamp(0.8 / t, 0.05, 4.0);
            const kd = this.clamp(0.35 * t, 0.02, 2.5);
            const ki = 0.0005; // gentle integral
            this.setGain('Kp', kp); this.setGain('Kd', kd); this.setGain('Ki', ki);
            return;
        }
        if (domain === 'linMomentum') {
            const kp = this.clamp(1.1 / t, 0.3, 6.0);
            const kd = this.clamp(0.22 * t, 0.02, 2.0);
            const ki = 0.0;
            this.setGain('Kp', kp); this.setGain('Kd', kd); this.setGain('Ki', ki);
            return;
        }
    }
}

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

    constructor(kp: number, ki: number, kd: number) {
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
    }

    public setMaxIntegral(maxIntegral: number): void {
        this.maxIntegral = maxIntegral;
    }

    public setDerivativeAlpha(alpha: number): void {
        this.derivativeAlpha = alpha;
    }

    public update(error: CANNON.Vec3, dt: number, currentValue: CANNON.Vec3 = new CANNON.Vec3()): CANNON.Vec3 {
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

        // Derivative term (with exponential smoothing)
        const derivative = currentValue.clone().scale(-1);
        this.lastDerivative.lerp(derivative, 1 - this.derivativeAlpha, this.lastDerivative);
        const d = this.lastDerivative.clone().scale(this.kd);

        // Update last error
        this.lastError.copy(error);

        // Combine terms
        this.output.set(0, 0, 0);
        this.output.vadd(p, this.output);
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
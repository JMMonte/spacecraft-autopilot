/**
 * Thruster pulse-width modulation state machine.
 * Prevents visual flicker by enforcing minimum on/off pulse durations
 * and smoothing latched force values.
 */
export class ThrusterPWM {
    private thrusterOnLatch: boolean[] = new Array(24).fill(false);
    private thrusterLatchTimer: number[] = new Array(24).fill(0);
    private thrusterLatchedForce: number[] = new Array(24).fill(0);
    private minPulseOn: number = 0.03;   // seconds
    private minPulseOff: number = 0.03;  // seconds
    private activationThresholdFactor: number = 0.003;

    constructor(
        private thrust: number,
        private thrusterMax: number[],
    ) {}

    setThrust(value: number): void { this.thrust = value; }
    setThrusterMax(max: number[]): void { this.thrusterMax = max; }

    /**
     * Apply PWM state machine to desired forces.
     * Returns per-thruster visibility and applied (smoothed/latched) forces.
     */
    apply(desired: number[], dt: number): { visibility: boolean[]; applied: number[] } {
        const visibility = new Array(24).fill(false);
        const applied = new Array(24).fill(0);

        for (let i = 0; i < 24; i++) {
            const cap = this.thrusterMax[i] || this.thrust;
            const clamped = Math.min(Math.max(desired[i] || 0, 0), cap);

            this.thrusterLatchTimer[i] += dt;

            const stateOn = this.thrusterOnLatch[i];
            const threshOn = cap * this.activationThresholdFactor;
            const threshOff = threshOn * 0.5;
            const wantsOn = stateOn ? clamped >= threshOff : clamped >= threshOn;

            if (wantsOn !== stateOn) {
                const minTime = stateOn ? this.minPulseOn : this.minPulseOff;
                if (this.thrusterLatchTimer[i] >= minTime) {
                    this.thrusterOnLatch[i] = wantsOn;
                    this.thrusterLatchTimer[i] = 0;
                    this.thrusterLatchedForce[i] = wantsOn ? clamped : 0;
                }
            }

            if (this.thrusterOnLatch[i]) {
                const alpha = 0.8;
                this.thrusterLatchedForce[i] = this.thrusterLatchedForce[i] * alpha + clamped * (1 - alpha);
                const f = Math.max(0, Math.min(this.thrusterLatchedForce[i], cap));
                visibility[i] = true;
                applied[i] = f;
            }
        }

        return { visibility, applied };
    }

    reset(): void {
        this.thrusterOnLatch.fill(false);
        this.thrusterLatchTimer.fill(0);
        this.thrusterLatchedForce.fill(0);
    }
}

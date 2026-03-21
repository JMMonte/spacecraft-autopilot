export class ControlScheduler {
  private intervalSec: number;
  private accumulatorSec: number;

  constructor(rateHz = 30, randomizePhase = false) {
    const clamped = this.clampRate(rateHz);
    this.intervalSec = 1 / clamped;
    this.accumulatorSec = randomizePhase ? Math.random() * this.intervalSec : 0;
  }

  public setRateHz(rateHz: number): number {
    const clamped = this.clampRate(rateHz);
    this.intervalSec = 1 / clamped;
    this.accumulatorSec = Math.min(this.accumulatorSec, this.intervalSec);
    return clamped;
  }

  public getRateHz(): number {
    return 1 / this.intervalSec;
  }

  public reset(randomizePhase = false): void {
    this.accumulatorSec = randomizePhase ? Math.random() * this.intervalSec : 0;
  }

  public consume(dt: number): number | null {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.accumulatorSec += dt;
    if (this.accumulatorSec < this.intervalSec) return null;
    this.accumulatorSec %= this.intervalSec;
    return this.intervalSec;
  }

  private clampRate(rateHz: number): number {
    if (!Number.isFinite(rateHz) || rateHz <= 0) return 30;
    return Math.max(5, Math.min(120, rateHz));
  }
}

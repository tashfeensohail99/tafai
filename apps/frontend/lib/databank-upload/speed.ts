/**
 * Upload speed + time-left for the upload dock. Samples the running byte total
 * and keeps an exponentially-weighted average, so one fast or stalled second
 * doesn't swing the estimate ("6.2 MB/s · ~48 min").
 */
export class SpeedMeter {
  private lastAt: number | null = null;
  private lastBytes = 0;
  private rate = 0; // bytes per second (smoothed)
  private readonly halfLifeMs: number;

  /** @param halfLifeMs how fast old samples fade (default 10 s). (No TS
   *  parameter properties: node --test runs these files type-stripped.) */
  constructor(halfLifeMs = 10_000) {
    this.halfLifeMs = halfLifeMs;
  }

  /** Record the cumulative bytes sent so far at time `now` (ms). */
  sample(totalBytes: number, now: number): void {
    if (this.lastAt === null) {
      this.lastAt = now;
      this.lastBytes = totalBytes;
      return;
    }
    const dt = now - this.lastAt;
    if (dt < 250) return; // too close to measure
    // Bytes can go DOWN (a failed part's progress is discarded) — count that as 0.
    const instant = (Math.max(0, totalBytes - this.lastBytes) * 1000) / dt;
    const keep = 0.5 ** (dt / this.halfLifeMs);
    this.rate = this.rate === 0 ? instant : this.rate * keep + instant * (1 - keep);
    this.lastAt = now;
    this.lastBytes = totalBytes;
  }

  /** Smoothed bytes per second (0 until two samples). */
  get bytesPerSecond(): number {
    return this.rate;
  }

  /** Seconds left for `remainingBytes`, or null while the rate is unknown. */
  etaSeconds(remainingBytes: number): number | null {
    if (remainingBytes <= 0) return 0;
    if (this.rate < 1) return null;
    return Math.ceil(remainingBytes / this.rate);
  }

  reset(): void {
    this.lastAt = null;
    this.lastBytes = 0;
    this.rate = 0;
  }
}

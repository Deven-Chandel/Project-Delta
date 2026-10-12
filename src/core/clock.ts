/**
 * Simulation clock shared by every part of the app.
 *
 * The globe's day/night terminator and every Time Board clock
 * read the same `now()`, so scrubbing or speeding up time moves all of them
 * together. Time is stored as an anchor pair (sim time, real time) plus a rate,
 * which keeps `now()` cheap and drift-free.
 */
export type ClockListener = (clock: SimClock) => void;

export class SimClock {
  private anchorSim: number;
  private anchorReal: number;
  private _rate = 1;
  private _paused = false;
  private listeners = new Set<ClockListener>();

  constructor(private readonly realNow: () => number = () => Date.now()) {
    this.anchorReal = realNow();
    this.anchorSim = this.anchorReal;
  }

  /** Current simulated time in epoch milliseconds. */
  now(): number {
    if (this._paused) return this.anchorSim;
    return this.anchorSim + (this.realNow() - this.anchorReal) * this._rate;
  }

  get rate(): number {
    return this._rate;
  }

  get paused(): boolean {
    return this._paused;
  }

  /** True when the clock is showing real, current time at normal speed. */
  get live(): boolean {
    return !this._paused && this._rate === 1 && Math.abs(this.now() - this.realNow()) < 1500;
  }

  /** Offset of simulated time from real time, in milliseconds. */
  get offset(): number {
    return this.now() - this.realNow();
  }

  setRate(rate: number): void {
    this.reanchor();
    this._rate = rate;
    this.emit();
  }

  setPaused(paused: boolean): void {
    this.reanchor();
    this._paused = paused;
    this.emit();
  }

  set(time: number): void {
    this.anchorSim = time;
    this.anchorReal = this.realNow();
    this.emit();
  }

  shift(deltaMs: number): void {
    this.set(this.now() + deltaMs);
  }

  /** Return to live, real time. */
  reset(): void {
    this._rate = 1;
    this._paused = false;
    this.set(this.realNow());
  }

  subscribe(fn: ClockListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private reanchor(): void {
    this.anchorSim = this.now();
    this.anchorReal = this.realNow();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this);
  }
}

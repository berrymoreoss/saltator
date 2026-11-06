/** A wall clock and frame scheduler under a test's control (not exported from the editor). */
import type { SimClock } from './simulation';

export class FakeClock implements SimClock {
  time = 1000;
  /** Milliseconds each `now()` call takes: makes the kernel "slow" for frame-budget tests. */
  cost = 0;
  #frames: (() => void)[] = [];

  now = (): number => {
    const t = this.time;
    this.time += this.cost;
    return t;
  };

  requestFrame(callback: () => void): () => void {
    this.#frames.push(callback);
    return () => {
      this.#frames = this.#frames.filter((f) => f !== callback);
    };
  }

  /** Frame callbacks waiting. */
  get pending(): number {
    return this.#frames.length;
  }

  /** Lets `ms` of wall time pass, then runs the frame callbacks. */
  frame(ms: number): void {
    this.time += ms;
    const frames = this.#frames;
    this.#frames = [];
    for (const f of frames) f();
  }

  frames(count: number, ms = 16): void {
    for (let i = 0; i < count; i++) this.frame(ms);
  }
}

import { type Level, levelChar } from '../logic';
import type { Simulator } from '../simulator';
import type { Time } from '../time';

/** Every net change of a simulator, in order, from the moment it was attached. */
export class Trace {
  readonly times: number[] = [];
  readonly nets: number[] = [];
  readonly levels: Level[] = [];
  private readonly sim: Simulator;
  private readonly off: () => void;

  constructor(sim: Simulator) {
    this.sim = sim;
    this.off = sim.onNetChange((time, net, level) => {
      this.times.push(time);
      this.nets.push(net);
      this.levels.push(level);
    });
  }

  get length(): number {
    return this.times.length;
  }

  /** Stops recording. */
  stop(): void {
    this.off();
  }

  /** Changes of one net as `[time, level]` pairs. */
  of(net: string): [Time, Level][] {
    const index = this.sim.netIndex(net);
    const out: [Time, Level][] = [];
    for (let i = 0; i < this.times.length; i++) {
      if (this.nets[i] === index) out.push([this.times[i]!, this.levels[i]!]);
    }
    return out;
  }

  /** Human-readable lines `"<ps> <net>=<level>"`. */
  lines(): string[] {
    return this.times.map(
      (t, i) => `${t} ${this.sim.netId(this.nets[i]!)}=${levelChar(this.levels[i]!)}`,
    );
  }

  /** 32-bit FNV-1a hash of the whole trace; equal traces ⇒ equal hashes (determinism checks). */
  hash(): number {
    let h = 0x811c9dc5;
    const mix = (n: number) => {
      // Times can exceed 32 bits: hash the low and high halves separately.
      for (const word of [n % 0x1_0000_0000, Math.floor(n / 0x1_0000_0000)]) {
        for (let shift = 0; shift < 32; shift += 8) {
          h ^= (word >>> shift) & 0xff;
          h = Math.imul(h, 0x01000193);
        }
      }
    };
    for (let i = 0; i < this.times.length; i++) {
      mix(this.times[i]!);
      mix(this.nets[i]!);
      mix(this.levels[i]!);
    }
    return h >>> 0;
  }
}

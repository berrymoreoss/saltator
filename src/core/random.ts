/**
 * Deterministic pseudo-randomness for the kernel and parts: the same seed gives the same
 * numbers in every run, so simulations stay reproducible (no `Math.random`). Used for RAM's
 * random power-on contents. Not for anything that must be unpredictable.
 */

/** FNV-1a hash of a string as an unsigned 32-bit integer: a seed taken from a name (`U3`). */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32: a small, fast 32-bit generator, plenty for power-on garbage. */
export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** The next number, an unsigned 32-bit integer. */
  nextUint32(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Fills `bytes` with random bytes, four per number drawn. */
  fill(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i += 4) {
      let n = this.nextUint32();
      for (let k = i; k < Math.min(i + 4, bytes.length); k++) {
        bytes[k] = n & 0xff;
        n >>>= 8;
      }
    }
  }
}

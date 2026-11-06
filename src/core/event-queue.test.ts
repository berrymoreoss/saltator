import { describe, expect, it } from 'vitest';
import { EventQueue } from './event-queue';

/** Small deterministic PRNG (mulberry32) so the randomized test is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drain(q: EventQueue): [number, number][] {
  const out: [number, number][] = [];
  while (q.pop()) out.push([q.popped.time, q.popped.a]);
  return out;
}

describe('EventQueue', () => {
  it('starts empty', () => {
    const q = new EventQueue();
    expect(q.size).toBe(0);
    expect(q.pop()).toBe(false);
    expect(q.peekTime()).toBe(Number.POSITIVE_INFINITY);
    expect(q.peekSeq()).toBe(Number.POSITIVE_INFINITY);
  });

  it('orders by time, then FIFO for equal times', () => {
    const q = new EventQueue();
    q.push(30, 0, 1, 0);
    q.push(10, 0, 2, 0);
    q.push(20, 0, 3, 0);
    q.push(10, 0, 4, 0);
    q.push(10, 0, 5, 0);
    expect(q.peekTime()).toBe(10);
    expect(drain(q)).toEqual([
      [10, 2],
      [10, 4],
      [10, 5],
      [20, 3],
      [30, 1],
    ]);
  });

  it('returns increasing seqs and exposes the next one', () => {
    const q = new EventQueue();
    expect(q.nextSeq).toBe(0);
    expect(q.push(5, 0, 0, 0)).toBe(0);
    expect(q.push(1, 0, 0, 0)).toBe(1);
    expect(q.nextSeq).toBe(2);
    expect(q.peekSeq()).toBe(1);
  });

  it('carries the payload', () => {
    const q = new EventQueue();
    q.push(7, 3, -1, 123_456);
    expect(q.pop()).toBe(true);
    expect(q.popped).toEqual({ time: 7, seq: 0, kind: 3, a: -1, b: 123_456 });
  });

  it('grows past its initial capacity', () => {
    const q = new EventQueue();
    const n = 5000;
    for (let i = n - 1; i >= 0; i--) q.push(i, 0, i, 0);
    expect(q.size).toBe(n);
    const out = drain(q);
    expect(out.map(([t]) => t)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it('clear() drops events but keeps seqs unique', () => {
    const q = new EventQueue();
    q.push(1, 0, 0, 0);
    q.push(2, 0, 0, 0);
    q.clear();
    expect(q.size).toBe(0);
    expect(q.pop()).toBe(false);
    expect(q.push(3, 0, 9, 0)).toBe(2);
    expect(drain(q)).toEqual([[3, 9]]);
  });

  it('forEach visits every queued event with its payload', () => {
    const q = new EventQueue();
    q.push(5, 1, 10, 20);
    q.push(3, 0, 11, 21);
    q.push(9, 1, 12, 22);
    q.pop();
    const seen: string[] = [];
    q.forEach((time, seq, kind, a, b) => {
      seen.push(`${time}/${seq}/${kind}/${a}/${b}`);
    });
    expect(seen.sort()).toEqual(['5/0/1/10/20', '9/2/1/12/22']);
  });

  it('matches a sorted reference under random interleaved push/pop (seeded)', () => {
    const random = rng(12345);
    const q = new EventQueue();
    const reference: { time: number; seq: number; a: number }[] = [];
    let now = 0;
    for (let step = 0; step < 20_000; step++) {
      if (random() < 0.55 || reference.length === 0) {
        // Few distinct times → many ties, which exercises the seq tiebreak.
        const time = now + Math.floor(random() * 8);
        const a = step;
        const seq = q.push(time, 1, a, 0);
        reference.push({ time, seq, a });
      } else {
        reference.sort((x, y) => x.time - y.time || x.seq - y.seq);
        const expected = reference.shift()!;
        expect(q.pop()).toBe(true);
        expect([q.popped.time, q.popped.seq, q.popped.a]).toEqual([
          expected.time,
          expected.seq,
          expected.a,
        ]);
        now = expected.time;
      }
      expect(q.size).toBe(reference.length);
    }
  });
});

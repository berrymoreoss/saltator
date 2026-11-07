import type { Time } from './time';

/** The event most recently removed by {@link EventQueue.pop}; one object, reused. */
export interface PoppedEvent {
  time: Time;
  seq: number;
  kind: number;
  a: number;
  b: number;
}

const INITIAL_CAPACITY = 1024;

/** The queued events of an `EventQueue` in heap order, and its seq counter (`snapshot`). */
export interface QueueSnapshot {
  readonly times: Float64Array;
  readonly seqs: Float64Array;
  readonly kinds: Uint8Array;
  readonly as: Int32Array;
  readonly bs: Int32Array;
  readonly nextSeq: number;
}

/**
 * Min-priority queue of events ordered by `(time, seq)`, where `seq` is a global insertion
 * counter: same-time events come out in FIFO order, which makes the simulation deterministic.
 *
 * Allocation-free in steady state: events are records in typed arrays (struct of arrays), the
 * heap holds record ids, freed ids are recycled. Payload is three small integers (`kind`, `a`,
 * `b`) whose meaning belongs to the caller. Cancellation is lazy and also the caller's job:
 * remember the `seq` returned by `push` and ignore popped events whose `seq` is stale.
 */
export class EventQueue {
  /** Valid after `pop()` returned true. */
  readonly popped: PoppedEvent = { time: 0, seq: 0, kind: 0, a: 0, b: 0 };

  private times = new Float64Array(INITIAL_CAPACITY);
  private seqs = new Float64Array(INITIAL_CAPACITY);
  private kinds = new Uint8Array(INITIAL_CAPACITY);
  private as = new Int32Array(INITIAL_CAPACITY);
  private bs = new Int32Array(INITIAL_CAPACITY);
  private heap = new Int32Array(INITIAL_CAPACITY);
  private free = new Int32Array(INITIAL_CAPACITY);
  private freeCount = 0;
  private used = 0; // records ever handed out (high-water mark)
  private count = 0;
  private seqCounter = 0;

  /** Number of queued events (including ones the caller considers cancelled). */
  get size(): number {
    return this.count;
  }

  /** The `seq` the next `push` will get; events with a smaller `seq` were queued before now. */
  get nextSeq(): number {
    return this.seqCounter;
  }

  /** Time of the earliest event, or `Infinity` when empty. */
  peekTime(): Time {
    return this.count === 0 ? Number.POSITIVE_INFINITY : this.times[this.heap[0]!]!;
  }

  /** Seq of the earliest event, or `Infinity` when empty. */
  peekSeq(): number {
    return this.count === 0 ? Number.POSITIVE_INFINITY : this.seqs[this.heap[0]!]!;
  }

  /** Queues an event; returns its `seq` (unique, increasing). */
  push(time: Time, kind: number, a: number, b: number): number {
    const id = this.allocate();
    const seq = this.seqCounter++;
    this.times[id] = time;
    this.seqs[id] = seq;
    this.kinds[id] = kind;
    this.as[id] = a;
    this.bs[id] = b;
    this.siftUp(this.count++, id);
    return seq;
  }

  /** Removes the earliest event into `popped`. Returns false when empty. */
  pop(): boolean {
    if (this.count === 0) return false;
    const heap = this.heap;
    const id = heap[0]!;
    const out = this.popped;
    out.time = this.times[id]!;
    out.seq = this.seqs[id]!;
    out.kind = this.kinds[id]!;
    out.a = this.as[id]!;
    out.b = this.bs[id]!;
    this.free[this.freeCount++] = id;
    const last = heap[--this.count]!;
    if (this.count > 0) this.siftDown(0, last);
    return true;
  }

  /** Calls `visit` for every queued event, in no particular order (not for hot paths). */
  forEach(visit: (time: Time, seq: number, kind: number, a: number, b: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      const id = this.heap[i]!;
      visit(this.times[id]!, this.seqs[id]!, this.kinds[id]!, this.as[id]!, this.bs[id]!);
    }
  }

  /** A copy of the queued events (cancelled ones included) and the seq counter. */
  snapshot(): QueueSnapshot {
    const n = this.count;
    const times = new Float64Array(n);
    const seqs = new Float64Array(n);
    const kinds = new Uint8Array(n);
    const as = new Int32Array(n);
    const bs = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const id = this.heap[i]!;
      times[i] = this.times[id]!;
      seqs[i] = this.seqs[id]!;
      kinds[i] = this.kinds[id]!;
      as[i] = this.as[id]!;
      bs[i] = this.bs[id]!;
    }
    return { times, seqs, kinds, as, bs, nextSeq: this.seqCounter };
  }

  /**
   * Puts back the events and the seq counter of a snapshot (of this queue or another): the same
   * events come out in the same order, and new ones get the seqs they got after the snapshot.
   */
  restore(snapshot: QueueSnapshot): void {
    const n = snapshot.times.length;
    while (this.times.length < n) this.grow();
    // Record i at heap position i: the snapshot is in heap order, so the heap stays valid.
    this.times.set(snapshot.times);
    this.seqs.set(snapshot.seqs);
    this.kinds.set(snapshot.kinds);
    this.as.set(snapshot.as);
    this.bs.set(snapshot.bs);
    for (let i = 0; i < n; i++) this.heap[i] = i;
    this.count = n;
    this.used = n;
    this.freeCount = 0;
    this.seqCounter = snapshot.nextSeq;
  }

  /** Drops all events. The seq counter keeps counting (seqs stay unique for the queue's life). */
  clear(): void {
    this.count = 0;
    this.used = 0;
    this.freeCount = 0;
  }

  private allocate(): number {
    if (this.freeCount > 0) return this.free[--this.freeCount]!;
    if (this.used === this.times.length) this.grow();
    return this.used++;
  }

  private grow(): void {
    const capacity = this.times.length * 2;
    this.times = resize(this.times, new Float64Array(capacity));
    this.seqs = resize(this.seqs, new Float64Array(capacity));
    this.kinds = resize(this.kinds, new Uint8Array(capacity));
    this.as = resize(this.as, new Int32Array(capacity));
    this.bs = resize(this.bs, new Int32Array(capacity));
    this.heap = resize(this.heap, new Int32Array(capacity));
    this.free = resize(this.free, new Int32Array(capacity));
  }

  private less(x: number, y: number): boolean {
    const tx = this.times[x]!;
    const ty = this.times[y]!;
    return tx < ty || (tx === ty && this.seqs[x]! < this.seqs[y]!);
  }

  /** Places record `id` at heap position `pos` or above. */
  private siftUp(pos: number, id: number): void {
    const heap = this.heap;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      const parentId = heap[parent]!;
      if (!this.less(id, parentId)) break;
      heap[pos] = parentId;
      pos = parent;
    }
    heap[pos] = id;
  }

  /** Places record `id` at heap position `pos` or below. */
  private siftDown(pos: number, id: number): void {
    const heap = this.heap;
    const n = this.count;
    for (;;) {
      let child = 2 * pos + 1;
      if (child >= n) break;
      const right = child + 1;
      if (right < n && this.less(heap[right]!, heap[child]!)) child = right;
      const childId = heap[child]!;
      if (!this.less(childId, id)) break;
      heap[pos] = childId;
      pos = child;
    }
    heap[pos] = id;
  }
}

function resize<T extends Float64Array | Int32Array | Uint8Array>(from: T, to: T): T {
  to.set(from);
  return to;
}

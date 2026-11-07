/**
 * Recorder: the levels of chosen nets over simulated time, the data behind the waveform view
 * (R13) and, later, headless test benches (R15). Spec: docs/simulation.md#recorder.
 *
 * Channels are numbered by the recorder and point at nets only through `attach`, because nets
 * have no identity across compiles: after a carry-over the caller re-resolves what each channel
 * shows and attaches the new simulator, and the record goes on.
 */
import type { Level } from './logic';
import type { Simulator } from './simulator';
import type { Time } from './time';

/** Stored instead of a level where a channel has no data (it lost its net, or was detached). */
export const NO_DATA = 4;

export interface RecorderOptions {
  /**
   * Changes kept across every channel. When the record grows past it, the oldest changes are
   * dropped (down to three quarters of it) and `start` moves forward. Default 4M (≈ 36 MB).
   */
  readonly budget?: number;
}

const DEFAULT_BUDGET = 4_000_000;
const INITIAL_CAPACITY = 64;

/** One channel's changes: `times[head + i]`, `levels[head + i]` for `i < count`, in time order. */
class Track {
  times = new Float64Array(INITIAL_CAPACITY);
  levels = new Uint8Array(INITIAL_CAPACITY);
  head = 0;
  count = 0;
  /** Recording in the attached simulator. */
  live = false;
  /** Next channel on the same net in the attached simulator (−1: none). */
  next = -1;

  time(i: number): Time {
    return this.times[this.head + i]!;
  }

  level(i: number): number {
    return this.levels[this.head + i]!;
  }

  push(time: Time, level: number): void {
    if (this.head + this.count === this.times.length) {
      if (this.head >= this.times.length / 2) {
        this.times.copyWithin(0, this.head, this.head + this.count);
        this.levels.copyWithin(0, this.head, this.head + this.count);
        this.head = 0;
      } else {
        const times = new Float64Array(this.times.length * 2);
        const levels = new Uint8Array(this.times.length * 2);
        times.set(this.times.subarray(this.head, this.head + this.count));
        levels.set(this.levels.subarray(this.head, this.head + this.count));
        this.times = times;
        this.levels = levels;
        this.head = 0;
      }
    }
    this.times[this.head + this.count] = time;
    this.levels[this.head + this.count] = level;
    this.count++;
  }

  /** Index of the last change at or before `t`; −1 if none. */
  indexAt(t: Time): number {
    let lo = 0;
    let hi = this.count - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[this.head + mid]! <= t) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /** Index of the last change strictly before `t`; −1 if none. */
  indexBefore(t: Time): number {
    let lo = 0;
    let hi = this.count - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[this.head + mid]! < t) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /** Changes strictly before `t`, except the last of them (it still tells the level at `t`). */
  droppableBefore(t: Time): number {
    return Math.max(0, this.indexBefore(t));
  }
}

/** Levels of chosen nets over simulated time, bounded by a budget of changes. */
export class Recorder {
  readonly budget: number;
  readonly #tracks: (Track | undefined)[] = [];
  #total = 0;
  #dropped = 0;
  #start: Time = 0;
  #sim: Simulator | undefined;
  #off: (() => void) | undefined;
  #end: Time = 0;
  /** First channel on each net of the attached simulator (−1: none). */
  #netFirst = new Int32Array(0);

  constructor(options: RecorderOptions = {}) {
    this.budget = Math.max(16, Math.floor(options.budget ?? DEFAULT_BUDGET));
  }

  // ── Channels ─────────────────────────────────────────────────────────────────────────────

  /** A new, empty channel; it records once an `attach` gives it a net. Returns its id. */
  addChannel(): number {
    this.#tracks.push(new Track());
    return this.#tracks.length - 1;
  }

  /** Forgets a channel and its record. Its id is not reused. */
  removeChannel(channel: number): void {
    const track = this.#tracks[channel];
    if (!track) return;
    const links = this.#links();
    links.delete(channel);
    this.#total -= track.count;
    this.#tracks[channel] = undefined;
    if (this.#sim) this.#link(this.#sim, links);
  }

  /** Ids of the channels, in the order they were added. */
  get channels(): number[] {
    const ids: number[] = [];
    this.#tracks.forEach((track, id) => {
      if (track) ids.push(id);
    });
    return ids;
  }

  // ── Recording ────────────────────────────────────────────────────────────────────────────

  /**
   * Records `sim` from its current instant: `nets` maps channel ids to the net index each one
   * shows there. A channel left out (its reference no longer resolves) gets no data from now on;
   * one given a net records its current level now and every change after. Replaces any simulator
   * attached before (a carry-over's old one).
   */
  attach(sim: Simulator, nets: ReadonlyMap<number, number>): void {
    this.#off?.();
    this.#sim = sim;
    const now = sim.now;
    this.#tracks.forEach((track, id) => {
      if (!track) return;
      const net = nets.get(id);
      if (net === undefined || net < 0 || net >= sim.netCount) {
        if (track.live) this.#append(track, now, NO_DATA);
        track.live = false;
      } else {
        this.#append(track, now, sim.levels[net]!);
        track.live = true;
      }
    });
    this.#link(sim, nets);
    this.#off = sim.onNetChange((time, net, level) => {
      for (let c = this.#netFirst[net]!; c >= 0; ) {
        const track = this.#tracks[c]!;
        this.#append(track, time, level);
        c = track.next;
      }
    });
  }

  /** Gives `channel` a net in the attached simulator from now on (a probe added while running). */
  attachChannel(channel: number, net: number): void {
    const sim = this.#sim;
    const track = this.#tracks[channel];
    if (!sim || !track) return;
    const nets = this.#links();
    nets.set(channel, net);
    this.#append(track, sim.now, sim.levels[net]!);
    track.live = true;
    this.#link(sim, nets);
  }

  /** Stops recording (Stop): the record ends at the simulator's current instant. */
  detach(): void {
    if (!this.#sim) return;
    this.#end = this.#sim.now;
    this.#off?.();
    this.#off = undefined;
    this.#sim = undefined;
    for (const track of this.#tracks) if (track) track.live = false;
  }

  /** Forgets every change and detaches (before a new power-on); the channels stay. */
  clear(): void {
    this.detach();
    for (const track of this.#tracks) {
      if (!track) continue;
      track.head = 0;
      track.count = 0;
    }
    this.#total = 0;
    this.#dropped = 0;
    this.#start = 0;
    this.#end = 0;
  }

  /** The earliest instant every channel still knows: 0, or later once the budget dropped changes. */
  get start(): Time {
    return this.#start;
  }

  /** Where the record ends: the attached simulator's current instant, or where it was detached. */
  get end(): Time {
    return this.#sim?.now ?? this.#end;
  }

  /** Recording a simulator now. */
  get attached(): boolean {
    return this.#sim !== undefined;
  }

  /** Changes kept, across every channel. */
  get size(): number {
    return this.#total;
  }

  /** Changes dropped because of the budget since the last `clear`. */
  get dropped(): number {
    return this.#dropped;
  }

  // ── Queries ──────────────────────────────────────────────────────────────────────────────

  /** Changes recorded on a channel (raw access: `changeTime`, `changeLevel`; 0 if unknown). */
  changeCount(channel: number): number {
    return this.#tracks[channel]?.count ?? 0;
  }

  /** Time of a channel's `i`-th recorded change (the first may lie before `start`). */
  changeTime(channel: number, i: number): Time {
    return this.#track(channel).time(i);
  }

  /** Level (or `NO_DATA`) of a channel's `i`-th recorded change. */
  changeLevel(channel: number, i: number): number {
    return this.#track(channel).level(i);
  }

  /** Time of the channel's last recorded change (O(1): did it change at this instant?). */
  lastChange(channel: number): Time | undefined {
    const track = this.#tracks[channel];
    return track && track.count > 0 ? track.time(track.count - 1) : undefined;
  }

  /** Index of the channel's last change at or before `t`; −1 if none. */
  indexAt(channel: number, t: Time): number {
    return this.#tracks[channel]?.indexAt(t) ?? -1;
  }

  /** The channel's level at `t`; undefined where it has no data (before it began, before `start`). */
  level(channel: number, t: Time): Level | undefined {
    const track = this.#tracks[channel];
    if (!track || t < this.#start || t > this.end) return undefined;
    const i = track.indexAt(t);
    if (i < 0) return undefined;
    const level = track.level(i);
    return level === NO_DATA ? undefined : (level as Level);
  }

  /** The first change of the channel after `t` (within the record), or undefined. */
  nextChange(channel: number, t: Time): Time | undefined {
    const track = this.#tracks[channel];
    if (!track) return undefined;
    const i = track.indexAt(Math.max(t, this.#start - 1)) + 1;
    return i < track.count ? track.time(i) : undefined;
  }

  /** The last change of the channel before `t` and not before `start`, or undefined. */
  prevChange(channel: number, t: Time): Time | undefined {
    const track = this.#tracks[channel];
    if (!track) return undefined;
    const i = track.indexBefore(t);
    if (i < 0) return undefined;
    const time = track.time(i);
    return time >= this.#start ? time : undefined;
  }

  /** The first change of any of `channels` after `t` (a bus's or group's next value). */
  nextChangeOf(channels: readonly number[], t: Time): Time | undefined {
    let best: Time | undefined;
    for (const channel of channels) {
      const next = this.nextChange(channel, t);
      if (next !== undefined && (best === undefined || next < best)) best = next;
    }
    return best;
  }

  /** The last change of any of `channels` before `t`. */
  prevChangeOf(channels: readonly number[], t: Time): Time | undefined {
    let best: Time | undefined;
    for (const channel of channels) {
      const prev = this.prevChange(channel, t);
      if (prev !== undefined && (best === undefined || prev > best)) best = prev;
    }
    return best;
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────

  #track(channel: number): Track {
    const track = this.#tracks[channel];
    if (!track) throw new Error(`recorder: no channel ${channel}`);
    return track;
  }

  /** The nets of the live channels, as attached. */
  #links(): Map<number, number> {
    const links = new Map<number, number>();
    const first = this.#netFirst;
    for (let net = 0; net < first.length; net++) {
      for (let c = first[net]!; c >= 0; c = this.#tracks[c]!.next) links.set(c, net);
    }
    return links;
  }

  #link(sim: Simulator, nets: ReadonlyMap<number, number>): void {
    const first = new Int32Array(sim.netCount).fill(-1);
    for (const track of this.#tracks) if (track) track.next = -1;
    // Highest id first, so each net's list runs in ascending channel order.
    for (let id = this.#tracks.length - 1; id >= 0; id--) {
      const track = this.#tracks[id];
      const net = nets.get(id);
      if (!track?.live || net === undefined || net < 0 || net >= first.length) continue;
      track.next = first[net]!;
      first[net] = id;
    }
    this.#netFirst = first;
  }

  /**
   * Appends a change. Changes at one instant (delta cycles) collapse into its last level, and
   * one that returns to the level before the instant leaves nothing: a zero-delay delta is no
   * pulse a real circuit makes.
   */
  #append(track: Track, time: Time, level: number): void {
    const n = track.count;
    if (n > 0) {
      const last = track.level(n - 1);
      if (last === level) return;
      if (track.time(n - 1) === time) {
        if (n >= 2 && track.level(n - 2) === level) {
          track.count--;
          this.#total--;
        } else {
          track.levels[track.head + n - 1] = level;
        }
        return;
      }
    }
    track.push(time, level);
    if (++this.#total > this.budget) this.#trim();
  }

  /** Drops the oldest changes of every channel, down to three quarters of the budget. */
  #trim(): void {
    const target = this.#total - Math.floor((this.budget * 3) / 4);
    const tracks = this.#tracks.filter((t): t is Track => t !== undefined);
    const droppable = (t: Time) => tracks.reduce((sum, tr) => sum + tr.droppableBefore(t), 0);
    // The earliest cut that drops enough, by bisection over time.
    // Changes are never later than the attached simulator's now: cutting there keeps one each.
    let lo = this.#start;
    let hi = this.end;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (droppable(mid) >= target) hi = mid;
      else lo = mid + 1;
    }
    for (const track of tracks) {
      const k = track.droppableBefore(lo);
      track.head += k;
      track.count -= k;
      this.#total -= k;
      this.#dropped += k;
    }
    this.#start = Math.max(this.#start, lo);
  }
}

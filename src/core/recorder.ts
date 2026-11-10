/**
 * Recorder: the levels of chosen nets over simulated time, the data behind the waveform view
 * (R13) and, later, headless test benches (R15). Spec: docs/simulation.md#recorder.
 *
 * Channels are numbered by the recorder and point at nets only through `attach`, because nets
 * have no identity across compiles: after a carry-over the caller re-resolves what each channel
 * shows and attaches the new simulator, and the record goes on. A channel may also show a bit
 * inside a part (HDL-4: a Verilog module's register), which changes inside the part's evaluation
 * rather than on a net: it is sampled at the end of each instant.
 */
import { type InnerBit, innerReader } from './inner-signals';
import type { Level } from './logic';
import type { Simulator } from './simulator';
import type { Time } from './time';

/** What a channel shows in the attached simulator: a net's index, or a bit inside a part. */
export type ChannelSource = number | InnerBit;

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
  /** While a rewound run goes through the record again: changes at or before `now` (a cursor). */
  past = 0;
  /** The record is complete up to here: a change at or before it is confirmed, not appended. */
  until = Number.NEGATIVE_INFINITY;

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
  /**
   * After a rewind (`seek`), how far the record reaches (the present); while the run is behind
   * it, the record is confirmed (`Track.past` moves), not written.
   */
  #replaying = false;
  #present: Time = 0;
  /** First channel on each net of the attached simulator (−1: none). */
  #netFirst = new Int32Array(0);
  /** What each live channel shows, as attached. */
  #sources = new Map<number, ChannelSource>();
  /** The live channels on bits inside parts, read at the end of each instant (HDL-4). */
  #sampled: { readonly track: Track; readonly read: () => Level }[] = [];
  #offInstant: (() => void) | undefined;

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
    const sources = new Map(this.#sources);
    sources.delete(channel);
    this.#total -= track.count;
    this.#tracks[channel] = undefined;
    if (this.#sim) this.#link(this.#sim, sources);
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
   * Records `sim` from its current instant: `sources` maps channel ids to what each one shows
   * there — a net's index, or a bit inside a part. A channel left out (its reference no longer
   * resolves) gets no data from now on; one given a source records its current level now and
   * every change after. Replaces any simulator attached before (a carry-over's old one).
   */
  attach(sim: Simulator, sources: ReadonlyMap<number, ChannelSource>): void {
    this.#off?.();
    this.#offInstant?.();
    this.#offInstant = undefined;
    this.#sim = sim;
    const now = sim.now;
    const live = new Map<number, ChannelSource>();
    this.#tracks.forEach((track, id) => {
      if (!track) return;
      const source = sources.get(id);
      const level = source === undefined ? undefined : levelOf(sim, source);
      if (level === undefined) {
        if (track.live) this.#record(track, now, NO_DATA);
        track.live = false;
      } else {
        this.#record(track, firstAt(track, now), level);
        track.live = true;
        live.set(id, source!);
      }
    });
    this.#link(sim, live);
    this.#off = sim.onNetChange((time, net, level) => {
      const replaying = this.#replaying;
      for (let c = this.#netFirst[net]!; c >= 0; ) {
        const track = this.#tracks[c]!;
        if (replaying) this.#record(track, time, level);
        else this.#append(track, time, level);
        c = track.next;
      }
    });
  }

  /**
   * Gives `channel` a net or a bit inside a part in the attached simulator from now on (a probe
   * added while running); nothing where `sim` has no such source.
   */
  attachChannel(channel: number, source: ChannelSource): void {
    const sim = this.#sim;
    const track = this.#tracks[channel];
    if (!sim || !track) return;
    const level = levelOf(sim, source);
    if (level === undefined) return;
    const sources = new Map(this.#sources);
    sources.set(channel, source);
    this.#record(track, firstAt(track, sim.now), level);
    track.live = true;
    this.#link(sim, sources);
  }

  /**
   * Reads the channels on bits inside parts at the attached simulator's present instant: done at
   * the end of every instant, and by anything that reads the record there before the recorder's
   * own listener runs (a `Trigger`). Reading again at one instant changes nothing.
   */
  sample(): void {
    const sim = this.#sim;
    if (!sim) return;
    const now = sim.now;
    const replaying = this.#replaying;
    for (const { track, read } of this.#sampled) {
      if (replaying) this.#record(track, now, read());
      else this.#append(track, now, read());
    }
  }

  /** Stops recording (Stop): the record ends at the simulator's current instant. */
  detach(): void {
    if (!this.#sim) return;
    this.#end = this.end;
    this.#endReplay();
    this.#off?.();
    this.#off = undefined;
    this.#offInstant?.();
    this.#offInstant = undefined;
    this.#sim = undefined;
    this.#sources = new Map();
    this.#sampled = [];
    for (const track of this.#tracks) if (track) track.live = false;
  }

  /** Forgets every change and detaches (before a new power-on); the channels stay. */
  clear(): void {
    this.detach();
    for (const track of this.#tracks) {
      if (!track) continue;
      track.head = 0;
      track.count = 0;
      track.past = 0;
      track.until = Number.NEGATIVE_INFINITY;
    }
    this.#replaying = false;
    this.#present = 0;
    this.#total = 0;
    this.#dropped = 0;
    this.#start = 0;
    this.#end = 0;
  }

  /** The earliest instant every channel still knows: 0, or later once the budget dropped changes. */
  get start(): Time {
    return this.#start;
  }

  /**
   * Where the record ends: the attached simulator's current instant, or where it was detached —
   * or, after a rewind (`seek`), the present the record reaches while the run is behind it.
   */
  get end(): Time {
    const now = this.#sim?.now ?? this.#end;
    return this.#replaying ? Math.max(now, this.#present) : now;
  }

  /** A rewound run is behind the record's end: the record after `now` is its future. */
  get replaying(): boolean {
    return this.#replaying && (this.#sim?.now ?? this.#present) < this.#present;
  }

  // ── Rewinding ────────────────────────────────────────────────────────────────────────────

  /**
   * The attached simulator was rewound to `t` (`Simulator.restore`) from `present`, the furthest
   * instant it had run to: the record after `t` stays — it is the future, and a run going on
   * deterministically from `t` repeats it, so its changes are confirmed rather than recorded
   * again until it reaches the present. `lastChange` answers as of `t`. A channel added later
   * records as usual.
   */
  seek(t: Time, present: Time): void {
    const end = present;
    for (const track of this.#tracks) {
      if (!track) continue;
      track.until = end;
      track.past = track.indexAt(t) + 1;
    }
    this.#present = end;
    this.#replaying = t < end;
  }

  /**
   * The run leaves the recorded future at `t` (the user acted at a rewound instant): every
   * change after `t` goes, and recording goes on from there.
   */
  cut(t: Time): void {
    for (const track of this.#tracks) {
      if (!track) continue;
      const keep = track.indexAt(t) + 1;
      this.#total -= track.count - keep;
      track.count = keep;
    }
    this.#replaying = false;
    if (!this.#sim) this.#end = Math.min(this.#end, t);
  }

  /** Cursors and `until` mean something only while replaying: nothing else to reset. */
  #endReplay(): void {
    this.#replaying = false;
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

  /**
   * Time of the channel's last change up to now (O(1): did it change at this instant?) — after
   * a rewind, up to the rewound run's instant, not the end of the record.
   */
  lastChange(channel: number): Time | undefined {
    const track = this.#tracks[channel];
    if (!track) return undefined;
    const n = this.#replaying ? track.past : track.count;
    return n > 0 ? track.time(n - 1) : undefined;
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

  /**
   * Points the live channels at their sources in `sim`: the nets' channel lists, and the bits
   * inside parts to sample at the end of each instant (listening for instants only while there
   * are any, so a recorder of nets costs the kernel nothing more).
   */
  #link(sim: Simulator, sources: ReadonlyMap<number, ChannelSource>): void {
    const first = new Int32Array(sim.netCount).fill(-1);
    for (const track of this.#tracks) if (track) track.next = -1;
    const sampled: { readonly track: Track; readonly read: () => Level }[] = [];
    // Highest id first, so each net's list runs in ascending channel order.
    for (let id = this.#tracks.length - 1; id >= 0; id--) {
      const track = this.#tracks[id];
      const source = sources.get(id);
      if (!track?.live || source === undefined) continue;
      if (typeof source === 'number') {
        if (source < 0 || source >= first.length) continue;
        track.next = first[source]!;
        first[source] = id;
      } else {
        const read = innerReader(sim, source);
        if (read) sampled.unshift({ track, read });
      }
    }
    this.#netFirst = first;
    this.#sources = new Map(sources);
    this.#sampled = sampled;
    if (sampled.length > 0 && !this.#offInstant) {
      this.#offInstant = sim.onInstant(() => this.sample());
    } else if (sampled.length === 0 && this.#offInstant) {
      this.#offInstant();
      this.#offInstant = undefined;
    }
  }

  /**
   * A change the attached simulator made: while replaying, confirmed where the record has it
   * already, else appended (the cursors matter only while replaying).
   */
  #record(track: Track, time: Time, level: number): void {
    if (this.#replaying) {
      if (time > this.#present) this.#endReplay();
      else if (time <= track.until) {
        // The record has this instant already (collapsed as `#append` would): move past it.
        while (track.past < track.count && track.time(track.past) <= time) track.past++;
        return;
      }
    }
    this.#append(track, time, level);
    track.past = track.count;
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
    let hi = this.#sim?.now ?? this.end; // not into a rewound run's future
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (droppable(mid) >= target) hi = mid;
      else lo = mid + 1;
    }
    for (const track of tracks) {
      const k = track.droppableBefore(lo);
      track.head += k;
      track.count -= k;
      track.past = Math.max(0, track.past - k);
      this.#total -= k;
      this.#dropped += k;
    }
    this.#start = Math.max(this.#start, lo);
  }
}

/**
 * When a channel's first level goes: a fresh channel attached at instant `now` > 0 (a probe or
 * a breakpoint added while paused) records the level as of 1 ps before, the level going into
 * the rest of the instant — so a change still made at `now` (an action while paused, the
 * power-on of a carried-over simulator) is an edge after it, not merged into it.
 */
/** A source's level in `sim` now; undefined where `sim` has no such net or bit. */
function levelOf(sim: Simulator, source: ChannelSource): Level | undefined {
  if (typeof source !== 'number') return innerReader(sim, source)?.();
  return source >= 0 && source < sim.netCount ? (sim.levels[source] as Level) : undefined;
}

function firstAt(track: Track, now: Time): Time {
  return track.count === 0 && now > 0 ? now - 1 : now;
}

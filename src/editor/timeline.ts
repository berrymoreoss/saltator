/**
 * The history of one simulator (R14b): checkpoints (kernel snapshots) taken while it runs and a
 * log of the user's actions, so any position since it was built — power-on, or the structural
 * edit that made it — is reached again by restoring the checkpoint before it and re-running
 * deterministically, in a replica the tools don't watch. Bounded by a memory budget: older
 * checkpoints are thinned out, then the oldest go. No DOM; the host (`Simulation`) drives it.
 * Spec: docs/editor.md#rewinding.
 */
import { type Simulator, type SimulatorSnapshot, snapshotBytes, type Time } from '../core';

/**
 * A point of a run: a time and how many logged actions were delivered by then. Several
 * positions share a time when actions happened at it: a breakpoint pause at 1.5 µs comes before
 * the switch flipped while paused there.
 */
export interface TimelinePosition {
  readonly time: Time;
  readonly actions: number;
}

/** Negative when `a` comes first, 0 when equal. */
export function comparePositions(a: TimelinePosition, b: TimelinePosition): number {
  return a.time - b.time || a.actions - b.actions;
}

/** An action the user took (a click, a poke), as a replay delivers it again. */
export interface TimelineAction {
  readonly time: Time;
  readonly component: string;
  readonly payload: unknown;
  /**
   * The kernel ran since the action before: a replay runs up to `time` first. Two actions with
   * no run between them (clicks within one frame) are delivered back to back, as they were.
   */
  readonly afterRun: boolean;
}

interface Checkpoint {
  readonly snapshot: SimulatorSnapshot;
  /** Logged actions delivered when it was taken. */
  readonly actions: number;
  /** Memory it holds that the checkpoint before it doesn't share. */
  bytes: number;
}

/** A stretch between two positions that a backward search replays (newest first). */
export interface TimelineSegment {
  readonly start: TimelinePosition;
  readonly end: TimelinePosition;
  /** Index of the checkpoint it starts from. */
  readonly checkpoint: number;
}

export interface TimelineOptions {
  /** Memory the checkpoints may hold, in bytes. Default 64 MiB. */
  readonly budget?: number;
  /** Kernel events between checkpoints. Default 200 000 (≈ 20 ms of replay). */
  readonly interval?: number;
  /** Longest stretch between checkpoints thinning may leave, in events. Default 8 intervals. */
  readonly maxGap?: number;
}

const DEFAULT_BUDGET = 64 * 1024 * 1024;
const DEFAULT_INTERVAL = 200_000;

export class Timeline {
  readonly budget: number;
  readonly interval: number;
  readonly maxGap: number;
  readonly #sim: Simulator;
  #replica: Simulator | undefined;
  readonly #checkpoints: Checkpoint[] = [];
  readonly #log: TimelineAction[] = [];
  #bytes = 0;
  /** Logged actions delivered in the live simulator now. */
  #applied = 0;
  #present: TimelinePosition;
  /** The kernel ran since the last action (and the state is settled: checkpoints may go). */
  #ran = false;

  /** Starts the history of `sim` where it is (before power-on, or at a carry-over's instant). */
  constructor(sim: Simulator, options: TimelineOptions = {}) {
    this.#sim = sim;
    this.budget = options.budget ?? DEFAULT_BUDGET;
    this.interval = Math.max(1, options.interval ?? DEFAULT_INTERVAL);
    this.maxGap = Math.max(this.interval, options.maxGap ?? 8 * this.interval);
    const snapshot = sim.snapshot();
    this.#checkpoints.push({ snapshot, actions: 0, bytes: snapshot.bytes });
    this.#bytes = snapshot.bytes;
    this.#present = this.position;
  }

  /** The earliest time it reaches back to. */
  get start(): Time {
    return this.#checkpoints[0]!.snapshot.time;
  }

  /** Where the live simulator is. */
  get position(): TimelinePosition {
    return { time: this.#sim.now, actions: this.#applied };
  }

  /** The furthest position the run reached; behind it, the run replays its recording. */
  get present(): TimelinePosition {
    return this.#present;
  }

  /** The run is behind the present (after a rewind): forward runs replay the recording. */
  get hasFuture(): boolean {
    return comparePositions(this.position, this.#present) < 0;
  }

  /** The user's actions so far (the recorded future's included). */
  get actions(): readonly TimelineAction[] {
    return this.#log;
  }

  /** The next logged action a forward run delivers again (while behind the present). */
  get pending(): TimelineAction | undefined {
    return this.#log[this.#applied];
  }

  /** Memory the checkpoints hold. */
  get bytes(): number {
    return this.#bytes;
  }

  get checkpointCount(): number {
    return this.#checkpoints.length;
  }

  // ── Following the live run ───────────────────────────────────────────────────────────────

  /**
   * The live kernel ran (a frame, a step, an action's effects applied): the present follows,
   * and a checkpoint is taken when enough happened since the last one. Between runs only.
   */
  ran(): void {
    this.#ran = true;
    const position = this.position;
    if (comparePositions(position, this.#present) > 0) this.#present = position;
    // Behind the present the newest checkpoint is ahead (more events): none is taken there.
    const last = this.#checkpoints.at(-1)!;
    if (this.#sim.stats.events - last.snapshot.events < this.interval) return;
    const snapshot = this.#sim.snapshot(last.snapshot);
    this.#checkpoints.push({ snapshot, actions: this.#applied, bytes: snapshot.bytes });
    this.#bytes += snapshot.bytes;
    this.#enforceBudget();
  }

  /**
   * The user delivered an action now (after `sim.action`). Behind the present it starts a new
   * future: the recorded one — logged actions not delivered yet, checkpoints after now — goes.
   */
  acted(component: string, payload: unknown): void {
    if (this.hasFuture) this.#diverge();
    this.#log.push({ time: this.#sim.now, component, payload, afterRun: this.#ran });
    this.#applied = this.#log.length;
    this.#ran = false;
    this.#present = this.position;
  }

  /**
   * Delivers the next logged action to the live simulator again (a forward run reached its
   * instant). False when there is none due now.
   */
  applyPending(): boolean {
    const action = this.pending;
    if (!action || action.time !== this.#sim.now) return false;
    deliver(this.#sim, action);
    this.#applied++;
    this.#ran = false;
    return true;
  }

  /** Drops the recorded future: logged actions not delivered yet, checkpoints after now. */
  #diverge(): void {
    const position = this.position;
    this.#log.length = this.#applied;
    while (
      this.#checkpoints.length > 1 &&
      comparePositions(checkpointPosition(this.#checkpoints.at(-1)!), position) > 0
    ) {
      this.#bytes -= this.#checkpoints.pop()!.bytes;
    }
  }

  // ── Rewinding ────────────────────────────────────────────────────────────────────────────

  /** "`time` as it ended": every logged action at or before it delivered. */
  asEnded(time: Time): TimelinePosition {
    let actions = 0;
    while (actions < this.#log.length && this.#log[actions]!.time <= time) actions++;
    return { time, actions };
  }

  /** Whether a position lies within the history (from its start to the present). */
  reachable(target: TimelinePosition): boolean {
    return (
      comparePositions(target, checkpointPosition(this.#checkpoints[0]!)) >= 0 &&
      comparePositions(target, this.#present) <= 0
    );
  }

  /**
   * Puts the live simulator at `target` (within the history): the last checkpoint at or before
   * it, re-run in the replica with the logged actions in between, the result restored into the
   * live simulator. Its listeners are not called; the tools catch up themselves.
   */
  reach(target: TimelinePosition): void {
    if (!this.reachable(target)) {
      throw new Error(`timeline: position ${target.time} ps / ${target.actions} is out of reach`);
    }
    let k = this.#checkpoints.length - 1;
    while (k > 0 && comparePositions(checkpointPosition(this.#checkpoints[k]!), target) > 0) k--;
    const checkpoint = this.#checkpoints[k]!;
    const replica = this.#replicaSim();
    replica.restore(checkpoint.snapshot);
    replay(replica, this.#log, checkpoint.actions, target);
    this.#sim.restore(replica.snapshot(checkpoint.snapshot));
    this.#applied = target.actions;
    this.#ran = true;
  }

  /** The stretches between checkpoints up to `before`, newest first (for backward searches). */
  segmentsBefore(before: TimelinePosition): TimelineSegment[] {
    const segments: TimelineSegment[] = [];
    let end = before;
    for (let k = this.#checkpoints.length - 1; k >= 0; k--) {
      const start = checkpointPosition(this.#checkpoints[k]!);
      if (comparePositions(start, before) >= 0) continue;
      segments.push({ start, end, checkpoint: k });
      end = start;
    }
    return segments;
  }

  /**
   * Replays a segment in the replica — the simulator `watch` gets, with the position of each
   * moment (`at`), to attach a scanner of its own and return its detach function.
   */
  replaySegment(
    segment: TimelineSegment,
    watch: (sim: Simulator, at: (time: Time) => TimelinePosition) => () => void,
  ): void {
    const checkpoint = this.#checkpoints[segment.checkpoint];
    if (!checkpoint) throw new Error('timeline: no such segment');
    const replica = this.#replicaSim();
    replica.restore(checkpoint.snapshot);
    let applied = checkpoint.actions;
    const stop = watch(replica, (time) => ({ time, actions: applied }));
    try {
      replay(replica, this.#log, checkpoint.actions, segment.end, (n) => {
        applied = n;
      });
    } finally {
      stop();
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────

  #replicaSim(): Simulator {
    this.#replica ??= this.#sim.replica();
    return this.#replica;
  }

  /**
   * Thins the older half, then drops the oldest, until the budget holds. It runs when a
   * checkpoint was just taken where the live run is: every other one lies behind it.
   */
  #enforceBudget(): void {
    while (this.#bytes > this.budget && this.#checkpoints.length > 2) {
      if (!this.#thin()) this.#dropOldest();
    }
  }

  /** Drops every other checkpoint of the older half where the gap stays short enough. */
  #thin(): boolean {
    const list = this.#checkpoints;
    let dropped = false;
    for (let k = 1; k < Math.floor(list.length / 2) && this.#bytes > this.budget; k++) {
      const gap = list[k + 1]!.snapshot.events - list[k - 1]!.snapshot.events;
      if (gap > this.maxGap) continue;
      this.#drop(k);
      dropped = true;
    }
    return dropped;
  }

  #drop(k: number): void {
    const list = this.#checkpoints;
    const next = list[k + 1]!;
    this.#bytes -= list[k]!.bytes + next.bytes;
    next.bytes = snapshotBytes(next.snapshot, list[k - 1]!.snapshot);
    this.#bytes += next.bytes;
    list.splice(k, 1);
  }

  /** The history's start moves on. */
  #dropOldest(): void {
    const list = this.#checkpoints;
    const next = list[1]!;
    this.#bytes -= list[0]!.bytes + next.bytes;
    next.bytes = snapshotBytes(next.snapshot);
    this.#bytes += next.bytes;
    list.shift();
  }
}

function checkpointPosition(checkpoint: Checkpoint): TimelinePosition {
  return { time: checkpoint.snapshot.time, actions: checkpoint.actions };
}

function deliver(sim: Simulator, action: TimelineAction): void {
  if (action.afterRun) sim.runUntil(action.time);
  sim.action(action.component, action.payload);
}

/** Re-runs `sim` from a checkpoint's `applied` actions to `target`, delivering the log's. */
function replay(
  sim: Simulator,
  log: readonly TimelineAction[],
  applied: number,
  target: TimelinePosition,
  onApplied?: (applied: number) => void,
): void {
  for (let i = applied; i < target.actions; i++) {
    deliver(sim, log[i]!);
    onApplied?.(i + 1);
  }
  sim.runUntil(target.time);
}

/**
 * The event-driven simulator: compiles a netlist into index-based runtime arrays and runs the
 * delta-cycle event loop. Spec: docs/simulation.md.
 */
import {
  type Behavior,
  type EvalContext,
  isDriverPin,
  isReadPin,
  type PinRef,
  type PropValue,
} from './component';
import { type ComponentDiagnostic, DiagnosticLog, KernelDiagnosticKind } from './diagnostics';
import { EventQueue } from './event-queue';
import {
  Drive,
  driveBits,
  driveName,
  isContentionBits,
  Level,
  levelChar,
  resolveBits,
} from './logic';
import { type Netlist, type ResolvedNetlist, resolveNetlist } from './netlist';
import type { ComponentRegistry } from './registry';
import { formatTime, ms, type Time } from './time';

export interface SimulatorOptions {
  /** Delta cycles allowed at one timestamp before the run halts with `oscillation`. Default 1000. */
  readonly maxDeltaCycles?: number;
  /** Distinct diagnostics kept (repeats are merged). Default 1000. */
  readonly maxDiagnostics?: number;
  /**
   * Continue a running simulation in this (recompiled) netlist: what `carryOver()` of the old
   * simulator returned. Time, statistics and the diagnostic log go on; see `carryOver`.
   */
  readonly carry?: SimulatorCarry;
}

/**
 * What a simulation hands over to the simulator of a recompiled netlist (`carryOver`). Plain
 * data keyed by component id; treat it as opaque.
 */
export interface SimulatorCarry {
  readonly time: Time;
  readonly stats: Readonly<SimulatorStats>;
  readonly diagnostics: DiagnosticLog;
  readonly components: ReadonlyMap<string, CarriedComponent>;
  /** Pending output changes and timers, in the order the old queue would have run them. */
  readonly events: readonly CarriedEvent[];
}

/** One component of a `SimulatorCarry`. */
export interface CarriedComponent {
  readonly type: string;
  readonly props: Readonly<Record<string, PropValue>>;
  /** The state object itself (moved, not copied). */
  readonly state: unknown;
  /** What each driver pin drives now, by pin name. */
  readonly drives: ReadonlyMap<string, Drive>;
}

/** A pending event of a `SimulatorCarry`. */
export type CarriedEvent =
  | {
      readonly kind: 'drive';
      readonly time: Time;
      readonly component: string;
      readonly pin: string;
      readonly drive: Drive;
    }
  | {
      readonly kind: 'wake';
      readonly time: Time;
      readonly component: string;
      readonly token: number;
    };

/**
 * - `idle`: no events left (nothing will happen without external input);
 * - `reached`: the time limit was reached with events still pending;
 * - `budget`: stopped early because the event budget was used up;
 * - `break`: stopped after an instant because `requestBreak()` was called (a trigger, a
 *   breakpoint); `now` is that instant and the next run goes on from there;
 * - `halted`: the simulation stopped for good (oscillation).
 */
export type RunStatus = 'idle' | 'reached' | 'budget' | 'break' | 'halted';

export interface RunOptions {
  /** Stop (status `budget`) once this many events were processed; checked between timestamps. */
  readonly maxEvents?: number;
}

export interface SettleOptions extends RunOptions {
  /** Longest simulated time to run, from now. Default 1 ms. */
  readonly maxTime?: Time;
}

export interface SimulatorStats {
  /** Driver changes and timer wake-ups applied (cancelled events not counted). */
  events: number;
  /** Delta cycles that evaluated at least one component. */
  deltaCycles: number;
  /** Behavior callbacks run (`evaluate` + `wake`). */
  evaluations: number;
}

/** `(time, net index, new level)`; see `Simulator.netId()`. */
export type NetChangeListener = (time: Time, net: number, level: Level) => void;

/** Called with the instant's time once all its delta cycles ran; see `Simulator.onInstant()`. */
export type InstantListener = (time: Time) => void;

const EVENT_DRIVE = 0;
const EVENT_WAKE = 1;
const NO_EVENT = -1;
const DEFAULT_SETTLE_MAX_EVENTS = 1_000_000;

/**
 * Runs a netlist. Time only moves when one of the run methods is called; there is no wall clock.
 *
 * Power-on: push-pull (`out`) outputs start driving strong `X`, tri-state and bidirectional pins
 * start released (`Z`). Every `init` runs in the constructor; at t = 0 every component is then
 * evaluated once, after the events `init` scheduled for t = 0 were applied. A simulator built
 * with `carry` starts where the old one stopped instead (see `carryOver`).
 */
export class Simulator {
  /** Resolved level of every net, by net index. Read-only for callers; updated in place. */
  readonly levels: Uint8Array;
  /** Resolved drive (level + strength) of every net, by net index. Read-only for callers. */
  readonly drives: Uint8Array;
  /**
   * 1 while two strong drivers disagree on the net (a short on real hardware), by net index.
   * Read-only for callers; distinguishes contention from an `X` that is merely unknown.
   */
  readonly contended: Uint8Array;
  readonly stats: SimulatorStats = { events: 0, deltaCycles: 0, evaluations: 0 };
  readonly diagnostics: DiagnosticLog;
  readonly maxDeltaCycles: number;

  private readonly netlist: ResolvedNetlist;
  private readonly queue = new EventQueue();
  private readonly behaviors: Behavior[];
  private readonly states: unknown[];
  private readonly netIndexById = new Map<string, number>();
  private readonly componentIndexById = new Map<string, number>();
  private readonly listeners: NetChangeListener[] = [];
  private readonly instantListeners: InstantListener[] = [];
  private readonly ctx: Context;

  // Pins, flattened: component c owns [pinStart[c], pinStart[c + 1]).
  private readonly pinStart: Int32Array;
  private readonly pinNets: Int32Array; // −1 for unconnected power/nc pins
  private readonly pinSlot: Int32Array; // −1 for pins without a driver
  private readonly pinReads: Uint8Array; // 1: reading Z here is a floating input

  // Driver slots (one per driver pin).
  private readonly slotNet: Int32Array;
  private readonly slotPin: Int32Array; // flat pin index
  private readonly slotComponent: Int32Array;
  private readonly slotDrive: Uint8Array;
  private readonly slotPendingSeq: Float64Array; // NO_EVENT when nothing is pending
  private readonly slotPendingDrive: Uint8Array;

  // Nets: drivers and readers in CSR form.
  private readonly netDriverStart: Int32Array;
  private readonly netDrivers: Int32Array;
  private readonly netReaderStart: Int32Array;
  private readonly netReaders: Int32Array;
  private readonly prevLevels: Uint8Array;
  private readonly changeStamp: Float64Array; // delta id of the last level change
  private readonly touchStamp: Float64Array;
  private readonly touched: Int32Array;
  private readonly floatingReported: Uint8Array;

  // Per-delta component activation.
  private readonly active: Int32Array;
  private readonly activeStamp: Float64Array;
  private readonly dirtyStamp: Float64Array;
  private readonly hasEvaluate: Uint8Array;
  private activeCount = 0;
  private touchedCount = 0;

  // Timer wake-ups of the current delta, as per-component linked lists (in event order).
  private readonly wakeHead: Int32Array;
  private readonly wakeTail: Int32Array;
  private readonly wakeStamp: Float64Array;
  private wakeToken = new Int32Array(64);
  private wakeNext = new Int32Array(64);
  private wakeCount = 0;

  private currentTime: Time = 0;
  private deltaId = 0;
  private started = false;
  private isHalted = false;
  private breakRequested = false;

  constructor(netlist: Netlist, registry: ComponentRegistry, options: SimulatorOptions = {}) {
    this.maxDeltaCycles = options.maxDeltaCycles ?? 1000;
    const carry = options.carry;
    this.diagnostics = carry?.diagnostics ?? new DiagnosticLog(options.maxDiagnostics ?? 1000);
    if (carry) {
      this.currentTime = carry.time;
      Object.assign(this.stats, carry.stats);
    }
    const resolved = resolveNetlist(netlist, registry);
    this.netlist = resolved;
    const { components, nets } = resolved;
    const componentCount = components.length;
    const netCount = nets.length;

    // What each component continues from a carried simulation: a part of the same type keeps
    // its output drives; with the same props too, also its state, pending events and timers.
    const carried = components.map((c) => {
      const old = carry?.components.get(c.id);
      return old?.type === c.definition.type ? old : undefined;
    });
    const kept = carried.map(
      (old, i) => old !== undefined && sameProps(old.props, components[i]!.props),
    );

    // Pins and driver slots.
    this.pinStart = new Int32Array(componentCount + 1);
    let pinCount = 0;
    let slotCount = 0;
    components.forEach((c, i) => {
      this.componentIndexById.set(c.id, i);
      this.pinStart[i] = pinCount;
      pinCount += c.pins.length;
      for (const pin of c.pins) if (isDriverPin(pin.dir)) slotCount++;
    });
    this.pinStart[componentCount] = pinCount;
    this.pinNets = new Int32Array(pinCount).fill(-1);
    this.pinSlot = new Int32Array(pinCount).fill(-1);
    this.pinReads = new Uint8Array(pinCount);
    this.slotNet = new Int32Array(slotCount);
    this.slotPin = new Int32Array(slotCount);
    this.slotComponent = new Int32Array(slotCount);
    this.slotDrive = new Uint8Array(slotCount);
    this.slotPendingSeq = new Float64Array(slotCount).fill(NO_EVENT);
    this.slotPendingDrive = new Uint8Array(slotCount);

    nets.forEach((net, n) => {
      this.netIndexById.set(net.id, n);
      for (const p of net.pins) this.pinNets[this.pinStart[p.component]! + p.pin] = n;
    });

    let slot = 0;
    const driverCount = new Int32Array(netCount);
    const readerSets: Set<number>[] = Array.from({ length: netCount }, () => new Set());
    components.forEach((c, i) => {
      c.pins.forEach((pin, p) => {
        const flat = this.pinStart[i]! + p;
        const net = this.pinNets[flat]!;
        if (isReadPin(pin.dir)) {
          // Sense pins (LEDs, probes) observe a floating net without it being a mistake.
          this.pinReads[flat] = pin.sense ? 0 : 1;
          readerSets[net]!.add(i);
        }
        if (isDriverPin(pin.dir)) {
          this.pinSlot[flat] = slot;
          this.slotNet[slot] = net;
          this.slotPin[slot] = flat;
          this.slotComponent[slot] = i;
          // A push-pull output always drives something; at power-on nobody knows what. A part
          // carried over from a running simulation drives what it drove there.
          this.slotDrive[slot] =
            carried[i]?.drives.get(pin.name) ?? (pin.dir === 'out' ? Drive.STRONG_X : Drive.Z);
          driverCount[net]!++;
          slot++;
        }
      });
    });

    this.netDriverStart = new Int32Array(netCount + 1);
    for (let n = 0; n < netCount; n++) {
      this.netDriverStart[n + 1] = this.netDriverStart[n]! + driverCount[n]!;
    }
    this.netDrivers = new Int32Array(slotCount);
    const fill = this.netDriverStart.slice(0, netCount);
    for (let s = 0; s < slotCount; s++) this.netDrivers[fill[this.slotNet[s]!]!++] = s;

    this.netReaderStart = new Int32Array(netCount + 1);
    const readers: number[] = [];
    readerSets.forEach((set, n) => {
      readers.push(...[...set].sort((a, b) => a - b));
      this.netReaderStart[n + 1] = readers.length;
    });
    this.netReaders = Int32Array.from(readers);

    this.levels = new Uint8Array(netCount);
    this.drives = new Uint8Array(netCount);
    this.prevLevels = new Uint8Array(netCount);
    this.changeStamp = new Float64Array(netCount);
    this.touchStamp = new Float64Array(netCount);
    this.touched = new Int32Array(netCount);
    this.contended = new Uint8Array(netCount);
    this.floatingReported = new Uint8Array(netCount);
    for (let n = 0; n < netCount; n++) {
      const drive = this.resolveDrive(n);
      this.drives[n] = drive;
      this.levels[n] = drive & 3;
      this.prevLevels[n] = drive & 3;
    }

    this.active = new Int32Array(componentCount);
    this.activeStamp = new Float64Array(componentCount);
    this.dirtyStamp = new Float64Array(componentCount);
    this.hasEvaluate = new Uint8Array(componentCount);
    this.wakeHead = new Int32Array(componentCount);
    this.wakeTail = new Int32Array(componentCount);
    this.wakeStamp = new Float64Array(componentCount);

    this.behaviors = components.map((c) => c.definition.create(c.props));
    this.states = this.behaviors.map((b, i) => (kept[i] ? carried[i]!.state : b.createState?.()));
    this.behaviors.forEach((b, i) => {
      this.hasEvaluate[i] = b.evaluate ? 1 : 0;
    });

    // Carried events go first, in their old order, so same-time events keep their FIFO order.
    for (const event of carry?.events ?? []) {
      const c = this.componentIndexById.get(event.component);
      if (c === undefined || !kept[c]) continue;
      if (event.kind === 'wake') {
        this.queue.push(event.time, EVENT_WAKE, c, event.token);
        continue;
      }
      const p = components[c]!.pins.findIndex((d) => d.name === event.pin);
      const slot = p < 0 ? -1 : this.pinSlot[this.pinStart[c]! + p]!;
      if (slot < 0) continue;
      this.slotPendingDrive[slot] = event.drive;
      this.slotPendingSeq[slot] = this.queue.push(event.time, EVENT_DRIVE, slot, event.drive);
    }

    this.ctx = new Context(this);
    this.behaviors.forEach((b, i) => {
      if (!b.init || kept[i]) return;
      this.ctx.bind(i, -1);
      b.init(this.ctx);
    });
  }

  // --- Queries ------------------------------------------------------------------------------

  /** Current simulation time. */
  get now(): Time {
    return this.currentTime;
  }

  /** True once the simulation stopped for good (oscillation); run methods return `halted`. */
  get halted(): boolean {
    return this.isHalted;
  }

  /**
   * Time of the earliest queued event (`Infinity` when none): where a step to the next event
   * goes. It may be a cancelled change; running to it then changes nothing (`stats.events`
   * stays), and the next one is tried.
   */
  get nextEventTime(): Time {
    return this.queue.peekTime();
  }

  get netCount(): number {
    return this.levels.length;
  }

  get componentCount(): number {
    return this.behaviors.length;
  }

  /** Index of the net with this id; throws if unknown. */
  netIndex(id: string): number {
    const index = this.netIndexById.get(id);
    if (index === undefined) throw new Error(`unknown net "${id}"`);
    return index;
  }

  netId(index: number): string {
    return this.netlist.nets[index]!.id;
  }

  /** Index of the component with this id; throws if unknown. */
  componentIndex(id: string): number {
    const index = this.componentIndexById.get(id);
    if (index === undefined) throw new Error(`unknown component "${id}"`);
    return index;
  }

  /** Net index of a component pin, or −1 for an unconnected power/nc pin. */
  pinNet(component: string, pin: string): number {
    const c = this.componentIndex(component);
    const p = this.netlist.components[c]!.pins.findIndex((d) => d.name === pin);
    if (p < 0) throw new Error(`component "${component}" has no pin "${pin}"`);
    return this.pinNets[this.pinStart[c]! + p]!;
  }

  /** Level of a net (by id or index). */
  level(net: string | number): Level {
    return this.levels[typeof net === 'number' ? net : this.netIndex(net)] as Level;
  }

  /** Level of the net a component pin is on (`Z` for an unconnected power/nc pin). */
  pinLevel(component: string, pin: string): Level {
    const net = this.pinNet(component, pin);
    return net < 0 ? Level.Z : (this.levels[net] as Level);
  }

  /** The state object of a component instance (for inspection and tests; do not mutate). */
  stateOf(component: string): unknown {
    return this.states[this.componentIndex(component)];
  }

  /** Calls `listener` whenever a net's level changes. Returns an unsubscribe function. */
  onNetChange(listener: NetChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * Calls `listener` after each instant the simulator processes (power-on included) has finished
   * all its delta cycles, before a run checks for a break: a condition on several nets (a
   * trigger) sees the instant's final levels there, and can still `requestBreak()` at it.
   * Returns an unsubscribe function.
   */
  onInstant(listener: InstantListener): () => void {
    this.instantListeners.push(listener);
    return () => {
      const i = this.instantListeners.indexOf(listener);
      if (i >= 0) this.instantListeners.splice(i, 1);
    };
  }

  /**
   * Hands this simulation over to the simulator of a recompiled netlist
   * (`new Simulator(netlist, registry, { carry })`), which goes on at the same time. A component
   * found there under the same id (after `renames`, old id → new) and type:
   *
   * - with the same props keeps its state, output drives, pending output changes and timers, and
   *   its `init` is not run;
   * - with other props powers on (fresh state, `init`), but its outputs start from what they
   *   drove here instead of `X`.
   *
   * Other components power on. Then every component is evaluated once, as at t = 0, so parts
   * react to changed connections; for an unchanged netlist that schedules nothing new, and the
   * run goes on exactly as if nothing happened. State objects are moved, not copied: don't run
   * this simulator afterwards.
   */
  carryOver(options: { readonly renames?: ReadonlyMap<string, string> } = {}): SimulatorCarry {
    const renames = options.renames;
    const idOf = (c: number) => {
      const id = this.componentId(c);
      return renames?.get(id) ?? id;
    };
    const components = new Map<string, CarriedComponent>();
    this.netlist.components.forEach((c, i) => {
      const drives = new Map<string, Drive>();
      c.pins.forEach((pin, p) => {
        const slot = this.pinSlot[this.pinStart[i]! + p]!;
        if (slot >= 0) drives.set(pin.name, this.slotDrive[slot]! as Drive);
      });
      components.set(idOf(i), {
        type: c.definition.type,
        props: c.props,
        state: this.states[i],
        drives,
      });
    });

    const pending: { seq: number; event: CarriedEvent }[] = [];
    this.queue.forEach((time, seq, kind, a, b) => {
      if (kind === EVENT_WAKE) {
        pending.push({ seq, event: { kind: 'wake', time, component: idOf(a), token: b } });
        return;
      }
      if (this.slotPendingSeq[a] !== seq) return; // cancelled
      const c = this.slotComponent[a]!;
      const pin = this.pinName(c, this.slotPin[a]! - this.pinStart[c]!);
      const drive = b as Drive;
      pending.push({ seq, event: { kind: 'drive', time, component: idOf(c), pin, drive } });
    });
    pending.sort((x, y) => x.event.time - y.event.time || x.seq - y.seq);

    return {
      time: this.currentTime,
      stats: { ...this.stats },
      diagnostics: this.diagnostics,
      components,
      events: pending.map((p) => p.event),
    };
  }

  // --- Control ------------------------------------------------------------------------------

  /**
   * Stops the run in progress once the instant it is processing has finished all its delta
   * cycles: `runUntil`/`settle` return `break`, with `now` at that instant. Meant for listeners
   * (a trigger, a breakpoint), so a condition seen in the middle of an instant still lets the
   * instant settle. Asked between runs, the next run stops after the first instant it
   * processes.
   */
  requestBreak(): void {
    this.breakRequested = true;
  }

  /** Delivers an external action (button press, switch flip) to a component, at `now`. */
  action(component: string, payload: unknown): void {
    const c = this.componentIndex(component);
    const behavior = this.behaviors[c]!;
    if (!behavior.action) throw new Error(`component "${component}" does not accept actions`);
    this.ctx.bind(c, -1);
    behavior.action(this.ctx, payload);
  }

  /** Processes all events up to and including time `t`; then `now = t` unless stopped early. */
  runUntil(t: Time, options: RunOptions = {}): RunStatus {
    if (t < this.currentTime) {
      throw new Error(
        `cannot run backwards: now ${formatTime(this.currentTime)}, until ${formatTime(t)}`,
      );
    }
    return this.run(t, options.maxEvents ?? Number.POSITIVE_INFINITY, true);
  }

  /** `runUntil(now + dt)`. */
  runFor(dt: Time, options: RunOptions = {}): RunStatus {
    return this.runUntil(this.currentTime + dt, options);
  }

  /**
   * Runs until no events are left (`idle`; `now` = time of the last event), or a limit hits:
   * `maxTime` from now (`reached`, default 1 ms) or `maxEvents` (`budget`, default 1M).
   */
  settle(options: SettleOptions = {}): RunStatus {
    // A negative span would set `now` back to the limit when events are pending.
    const limit = this.currentTime + Math.max(0, options.maxTime ?? ms(1));
    return this.run(limit, options.maxEvents ?? DEFAULT_SETTLE_MAX_EVENTS, false);
  }

  private run(limit: Time, maxEvents: number, advanceWhenIdle: boolean): RunStatus {
    if (this.isHalted) return 'halted';
    const startEvents = this.stats.events;
    if (!this.started) {
      this.started = true;
      // Power-on: t = 0, or the time a carried simulation had reached.
      this.processTimestamp(this.currentTime, true);
      if (this.isHalted) return 'halted';
      if (this.instantListeners.length > 0) this.instantEnded();
      if (this.breakRequested) return this.takeBreak();
    }
    const queue = this.queue;
    for (;;) {
      const next = queue.peekTime();
      if (next > limit) {
        if (next !== Number.POSITIVE_INFINITY) {
          this.currentTime = limit;
          return 'reached';
        }
        if (advanceWhenIdle) this.currentTime = limit;
        return 'idle';
      }
      if (this.stats.events - startEvents >= maxEvents) return 'budget';
      this.processTimestamp(next, false);
      if (this.isHalted) return 'halted';
      if (this.instantListeners.length > 0) this.instantEnded();
      if (this.breakRequested) return this.takeBreak();
    }
  }

  private instantEnded(): void {
    const listeners = this.instantListeners;
    for (let i = 0; i < listeners.length; i++) {
      const listener = listeners[i]!;
      listener(this.currentTime);
      if (listeners[i] !== listener) i--; // it unsubscribed (a trigger that fired)
    }
  }

  private takeBreak(): RunStatus {
    this.breakRequested = false;
    return 'break';
  }

  // --- Event loop ---------------------------------------------------------------------------

  /** Runs all delta cycles at time `t`. */
  private processTimestamp(t: Time, initial: boolean): void {
    this.currentTime = t;
    const queue = this.queue;
    const popped = queue.popped;
    const stats = this.stats;
    let deltas = 0;
    let forceAll = initial;

    for (;;) {
      const boundary = queue.nextSeq;
      const delta = ++this.deltaId;
      this.touchedCount = 0;
      this.activeCount = 0;
      this.wakeCount = 0;

      // 1. Apply the events of this delta (those queued before it started).
      while (queue.peekTime() === t && queue.peekSeq() < boundary) {
        queue.pop();
        if (popped.kind === EVENT_DRIVE) {
          const slot = popped.a;
          if (this.slotPendingSeq[slot] !== popped.seq) continue; // cancelled
          this.slotPendingSeq[slot] = NO_EVENT;
          this.slotDrive[slot] = popped.b;
          const net = this.slotNet[slot]!;
          if (this.touchStamp[net] !== delta) {
            this.touchStamp[net] = delta;
            this.touched[this.touchedCount++] = net;
          }
        } else {
          this.addWake(popped.a, popped.b, delta);
        }
        stats.events++;
      }

      // 2. Re-resolve each touched net once; changed nets mark their readers dirty.
      for (let i = 0; i < this.touchedCount; i++) this.updateNet(this.touched[i]!, delta);

      if (forceAll) {
        forceAll = false;
        for (let c = 0; c < this.behaviors.length; c++) {
          if (this.hasEvaluate[c] === 1) this.markDirty(c, delta);
        }
      }

      if (this.activeCount === 0) return;

      if (++deltas > this.maxDeltaCycles) {
        this.reportOscillation(t);
        this.isHalted = true;
        return;
      }
      stats.deltaCycles++;

      // 3. Run callbacks in ascending component order: timers first, then one evaluate.
      sortAscending(this.active, this.activeCount);
      const ctx = this.ctx;
      for (let i = 0; i < this.activeCount; i++) {
        const c = this.active[i]!;
        const behavior = this.behaviors[c]!;
        ctx.bind(c, delta);
        if (this.wakeStamp[c] === delta) {
          for (let w = this.wakeHead[c]!; w >= 0; w = this.wakeNext[w]!) {
            stats.evaluations++;
            behavior.wake?.(ctx, this.wakeToken[w]!);
          }
        }
        if (this.dirtyStamp[c] === delta && behavior.evaluate) {
          stats.evaluations++;
          behavior.evaluate(ctx);
        }
      }

      // Zero-delay drives scheduled above land at t → another delta.
      if (queue.peekTime() !== t) return;
    }
  }

  private updateNet(net: number, delta: number): void {
    const drive = this.resolveDrive(net);
    this.drives[net] = drive;
    const level = drive & 3;
    const old = this.levels[net]!;
    if (level === old) return;
    this.prevLevels[net] = old;
    this.levels[net] = level;
    this.changeStamp[net] = delta;
    this.floatingReported[net] = 0;
    if (this.listeners.length > 0) {
      for (const listener of this.listeners) listener(this.currentTime, net, level as Level);
    }
    const end = this.netReaderStart[net + 1]!;
    for (let r = this.netReaderStart[net]!; r < end; r++)
      this.markDirty(this.netReaders[r]!, delta);
  }

  /** Resolves a net's drivers; tracks contention as a side effect. */
  private resolveDrive(net: number): number {
    const start = this.netDriverStart[net]!;
    const end = this.netDriverStart[net + 1]!;
    if (end - start === 1) return this.slotDrive[this.netDrivers[start]!]!;
    let bits = 0;
    for (let s = start; s < end; s++)
      bits |= driveBits(this.slotDrive[this.netDrivers[s]!]! as Drive);
    const contention = isContentionBits(bits);
    if (contention !== (this.contended[net] === 1)) {
      this.contended[net] = contention ? 1 : 0;
      if (contention) this.reportContention(net);
    }
    return resolveBits(bits);
  }

  private markDirty(c: number, delta: number): void {
    this.dirtyStamp[c] = delta;
    this.activate(c, delta);
  }

  private activate(c: number, delta: number): void {
    if (this.activeStamp[c] === delta) return;
    this.activeStamp[c] = delta;
    this.active[this.activeCount++] = c;
  }

  private addWake(c: number, token: number, delta: number): void {
    if (this.wakeCount === this.wakeToken.length) {
      this.wakeToken = growInt32(this.wakeToken);
      this.wakeNext = growInt32(this.wakeNext);
    }
    const w = this.wakeCount++;
    this.wakeToken[w] = token;
    this.wakeNext[w] = -1;
    if (this.wakeStamp[c] !== delta) {
      this.wakeStamp[c] = delta;
      this.wakeHead[c] = w;
    } else {
      this.wakeNext[this.wakeTail[c]!] = w;
    }
    this.wakeTail[c] = w;
    this.activate(c, delta);
  }

  // --- Called by the context ------------------------------------------------------------------

  /** Flat index of a component's pin; throws on an out-of-range `PinRef` (a part bug). */
  private flat(c: number, pin: PinRef): number {
    const flat = this.pinStart[c]! + pin;
    if (pin < 0 || flat >= this.pinStart[c + 1]!) {
      throw new Error(`${this.componentId(c)}: no pin #${pin}`);
    }
    return flat;
  }

  /** @internal */
  scheduleDrive(c: number, pin: PinRef, drive: Drive, delay: Time): void {
    const slot = this.pinSlot[this.flat(c, pin)]!;
    if (slot < 0)
      throw new Error(`${this.componentId(c)}: pin ${this.pinName(c, pin)} cannot drive`);
    if (!(delay >= 0)) throw new Error(`${this.componentId(c)}: invalid delay ${delay}`);
    // Inertial delay: confirming the pending value keeps it; anything else cancels it, and a
    // change is scheduled only if it differs from what the pin drives now.
    if (this.slotPendingSeq[slot] !== NO_EVENT) {
      if (this.slotPendingDrive[slot] === drive) return;
      this.slotPendingSeq[slot] = NO_EVENT;
    }
    if (this.slotDrive[slot] === drive) return;
    this.slotPendingDrive[slot] = drive;
    this.slotPendingSeq[slot] = this.queue.push(this.currentTime + delay, EVENT_DRIVE, slot, drive);
  }

  /** @internal */
  scheduleWake(c: number, delay: Time, token: number): void {
    if (!(delay >= 0)) throw new Error(`${this.componentId(c)}: invalid delay ${delay}`);
    this.queue.push(this.currentTime + delay, EVENT_WAKE, c, token | 0);
  }

  /** @internal */
  readPin(c: number, pin: PinRef): Level {
    const flat = this.flat(c, pin);
    const net = this.pinNets[flat]!;
    if (net < 0) return Level.Z;
    const level = this.levels[net]!;
    if (level === Level.Z && this.pinReads[flat] === 1 && this.floatingReported[net] === 0) {
      this.floatingReported[net] = 1;
      this.reportFloating(c, pin, net);
    }
    return level as Level;
  }

  /** @internal */
  pinChanged(c: number, pin: PinRef, delta: number): boolean {
    const net = this.pinNets[this.flat(c, pin)]!;
    return net >= 0 && this.changeStamp[net] === delta;
  }

  /** @internal */
  prevLevel(c: number, pin: PinRef, delta: number): Level {
    const net = this.pinNets[this.flat(c, pin)]!;
    if (net < 0) return Level.Z;
    return (this.changeStamp[net] === delta ? this.prevLevels[net]! : this.levels[net]!) as Level;
  }

  /** @internal */
  componentId(c: number): string {
    return this.netlist.components[c]!.id;
  }

  /** @internal */
  stateAt(c: number): unknown {
    return this.states[c];
  }

  /** @internal */
  report(c: number, d: ComponentDiagnostic): void {
    const pin = d.pin === undefined ? undefined : this.pinName(c, d.pin);
    this.diagnostics.add({
      time: this.currentTime,
      kind: d.kind,
      message: d.message,
      component: this.componentId(c),
      ...(pin === undefined ? {} : { pin }),
    });
  }

  // --- Diagnostics ------------------------------------------------------------------------------

  private pinName(c: number, pin: PinRef): string {
    return this.netlist.components[c]!.pins[pin]?.name ?? `#${pin}`;
  }

  private pinLabel(flat: number): string {
    let c = 0;
    while (this.pinStart[c + 1]! <= flat) c++;
    return `${this.componentId(c)}.${this.pinName(c, flat - this.pinStart[c]!)}`;
  }

  private reportContention(net: number): void {
    const parts: string[] = [];
    const end = this.netDriverStart[net + 1]!;
    for (let s = this.netDriverStart[net]!; s < end; s++) {
      const slot = this.netDrivers[s]!;
      const drive = this.slotDrive[slot]! as Drive;
      if (drive !== Drive.Z)
        parts.push(`${this.pinLabel(this.slotPin[slot]!)} drives ${driveName(drive)}`);
    }
    const id = this.netId(net);
    this.diagnostics.add({
      time: this.currentTime,
      kind: KernelDiagnosticKind.CONTENTION,
      message: `bus contention on net "${id}": ${parts.join(', ')}`,
      net: id,
    });
  }

  private reportFloating(c: number, pin: PinRef, net: number): void {
    const id = this.netId(net);
    const label = `${this.componentId(c)}.${this.pinName(c, pin)}`;
    const what = this.netlist.nets[net]!.implicit ? 'is unconnected' : `reads net "${id}"`;
    this.diagnostics.add({
      time: this.currentTime,
      kind: KernelDiagnosticKind.FLOATING_INPUT,
      message: `floating input: ${label} ${what}, which nothing drives (reads as X)`,
      net: id,
      component: this.componentId(c),
      pin: this.pinName(c, pin),
    });
  }

  private reportOscillation(t: Time): void {
    const nets: string[] = [];
    for (let i = 0; i < Math.min(this.touchedCount, 5); i++) {
      const net = this.touched[i]!;
      nets.push(`${this.netId(net)}=${levelChar(this.levels[net] as Level)}`);
    }
    const more = this.touchedCount > 5 ? `, … (${this.touchedCount} nets)` : '';
    this.diagnostics.add({
      time: t,
      kind: KernelDiagnosticKind.OSCILLATION,
      message:
        `oscillation: more than ${this.maxDeltaCycles} delta cycles at ${formatTime(t)} ` +
        `(a zero-delay loop?); still changing: ${nets.join(', ')}${more}. Simulation halted.`,
      ...(this.touchedCount > 0 ? { net: this.netId(this.touched[0]!) } : {}),
    });
  }
}

/**
 * The single context object handed to behaviors; `bind` points it at the component being run.
 * `delta` is the triggering delta id, or −1 outside delta cycles (init, actions), where nothing
 * counts as changed.
 */
class Context implements EvalContext<unknown> {
  private readonly sim: Simulator;
  private c = 0;
  private delta = -1;
  id = '';
  state: unknown = undefined;

  constructor(sim: Simulator) {
    this.sim = sim;
  }

  bind(c: number, delta: number): void {
    this.c = c;
    this.delta = delta;
    this.id = this.sim.componentId(c);
    this.state = this.sim.stateAt(c);
  }

  get now(): Time {
    return this.sim.now;
  }

  read(pin: PinRef): Level {
    return this.sim.readPin(this.c, pin);
  }

  prev(pin: PinRef): Level {
    return this.sim.prevLevel(this.c, pin, this.delta);
  }

  changed(pin: PinRef): boolean {
    return this.sim.pinChanged(this.c, pin, this.delta);
  }

  rose(pin: PinRef): boolean {
    const sim = this.sim;
    return (
      sim.pinChanged(this.c, pin, this.delta) &&
      sim.prevLevel(this.c, pin, this.delta) === Level.L0 &&
      sim.readPin(this.c, pin) === Level.L1
    );
  }

  fell(pin: PinRef): boolean {
    const sim = this.sim;
    return (
      sim.pinChanged(this.c, pin, this.delta) &&
      sim.prevLevel(this.c, pin, this.delta) === Level.L1 &&
      sim.readPin(this.c, pin) === Level.L0
    );
  }

  drive(pin: PinRef, drive: Drive, delay: Time): void {
    this.sim.scheduleDrive(this.c, pin, drive, delay);
  }

  wakeAfter(delay: Time, token = 0): void {
    this.sim.scheduleWake(this.c, delay, token);
  }

  report(diagnostic: ComponentDiagnostic): void {
    this.sim.report(this.c, diagnostic);
  }
}

/** Resolved props are complete records of primitives: equal when every value is. */
function sameProps(
  a: Readonly<Record<string, PropValue>>,
  b: Readonly<Record<string, PropValue>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** In-place ascending sort of `a[0..n)`; insertion sort for the common small case. */
function sortAscending(a: Int32Array, n: number): void {
  if (n > 32) {
    a.subarray(0, n).sort();
    return;
  }
  for (let i = 1; i < n; i++) {
    const v = a[i]!;
    let j = i - 1;
    while (j >= 0 && a[j]! > v) {
      a[j + 1] = a[j]!;
      j--;
    }
    a[j + 1] = v;
  }
}

function growInt32(a: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const b = new Int32Array(a.length * 2);
  b.set(a);
  return b;
}

/**
 * The debugger's model (R14): breakpoints — the trigger's conditions on any signal, repeating —
 * and breaks on errors or warnings, which pause the host; steps (Step Clock, Run For, Run To);
 * watches of signals and memory cells marking what changed since the last stop; and run
 * statistics. The debug setup lives in the session, not in the document (ADR-0020). No DOM: the
 * Debug tab draws it, and tests drive it with a fake clock. Spec: docs/editor.md#debugger.
 */
import { type ProbeRadix, Resolver, renameReference } from '../circuit';
import {
  busMembers,
  conditionProblems,
  diagnosticSeverity,
  formatTime,
  isBusName,
  Level,
  Recorder,
  resolveProps,
  type Simulator,
  type Time,
  Trigger,
  type TriggerTerm,
  us,
} from '../core';
import { clockPhases } from '../library';
import { formatValue } from './analyzer';
import type { Editor } from './editor';
import type { Scene } from './scene';
import type { SimClock } from './simulation';
import { Store } from './store';

/**
 * A signal as the debugger takes it: one reference (`CLK`, `U3.QA`, `D[0..7]`), or several
 * 1-bit references, bit 0 first, read as one value (`U3.Q0 U3.Q1 U3.Q2 U3.Q3`).
 */
export type DebugSignal = string;

/** One term of a breakpoint's condition (ANDed), on a signal. */
export interface DebugTerm {
  readonly signal: DebugSignal;
  readonly kind: TriggerTerm['kind'];
  /** For `level`. */
  readonly level?: Level;
  /** For `equal` / `notEqual`: hex digits, `X` for any. */
  readonly value?: string;
}

export interface Breakpoint {
  /** Stable, counted from 1: "Breakpoint 2". */
  readonly id: number;
  readonly terms: readonly DebugTerm[];
  readonly enabled: boolean;
  /** Stop from this hit on (hits counted since power-on); every hit when absent. */
  readonly hitCount?: number;
}

/** A watch: a signal, or cells of a memory part (kept as data, so a rename rewrites it). */
export type Watch =
  | {
      readonly kind: 'signal';
      readonly signal: DebugSignal;
      readonly name?: string;
      readonly radix?: ProbeRadix;
    }
  | {
      readonly kind: 'cells';
      readonly part: string;
      readonly from: number;
      readonly to: number;
      readonly name?: string;
      readonly radix?: ProbeRadix;
    };

/** What the session keeps of the debugger (ADR-0020). */
export interface DebugSetup {
  readonly breakpoints: readonly Breakpoint[];
  readonly watches: readonly Watch[];
  /** The step clock; absent: the default (`defaultClock`). */
  readonly clock?: DebugSignal;
  readonly edge: 'rise' | 'fall';
  /** Run For's duration. */
  readonly runFor: Time;
  readonly breakOnErrors: boolean;
  readonly breakOnWarnings: boolean;
}

export const EMPTY_DEBUG_SETUP: DebugSetup = {
  breakpoints: [],
  watches: [],
  edge: 'rise',
  runFor: us(1),
  breakOnErrors: false,
  breakOnWarnings: false,
};

export interface BreakpointView {
  readonly breakpoint: Breakpoint;
  /** `CLK ↑ · D[0..7] = 2B`. */
  readonly text: string;
  /** Hits since power-on (disabled breakpoints count none). */
  readonly hits: number;
  /** Why it can't stop the run; undefined when armed. */
  readonly problem?: string;
}

export interface WatchView {
  readonly index: number;
  readonly watch: Watch;
  /** Its name, else what it watches (`U5[0x10..0x1F]`). */
  readonly label: string;
  readonly reference: string;
  /** The value now (`0x3F`, `3F 06 5B`, `1`); empty when there is nothing to show. */
  readonly value: string;
  /** Shown as a value in a radix (a bus, a group, memory cells), not as one level. */
  readonly vector: boolean;
  /** Differs from its value at the last stop (while paused: at the stop before). */
  readonly changed: boolean;
  readonly problem?: string;
}

export interface RunCounters {
  /** Simulated time. */
  readonly time: Time;
  /** Wall time spent running, ms. */
  readonly wall: number;
  readonly events: number;
  readonly deltaCycles: number;
  readonly evaluations: number;
}

export interface RunStats {
  /** Since power-on. */
  readonly total: RunCounters;
  /** Since the last run began (Run, or a step of the Debug tab). */
  readonly last: RunCounters;
}

export interface NetActivity {
  /** The net's name, else a pin on it. */
  readonly net: string;
  readonly changes: number;
  /** `changes / 2` over the time measured, Hz (a clock's frequency). */
  readonly frequency: number;
}

const DEBUG_BUDGET = 65_536;
const EDGE_TEXT: Readonly<Record<string, string>> = { rise: '↑', fall: '↓', edge: '↕' };

const TERM_KINDS: readonly string[] = ['rise', 'fall', 'edge', 'level', 'equal', 'notEqual'];
const RADIXES: readonly string[] = ['hex', 'dec', 'bin', 'ascii'];

/**
 * A debug setup read back from storage (a session written by this or an older version): what
 * doesn't have the expected shape is left out, so a bad entry never breaks a restore.
 */
export function parseDebugSetup(raw: unknown): DebugSetup | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const radix = (v: unknown) =>
    typeof v === 'string' && RADIXES.includes(v) ? { radix: v as ProbeRadix } : {};
  const name = (v: unknown) => (typeof v === 'string' && v !== '' ? { name: v } : {});
  const term = (t: unknown): DebugTerm | undefined => {
    const o = t as Record<string, unknown> | null;
    if (!o || typeof o.signal !== 'string' || !TERM_KINDS.includes(String(o.kind))) {
      return undefined;
    }
    return {
      signal: o.signal,
      kind: o.kind as DebugTerm['kind'],
      ...(typeof o.level === 'number' && { level: o.level as Level }),
      ...(typeof o.value === 'string' && { value: o.value }),
    };
  };
  const breakpoints = (Array.isArray(r.breakpoints) ? r.breakpoints : []).flatMap(
    (b): Breakpoint[] => {
      const o = b as Record<string, unknown> | null;
      if (!o || !Number.isInteger(o.id) || !Array.isArray(o.terms)) return [];
      const terms = o.terms.map(term);
      if (terms.some((t) => t === undefined)) return [];
      return [
        {
          id: o.id as number,
          terms: terms as DebugTerm[],
          enabled: o.enabled !== false,
          ...hitCountOf(typeof o.hitCount === 'number' ? o.hitCount : undefined),
        },
      ];
    },
  );
  const watches = (Array.isArray(r.watches) ? r.watches : []).flatMap((w): Watch[] => {
    const o = w as Record<string, unknown> | null;
    if (o?.kind === 'signal' && typeof o.signal === 'string') {
      return [{ kind: 'signal', signal: o.signal, ...name(o.name), ...radix(o.radix) }];
    }
    if (
      o?.kind === 'cells' &&
      typeof o.part === 'string' &&
      Number.isInteger(o.from) &&
      Number.isInteger(o.to)
    ) {
      const cells = { part: o.part, from: o.from as number, to: o.to as number };
      return [{ kind: 'cells', ...cells, ...name(o.name), ...radix(o.radix) }];
    }
    return [];
  });
  const clock = text(r.clock);
  return {
    breakpoints,
    watches,
    ...(clock && { clock }),
    edge: r.edge === 'fall' ? 'fall' : 'rise',
    runFor:
      typeof r.runFor === 'number' && r.runFor > 0
        ? Math.round(r.runFor)
        : EMPTY_DEBUG_SETUP.runFor,
    breakOnErrors: r.breakOnErrors === true,
    breakOnWarnings: r.breakOnWarnings === true,
  };
}

/** The members of a debug signal: one reference, or several 1-bit ones bit 0 first. */
export function signalMembers(signal: DebugSignal): string[] {
  return signal
    .split(/[\s,]+/)
    .map((m) => m.trim())
    .filter((m) => m !== '');
}

/** A term as text: `CLK ↑`, `U3.QA = 1`, `D[0..7] ≠ 2B`. */
export function termText(term: DebugTerm): string {
  const { signal, kind } = term;
  if (kind === 'rise' || kind === 'fall' || kind === 'edge') return `${signal} ${EDGE_TEXT[kind]}`;
  if (kind === 'level') return `${signal} = ${levelText(term.level ?? Level.L1)}`;
  return `${signal} ${kind === 'equal' ? '=' : '≠'} ${(term.value ?? '').toUpperCase()}`;
}

function levelText(level: Level): string {
  return level === Level.L0 ? '0' : level === Level.L1 ? '1' : level === Level.X ? 'X' : 'Z';
}

/** `U5[0x1F]`, `U5[0x10..0x1F]`. */
export function cellsReference(part: string, from: number, to: number): string {
  const hex = (a: number) => `0x${a.toString(16).toUpperCase().padStart(2, '0')}`;
  return from === to ? `${part}[${hex(from)}]` : `${part}[${hex(from)}..${hex(to)}]`;
}

/** A watch's reference as text. */
export function watchReference(watch: Watch): string {
  return watch.kind === 'cells' ? cellsReference(watch.part, watch.from, watch.to) : watch.signal;
}

/**
 * Cells as text: one cell as a value (`0x3F`, `63`, `00111111`, `?`), a range as its cells
 * (`3F 06 5B`; ASCII as one string); unknown bits as `X`.
 */
export function formatCells(
  data: ArrayLike<number>,
  unknown: ArrayLike<number>,
  width: number,
  radix: ProbeRadix,
): string {
  const digits = Math.ceil(width / 4);
  const cell = (value: number, x: number): string => {
    switch (radix) {
      case 'hex': {
        let text = '';
        for (let d = digits - 1; d >= 0; d--) {
          const mask = 0xf << (d * 4);
          text += x & mask ? 'X' : ((value & mask) >> (d * 4)).toString(16).toUpperCase();
        }
        return text;
      }
      case 'dec':
        return x ? 'X' : String(value);
      case 'bin': {
        let text = '';
        for (let b = width - 1; b >= 0; b--) text += x & (1 << b) ? 'X' : (value >> b) & 1;
        return text;
      }
      case 'ascii':
        return x ? 'X' : value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : '.';
    }
  };
  const cells = Array.from(data, (value, i) => cell(value, unknown[i] ?? 0));
  if (radix === 'ascii') return cells.join('');
  if (cells.length === 1 && radix === 'hex') return `0x${cells[0]}`;
  return cells.join(' ');
}

/** The debugger of an editor: `editor.debug`. */
export class Debugger {
  readonly setup = new Store<DebugSetup>(EMPTY_DEBUG_SETUP);
  readonly breakpoints = new Store<readonly BreakpointView[]>([]);
  readonly watches = new Store<readonly WatchView[]>([]);
  readonly #editor: Editor;
  readonly #clock: SimClock;
  /** The levels breakpoints are evaluated on: only their signals. */
  readonly #recorder = new Recorder({ budget: DEBUG_BUDGET });
  #scene: Scene | undefined;
  #sim: Simulator | undefined;
  /** Recorder channel by bit reference; net id (of the scene's compile) by bit reference. */
  #bits = new Map<string, number>();
  #nets = new Map<string, string>();
  /**
   * Built breakpoints, by id: their trigger (kept while its condition is the same: a carry-over
   * processes the instant it fired at again, and a fresh trigger would fire there twice), or
   * why there is none.
   */
  #built = new Map<number, { key: string; trigger?: Trigger; problem?: string }>();
  #hits = new Map<number, number>();
  #offDiagnostics: (() => void) | undefined;
  // Watches: values at the last stop and the one before, by reference.
  #lastStop = new Map<string, string>();
  #prevStop = new Map<string, string>();
  #stopAt = { time: -1, events: -1 };
  // Statistics: wall time running, and the counters when the last run began.
  #wall = 0;
  #runningSince: number | undefined;
  #lastRun: RunCounters = { time: 0, wall: 0, events: 0, deltaCycles: 0, evaluations: 0 };
  // Activity, while measured: changes per net index of `#sim` since `#activityFrom`.
  #activity: Float64Array | undefined;
  #activityFrom = 0;
  #offActivity: (() => void) | undefined;

  constructor(editor: Editor, clock: SimClock) {
    this.#editor = editor;
    this.#clock = clock;
    const sync = () => this.#sync();
    editor.state.subscribe(sync);
    editor.simulation.status.subscribe(sync);
    editor.simulation.ticks.subscribe(() => {
      this.#noteStop();
      this.#refresh();
    });
    this.setup.subscribe(() => {
      this.#rebuild();
      this.#refresh();
    });
    this.#sync();
  }

  // ── The setup ───────────────────────────────────────────────────────────────────────────

  /** Replaces the setup (a restored session); New and Open pass `EMPTY_DEBUG_SETUP`. */
  load(setup: DebugSetup): void {
    this.setup.set(setup);
  }

  /** Adds a breakpoint; its id, or why not. */
  addBreakpoint(terms: readonly DebugTerm[], hitCount?: number): number | string {
    const problem = this.termProblems(terms)[0];
    if (problem !== undefined) return problem;
    const setup = this.setup.get();
    const id = Math.max(0, ...setup.breakpoints.map((b) => b.id)) + 1;
    const breakpoint: Breakpoint = { id, terms, enabled: true, ...hitCountOf(hitCount) };
    this.setup.set({ ...setup, breakpoints: [...setup.breakpoints, breakpoint] });
    return id;
  }

  /** Changes a breakpoint's terms, hit count or enabled state; why not instead. */
  updateBreakpoint(
    id: number,
    changes: {
      readonly terms?: readonly DebugTerm[];
      readonly enabled?: boolean;
      readonly hitCount?: number | undefined;
    },
  ): string | undefined {
    if (changes.terms) {
      const problem = this.termProblems(changes.terms)[0];
      if (problem !== undefined) return problem;
    }
    this.#setBreakpoints((b) => {
      if (b.id !== id) return b;
      const { hitCount: _, ...rest } = b;
      const hitCount = 'hitCount' in changes ? changes.hitCount : b.hitCount;
      return { ...rest, ...changes, ...hitCountOf(hitCount) } as Breakpoint;
    });
    return undefined;
  }

  removeBreakpoint(id: number): void {
    const setup = this.setup.get();
    this.setup.set({ ...setup, breakpoints: setup.breakpoints.filter((b) => b.id !== id) });
  }

  /** Enables or disables every breakpoint. */
  enableAll(enabled: boolean): void {
    this.#setBreakpoints((b) => (b.enabled === enabled ? b : { ...b, enabled }));
  }

  /** Why these terms can't make a breakpoint (empty when they can). */
  termProblems(terms: readonly DebugTerm[]): string[] {
    const built = this.#buildTerms(terms, new Resolver(this.#compiled(), this.#editor.registry));
    return typeof built === 'string' ? [built] : conditionProblems(built.terms);
  }

  setBreakOn(changes: { readonly errors?: boolean; readonly warnings?: boolean }): void {
    const setup = this.setup.get();
    this.setup.set({
      ...setup,
      breakOnErrors: changes.errors ?? setup.breakOnErrors,
      breakOnWarnings: changes.warnings ?? setup.breakOnWarnings,
    });
  }

  /** Adds a watch from text: a signal, or memory cells (`U5[1F]`); why not instead. */
  addWatch(text: string): string | undefined {
    const watch = this.#parseWatch(text);
    if (typeof watch === 'string') return watch;
    const setup = this.setup.get();
    const reference = watchReference(watch);
    if (setup.watches.some((w) => watchReference(w) === reference)) {
      return `${reference} is watched already.`;
    }
    this.setup.set({ ...setup, watches: [...setup.watches, watch] });
    return undefined;
  }

  removeWatch(index: number): void {
    const setup = this.setup.get();
    this.setup.set({ ...setup, watches: setup.watches.filter((_, i) => i !== index) });
  }

  /** Renames a watch (empty: its reference) or changes its radix. */
  updateWatch(
    index: number,
    changes: { readonly name?: string; readonly radix?: ProbeRadix },
  ): void {
    const setup = this.setup.get();
    const watches = setup.watches.map((w, i) => {
      if (i !== index) return w;
      const { name: _, ...rest } = w;
      const name = (changes.name ?? w.name ?? '').trim();
      return { ...rest, ...(name !== '' && { name }), radix: changes.radix ?? w.radix } as Watch;
    });
    this.setup.set({ ...setup, watches });
  }

  /** Chooses the step clock (`undefined`: the default) and its edge; why not instead. */
  setClock(clock: DebugSignal | undefined, edge?: 'rise' | 'fall'): string | undefined {
    const setup = this.setup.get();
    if (clock !== undefined && clock.trim() !== '') {
      const problem = this.#clockNet(clock.trim());
      if (typeof problem === 'string') return problem;
    }
    const { clock: _, ...rest } = setup;
    const trimmed = clock?.trim();
    this.setup.set({
      ...rest,
      ...(trimmed && { clock: trimmed }),
      edge: edge ?? setup.edge,
    });
    return undefined;
  }

  setRunFor(duration: Time): void {
    if (!(duration > 0)) return;
    this.setup.set({ ...this.setup.get(), runFor: Math.round(duration) });
  }

  // ── Steps ───────────────────────────────────────────────────────────────────────────────

  /**
   * The step clock: the setup's, else the default — the net named `CLK`, else the output of
   * the first clock part (`io/clock` Y, `timer/ne555` OUT) — with its net or why it has none.
   */
  clock(): { readonly signal?: DebugSignal; readonly net?: string; readonly problem?: string } {
    const signal = this.setup.get().clock ?? this.defaultClock();
    if (signal === undefined) {
      return { problem: 'No clock to step by: name a net CLK or choose the step clock.' };
    }
    const net = this.#clockNet(signal);
    return typeof net === 'string' ? { signal, problem: net } : { signal, net: net.net };
  }

  /** The net named `CLK`, else the first clock part's output; undefined when neither exists. */
  defaultClock(): DebugSignal | undefined {
    const resolver = new Resolver(this.#compiled(), this.#editor.registry);
    const clk = resolver.resolve('CLK');
    if (typeof clk !== 'string' && clk.kind === 'net') return 'CLK';
    const outputs: Readonly<Record<string, string>> = { 'io/clock': 'Y', 'timer/ne555': 'OUT' };
    const part = resolver.parts
      .filter((p) => outputs[p.type] !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))[0];
    return part && `${part.id}.${outputs[part.type]}`;
  }

  /**
   * Step Clock: right before the step clock's next active edge but one. A manual `io/clock`
   * has no edge coming: it gets one pulse (its `step` action, the button of a clock module)
   * and the run goes on for one period of its props — high, then low, as a hand pressing the
   * button again later (a press at the instant the last pulse ended would be a 0 ps LOW, a
   * pulse-width violation). From stopped: power-on and the low time. Why not instead.
   */
  stepClock(): string | undefined {
    const { signal, net, problem } = this.clock();
    if (problem !== undefined || net === undefined) return problem;
    const host = this.#editor.simulation;
    const manual = this.#manualClock(net);
    if (manual !== undefined) {
      if (host.state === 'halted') return 'The simulation is halted: Reset or Stop first.';
      const { high, low } = manual.phases;
      const now = host.simulator?.now ?? 0;
      const stopped = host.state === 'stopped';
      if (!stopped) host.action(manual.id, { type: 'step' });
      const until = now + (stopped ? low : high + low);
      host.runTo({ kind: 'time', until, label: `Step Clock (${manual.id} pulse)` });
      return undefined;
    }
    const { edge } = this.setup.get();
    const ok = this.#editor.simulation.runTo({
      kind: 'edge',
      net,
      level: edge === 'rise' ? Level.L1 : Level.L0,
      label: `Step Clock (${signal} ${EDGE_TEXT[edge]})`,
    });
    return ok ? undefined : 'The simulation is halted: Reset or Stop first.';
  }

  /** The manual `io/clock` driving a net of the scene, with its phases, if one does. */
  #manualClock(net: string): { id: string; phases: { high: Time; low: Time } } | undefined {
    const compiled = this.#compiled();
    const pins = compiled.nets.find((n) => n.id === net)?.pins ?? [];
    for (const pin of pins) {
      const part = compiled.netlist.components.find((c) => c.id === pin.component);
      const definition = part && this.#editor.registry.get(part.type);
      if (part?.type !== 'io/clock' || !definition) continue;
      // Documents may leave props at their defaults out.
      const { frequency, duty, mode } = resolveProps(definition, part.props);
      if (mode !== 'manual') continue;
      return { id: part.id, phases: clockPhases(Number(frequency), Number(duty)) };
    }
    return undefined;
  }

  /** Run For the setup's duration (or `duration`). */
  runFor(duration = this.setup.get().runFor): string | undefined {
    const now = this.#editor.simulation.simulator?.now ?? 0;
    return this.#runTo(now + duration, `Run For ${formatTime(duration)}`);
  }

  /** Run To a simulated time; why not instead. */
  runToTime(time: Time): string | undefined {
    const now = this.#editor.simulation.simulator?.now ?? 0;
    if (time <= now) return `The simulation is at ${formatTime(now)} already.`;
    return this.#runTo(time, `Run To ${formatTime(time)}`);
  }

  #runTo(until: Time, label: string): string | undefined {
    const ok = this.#editor.simulation.runTo({ kind: 'time', until, label });
    return ok ? undefined : 'The simulation is halted: Reset or Stop first.';
  }

  // ── Statistics ──────────────────────────────────────────────────────────────────────────

  /** The run's counters since power-on and since the last run began. */
  stats(): RunStats {
    const total = this.#counters();
    const last = this.#lastRun;
    return {
      total,
      last: {
        time: total.time - last.time,
        wall: total.wall - last.wall,
        events: total.events - last.events,
        deltaCycles: total.deltaCycles - last.deltaCycles,
        evaluations: total.evaluations - last.evaluations,
      },
    };
  }

  /** Measuring activity (changes per net) since `activityFrom`. */
  get measuring(): boolean {
    return this.#activity !== undefined;
  }

  get activityFrom(): Time {
    return this.#activityFrom;
  }

  /** Starts (from now) or stops counting each net's changes. */
  measureActivity(on: boolean): void {
    this.#offActivity?.();
    this.#offActivity = undefined;
    this.#activity = undefined;
    if (!on) return;
    this.#activity = new Float64Array(0);
    this.#activityFrom = this.#sim?.now ?? 0;
    if (this.#sim) this.#countActivity(this.#sim, new Map());
  }

  /** The most active nets, most changes first. */
  activity(count = 10): NetActivity[] {
    const sim = this.#sim;
    const counts = this.#activity;
    if (!sim || !counts) return [];
    const span = (sim.now - this.#activityFrom) / 1e12;
    const resolver = new Resolver(this.#compiled(), this.#editor.registry);
    const names = new Map<number, string>();
    for (const net of this.#compiled().nets) {
      const index = this.#editor.simulation.netOf(net.id);
      if (index !== undefined && !names.has(index)) {
        names.set(index, resolver.netReference(net.id) ?? net.id);
      }
    }
    const found: NetActivity[] = [];
    counts.forEach((changes, n) => {
      if (changes === 0) return;
      found.push({
        net: names.get(n) ?? sim.netId(n),
        changes,
        frequency: span > 0 ? changes / 2 / span : 0,
      });
    });
    return found.sort((a, b) => b.changes - a.changes).slice(0, count);
  }

  // ── Following the editor ────────────────────────────────────────────────────────────────

  #compiled() {
    return this.#editor.state.get().scene.compiled;
  }

  #sync(): void {
    const { scene, renames } = this.#editor.state.get();
    let changed = false;
    if (scene !== this.#scene) {
      this.#scene = scene;
      if (renames) this.#rename(renames);
      changed = true;
    }
    const host = this.#editor.simulation;
    const sim = host.simulator;
    this.#trackWall();
    if (sim !== this.#sim) {
      const old = this.#sim;
      this.#sim = sim;
      if (!sim) {
        this.#recorder.detach();
        for (const built of this.#built.values()) built.trigger?.disarm();
        this.#offDiagnostics?.();
        this.#offDiagnostics = undefined;
        this.#offActivity?.();
        this.#offActivity = undefined;
      } else {
        const powerOn = sim.now === 0 && sim.stats.events === 0;
        if (powerOn) this.#powerOn();
        this.#rebuild();
        this.#watchDiagnostics(sim);
        if (this.#activity)
          this.#countActivity(sim, powerOn || !old ? new Map() : this.#carried(old));
      }
      changed = true;
    } else if (changed) {
      this.#rebuild();
    }
    this.#noteStop();
    if (changed) this.#refresh();
  }

  #powerOn(): void {
    this.#recorder.clear();
    this.#hits.clear();
    this.#lastStop = new Map();
    this.#prevStop = new Map();
    this.#stopAt = { time: -1, events: -1 };
    this.#wall = 0;
    this.#runningSince =
      this.#editor.simulation.state === 'running' ? this.#clock.now() : undefined;
    this.#lastRun = { time: 0, wall: 0, events: 0, deltaCycles: 0, evaluations: 0 };
    this.#activityFrom = 0;
  }

  /** Wall time while running, and the counters each time a run begins. */
  #trackWall(): void {
    const running = this.#editor.simulation.state === 'running' && this.#sim !== undefined;
    const now = this.#clock.now();
    if (running && this.#runningSince === undefined) {
      this.#runningSince = now;
      this.#lastRun = this.#counters();
    } else if (!running && this.#runningSince !== undefined) {
      this.#wall += now - this.#runningSince;
      this.#runningSince = undefined;
    }
  }

  #counters(): RunCounters {
    const sim = this.#editor.simulation.simulator;
    const wall =
      this.#wall + (this.#runningSince === undefined ? 0 : this.#clock.now() - this.#runningSince);
    if (!sim) return { time: 0, wall, events: 0, deltaCycles: 0, evaluations: 0 };
    return { time: sim.now, wall, ...sim.stats };
  }

  /** A new stop (paused after something ran): the watches compare against the one before. */
  #noteStop(): void {
    const sim = this.#sim;
    if (!sim || this.#editor.simulation.state !== 'paused') return;
    const at = { time: sim.now, events: sim.stats.events };
    if (at.time === 0 && at.events === 0) return; // powered on, nothing run yet
    if (at.time === this.#stopAt.time && at.events === this.#stopAt.events) return;
    this.#stopAt = at;
    this.#prevStop = this.#lastStop;
    this.#lastStop = new Map(this.#watchValues().map((v) => [v.reference, v.value]));
  }

  #setBreakpoints(map: (b: Breakpoint) => Breakpoint): void {
    const setup = this.setup.get();
    const breakpoints = setup.breakpoints.map(map);
    if (breakpoints.every((b, i) => b === setup.breakpoints[i])) return;
    this.setup.set({ ...setup, breakpoints });
  }

  /** Part renames rewrite the setup's references. */
  #rename(renames: ReadonlyMap<string, string>): void {
    const setup = this.setup.get();
    const signal = (s: DebugSignal) => {
      let members = signalMembers(s);
      for (const [from, to] of renames) members = members.map((m) => renameReference(m, from, to));
      return members.join(' ') === signalMembers(s).join(' ') ? s : members.join(' ');
    };
    const breakpoints = setup.breakpoints.map((b) => {
      const terms = b.terms.map((t) => ({ ...t, signal: signal(t.signal) }));
      return terms.every((t, i) => t.signal === b.terms[i]!.signal) ? b : { ...b, terms };
    });
    const watches = setup.watches.map((w): Watch => {
      if (w.kind === 'signal') {
        const renamed = signal(w.signal);
        return renamed === w.signal ? w : { ...w, signal: renamed };
      }
      const part = renames.get(w.part);
      return part === undefined ? w : { ...w, part };
    });
    const clock = setup.clock === undefined ? undefined : signal(setup.clock);
    const same =
      breakpoints.every((b, i) => b === setup.breakpoints[i]) &&
      watches.every((w, i) => w === setup.watches[i]) &&
      clock === setup.clock;
    if (!same) this.setup.set({ ...setup, breakpoints, watches, ...(clock && { clock }) });
  }

  // ── Breakpoints ─────────────────────────────────────────────────────────────────────────

  /** The breakpoints' triggers for the current scene and simulator. */
  #rebuild(): void {
    const old = this.#built;
    this.#built = new Map();
    const resolver = new Resolver(this.#compiled(), this.#editor.registry);
    const used = new Set<string>();
    const nets = new Map<string, string>();
    for (const breakpoint of this.setup.get().breakpoints) {
      const { id } = breakpoint;
      const built = this.#buildTerms(breakpoint.terms, resolver, used, nets);
      if (typeof built === 'string') {
        this.#built.set(id, { key: '', problem: built });
        continue;
      }
      const problems = conditionProblems(built.terms);
      if (problems.length > 0) {
        this.#built.set(id, { key: '', problem: problems.join('; ') });
        continue;
      }
      if (!breakpoint.enabled) {
        this.#built.set(id, { key: '' });
        continue;
      }
      const key = JSON.stringify(built.terms);
      const kept = old.get(id);
      if (kept?.trigger && kept.key === key) {
        old.delete(id);
        this.#built.set(id, kept);
        continue;
      }
      const trigger = new Trigger(this.#recorder, built.terms, () => this.#hit(id), {
        repeat: true,
      });
      this.#built.set(id, { key, trigger });
    }
    for (const built of old.values()) built.trigger?.disarm();
    for (const [key, channel] of this.#bits) {
      if (used.has(key)) continue;
      this.#recorder.removeChannel(channel);
      this.#bits.delete(key);
    }
    this.#nets = nets;
    const sim = this.#sim;
    if (!sim) return;
    const attached = new Map<number, number>();
    for (const [key, channel] of this.#bits) {
      const net = this.#nets.get(key);
      const index = net === undefined ? undefined : this.#editor.simulation.netOf(net);
      if (index !== undefined) attached.set(channel, index);
    }
    this.#recorder.attach(sim, attached);
    for (const built of this.#built.values()) built.trigger?.attach(sim);
  }

  /** Terms on recorder channels (created as needed), or why they can't be. */
  #buildTerms(
    terms: readonly DebugTerm[],
    resolver: Resolver,
    used = new Set<string>(),
    nets = new Map<string, string>(),
  ): { terms: TriggerTerm[] } | string {
    const built: TriggerTerm[] = [];
    for (const term of terms) {
      const members = signalMembers(term.signal);
      if (members.length === 0) return 'a term needs a signal';
      const one = members.length === 1 ? members[0]! : undefined;
      const target =
        one === undefined ? resolver.probe({ name: term.signal, members }) : resolver.signal(one);
      if (typeof target === 'string') return target;
      const keys = one === undefined ? members : isBusName(one) ? busMembers(one) : [one];
      const channels = keys.map((key, i) => {
        used.add(key);
        const net = target.nets[i];
        if (net !== undefined) nets.set(key, net);
        let channel = this.#bits.get(key);
        if (channel === undefined) {
          channel = this.#recorder.addChannel();
          this.#bits.set(key, channel);
        }
        return channel;
      });
      if (term.kind === 'equal' || term.kind === 'notEqual') {
        built.push({ kind: term.kind, channels, value: term.value ?? '' });
      } else if (target.vector) {
        return `${term.signal} is a value: an edge or level needs one signal`;
      } else if (term.kind === 'level') {
        built.push({ kind: 'level', channel: channels[0]!, level: term.level ?? Level.L1 });
      } else {
        built.push({ kind: term.kind, channel: channels[0]! });
      }
    }
    return { terms: built };
  }

  #hit(id: number): void {
    const breakpoint = this.setup.get().breakpoints.find((b) => b.id === id);
    if (!breakpoint) return;
    const hits = (this.#hits.get(id) ?? 0) + 1;
    this.#hits.set(id, hits);
    if (hits < (breakpoint.hitCount ?? 1)) return;
    const text = breakpoint.terms.map(termText).join(' · ');
    this.#editor.simulation.requestPause(`Breakpoint ${breakpoint.id}: ${text}`);
  }

  /** Breaks on errors and warnings (a carried-over simulator keeps the log: one listener). */
  #watchDiagnostics(sim: Simulator): void {
    this.#offDiagnostics?.();
    this.#offDiagnostics = sim.diagnostics.onOccurrence((d) => {
      const { breakOnErrors, breakOnWarnings } = this.setup.get();
      const severity = diagnosticSeverity(d);
      if (severity === 'error' ? !breakOnErrors : !breakOnWarnings) return;
      const what = severity === 'error' ? 'Error' : 'Warning';
      this.#editor.simulation.requestPause(`${what}: ${d.message}`);
    });
  }

  // ── Activity ────────────────────────────────────────────────────────────────────────────

  /** The counts of `old`'s nets by net id, for its successor after a carry-over. */
  #carried(old: Simulator): Map<string, number> {
    const counts = new Map<string, number>();
    this.#activity?.forEach((n, i) => {
      if (n > 0) counts.set(old.netId(i), n);
    });
    return counts;
  }

  #countActivity(sim: Simulator, carried: ReadonlyMap<string, number>): void {
    this.#offActivity?.();
    const counts = new Float64Array(sim.netCount);
    for (const [id, n] of carried) {
      try {
        counts[sim.netIndex(id)] = n;
      } catch {
        // a net the recompiled netlist doesn't have
      }
    }
    this.#activity = counts;
    this.#offActivity = sim.onNetChange((_, net) => {
      counts[net] = counts[net]! + 1;
    });
  }

  // ── Views ───────────────────────────────────────────────────────────────────────────────

  /** The views of breakpoints and watches (on setup and scene changes, and on the host's ticks). */
  #refresh(): void {
    const breakpoints = this.setup.get().breakpoints.map((breakpoint): BreakpointView => {
      const problem = this.#built.get(breakpoint.id)?.problem;
      return {
        breakpoint,
        text: breakpoint.terms.map(termText).join(' · '),
        hits: this.#hits.get(breakpoint.id) ?? 0,
        ...(problem !== undefined && { problem }),
      };
    });
    const shown = this.breakpoints.get();
    const sameBreakpoints =
      shown.length === breakpoints.length &&
      breakpoints.every((b, i) => {
        const s = shown[i]!;
        return s.breakpoint === b.breakpoint && s.hits === b.hits && s.problem === b.problem;
      });
    if (!sameBreakpoints) this.breakpoints.set(breakpoints);
    const watches = this.#watchValues();
    const old = this.watches.get();
    const sameWatches =
      old.length === watches.length &&
      watches.every((w, i) => {
        const o = old[i]!;
        return (
          o.watch === w.watch &&
          o.value === w.value &&
          o.changed === w.changed &&
          o.problem === w.problem
        );
      });
    if (!sameWatches) this.watches.set(watches);
  }

  #watchValues(): WatchView[] {
    const resolver = new Resolver(this.#compiled(), this.#editor.registry);
    const paused = this.#editor.simulation.state !== 'running';
    const base = paused ? this.#prevStop : this.#lastStop;
    return this.setup.get().watches.map((watch, index) => {
      const reference = watchReference(watch);
      const shown = this.#watchValue(watch, resolver);
      const value = 'value' in shown ? shown.value : '';
      const before = base.get(reference);
      return {
        index,
        watch,
        label: watch.name ?? reference,
        reference,
        value,
        vector: 'value' in shown ? shown.vector : watch.kind === 'cells',
        changed: before !== undefined && value !== '' && before !== value,
        ...('problem' in shown && { problem: shown.problem }),
      };
    });
  }

  /** A watch's value as text, or why it has none. */
  #watchValue(
    watch: Watch,
    resolver: Resolver,
  ): { readonly value: string; readonly vector: boolean } | { readonly problem: string } {
    const radix = watch.radix ?? 'hex';
    if (watch.kind === 'cells') {
      const target = resolver.resolve(cellsReference(watch.part, watch.from, watch.to));
      if (typeof target === 'string') return { problem: target };
      if (target.kind !== 'cells') return { problem: `${watch.part} holds no memory` };
      const cells = this.#editor.memory.cells(watch.part);
      if (cells.kind === 'none') return { value: '', vector: true }; // a stopped RAM
      const end = watch.to + 1;
      const data = (cells.kind === 'live' ? cells.view.data : cells.data).subarray(watch.from, end);
      const unknown =
        cells.kind === 'live'
          ? cells.view.unknown.subarray(watch.from, end)
          : new Uint8Array(data.length);
      return { value: formatCells(data, unknown, target.memory.width, radix), vector: true };
    }
    const members = signalMembers(watch.signal);
    const one = members.length === 1 ? members[0]! : undefined;
    const target =
      one === undefined ? resolver.probe({ name: watch.signal, members }) : resolver.signal(one);
    if (typeof target === 'string') return { problem: target };
    const { vector } = target;
    const sim = this.#sim;
    if (!sim) return { value: '', vector };
    const levels = target.nets.map((net) => {
      const index = net === undefined ? undefined : this.#editor.simulation.netOf(net);
      return index === undefined ? Level.Z : (sim.levels[index] as Level);
    });
    if (!vector) return { value: levelText(levels[0] ?? Level.Z), vector };
    return { value: formatValue(levels, radix), vector };
  }

  #parseWatch(text: string): Watch | string {
    const trimmed = text.trim();
    if (trimmed === '') return 'Type a signal or memory cells (U5[1F]).';
    const resolver = new Resolver(this.#compiled(), this.#editor.registry);
    const members = signalMembers(trimmed);
    if (members.length === 1) {
      const target = resolver.resolve(trimmed);
      if (typeof target !== 'string' && target.kind === 'cells') {
        if (target.to - target.from >= 16) return 'Watch at most 16 cells.';
        return { kind: 'cells', part: target.part, from: target.from, to: target.to };
      }
      const signal = resolver.signal(trimmed);
      if (typeof signal === 'string') return signal;
      return { kind: 'signal', signal: trimmed };
    }
    const group = resolver.probe({ name: trimmed, members });
    if (typeof group === 'string') return group;
    return { kind: 'signal', signal: members.join(' ') };
  }

  #clockNet(signal: DebugSignal): { readonly net: string } | string {
    const resolver = new Resolver(this.#compiled(), this.#editor.registry);
    const members = signalMembers(signal);
    if (members.length !== 1) return 'The step clock is one signal.';
    const target = resolver.signal(members[0]!);
    if (typeof target === 'string') return target;
    if (target.vector || target.nets[0] === undefined) return `${signal} is a bus, not a clock.`;
    return { net: target.nets[0] };
  }
}

function hitCountOf(hitCount: number | undefined): { readonly hitCount?: number } {
  return hitCount !== undefined && hitCount > 1 ? { hitCount: Math.floor(hitCount) } : {};
}

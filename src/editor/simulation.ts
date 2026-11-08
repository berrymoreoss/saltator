/**
 * The simulator host: runs the kernel for the circuit in the editor. It paces simulated time
 * against the wall clock (speed presets, a frame budget, "can't keep up" measured), offers
 * run / pause / step / stop / reset, delivers actions from the canvas, and follows the document:
 * an edit that keeps the circuit's structure keeps the simulator, any other edit continues the
 * simulation in the recompiled netlist (`Simulator.carryOver`). The kernel stays wall-clock
 * free; the clock and the frame scheduler are injected, so all of this runs in Node tests.
 * Spec: docs/editor.md#simulation.
 */
import { type Point, pointKey } from '../circuit';
import {
  type AnyComponentDefinition,
  busValueText,
  type ComponentRegistry,
  type Diagnostic,
  Drive,
  formatTime,
  Level,
  levelOf,
  type Netlist,
  ns,
  type PropValue,
  type RunStatus,
  resolveProps,
  Simulator,
  sameNetlistStructure,
  type Time,
  us,
} from '../core';
import { isLightsState, Light, type LightsState, onTimeAt } from '../library';
import type { SignalView } from './renderer';
import type { Scene } from './scene';
import { Store } from './store';
import { type PartLive, UNKNOWN_LIGHT } from './symbols';
import { SignalStyle } from './theme';
import {
  Timeline,
  type TimelineOptions,
  type TimelinePosition,
  type TimelineSegment,
} from './timeline';

/**
 * - `stopped`: no simulator; the canvas shows the plain drawing;
 * - `running`: simulated time follows the wall clock at the chosen speed;
 * - `paused`: time stands still; parts still take actions;
 * - `halted`: the kernel stopped on an oscillation (Reset, Stop or an edit gets out).
 */
export type SimState = 'stopped' | 'running' | 'paused' | 'halted';

/** How fast simulated time runs. */
export interface Speed {
  readonly id: string;
  readonly label: string;
  /** Simulated time per wall-clock second; absent: as fast as the frame budget allows. */
  readonly perSecond?: Time;
}

const PS_PER_SECOND = 1e12;

/** Speed presets, slowest first; real time is the default. */
export const SPEEDS: readonly Speed[] = [
  ...[1, 10, 100].map((n) => ({ id: `${n}ns`, perSecond: ns(n) })),
  ...[1, 10, 100].map((n) => ({ id: `${n}us`, perSecond: us(n) })),
  ...[1, 10, 100].map((n) => ({ id: `${n}ms`, perSecond: ns(n * 1e6) })),
].map((s) => ({ ...s, label: `${formatTime(s.perSecond)}/s` }));

export const REAL_TIME: Speed = { id: 'real-time', label: 'Real time (1 s/s)', perSecond: 1e12 };
export const MAX_SPEED: Speed = { id: 'max', label: 'Max' };

/** Every speed, slowest first. */
export const ALL_SPEEDS: readonly Speed[] = [...SPEEDS, REAL_TIME, MAX_SPEED];

/** `1 ms/s`: simulated time per wall second. */
export function formatRate(perSecond: number): string {
  return `${formatTime(Math.round(perSecond))}/s`;
}

export interface SimStatus {
  readonly state: SimState;
  /** Simulated time (0 when stopped). Refreshed a few times per second while running. */
  readonly time: Time;
  readonly speed: Speed;
  /** Measured simulated time per wall second (smoothed), while running. */
  readonly actual: number;
  /** The kernel recently couldn't keep up with `speed`: `actual` is what it managed. */
  readonly lagging: boolean;
  /** Why no simulator could be built (a library bug), for the user. */
  readonly error?: string;
  /**
   * Why it paused by itself — a breakpoint (`requestPause`), a step reached (`runTo`), a
   * trigger (`pauseAt`); cleared by Run, Step, Reset and Stop.
   */
  readonly reason?: string;
  /** While running a step (`runTo`): what it runs to. */
  readonly goal?: string;
}

/**
 * A step the host runs at Max, whatever the speed, until it is reached, then pauses (R14):
 * - `time`: until simulated time `until` (Run For, Run To);
 * - `edge`: through the next instant, then until right before net `net` (a netlist id) is due
 *   to change to `level` — one clock cycle, the cycle settled (Step Clock);
 * - `settle`: until nothing is left to happen (Step Clock on a manual clock, after its pulse).
 */
export type StepGoal =
  | { readonly kind: 'time'; readonly until: Time; readonly label: string }
  | { readonly kind: 'edge'; readonly net: string; readonly level: Level; readonly label: string }
  | { readonly kind: 'settle'; readonly label: string };

/** Where the run stands in its history (R14b), for the UI. */
export interface HistoryStatus {
  /** The earliest time a rewind reaches (0 while stopped). */
  readonly start: Time;
  /** The furthest the run has reached. */
  readonly present: Time;
  /** Behind the present: forward runs replay the recording. */
  readonly behind: boolean;
}

/** Told to the tools after a rewind: where the live simulator is, how far its record reaches. */
export interface RewindEvent {
  readonly time: Time;
  readonly present: Time;
}

/**
 * A backward search (Step Back, Step Back Clock, Reverse Continue): it watches the replica
 * while the history's segments replay, newest first, until it knows where to go.
 */
export interface BackSearch {
  /** The reason it stops with (`Step Back`), and what the status says meanwhile (`goal`). */
  readonly label: string;
  /** Why it went to the history's start: nothing found (`no earlier hit`). */
  readonly notFound: string;
  /**
   * Watches one segment's replay in `sim` (the replica; `at` gives the position of an instant)
   * up to `before`, where the search began. Returns its detach function.
   */
  watch(sim: Simulator, at: (time: Time) => TimelinePosition, before: TimelinePosition): () => void;
  /** Where to go, once known: a position, or a time as it ended. */
  target(): TimelinePosition | Time | undefined;
  /** The reason once found, when it says more than `label` (which breakpoint). */
  readonly reason?: string;
}

/** A search under way: the segments left. */
interface Search {
  readonly search: BackSearch;
  readonly segments: readonly TimelineSegment[];
  readonly before: TimelinePosition;
  next: number;
}

/** A kernel call's status, or: it stopped at the instant of a recorded action (go on). */
type HostRun = RunStatus | 'action';

/** A step under way: its goal, whether the first instant is behind it, why it ended. */
interface Step {
  readonly goal: StepGoal;
  passed: boolean;
  done?: string;
}

/** Wall-clock time and frames: the browser's, or a fake in tests. */
export interface SimClock {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Calls `callback` before the next repaint; returns a cancel function. */
  requestFrame(callback: () => void): () => void;
}

export const BROWSER_CLOCK: SimClock = {
  now: () => performance.now(),
  requestFrame(callback) {
    if (typeof requestAnimationFrame !== 'function') {
      const id = setTimeout(callback, 16);
      return () => clearTimeout(id);
    }
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  },
};

export interface SimulationOptions {
  readonly clock?: SimClock;
  /** Wall-clock milliseconds the kernel may use per frame. Default 8. */
  readonly frameBudget?: number;
  /** The history's checkpoints and budget (tests make them small). */
  readonly history?: TimelineOptions;
}

/** A bus as it is in the simulation (Properties). */
export interface BusLive {
  /** `0x3F`, with `X`/`Z` nibbles. */
  readonly value: string;
  /** Each member's signal style, least significant first (`Z` for a member without a net). */
  readonly members: readonly SignalStyle[];
}

/**
 * What the host simulates and what the canvas shows of it (R11a): the design's flat netlist
 * and the scene of the circuit open, with the way from the scene's local ids to the netlist's
 * in the instance open (R11b) — the top's are the flat ones, `A1`'s are `A1/…`; a circuit the
 * design places nowhere maps nothing.
 */
export interface SimulationModel {
  readonly netlist: Netlist;
  readonly scene: Scene;
  /**
   * The instance path the scene is mapped through (`''` the top; undefined: nowhere). Another
   * instance of the same circuit is the same netlist and scene, mapped otherwise.
   */
  readonly path: string | undefined;
  /** The flat net id of a net of the scene (its id in the scene's compile result). */
  flatNet(net: string): string | undefined;
  /** The netlist id of a part of the scene (`U1`), if the scene is what simulates. */
  flatPart(id: string): string | undefined;
}

/** The model of a flat circuit: its own netlist, ids as they are (tests, one-circuit hosts). */
export function sceneModel(scene: Scene): SimulationModel {
  return {
    netlist: scene.compiled.netlist,
    scene,
    path: '',
    flatNet: (net) => net,
    flatPart: (id) => id,
  };
}

/** Where each wire and connection point of the scene is in the simulator's nets. */
export interface SignalMap {
  /**
   * Net index of each net of the netlist, by its flat id — what the resolver gives (through a
   * pin on it: a simulator kept across a same-structure edit may call its nets otherwise).
   */
  readonly nets: ReadonlyMap<string, number>;
  /** Net index of each wire, by wire id; −1 when the simulator has no such net. */
  readonly wires: ReadonlyMap<string, number>;
  /** Net index at wire ends and pin tips, by `pointKey` (junction dots). */
  readonly points: ReadonlyMap<number, number>;
  /**
   * Net indices of each bus's members, least significant first, by bus id; −1 for a member
   * nothing is named after (it reads `Z`).
   */
  readonly buses: ReadonlyMap<string, Int32Array>;
  /** Bus id of each bus line, by wire id. */
  readonly busWires: ReadonlyMap<string, string>;
  /** Bus id at bus line ends and bus pins, by `pointKey` (bus junction dots). */
  readonly busPoints: ReadonlyMap<number, string>;
}

const EMPTY_SIGNALS: SignalMap = {
  nets: new Map(),
  wires: new Map(),
  points: new Map(),
  buses: new Map(),
  busWires: new Map(),
  busPoints: new Map(),
};

/** Events per kernel call; the frame budget is checked between calls. */
const CHUNK_EVENTS = 20_000;
/** A frame never advances more than this much wall time (a background tab, a debugger stop). */
const MAX_FRAME_MS = 100;
/** Status (time, actual speed) refresh interval while running. */
const STATUS_MS = 100;
/** Frames a lag stays reported after the kernel last ran out of budget. */
const LAG_FRAMES = 30;
/** Max speed: how far one kernel call may go when nothing limits it (1 hour). */
const MAX_SETTLE = 3_600 * PS_PER_SECOND;
/** Half period of a flashing contention, wall-clock ms. */
const FLASH_MS = 250;
/** Brightness steps: finer changes (a multiplexed display's frame-to-frame jitter) don't redraw. */
const BRIGHTNESS_STEPS = 32;

/** The last brightness sample of an indicator: on-time per light at `time`, brightness since. */
interface LightSample {
  readonly state: LightsState;
  time: Time;
  readonly onTime: Float64Array;
  readonly brightness: Float32Array;
}

/** A part of the running simulation, as its drawer sees it. */
class LivePart implements PartLive {
  readonly #sim: Simulator;
  readonly #id: string;
  readonly #lights: ReadonlyMap<string, LightSample>;

  constructor(sim: Simulator, id: string, lights: ReadonlyMap<string, LightSample>) {
    this.#sim = sim;
    this.#id = id;
    this.#lights = lights;
  }

  get state(): unknown {
    return this.#sim.stateOf(this.#id);
  }

  get time(): number {
    return this.#sim.now;
  }

  level(pin: string): Level {
    try {
      return this.#sim.pinLevel(this.#id, pin);
    } catch {
      return Level.Z;
    }
  }

  light(i: number): number {
    return this.#lights.get(this.#id)?.brightness[i] ?? 0;
  }
}

/**
 * How a bus looks: `X` if a member is unknown or in contention, `Z` if every member floats, `X`
 * if only some do, else `BUS` (an unnamed bus, without members, too).
 */
export function busStyle(sim: Simulator, members: Int32Array): SignalStyle {
  let floating = 0;
  for (const net of members) {
    const level = memberLevel(sim, net);
    if (level === Level.X) return SignalStyle.X;
    if (level === Level.Z) floating++;
  }
  if (floating === 0) return SignalStyle.BUS;
  return floating === members.length ? SignalStyle.Z : SignalStyle.X;
}

/** A bus's value as text (`0x3F`) from its members' nets. */
export function busValue(sim: Simulator, members: Int32Array): string {
  return busValueText(Array.from(members, (net) => memberLevel(sim, net)));
}

/** A bus member's level: `Z` for a member without a net, `X` in contention. */
function memberLevel(sim: Simulator, net: number): Level {
  if (net < 0) return Level.Z;
  if (sim.contended[net] === 1) return Level.X;
  return levelOf(sim.drives[net]! as Drive);
}

/** Signal style of each kernel drive value (level + strength). */
const DRIVE_STYLES: readonly SignalStyle[] = (() => {
  const styles: SignalStyle[] = Array.from({ length: 16 }, () => SignalStyle.Z);
  styles[Drive.WEAK_0] = SignalStyle.WEAK_0;
  styles[Drive.WEAK_1] = SignalStyle.WEAK_1;
  styles[Drive.WEAK_X] = SignalStyle.X;
  styles[Drive.STRONG_0] = SignalStyle.L0;
  styles[Drive.STRONG_1] = SignalStyle.L1;
  styles[Drive.STRONG_X] = SignalStyle.X;
  return styles;
})();

/** How a net of `sim` looks; −1 (a net the simulator doesn't have, wires on no pin) is `Z`. */
export function netStyle(sim: Simulator, net: number): SignalStyle {
  if (net < 0) return SignalStyle.Z;
  if (sim.contended[net] === 1) return SignalStyle.CONTENTION;
  return DRIVE_STYLES[sim.drives[net]!] ?? SignalStyle.Z;
}

export class Simulation {
  readonly status: Store<SimStatus>;
  /** The kernel's and parts' diagnostics, in order of first occurrence. */
  readonly diagnostics = new Store<readonly Diagnostic[]>([]);
  /** Grows whenever what the canvas shows may have changed (levels, lights, state). */
  readonly revision = new Store(0);
  /**
   * Grows when panels showing live values should refresh: a few times per second while running,
   * after every step, action and state change. (The canvas follows `revision` instead.)
   */
  readonly ticks = new Store(0);
  /** Where the run stands in its history (start, present, behind it). */
  readonly history = new Store<HistoryStatus>({ start: 0, present: 0, behind: false });
  readonly #registry: ComponentRegistry;
  readonly #clock: SimClock;
  readonly #budget: number;
  #model: SimulationModel;
  #netlist: Netlist;
  #sim: Simulator | undefined;
  #signals: SignalMap = EMPTY_SIGNALS;
  #cancelFrame: (() => void) | undefined;
  #lastWall = 0;
  #lastStatus = 0;
  #lagFrames = 0;
  #actual = 0;
  #events = 0;
  #diagnosticsKey = '';
  /** Counts of the entries cleared from the list: they show again only if they recur. */
  #cleared = new WeakMap<Diagnostic, number>();
  #flash = true;
  #pauseAt: Time | undefined;
  #pauseAtReason: string | undefined;
  /** A pause asked for at the end of the current instant (a breakpoint), and why. */
  #pauseRequest: string | undefined;
  #breaks = 0;
  #step: Step | undefined;
  #timeline: Timeline | undefined;
  readonly #historyOptions: TimelineOptions;
  #search: Search | undefined;
  readonly #rewindListeners = new Set<(event: RewindEvent) => void>();
  readonly #divergeListeners = new Set<(time: Time) => void>();
  /** Brightness samples of the indicators, by component id. */
  readonly #lights = new Map<string, LightSample>();
  /** Parts whose look changes with time alone (an LCD's blink), and the look shown last. */
  #animated: {
    readonly id: string;
    readonly definition: AnyComponentDefinition;
    readonly props: Readonly<Record<string, PropValue>>;
    phase: number;
  }[] = [];
  /** Live views of the parts in the simulator, by component id (rebuilt with the simulator). */
  #parts = new Map<string, LivePart>();

  constructor(
    registry: ComponentRegistry,
    model: SimulationModel | Scene,
    options: SimulationOptions = {},
  ) {
    this.#registry = registry;
    this.#clock = options.clock ?? BROWSER_CLOCK;
    this.#budget = options.frameBudget ?? 8;
    this.#historyOptions = options.history ?? {};
    this.#model = 'netlist' in model ? model : sceneModel(model);
    this.#netlist = this.#model.netlist;
    this.status = new Store<SimStatus>({
      state: 'stopped',
      time: 0,
      speed: REAL_TIME,
      actual: 0,
      lagging: false,
    });
  }

  get state(): SimState {
    return this.status.get().state;
  }

  /** The kernel running the circuit (undefined when stopped). Read-only use. */
  get simulator(): Simulator | undefined {
    return this.#sim;
  }

  /** The live simulator's history (undefined when stopped). Read-only use. */
  get timeline(): Timeline | undefined {
    return this.#timeline;
  }

  /**
   * Calls `listener` after every rewind — the live simulator was restored to an earlier (or
   * later) position, and no net listener heard it: a tool catches up (`Recorder.seek`).
   */
  onRewind(listener: (event: RewindEvent) => void): () => void {
    this.#rewindListeners.add(listener);
    return () => {
      this.#rewindListeners.delete(listener);
    };
  }

  /**
   * Calls `listener` when the run leaves its recorded future at `time` — the user acted behind
   * the present, or an edit continues the run from there — before anything new happens: a
   * tool drops what it kept of that future (`Recorder.cut`).
   */
  onDiverge(listener: (time: Time) => void): () => void {
    this.#divergeListeners.add(listener);
    return () => {
      this.#divergeListeners.delete(listener);
    };
  }

  /** Wire and point → net index for the current scene (empty when stopped). */
  get signals(): SignalMap {
    return this.#signals;
  }

  /** True while there is a simulator (running, paused or halted). */
  get active(): boolean {
    return this.#sim !== undefined;
  }

  /**
   * The simulator's index of a net by its flat id (what the resolver gives); undefined without
   * a simulator or for a net it doesn't have.
   */
  netOf(net: string): number | undefined {
    const index = this.#signals.nets.get(net);
    return index === undefined || index < 0 ? undefined : index;
  }

  /** Signal style of a component pin's net (Properties); undefined without a simulator. */
  pinStyle(component: string, pin: string): SignalStyle | undefined {
    const sim = this.#sim;
    if (!sim) return undefined;
    try {
      return netStyle(sim, sim.pinNet(component, pin));
    } catch {
      return undefined; // a part left out of the netlist, or a pin it doesn't have
    }
  }

  /** Signal style of a wire's net; undefined without a simulator. */
  wireStyle(wire: string): SignalStyle | undefined {
    const sim = this.#sim;
    const net = this.#signals.wires.get(wire);
    return sim && net !== undefined ? netStyle(sim, net) : undefined;
  }

  /**
   * A bus's live value (`0x3F`) and its members' signal styles, least significant first;
   * undefined without a simulator, or for a bus without members.
   */
  busLive(bus: string): BusLive | undefined {
    const sim = this.#sim;
    const members = this.#signals.buses.get(bus);
    if (!sim || !members || members.length === 0) return undefined;
    return {
      value: busValue(sim, members),
      members: Array.from(members, (net) => (net < 0 ? SignalStyle.Z : netStyle(sim, net))),
    };
  }

  /** The scene's wires on a simulator net (by the net id a diagnostic names). */
  wiresOfNet(net: string): string[] {
    const sim = this.#sim;
    if (!sim) return [];
    let index: number;
    try {
      index = sim.netIndex(net);
    } catch {
      return [];
    }
    const wires: string[] = [];
    for (const [id, n] of this.#signals.wires) if (n === index) wires.push(id);
    return wires;
  }

  /** Empties the diagnostics list; an entry shows again if it happens again. */
  clearDiagnostics(): void {
    for (const d of this.#sim?.diagnostics.entries ?? []) this.#cleared.set(d, d.count);
    this.#diagnosticsKey = '';
    this.#refreshDiagnostics();
  }

  /** What the canvas shows on wires now; undefined when stopped. */
  signalView(): SignalView | undefined {
    const sim = this.#sim;
    if (!sim) return undefined;
    const { wires, points, buses, busWires, busPoints } = this.#signals;
    const style = (net: number | undefined) =>
      net === undefined ? SignalStyle.NONE : netStyle(sim, net);
    // Bus styles are worked out once per frame and bus, not per bus line.
    const styles = new Map<string, SignalStyle>();
    const ofBus = (id: string | undefined) => {
      const members = id === undefined ? undefined : buses.get(id);
      if (id === undefined || !members) return SignalStyle.NONE;
      let style = styles.get(id);
      if (style === undefined) {
        style = busStyle(sim, members);
        styles.set(id, style);
      }
      return style;
    };
    return {
      wire: (id: string) => {
        const bus = busWires.get(id);
        return bus === undefined ? style(wires.get(id)) : ofBus(bus);
      },
      point: (p: Point) => style(points.get(pointKey(p))),
      busPoint: (p: Point) => ofBus(busPoints.get(pointKey(p))),
      busValue: (id: string) => {
        const members = buses.get(id);
        return members && members.length > 0 ? busValue(sim, members) : undefined;
      },
      flash: this.#flash || this.state !== 'running',
      part: (id: string) => {
        const flat = this.#model.flatPart(id);
        return flat === undefined ? undefined : this.#parts.get(flat);
      },
    };
  }

  // ── Run control ─────────────────────────────────────────────────────────────────────────

  /** Stopped: powers on at t = 0 and runs. Paused: goes on. Running a step: runs on freely. */
  run(): void {
    const state = this.state;
    if (state === 'running' && this.#step) {
      // From now on at the chosen speed: the step's frames ran at Max.
      this.#step = undefined;
      this.#lastWall = this.#clock.now();
      this.#setState('running');
    }
    if (state === 'running' || state === 'halted') return;
    if (state === 'stopped' && !this.#powerOn()) return;
    this.#lastWall = this.#clock.now();
    this.#lagFrames = 0;
    this.#actual = 0;
    this.#setState('running');
    this.#schedule();
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.#pauseWith(undefined);
  }

  #pauseWith(reason: string | undefined): void {
    this.#unschedule();
    this.#sampleLights(false);
    this.#setState('paused', reason);
  }

  /** Run / Pause. */
  toggle(): void {
    if (this.state === 'running') this.pause();
    else this.run();
  }

  /**
   * Runs to the next moment something happens (all delta cycles at the next timestamp with
   * events). From stopped it powers on and runs t = 0. Returns false when nothing was pending.
   */
  step(): boolean {
    const state = this.state;
    if (state === 'running' || state === 'halted') return false;
    if (state === 'stopped') {
      if (!this.#powerOn()) return false;
      this.#setState('paused');
      this.#sim!.runUntil(0);
      this.#timeline?.ran();
      this.#afterRun();
      return true;
    }
    this.#setReason(undefined);
    const sim = this.#sim!;
    const before = sim.stats.events;
    // Cancelled changes leave stale events behind: skip them until something real happens. A
    // recorded action on the way (behind the present) is delivered at its instant.
    for (;;) {
      const next = sim.nextEventTime;
      const cap = this.#timeline?.pending?.time ?? Number.POSITIVE_INFINITY;
      if (next === Number.POSITIVE_INFINITY && cap === Number.POSITIVE_INFINITY) break;
      this.#advance(sim, Math.min(next, cap), (limit) => sim.runUntil(limit));
      if (sim.halted || sim.stats.events !== before) break;
    }
    this.#afterRun();
    return sim.stats.events !== before;
  }

  /**
   * Runs a step (`StepGoal`) at Max until it is reached, then pauses there with the goal's label
   * as the reason; from stopped it powers on first (the power-on instant counts as the first
   * one). A breakpoint (`requestPause`) or a trigger's `pauseAt` on the way pause it earlier;
   * Pause cancels it, Run turns it into a normal run. False when halted or nothing to run.
   */
  runTo(goal: StepGoal): boolean {
    const state = this.state;
    if (state === 'halted') return false;
    if (goal.kind === 'time' && !Number.isFinite(goal.until)) return false;
    if (goal.kind === 'time' && this.#sim && goal.until < this.#sim.now) {
      return this.rewindTo(goal.until, goal.label);
    }
    let passed = goal.kind === 'time';
    if (state === 'stopped') {
      if (!this.#powerOn()) return false;
      this.#setState('paused');
      this.#sim!.runUntil(0);
      this.#timeline?.ran();
      passed = true;
      if (this.#pauseRequest !== undefined || this.#sim!.halted) {
        this.#afterRun();
        return true;
      }
    }
    this.#unschedule();
    this.#step = { goal, passed };
    this.#lastWall = this.#clock.now();
    this.#lagFrames = 0;
    this.#actual = 0;
    this.#setState('running');
    this.#frame();
    return true;
  }

  /**
   * Pause at the end of the instant being processed, whatever a pending `pauseAt` or step says
   * — a breakpoint or an error break, from a listener — with `reason` shown in the status. The
   * first request of an instant wins.
   */
  requestPause(reason: string): void {
    const sim = this.#sim;
    if (!sim) return;
    this.#pauseRequest ??= reason;
    sim.requestBreak();
  }

  /**
   * How many pauses asked for with `requestPause` were taken: a caller that runs an action
   * before a step (Step Clock's pulse) sees whether the action's instant stopped it already.
   */
  get breaks(): number {
    return this.#breaks;
  }

  /**
   * While running, pause once simulated time reaches `time` (a trigger's post-trigger end),
   * saying `reason`; `undefined` cancels. Cleared when it pauses there, by Pause, Stop and every
   * power-on.
   */
  pauseAt(time: Time | undefined, reason?: string): void {
    this.#pauseAt = time;
    this.#pauseAtReason = time === undefined ? undefined : reason;
  }

  /** Where `pauseAt` will pause; undefined when nothing is pending. */
  get pausesAt(): Time | undefined {
    return this.#pauseAt;
  }

  // ── Rewinding (R14b) ────────────────────────────────────────────────────────────────────

  /**
   * Puts the simulation at `time` as it ended — every action taken at it delivered — paused,
   * with `reason` (default `Rewound to 1.5 µs`): back, or forward within the recorded future.
   * False when stopped or the time lies outside the history (before its start, after the
   * present).
   */
  rewindTo(time: Time, reason?: string): boolean {
    const timeline = this.#timeline;
    if (!timeline || !Number.isFinite(time)) return false;
    const target = timeline.asEnded(time);
    if (!timeline.reachable(target)) return false;
    this.#reach(target, reason ?? `Rewound to ${formatTime(time)}`);
    return true;
  }

  /** Back to the present, paused (`Go to Present`). False when not behind it. */
  toPresent(): boolean {
    const timeline = this.#timeline;
    if (!timeline?.hasFuture) return false;
    this.#reach(timeline.present, 'Present');
    return true;
  }

  /**
   * Step Back: to the instant with events before the last one at or before now, as it ended —
   * Step then comes back. At the history's start it stays there.
   */
  stepBack(): boolean {
    return this.searchBack(previousInstantSearch());
  }

  /**
   * Searches the history backwards from where the run is (`BackSearch`), one segment at a time
   * in the replica — the first at once, the rest over frames, `status.goal` naming it — then
   * goes where it found, paused with its label as the reason, or to the history's start. Pause
   * cancels it (the run stays where it was). False when stopped.
   */
  searchBack(search: BackSearch): boolean {
    const timeline = this.#timeline;
    if (!timeline) return false;
    this.#unschedule();
    if (this.state === 'running') this.#sampleLights(false);
    const before = timeline.position;
    this.#search = { search, segments: timeline.segmentsBefore(before), before, next: 0 };
    this.#step = undefined;
    this.#setState('running');
    this.#searchFrame();
    return true;
  }

  /** Replays segments of the search under way until it finds, or the frame's budget is used. */
  #searchFrame(): void {
    const timeline = this.#timeline;
    const current = this.#search;
    if (!timeline || !current) return;
    const { search, segments, before } = current;
    const deadline = this.#clock.now() + this.#budget;
    while (current.next < segments.length) {
      const segment = segments[current.next++]!;
      timeline.replaySegment(segment, (sim, at) => search.watch(sim, at, before));
      const found = search.target();
      if (found !== undefined) {
        const target = typeof found === 'number' ? timeline.asEnded(found) : found;
        if (timeline.reachable(target)) {
          this.#reach(target, search.reason ?? search.label);
          return;
        }
      }
      if (this.#clock.now() >= deadline && current.next < segments.length) {
        this.#schedule();
        return;
      }
    }
    this.#reach(timeline.asEnded(timeline.start), `${search.label}: ${search.notFound}`);
  }

  /** Restores the live simulator at `target` (paused), and lets the tools catch up. */
  #reach(target: TimelinePosition, reason: string): void {
    const sim = this.#sim;
    const timeline = this.#timeline;
    if (!sim || !timeline) return;
    this.#unschedule();
    this.#search = undefined;
    this.#step = undefined;
    timeline.reach(target);
    this.#pauseAt = undefined;
    this.#pauseRequest = undefined;
    this.#collectLights(sim);
    this.#sampleLights(false);
    this.#events = sim.stats.events;
    this.#diagnosticsKey = '';
    const event: RewindEvent = { time: sim.now, present: timeline.present.time };
    for (const listener of [...this.#rewindListeners]) listener(event);
    this.#setState('paused', reason);
  }

  #diverged(time: Time): void {
    for (const listener of [...this.#divergeListeners]) listener(time);
  }

  /**
   * One kernel call toward `limit` (absolute), through the recorded future: the logged actions
   * due now are delivered first, and the call stops at the next one's instant (`action`: go
   * on). Every forward run goes through here, so the timeline sees each one.
   */
  #advance(sim: Simulator, limit: Time, run: (limit: Time) => RunStatus): HostRun {
    const timeline = this.#timeline;
    if (!timeline) return run(limit);
    while (timeline.applyPending()) {
      // every action logged at this instant, in order
    }
    const cap = timeline.pending?.time;
    if (cap === undefined || cap > limit) {
      const result = run(limit);
      timeline.ran();
      return result;
    }
    const result = run(cap);
    timeline.ran();
    if (result !== 'reached' && result !== 'idle') return result;
    if (sim.now < cap) {
      sim.runUntil(cap); // nothing happens before it: on to the action's instant
      timeline.ran();
    }
    return 'action';
  }

  /** Discards the simulator: back to the plain drawing. */
  stop(): void {
    if (this.state === 'stopped') return;
    this.#unschedule();
    this.#sim = undefined;
    this.#timeline = undefined;
    this.#signals = EMPTY_SIGNALS;
    this.#parts = new Map();
    this.#lights.clear();
    this.#setState('stopped');
  }

  /** Power-on again at t = 0, keeping running or paused (a halted simulation runs). */
  reset(): void {
    const state = this.state;
    if (state === 'stopped') return;
    if (!this.#powerOn()) return;
    if (state === 'running' || state === 'halted') {
      this.#lastWall = this.#clock.now();
      this.#setState('running');
      this.#schedule();
    } else {
      this.#setState('paused');
    }
  }

  setSpeed(speed: Speed): void {
    if (speed.id === this.status.get().speed.id) return;
    this.#lagFrames = 0;
    this.#actual = 0;
    this.status.update((status) => ({ ...status, speed, lagging: false, actual: 0 }));
  }

  /**
   * Delivers an action (flip a switch, press a button) to a part at the current instant.
   * While not running, its zero-delay consequences are applied right away. False when there is
   * no simulator or the part doesn't take it.
   */
  action(component: string, payload: unknown): boolean {
    const sim = this.#sim;
    if (!sim || sim.halted) return false;
    try {
      sim.action(component, payload);
    } catch {
      return false; // not in the netlist (a broken part) or not interactive
    }
    const timeline = this.#timeline;
    if (timeline) {
      // Behind the present, acting starts a new future: the tools drop the old one first.
      const behind = timeline.hasFuture;
      timeline.acted(component, payload);
      if (behind) this.#diverged(sim.now);
    }
    if (this.state !== 'running') {
      sim.runUntil(sim.now);
      timeline?.ran();
      this.#afterRun();
    } else {
      this.#bump();
    }
    return true;
  }

  // ── Following the document ──────────────────────────────────────────────────────────────

  /**
   * The document, the circuit shown or its instance changed (`renames`: old netlist id → new).
   * Same structure: the simulator goes on as it is. Otherwise the simulation continues in the
   * recompiled netlist.
   */
  sync(model: SimulationModel | Scene, renames?: ReadonlyMap<string, string>): void {
    const next = 'netlist' in model ? model : sceneModel(model);
    const last = this.#model;
    if (next.netlist === last.netlist && next.scene === last.scene && next.path === last.path) {
      return;
    }
    this.#model = next;
    const netlist = next.netlist;
    const previous = this.#netlist;
    this.#netlist = netlist;
    const sim = this.#sim;
    if (!sim) return;
    if (!sameNetlistStructure(previous, netlist)) {
      // The run goes on from here in another circuit: its recorded future is gone.
      if (this.#timeline?.hasFuture) this.#diverged(sim.now);
      const carry = sim.carryOver(renames ? { renames } : {});
      if (!this.#build(carry)) return;
      if (this.state === 'halted') this.#setState('paused');
    }
    this.#signals = signalMap(next, this.#sim!);
    this.#afterRun();
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────────

  /** A fresh simulator at t = 0 for the current netlist; false if it can't be built. */
  #powerOn(): boolean {
    this.#lights.clear();
    this.#pauseAt = undefined;
    this.#pauseRequest = undefined;
    if (!this.#build(undefined)) return false;
    this.#signals = signalMap(this.#model, this.#sim!);
    this.#events = 0;
    return true;
  }

  #build(carry: ReturnType<Simulator['carryOver']> | undefined): boolean {
    try {
      const sim = new Simulator(this.#netlist, this.#registry, carry ? { carry } : {});
      this.#sim = sim;
      this.#timeline = new Timeline(sim, this.#historyOptions);
      this.#parts = new Map(
        this.#netlist.components.map((c) => [c.id, new LivePart(sim, c.id, this.#lights)]),
      );
      this.#collectLights(sim);
      this.#animated = this.#netlist.components.flatMap(({ id, type, props }) => {
        const definition = this.#registry.get(type);
        return definition?.animation
          ? [{ id, definition, props: resolveProps(definition, props ?? {}, id), phase: -1 }]
          : [];
      });
      return true;
    } catch (error) {
      // The compiler leaves broken parts out, so this is a library bug: say so, don't crash.
      this.#unschedule();
      this.#sim = undefined;
      this.#timeline = undefined;
      this.#signals = EMPTY_SIGNALS;
      this.#parts = new Map();
      const message = error instanceof Error ? error.message : String(error);
      this.status.update((status) => ({ ...status, state: 'stopped', time: 0, error: message }));
      this.#bump();
      return false;
    }
  }

  #setState(state: SimState, reason?: string): void {
    if (state !== 'running') {
      this.#pauseAt = undefined;
      this.#pauseAtReason = undefined;
      this.#step = undefined;
      this.#search = undefined;
    }
    const sim = this.#sim;
    const goal =
      state === 'running' ? (this.#step?.goal.label ?? this.#search?.search.label) : undefined;
    this.status.update(({ error: _error, reason: _reason, goal: _goal, ...status }) => ({
      ...status,
      state,
      time: sim?.now ?? 0,
      actual: state === 'running' ? this.#actual : 0,
      lagging: state === 'running' && this.#lagFrames > 0,
      ...(reason !== undefined && { reason }),
      ...(goal !== undefined && { goal }),
    }));
    this.#lastStatus = this.#clock.now();
    this.#refreshDiagnostics();
    this.#refreshHistory();
    this.ticks.update((n) => n + 1);
    this.#bump();
  }

  #schedule(): void {
    this.#cancelFrame ??= this.#clock.requestFrame(() => {
      this.#cancelFrame = undefined;
      this.#frame();
    });
  }

  #unschedule(): void {
    this.#cancelFrame?.();
    this.#cancelFrame = undefined;
  }

  /** One animation frame while running: advance simulated time, measure, schedule the next. */
  #frame(): void {
    const sim = this.#sim;
    if (!sim || this.state !== 'running') return;
    if (this.#search) {
      this.#searchFrame();
      return;
    }
    const clock = this.#clock;
    const wall = clock.now();
    const elapsed = Math.min(Math.max(wall - this.#lastWall, 0), MAX_FRAME_MS);
    this.#lastWall = wall;
    const speed = this.status.get().speed;
    const start = sim.now;
    const deadline = wall + this.#budget;
    const step = this.#step;
    const perSecond = speed.perSecond;
    // From where the kernel got to, not where it should be: a backlog is dropped, not caught up.
    const target =
      perSecond === undefined
        ? Number.POSITIVE_INFINITY
        : start + Math.round((elapsed / 1000) * perSecond);
    let result: HostRun;
    let stop = false;
    let reason: string | undefined;
    for (;;) {
      const pauseAt = this.#pauseAt ?? Number.POSITIVE_INFINITY;
      // A step runs at Max whatever the speed: it is a jump, not something to watch.
      if (step) result = this.#stepChunk(sim, step, pauseAt);
      else if (perSecond === undefined) {
        result = this.#advance(
          sim,
          sim.now + Math.max(0, Math.min(MAX_SETTLE, pauseAt - sim.now)),
          (limit) => sim.settle({ maxTime: Math.max(0, limit - sim.now), maxEvents: CHUNK_EVENTS }),
        );
      } else {
        result = this.#advance(sim, Math.min(target, pauseAt), (limit) =>
          sim.runUntil(limit, { maxEvents: CHUNK_EVENTS }),
        );
      }
      if (result === 'halted') break;
      // Why it pauses here, if it does: a breakpoint, a step reached, a trigger's post-trigger
      // time over (or nothing left to happen before it), a plain break.
      if (result === 'break' && this.#pauseRequest !== undefined) {
        reason = this.#pauseRequest;
        this.#breaks++;
      } else if (step?.done !== undefined) reason = step.done;
      else if (
        this.#pauseAt !== undefined &&
        (sim.now >= this.#pauseAt || (result === 'idle' && (step || target > sim.now)))
      ) {
        reason = this.#pauseAtReason;
        stop = true;
      } else stop = result === 'break' && this.#pauseAt === undefined;
      stop ||= reason !== undefined;
      if (stop || clock.now() >= deadline) break;
      // A trigger that fired asks to run on to its post-trigger end (`pauseAt`): go on there.
      const runOn = result === 'break' && this.#pauseAt !== undefined && sim.now < this.#pauseAt;
      // At a recorded action's instant (replaying the recording): deliver it and go on.
      if (result !== 'budget' && result !== 'action' && !runOn) break;
    }
    if (elapsed > 0) {
      const rate = ((sim.now - start) * 1000) / elapsed;
      this.#actual = this.#actual === 0 ? rate : this.#actual * 0.8 + rate * 0.2;
    }
    const lagged = result === 'budget' && !step;
    this.#lagFrames = lagged ? LAG_FRAMES : Math.max(0, this.#lagFrames - 1);
    if (result === 'halted') {
      this.#setState('halted');
      return;
    }
    if (stop) {
      this.#pauseWith(reason);
      return;
    }
    let changed = this.#sampleLights(true);
    changed = this.#animate(sim) || changed;
    changed ||= sim.stats.events !== this.#events;
    this.#events = sim.stats.events;
    const flash = Math.floor(wall / FLASH_MS) % 2 === 0;
    if (flash !== this.#flash) {
      this.#flash = flash;
      changed ||= sim.contended.includes(1);
    }
    if (changed) this.#bump();
    if (wall - this.#lastStatus >= STATUS_MS) this.#refreshStatus(wall);
    this.#schedule();
  }

  /**
   * One piece of a step, at Max: `budget` while there is more to do; otherwise what the kernel
   * returned, with `step.done` set once the goal is reached (or can't be).
   */
  #stepChunk(sim: Simulator, step: Step, pauseAt: Time): HostRun {
    const { goal } = step;
    if (goal.kind === 'time') {
      const limit = Math.max(sim.now, Math.min(goal.until, pauseAt));
      const result = this.#advance(sim, limit, (l) => sim.runUntil(l, { maxEvents: CHUNK_EVENTS }));
      // At its time it is done — before a recorded action there, as the original run stopped
      // there and the action came after.
      if (
        result !== 'budget' &&
        result !== 'break' &&
        result !== 'halted' &&
        sim.now >= goal.until
      ) {
        step.done = goal.label;
      }
      return result;
    }
    if (goal.kind === 'settle') {
      const limit = sim.now + Math.max(0, Math.min(MAX_SETTLE, pauseAt - sim.now));
      const result = this.#advance(sim, limit, (l) =>
        sim.settle({ maxTime: Math.max(0, l - sim.now), maxEvents: CHUNK_EVENTS }),
      );
      if (result === 'idle') step.done = goal.label;
      return result;
    }
    const net = this.netOf(goal.net);
    if (net === undefined) {
      step.done = `${goal.label}: no net ${goal.net}`;
      return 'idle';
    }
    if (!step.passed) {
      // Through the next instant first: right before an edge, that is the edge itself (a
      // recorded action on the way is delivered first, then the edge passed).
      const next = sim.nextEventTime;
      if (next === Number.POSITIVE_INFINITY) {
        step.done = `${goal.label}: nothing left to happen`;
        return 'idle';
      }
      const result = this.#advance(sim, next, (l) => sim.runUntil(l));
      if (result === 'action') return result;
      step.passed = true; // (no `pauseAt` yet: pausing forgets it)
      return result === 'reached' || result === 'idle' ? 'budget' : result;
    }
    const limit = sim.now + Math.max(0, Math.min(MAX_SETTLE, pauseAt - sim.now));
    const result = this.#advance(sim, limit, (l) =>
      sim.settle({
        maxTime: Math.max(0, l - sim.now),
        maxEvents: CHUNK_EVENTS,
        stopBefore: { net, level: goal.level },
      }),
    );
    if (result === 'before') step.done = goal.label;
    else if (result === 'idle') step.done = `${goal.label}: nothing left to happen`;
    return result; // `reached` after an hour without the edge: the next frame goes on
  }

  #setReason(reason: string | undefined): void {
    if (this.status.get().reason === reason) return;
    this.status.update(({ reason: _reason, ...status }) => ({
      ...status,
      ...(reason !== undefined && { reason }),
    }));
  }

  /** After a step, an action while paused or a recompile: show the result now. */
  #afterRun(): void {
    const sim = this.#sim;
    if (sim?.halted && this.state !== 'halted') {
      this.#unschedule();
      this.#setState('halted');
      return;
    }
    // A breakpoint that asked to pause while not running (a step, an action): say why.
    if (this.#pauseRequest !== undefined && this.state !== 'running') {
      this.#setReason(this.#pauseRequest);
      this.#pauseRequest = undefined;
      this.#breaks++;
    }
    this.#events = sim?.stats.events ?? 0;
    this.#sampleLights(false);
    this.#refreshStatus(this.#clock.now());
    this.#bump();
  }

  /**
   * Indicators of a new simulator: carried ones keep their state object and so their samples;
   * the others start sampling now.
   */
  #collectLights(sim: Simulator): void {
    const previous = new Map(this.#lights);
    this.#lights.clear();
    for (const { id } of this.#netlist.components) {
      const state = sim.stateOf(id);
      if (!isLightsState(state)) continue;
      const old = previous.get(id);
      if (old?.state === state) {
        this.#lights.set(id, old);
        continue;
      }
      const count = state.light.length;
      const sample: LightSample = {
        state,
        time: sim.now,
        onTime: new Float64Array(count),
        brightness: new Float32Array(count),
      };
      for (let i = 0; i < count; i++) sample.onTime[i] = onTimeAt(state, i, sim.now);
      this.#lights.set(id, sample);
    }
  }

  /**
   * Brightness of every light: while running, its on-time over the time since the last sample
   * (a multiplexed digit or an LED on a fast clock shows its average); otherwise what it shows
   * now. True if any brightness changed by a visible step.
   */
  #sampleLights(running: boolean): boolean {
    const sim = this.#sim;
    if (!sim) return false;
    const now = sim.now;
    let changed = false;
    for (const sample of this.#lights.values()) {
      const { state } = sample;
      const span = now - sample.time;
      for (let i = 0; i < state.light.length; i++) {
        const on = onTimeAt(state, i, now);
        const light = state.light[i];
        let b: number;
        if (running && span > 0) {
          b = Math.min(1, Math.max(0, (on - sample.onTime[i]!) / span));
          if (b === 0 && light === Light.UNKNOWN) b = UNKNOWN_LIGHT;
        } else {
          b = light === Light.ON ? 1 : light === Light.UNKNOWN ? UNKNOWN_LIGHT : 0;
        }
        if (b !== UNKNOWN_LIGHT) b = Math.round(b * BRIGHTNESS_STEPS) / BRIGHTNESS_STEPS;
        if (b !== sample.brightness[i]) {
          sample.brightness[i] = b;
          changed = true;
        }
        sample.onTime[i] = on;
      }
      sample.time = now;
    }
    return changed;
  }

  /** True when a part whose look follows time alone moved into its next look. */
  #animate(sim: Simulator): boolean {
    let changed = false;
    for (const part of this.#animated) {
      const { id, definition, props } = part;
      const period = definition.animation!(sim.stateOf(id), props);
      const phase = period === undefined || period <= 0 ? -1 : Math.floor(sim.now / period);
      if (phase !== part.phase) {
        part.phase = phase;
        changed = true;
      }
    }
    return changed;
  }

  #refreshStatus(wall: number): void {
    this.#lastStatus = wall;
    const running = this.state === 'running';
    const lagging = running && this.#lagFrames > 0;
    const time = this.#sim?.now ?? 0;
    const actual = running ? this.#actual : 0;
    const status = this.status.get();
    if (status.time !== time || status.actual !== actual || status.lagging !== lagging) {
      this.status.set({ ...status, time, actual, lagging });
    }
    this.#refreshDiagnostics();
    this.#refreshHistory();
    this.ticks.update((n) => n + 1);
  }

  #refreshHistory(): void {
    const timeline = this.#timeline;
    const next: HistoryStatus = timeline
      ? { start: timeline.start, present: timeline.present.time, behind: timeline.hasFuture }
      : { start: 0, present: 0, behind: false };
    const old = this.history.get();
    if (old.start !== next.start || old.present !== next.present || old.behind !== next.behind) {
      this.history.set(next);
    }
  }

  #refreshDiagnostics(): void {
    const log = this.#sim?.diagnostics;
    const entries = log?.entries ?? [];
    // Counts grow in place; a cheap signature tells whether a new snapshot is needed.
    let key = `${entries.length}/${log?.dropped ?? 0}`;
    for (const d of entries) key += `/${d.count}`;
    if (key === this.#diagnosticsKey) return;
    this.#diagnosticsKey = key;
    this.diagnostics.set(
      entries.filter((d) => d.count > (this.#cleared.get(d) ?? 0)).map((d) => ({ ...d })),
    );
  }

  #bump(): void {
    this.revision.update((n) => n + 1);
  }
}

/**
 * Maps the netlist's nets, and the scene's wires and connection points through them, to the
 * simulator's nets by the pins on them: net ids may differ when the simulator was kept across a
 * same-structure edit. A net without pins maps to −1.
 */
export function signalMap(model: SimulationModel | Scene, sim: Simulator): SignalMap {
  const { netlist, scene, flatNet } = 'netlist' in model ? model : sceneModel(model);
  const nets = new Map<string, number>();
  const wires = new Map<string, number>();
  const points = new Map<number, number>();
  const named = new Map<string, number>();
  for (const net of netlist.nets) {
    let index = -1;
    for (const pin of net.pins) {
      try {
        index = sim.pinNet(pin.component, pin.pin);
      } catch {
        continue;
      }
      if (index >= 0) break;
    }
    nets.set(net.id, index);
  }
  for (const net of scene.compiled.nets) {
    const flat = flatNet(net.id);
    const index = flat === undefined ? -1 : (nets.get(flat) ?? -1);
    for (const wire of net.wires) {
      wires.set(wire.id, index);
      points.set(pointKey(wire.from), index);
      points.set(pointKey(wire.to), index);
    }
    for (const pin of net.pins) points.set(pointKey(pin.at), index);
    for (const pin of net.schematicPins) points.set(pointKey(pin.at), index);
    for (const pin of net.instancePins) points.set(pointKey(pin.at), index);
    for (const name of net.names) named.set(name, index);
  }
  const buses = new Map<string, Int32Array>();
  const busWires = new Map<string, string>();
  const busPoints = new Map<number, string>();
  for (const bus of scene.compiled.buses) {
    buses.set(
      bus.id,
      Int32Array.from(bus.members, (name) => named.get(name) ?? -1),
    );
    for (const wire of bus.wires) {
      busWires.set(wire.id, bus.id);
      busPoints.set(pointKey(wire.from), bus.id);
      busPoints.set(pointKey(wire.to), bus.id);
    }
    for (const pin of bus.pins) busPoints.set(pointKey(pin.at), bus.id);
  }
  return { nets, wires, points, buses, busWires, busPoints };
}

/**
 * Step Back's search: the instants with events, newest first, until two are known — the last
 * one at or before where the search began, and the one before it, the target.
 */
export function previousInstantSearch(): BackSearch {
  let times: Time[] = [];
  return {
    label: 'Step Back',
    notFound: 'the start of the history',
    watch(sim) {
      const found: Time[] = [];
      let events = sim.stats.events;
      const off = sim.onInstant((time) => {
        if (sim.stats.events === events) return; // only stale events: nothing happened
        events = sim.stats.events;
        if (found.at(-1) !== time) found.push(time);
      });
      return () => {
        off();
        if (found.at(-1) === times[0]) found.pop();
        times = [...found, ...times];
      };
    },
    target: () => (times.length >= 2 ? times.at(-2) : undefined),
  };
}

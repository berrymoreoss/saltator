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
  type ComponentRegistry,
  type Diagnostic,
  Drive,
  formatTime,
  type Netlist,
  ns,
  type RunStatus,
  Simulator,
  sameNetlistStructure,
  type Time,
  us,
} from '../core';
import type { SignalView } from './renderer';
import type { Scene } from './scene';
import { Store } from './store';
import { SignalStyle } from './theme';

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
}

/** Where each wire and connection point of the scene is in the simulator's nets. */
export interface SignalMap {
  /** Net index of each wire, by wire id; −1 when the simulator has no such net. */
  readonly wires: ReadonlyMap<string, number>;
  /** Net index at wire ends and pin tips, by `pointKey` (junction dots). */
  readonly points: ReadonlyMap<number, number>;
}

const EMPTY_SIGNALS: SignalMap = { wires: new Map(), points: new Map() };

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
  readonly #registry: ComponentRegistry;
  readonly #clock: SimClock;
  readonly #budget: number;
  #scene: Scene;
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
  #flash = true;

  constructor(registry: ComponentRegistry, scene: Scene, options: SimulationOptions = {}) {
    this.#registry = registry;
    this.#clock = options.clock ?? BROWSER_CLOCK;
    this.#budget = options.frameBudget ?? 8;
    this.#scene = scene;
    this.#netlist = scene.compiled.netlist;
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

  /** Wire and point → net index for the current scene (empty when stopped). */
  get signals(): SignalMap {
    return this.#signals;
  }

  /** True while there is a simulator (running, paused or halted). */
  get active(): boolean {
    return this.#sim !== undefined;
  }

  /** What the canvas shows on wires now; undefined when stopped. */
  signalView(): SignalView | undefined {
    const sim = this.#sim;
    if (!sim) return undefined;
    const { wires, points } = this.#signals;
    const style = (net: number | undefined) =>
      net === undefined ? SignalStyle.NONE : netStyle(sim, net);
    return {
      wire: (id: string) => style(wires.get(id)),
      point: (p: Point) => style(points.get(pointKey(p))),
      flash: this.#flash || this.state !== 'running',
    };
  }

  // ── Run control ─────────────────────────────────────────────────────────────────────────

  /** Stopped: powers on at t = 0 and runs. Paused: goes on. */
  run(): void {
    const state = this.state;
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
    this.#unschedule();
    this.#setState('paused');
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
      this.#afterRun();
      return true;
    }
    const sim = this.#sim!;
    const before = sim.stats.events;
    // Cancelled changes leave stale events behind: skip them until something real happens.
    while (sim.nextEventTime !== Number.POSITIVE_INFINITY && sim.stats.events === before) {
      sim.runUntil(sim.nextEventTime);
      if (sim.halted) break;
    }
    this.#afterRun();
    return sim.stats.events !== before;
  }

  /** Discards the simulator: back to the plain drawing. */
  stop(): void {
    if (this.state === 'stopped') return;
    this.#unschedule();
    this.#sim = undefined;
    this.#signals = EMPTY_SIGNALS;
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
    if (this.state !== 'running') {
      sim.runUntil(sim.now);
      this.#afterRun();
    } else {
      this.#bump();
    }
    return true;
  }

  // ── Following the document ──────────────────────────────────────────────────────────────

  /**
   * The editor's circuit changed (`renames`: old designator → new). Same structure: the
   * simulator goes on as it is. Otherwise the simulation continues in the recompiled netlist.
   */
  sync(scene: Scene, renames?: ReadonlyMap<string, string>): void {
    if (scene === this.#scene) return;
    this.#scene = scene;
    const netlist = scene.compiled.netlist;
    const previous = this.#netlist;
    this.#netlist = netlist;
    const sim = this.#sim;
    if (!sim) return;
    if (!sameNetlistStructure(previous, netlist)) {
      const carry = sim.carryOver(renames ? { renames } : {});
      if (!this.#build(carry)) return;
      if (this.state === 'halted') this.#setState('paused');
    }
    this.#signals = signalMap(scene, this.#sim!);
    this.#afterRun();
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────────

  /** A fresh simulator at t = 0 for the current netlist; false if it can't be built. */
  #powerOn(): boolean {
    if (!this.#build(undefined)) return false;
    this.#signals = signalMap(this.#scene, this.#sim!);
    this.#events = 0;
    return true;
  }

  #build(carry: ReturnType<Simulator['carryOver']> | undefined): boolean {
    try {
      this.#sim = new Simulator(this.#netlist, this.#registry, carry ? { carry } : {});
      return true;
    } catch (error) {
      // The compiler leaves broken parts out, so this is a library bug: say so, don't crash.
      this.#unschedule();
      this.#sim = undefined;
      this.#signals = EMPTY_SIGNALS;
      const message = error instanceof Error ? error.message : String(error);
      this.status.update((status) => ({ ...status, state: 'stopped', time: 0, error: message }));
      this.#bump();
      return false;
    }
  }

  #setState(state: SimState): void {
    const sim = this.#sim;
    this.status.update(({ error: _, ...status }) => ({
      ...status,
      state,
      time: sim?.now ?? 0,
      actual: state === 'running' ? this.#actual : 0,
      lagging: state === 'running' && this.#lagFrames > 0,
    }));
    this.#lastStatus = this.#clock.now();
    this.#refreshDiagnostics();
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
    const clock = this.#clock;
    const wall = clock.now();
    const elapsed = Math.min(Math.max(wall - this.#lastWall, 0), MAX_FRAME_MS);
    this.#lastWall = wall;
    const speed = this.status.get().speed;
    const start = sim.now;
    const deadline = wall + this.#budget;
    let result: RunStatus;
    if (speed.perSecond === undefined) {
      do result = sim.settle({ maxTime: MAX_SETTLE, maxEvents: CHUNK_EVENTS });
      while (result === 'budget' && clock.now() < deadline);
    } else {
      // From where the kernel got to, not where it should be: a backlog is dropped, not caught up.
      const target = start + Math.round((elapsed / 1000) * speed.perSecond);
      do result = sim.runUntil(target, { maxEvents: CHUNK_EVENTS });
      while (result === 'budget' && clock.now() < deadline);
    }
    if (elapsed > 0) {
      const rate = ((sim.now - start) * 1000) / elapsed;
      this.#actual = this.#actual === 0 ? rate : this.#actual * 0.8 + rate * 0.2;
    }
    this.#lagFrames = result === 'budget' ? LAG_FRAMES : Math.max(0, this.#lagFrames - 1);
    if (result === 'halted') {
      this.#setState('halted');
      return;
    }
    let changed = sim.stats.events !== this.#events;
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

  /** After a step, an action while paused or a recompile: show the result now. */
  #afterRun(): void {
    const sim = this.#sim;
    if (sim?.halted && this.state !== 'halted') {
      this.#unschedule();
      this.#setState('halted');
      return;
    }
    this.#events = sim?.stats.events ?? 0;
    this.#refreshStatus(this.#clock.now());
    this.#bump();
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
  }

  #refreshDiagnostics(): void {
    const log = this.#sim?.diagnostics;
    const entries = log?.entries ?? [];
    // Counts grow in place; a cheap signature tells whether a new snapshot is needed.
    let key = `${entries.length}/${log?.dropped ?? 0}`;
    for (const d of entries) key += `/${d.count}`;
    if (key === this.#diagnosticsKey) return;
    this.#diagnosticsKey = key;
    this.diagnostics.set(entries.map((d) => ({ ...d })));
  }

  #bump(): void {
    this.revision.update((n) => n + 1);
  }
}

/**
 * Maps the scene's wires and connection points to the simulator's nets through the pins on
 * them: net ids may differ when the simulator was kept across a same-structure edit.
 */
export function signalMap(scene: Scene, sim: Simulator): SignalMap {
  const wires = new Map<string, number>();
  const points = new Map<number, number>();
  for (const net of scene.compiled.nets) {
    let index = -1;
    for (const pin of net.pins) {
      try {
        index = sim.pinNet(pin.component, pin.pin);
      } catch {
        continue;
      }
      if (index >= 0) break;
    }
    for (const wire of net.wires) {
      wires.set(wire.id, index);
      points.set(pointKey(wire.from), index);
      points.set(pointKey(wire.to), index);
    }
    for (const pin of net.pins) points.set(pointKey(pin.at), index);
  }
  return { wires, points };
}

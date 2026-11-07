/**
 * The waveform analyzer's model (R13): the circuit's probes as channels, their record over
 * simulated time (a `Recorder` attached to every simulator the host builds), the visible window
 * with its zoom and two cursors, and a single-shot trigger that pauses the run after its
 * post-trigger time. No DOM: the Waveforms tab draws it, and tests drive it with a fake clock.
 * Spec: docs/editor.md#waveforms.
 */
import {
  type GroupProbe,
  isGroupProbe,
  type Probe,
  type ProbeRadix,
  type ProbeTarget,
  Resolver,
  renameInProbes,
  type SignalProbe,
} from '../circuit';
import {
  busMembers,
  busValueText,
  conditionProblems,
  isBusName,
  Level,
  levelChar,
  Recorder,
  type Simulator,
  type Time,
  Trigger,
  type TriggerTerm,
} from '../core';
import type { Editor } from './editor';
import type { Scene } from './scene';
import { Store } from './store';

/** One probe as the Waveforms tab shows it. */
export interface AnalyzerChannel {
  /** Position in the circuit's probe list. */
  readonly index: number;
  readonly probe: Probe;
  /** `CLK`, the probe's name, or a group's name. */
  readonly label: string;
  /** What it probes: `U1.Y`, `D[0..7]`, a group's members. */
  readonly reference: string;
  /** Shown as a value (a bus or a group), not as one level. */
  readonly vector: boolean;
  /** How a vector's value is written (`hex` unless the probe says). */
  readonly radix: ProbeRadix;
  /** Recorder channels of its bits, bit 0 first. */
  readonly bits: readonly number[];
  /** A name per bit (`D0`, `U3.Q1`), for a bus or group expanded into its bits. */
  readonly bitLabels: readonly string[];
  /** Why it shows nothing (the resolver's reason); undefined when it resolves. */
  readonly problem?: string;
}

/**
 * How the window moves: `fit` shows the whole record as it grows (after power-on), `follow`
 * keeps its scale with `now` at the right edge, `free` stays where the user put it.
 */
export type ViewMode = 'fit' | 'follow' | 'free';

export interface WaveView {
  /** Simulated time at the plot's left edge. */
  readonly start: Time;
  /** Picoseconds per pixel (fractional when zoomed in past 1 ps a pixel). */
  readonly scale: number;
  /** Plot width in pixels. */
  readonly width: number;
  readonly mode: ViewMode;
  readonly cursorA?: Time;
  readonly cursorB?: Time;
  /** The channel picked in the list (edge search, Delete). */
  readonly selected?: number;
}

/** A trigger term on a channel, by probe (`probeKey`), as the Trigger dialog builds it. */
export interface AnalyzerTerm {
  readonly probe: string;
  readonly kind: TriggerTerm['kind'];
  /** For `level`. */
  readonly level?: Level;
  /** For `equal` / `notEqual`: hex digits, `X` for any. */
  readonly value?: string;
}

export interface AnalyzerCondition {
  readonly terms: readonly AnalyzerTerm[];
  /** Where the trigger lands in the window, 0 (left) … 1 (right). Default 0.1. */
  readonly position?: number;
  /**
   * The capture window around the trigger: what runs after it is `window × (1 − position)`.
   * Default: the view's window when armed (so zooming before arming sets it).
   */
  readonly window?: Time;
}

export type TriggerState =
  | { readonly status: 'off' }
  | { readonly status: 'armed'; readonly condition: AnalyzerCondition }
  | { readonly status: 'triggered'; readonly condition: AnalyzerCondition; readonly time: Time };

/** Limits of the zoom: 1 ps over 50 pixels … 10 ms a pixel. */
export const MIN_WAVE_SCALE = 0.02;
export const MAX_WAVE_SCALE = 1e10;
const DEFAULT_SCALE = 1000;
const DEFAULT_POSITION = 0.1;
/** A trigger's window when the view has no width yet. */
const DEFAULT_WINDOW = 1_000_000;

/** Identifies a probe in the list (duplicates are refused, so it is unique). */
export function probeKey(probe: Probe): string {
  return isGroupProbe(probe) ? `${probe.name}{${probe.members.join(',')}}` : probe.ref;
}

/** What a probe is called in the list. */
export function probeLabel(probe: Probe): string {
  return isGroupProbe(probe) ? probe.name : (probe.name ?? probe.ref);
}

/** Bit references of a probe, bit 0 first: a bus's members are nets named `D0`, `D1`, … */
function bitKeys(probe: Probe): string[] {
  if (isGroupProbe(probe)) return [...probe.members];
  return isBusName(probe.ref) ? busMembers(probe.ref) : [probe.ref];
}

/**
 * A value as text: `hex` with `X`/`Z` nibbles (`0x3F`, `0x3X`), `dec` (`X` while any bit isn't
 * 0 or 1), `bin` most significant first (`0011X1`), `ascii` one character a byte (`.` where not
 * printable, `X` where not known). Bits without data count as `X`.
 */
export function formatValue(levels: readonly (Level | undefined)[], radix: ProbeRadix): string {
  const known = levels.map((l) => l ?? Level.X);
  switch (radix) {
    case 'hex':
      return busValueText(known);
    case 'bin':
      return known
        .map((l) => levelChar(l))
        .reverse()
        .join('');
    case 'dec': {
      let value = 0n;
      for (let bit = known.length - 1; bit >= 0; bit--) {
        const level = known[bit];
        if (level !== Level.L0 && level !== Level.L1) return 'X';
        value = value * 2n + (level === Level.L1 ? 1n : 0n);
      }
      return value.toString();
    }
    case 'ascii': {
      let text = '';
      for (let lo = Math.floor((known.length - 1) / 8) * 8; lo >= 0; lo -= 8) {
        let code = 0;
        let unknown = false;
        for (let bit = 0; bit < 8 && lo + bit < known.length; bit++) {
          const level = known[lo + bit];
          if (level === Level.L1) code |= 1 << bit;
          else if (level !== Level.L0) unknown = true;
        }
        text += unknown ? 'X' : code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '.';
      }
      return text;
    }
  }
}

/** The waveform analyzer of an editor: `editor.analyzer`. */
export class Analyzer {
  /** The record behind the waveforms (read it, don't change it). */
  readonly recorder = new Recorder();
  readonly channels = new Store<readonly AnalyzerChannel[]>([]);
  readonly view = new Store<WaveView>({
    start: 0,
    scale: DEFAULT_SCALE,
    width: 0,
    mode: 'fit',
  });
  readonly trigger = new Store<TriggerState>({ status: 'off' });
  /** Grows whenever the record or the channels changed: the waveform view redraws on it. */
  readonly revision = new Store(0);
  readonly #editor: Editor;
  #scene: Scene | undefined;
  #sim: Simulator | undefined;
  /** Recorder channel by bit reference. */
  #bits = new Map<string, number>();
  /** Net id by bit reference, for the scene's netlist. */
  #nets = new Map<string, string>();
  #core: Trigger | undefined;
  /** The post-trigger end this analyzer asked the host to pause at. */
  #pause: Time | undefined;

  constructor(editor: Editor) {
    this.#editor = editor;
    const sync = () => this.#sync();
    editor.state.subscribe(sync);
    editor.simulation.status.subscribe(sync);
    editor.simulation.revision.subscribe(() => {
      this.#sync();
      this.#follow();
      if (this.#sim) this.revision.update((n) => n + 1);
    });
    this.#sync();
  }

  // ── Probes (document edits) ──────────────────────────────────────────────────────────────

  get probes(): readonly Probe[] {
    return this.#editor.state.get().circuit.probes;
  }

  /** The index of the probe on `ref` (a signal probe), or −1. */
  indexOf(ref: string): number {
    return this.probes.findIndex((p) => !isGroupProbe(p) && p.ref === ref);
  }

  /** Adds a probe at the end (one undo step); why not instead. */
  addProbe(probe: Probe): string | undefined {
    const key = probeKey(probe);
    if (this.probes.some((p) => probeKey(p) === key))
      return `${probeLabel(probe)} is probed already.`;
    const target = this.#resolver().probe(probe);
    if (typeof target === 'string') return target;
    this.#editProbes(`Add ${probeLabel(probe)} to Waveforms`, [...this.probes, probe]);
    return undefined;
  }

  /** Adds the signal `ref`, or removes it when it is probed: what the Probe tool does. */
  toggleProbe(ref: string): 'added' | 'removed' | string {
    const index = this.indexOf(ref);
    if (index >= 0) {
      this.removeProbe(index);
      return 'removed';
    }
    return this.addProbe({ ref }) ?? 'added';
  }

  removeProbe(index: number): void {
    const probe = this.probes[index];
    if (!probe) return;
    this.#editProbes(
      `Remove ${probeLabel(probe)} from Waveforms`,
      this.probes.filter((_, i) => i !== index),
    );
  }

  /** Moves a probe to another place in the list. */
  moveProbe(from: number, to: number): void {
    const probes = [...this.probes];
    const [probe] = probes.splice(from, 1);
    if (!probe || to < 0 || to > probes.length || from === to) return;
    probes.splice(to, 0, probe);
    this.#editProbes('Reorder Waveforms', probes);
  }

  /** Renames a probe (an empty name shows its reference) or changes its radix. */
  updateProbe(
    index: number,
    changes: { readonly name?: string; readonly radix?: ProbeRadix },
  ): void {
    const probe = this.probes[index];
    if (!probe) return;
    const radix = changes.radix ?? probe.radix;
    let next: Probe;
    if (isGroupProbe(probe)) {
      const name = changes.name?.trim() || probe.name;
      next = { name, members: probe.members, ...(radix !== undefined && { radix }) };
    } else {
      const name = changes.name === undefined ? probe.name : changes.name.trim() || undefined;
      next = {
        ref: probe.ref,
        ...(name !== undefined && { name }),
        ...(radix !== undefined && { radix }),
      };
    }
    const probes = [...this.probes];
    probes[index] = next;
    this.#editProbes(`Change ${probeLabel(probe)} in Waveforms`, probes);
  }

  /**
   * Groups single-signal probes into one value named `name`, bit 0 first in the order given,
   * where the first of them was. Why not instead.
   */
  groupProbes(indices: readonly number[], name: string): string | undefined {
    const title = name.trim();
    if (title === '') return 'A group needs a name.';
    if (indices.length < 2) return 'Pick at least two signals to group.';
    const channels = this.channels.get();
    const members: string[] = [];
    for (const index of indices) {
      const probe = this.probes[index];
      const channel = channels[index];
      if (!probe || isGroupProbe(probe) || !channel || channel.vector) {
        return 'Only single signals can be grouped.';
      }
      members.push(probe.ref);
    }
    const group: GroupProbe = { name: title, members };
    const probes = this.probes.filter((_, i) => !indices.includes(i));
    probes.splice(Math.min(...indices), 0, group);
    this.#editProbes(`Group ${title}`, probes);
    return undefined;
  }

  /** Splits a group back into its members, in its place. */
  ungroup(index: number): void {
    const probe = this.probes[index];
    if (!probe || !isGroupProbe(probe)) return;
    const probes = [...this.probes];
    probes.splice(index, 1, ...probe.members.map((ref): SignalProbe => ({ ref })));
    this.#editProbes(`Ungroup ${probe.name}`, probes);
  }

  #editProbes(label: string, probes: readonly Probe[]): void {
    const { circuit } = this.#editor.state.get();
    this.#editor.edit(label, { ...circuit, probes });
  }

  #resolver(): Resolver {
    return new Resolver(this.#editor.state.get().scene.compiled, this.#editor.registry);
  }

  // ── Values ───────────────────────────────────────────────────────────────────────────────

  /** A channel's bit levels at `t` (undefined where there is no data). */
  levelsAt(channel: AnalyzerChannel, t: Time): (Level | undefined)[] {
    return channel.bits.map((bit) => this.recorder.level(bit, t));
  }

  /** A channel's value at `t` as the list shows it: a level letter, or the vector's value. */
  valueAt(channel: AnalyzerChannel, t: Time): string {
    if (channel.problem !== undefined) return '';
    const levels = this.levelsAt(channel, t);
    if (levels.every((l) => l === undefined)) return '';
    if (!channel.vector) return levelChar(levels[0] ?? Level.X);
    return formatValue(levels, channel.radix);
  }

  // ── View ─────────────────────────────────────────────────────────────────────────────────

  /** The end of the record: now while simulating, where it stopped after. */
  get end(): Time {
    return this.recorder.end;
  }

  /** Time at a plot x (pixels from the left). */
  timeAt(x: number): Time {
    const { start, scale } = this.view.get();
    return start + x * scale;
  }

  /** Plot x of a time. */
  xOf(t: Time): number {
    const { start, scale } = this.view.get();
    return (t - start) / scale;
  }

  setWidth(width: number): void {
    const w = Math.max(0, Math.floor(width));
    if (w === this.view.get().width) return;
    this.view.update((v) => ({ ...v, width: w }));
    this.#follow();
  }

  /**
   * Zooms by `factor` (> 1 in) about plot x `anchor` (default: the right edge when following,
   * else the middle). Leaves `fit`: following while simulating, else free.
   */
  zoom(factor: number, anchor?: number): void {
    const view = this.view.get();
    const following = view.mode !== 'free' && this.#sim !== undefined;
    const x = following ? view.width : (anchor ?? view.width / 2);
    const at = view.start + x * view.scale;
    const scale = Math.min(MAX_WAVE_SCALE, Math.max(MIN_WAVE_SCALE, view.scale / factor));
    this.view.set({
      ...view,
      scale,
      start: Math.max(0, at - x * scale),
      mode: following ? 'follow' : 'free',
    });
  }

  /** Pans by `dx` pixels (positive: later); the view stops following. */
  pan(dx: number): void {
    const view = this.view.get();
    this.view.set({ ...view, start: Math.max(0, view.start + dx * view.scale), mode: 'free' });
  }

  /** Shows the window from `start` at the current scale (Go to, the trigger), free. */
  scrollTo(start: Time): void {
    this.view.update((v) => ({ ...v, start: Math.max(0, start), mode: 'free' }));
  }

  /** The whole record in view; keeps fitting while it grows. */
  zoomToFit(): void {
    this.view.update((v) => ({ ...v, mode: 'fit' }));
    this.#follow(true);
  }

  /** `now` at the right edge from here on, at this scale. */
  followNow(): void {
    this.view.update((v) => ({ ...v, mode: 'follow' }));
    this.#follow(true);
  }

  /** The span between the cursors in view, with a margin. */
  zoomToCursors(): void {
    const view = this.view.get();
    const { cursorA, cursorB } = view;
    if (cursorA === undefined || cursorB === undefined || cursorA === cursorB || view.width === 0) {
      return;
    }
    const lo = Math.min(cursorA, cursorB);
    const span = Math.abs(cursorB - cursorA) * 1.2;
    const scale = Math.min(MAX_WAVE_SCALE, Math.max(MIN_WAVE_SCALE, span / view.width));
    this.view.set({
      ...view,
      scale,
      start: Math.max(0, lo - (span - Math.abs(cursorB - cursorA)) / 2),
      mode: 'free',
    });
  }

  /** Moves the window with the record: fits it or keeps `now` at the right edge. */
  #follow(force = false): void {
    const view = this.view.get();
    if (view.width === 0 || (view.mode === 'free' && !force)) return;
    const end = this.end;
    if (view.mode === 'fit') {
      const first = this.recorder.start;
      if (end <= first) return; // nothing recorded yet: keep the scale
      const scale = Math.min(MAX_WAVE_SCALE, Math.max(MIN_WAVE_SCALE, (end - first) / view.width));
      if (scale !== view.scale || first !== view.start) {
        this.view.set({ ...view, start: first, scale });
      }
      return;
    }
    const start = Math.max(0, end - view.width * view.scale);
    if (view.mode === 'follow' && start !== view.start) this.view.set({ ...view, start });
  }

  // ── Cursors ──────────────────────────────────────────────────────────────────────────────

  setCursor(which: 'A' | 'B', time: Time | undefined): void {
    this.view.update(({ cursorA, cursorB, ...rest }) => {
      const a = which === 'A' ? time : cursorA;
      const b = which === 'B' ? time : cursorB;
      return {
        ...rest,
        ...(a !== undefined && { cursorA: Math.max(0, Math.round(a)) }),
        ...(b !== undefined && { cursorB: Math.max(0, Math.round(b)) }),
      };
    });
  }

  /**
   * `t` moved onto the nearest change of `channel` (any of its bits) within `tolerance` pixels;
   * `t` itself (rounded to a picosecond) when none is that near.
   */
  snap(t: Time, channel: AnalyzerChannel | undefined, tolerance = 6): Time {
    const time = Math.round(t);
    if (!channel) return time;
    const before = this.recorder.prevChangeOf(channel.bits, time + 1);
    const after = this.recorder.nextChangeOf(channel.bits, time);
    const scale = this.view.get().scale;
    let best = time;
    let distance = tolerance * scale;
    for (const candidate of [before, after]) {
      if (candidate === undefined) continue;
      const d = Math.abs(candidate - t);
      if (d <= distance) {
        best = candidate;
        distance = d;
      }
    }
    return best;
  }

  /** Picks a channel in the list (undefined: none). */
  select(index: number | undefined): void {
    this.view.update(({ selected: _, ...rest }) => ({
      ...rest,
      ...(index !== undefined && { selected: index }),
    }));
  }

  /**
   * Moves a cursor (A unless told) to the selected channel's next (or previous) change after
   * (before) it, or after the window's start when it isn't set; brings it into view. False when
   * there is none.
   */
  edge(direction: 1 | -1, which: 'A' | 'B' = 'A'): boolean {
    const view = this.view.get();
    const channel = view.selected === undefined ? undefined : this.channels.get()[view.selected];
    if (!channel) return false;
    const from = (which === 'A' ? view.cursorA : view.cursorB) ?? view.start;
    const t =
      direction > 0
        ? this.recorder.nextChangeOf(channel.bits, from)
        : this.recorder.prevChangeOf(channel.bits, from);
    if (t === undefined) return false;
    this.setCursor(which, t);
    const x = this.xOf(t);
    if (x < 0 || x > view.width) this.scrollTo(t - (view.width * view.scale) / 2);
    return true;
  }

  // ── Trigger ──────────────────────────────────────────────────────────────────────────────

  /** Problems with a condition on the current channels (empty when it can be armed). */
  conditionProblems(condition: AnalyzerCondition): string[] {
    const built = this.#build(condition);
    return typeof built === 'string' ? [built] : conditionProblems(built);
  }

  /**
   * Arms a single-shot trigger: at the first instant the condition fires, the simulation runs
   * on for the post-trigger time (what the window holds right of `position`), then pauses with
   * the trigger in view. Armed while stopped, it waits for the next power-on. Why not instead.
   */
  arm(condition: AnalyzerCondition): string | undefined {
    const problems = this.conditionProblems(condition);
    if (problems.length > 0) return problems.join('; ');
    this.#core?.disarm();
    this.#core = undefined;
    const view = this.view.get();
    const window = condition.window ?? (view.width * view.scale || DEFAULT_WINDOW);
    this.trigger.set({ status: 'armed', condition: { ...condition, window } });
    this.#armCore();
    return undefined;
  }

  /** Cancels the trigger (and the pause it asked for, if still pending). */
  disarm(): void {
    this.#core?.disarm();
    this.#core = undefined;
    const host = this.#editor.simulation;
    if (this.#pause !== undefined && host.pausesAt === this.#pause) host.pauseAt(undefined);
    this.#pause = undefined;
    if (this.trigger.get().status !== 'off') this.trigger.set({ status: 'off' });
  }

  #build(condition: AnalyzerCondition): TriggerTerm[] | string {
    const channels = this.channels.get();
    const terms: TriggerTerm[] = [];
    for (const term of condition.terms) {
      const channel = channels.find((c) => probeKey(c.probe) === term.probe);
      if (!channel) return `${term.probe} is not probed`;
      if (channel.problem !== undefined) return `${channel.label}: ${channel.problem}`;
      if (term.kind === 'equal' || term.kind === 'notEqual') {
        terms.push({ kind: term.kind, channels: channel.bits, value: term.value ?? '' });
        continue;
      }
      if (channel.vector) return `${channel.label} is a value: an edge or level needs one signal`;
      if (term.kind === 'level') {
        terms.push({ kind: 'level', channel: channel.bits[0]!, level: term.level ?? Level.L1 });
      } else {
        terms.push({ kind: term.kind, channel: channel.bits[0]! });
      }
    }
    return terms;
  }

  /** Watches the current simulator for the armed condition (a fresh trigger per power-on). */
  #armCore(): void {
    const state = this.trigger.get();
    const sim = this.#sim;
    if (state.status !== 'armed' || !sim) return;
    if (!this.#core) {
      const terms = this.#build(state.condition);
      if (typeof terms === 'string') {
        this.trigger.set({ status: 'off' });
        return;
      }
      this.#core = new Trigger(this.recorder, terms, (time) => this.#fired(time));
    }
    this.#core.attach(sim);
  }

  #fired(time: Time): void {
    const state = this.trigger.get();
    const sim = this.#sim;
    if (state.status !== 'armed' || !sim) return;
    const view = this.view.get();
    const position = Math.min(1, Math.max(0, state.condition.position ?? DEFAULT_POSITION));
    const window = state.condition.window ?? DEFAULT_WINDOW;
    this.trigger.set({ status: 'triggered', condition: state.condition, time });
    this.#core = undefined;
    const scale = view.width > 0 ? window / view.width : view.scale;
    this.view.set({
      ...view,
      scale: Math.min(MAX_WAVE_SCALE, Math.max(MIN_WAVE_SCALE, scale)),
      start: Math.max(0, time - position * window),
      mode: 'free',
    });
    sim.requestBreak();
    this.#pause = time + Math.round(window * (1 - position));
    this.#editor.simulation.pauseAt(this.#pause);
  }

  // ── Following the editor ─────────────────────────────────────────────────────────────────

  /** Forgets the record (another document was opened). */
  clear(): void {
    this.recorder.clear();
    this.#sim = undefined;
    this.view.update((v) => ({ ...v, start: 0, mode: 'fit' }));
    this.revision.update((n) => n + 1);
    this.#sync();
  }

  #sync(): void {
    const { scene, renames } = this.#editor.state.get();
    let changed = false;
    if (scene !== this.#scene) {
      this.#scene = scene;
      changed = this.#rebuild(scene, renames);
    }
    const sim = this.#editor.simulation.simulator;
    if (sim !== this.#sim) {
      if (!sim) {
        this.recorder.detach();
        this.#core?.disarm();
        this.#core = undefined;
        this.#sim = undefined;
        this.revision.update((n) => n + 1);
        return;
      }
      const powerOn = sim.now === 0 && sim.stats.events === 0;
      if (powerOn) {
        this.recorder.clear();
        this.#core?.disarm();
        this.#core = undefined;
        if (this.trigger.get().status === 'triggered') this.trigger.set({ status: 'off' });
        // A new run: the window keeps the scale the user chose and follows it from t = 0.
        this.view.update((v) => ({ ...v, start: 0, mode: v.mode === 'free' ? 'follow' : v.mode }));
      }
      this.#sim = sim;
      this.#attach(sim);
      this.#armCore();
      this.revision.update((n) => n + 1);
    } else if (changed && sim) {
      this.#attach(sim);
      // The terms' channels may have moved: rebuild the trigger on the new list.
      if (this.#core) {
        this.#core.disarm();
        this.#core = undefined;
        this.#armCore();
      }
    }
    if (changed) this.revision.update((n) => n + 1);
  }

  #attach(sim: Simulator): void {
    const nets = new Map<number, number>();
    for (const [key, channel] of this.#bits) {
      const net = this.#nets.get(key);
      if (net === undefined) continue;
      try {
        nets.set(channel, sim.netIndex(net));
      } catch {
        // The simulator runs another netlist than the scene (a broken part left out).
      }
    }
    this.recorder.attach(sim, nets);
  }

  /** Channels for the scene's probes; true when anything a recording depends on changed. */
  #rebuild(scene: Scene, renames: ReadonlyMap<string, string> | undefined): boolean {
    if (renames) {
      let bits = this.#bits;
      for (const [from, to] of renames) {
        const moved = new Map<string, number>();
        for (const [key, channel] of bits) {
          const [renamed] = renameInProbes([{ ref: key }], from, to) as SignalProbe[];
          moved.set(renamed!.ref, channel);
        }
        bits = moved;
      }
      this.#bits = bits;
    }
    const resolver = new Resolver(scene.compiled, this.#editor.registry);
    const used = new Set<string>();
    const nets = new Map<string, string>();
    const channels = scene.circuit.probes.map((probe, index): AnalyzerChannel => {
      const keys = bitKeys(probe);
      const target: ProbeTarget | string = resolver.probe(probe);
      const bits = keys.map((key, i) => {
        used.add(key);
        if (typeof target !== 'string') {
          const net = target.nets[i];
          if (net !== undefined) nets.set(key, net);
        }
        let channel = this.#bits.get(key);
        if (channel === undefined) {
          channel = this.recorder.addChannel();
          this.#bits.set(key, channel);
        }
        return channel;
      });
      const vector = typeof target === 'string' ? keys.length > 1 : target.vector;
      return {
        index,
        probe,
        label: probeLabel(probe),
        reference: isGroupProbe(probe) ? probe.members.join(' ') : probe.ref,
        vector,
        radix: probe.radix ?? 'hex',
        bits,
        bitLabels: keys,
        ...(typeof target === 'string' && { problem: target }),
      };
    });
    for (const [key, channel] of this.#bits) {
      if (used.has(key)) continue;
      this.recorder.removeChannel(channel);
      this.#bits.delete(key);
    }
    const sameNets =
      nets.size === this.#nets.size && [...nets].every(([k, n]) => this.#nets.get(k) === n);
    this.#nets = nets;
    this.channels.set(channels);
    return !sameNets || renames !== undefined;
  }
}

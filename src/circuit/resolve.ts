/**
 * The resolver: references as the app writes them (`U5`, `U5.A0`, `CLK`, `D[0..7]`, `U5[1F]`,
 * and inside instances `A1/U3.Q0`, `A1/CLK`) turned into the parts and nets of a compiled
 * design. The memory inspector, probes, watches, breakpoints and test benches find what they
 * show through it. Spec: docs/circuit.md#resolver.
 */
import {
  type AnyComponentDefinition,
  busMembers,
  type ChannelSource,
  type ComponentRegistry,
  type InnerBit,
  innerReader,
  isBusName,
  Level,
  type MemoryDef,
  type NetlistComponent,
  type SignalsDef,
  type Simulator,
} from '../core';
import type { CircuitNet } from './checks';
import type { CompileResult } from './compile';
import type { Design } from './design';
import { isGroupProbe, type Probe } from './document';
import { MODULE_PART } from './verilog';

/** What a reference names: netlist ids, which the simulator maps to its indices. */
export type Target =
  | { readonly kind: 'part'; readonly part: string; readonly type: string }
  | { readonly kind: 'pin'; readonly part: string; readonly pin: string; readonly net: string }
  | { readonly kind: 'net'; readonly net: string }
  | {
      readonly kind: 'bus';
      readonly bus: string;
      /** Net ids of the members, bit 0 first; `undefined` where no net has the member's name. */
      readonly members: readonly (string | undefined)[];
    }
  | {
      /**
       * Cells `from` … `to` (word indices, inclusive, `from ≤ to`; an address minus the memory's
       * `offset`) of a memory: a chip's (`U5[1F]`, `U5[10..1F]`) or a module's (`A1/rom[1F]`,
       * HDL-6). `part` holds it; `name` is the memory's reference (`U5`, `A1/rom`).
       */
      readonly kind: 'cells';
      readonly part: string;
      readonly type: string;
      readonly memory: MemoryDef;
      readonly name: string;
      readonly from: number;
      readonly to: number;
    }
  | {
      /**
       * A memory of a Verilog module, whole (HDL-6): `A1/rom`, `rom` in the module's own scope.
       * A chip's memory is its part (`U5`).
       */
      readonly kind: 'memory';
      readonly part: string;
      readonly type: string;
      readonly memory: MemoryDef;
      readonly name: string;
    }
  | {
      /**
       * Bits of a named signal inside a Verilog module (HDL-4): `A1/state`, `A1/count[3:0]`;
       * `signal` indexes the part's `signals.list`, `bits` its bits, least significant first.
       */
      readonly kind: 'inner';
      readonly part: string;
      readonly type: string;
      readonly signal: number;
      /** The signal by its path and name (`A1/state`), its declared indices. */
      readonly name: string;
      readonly lsb: number;
      readonly width: number;
      readonly bits: readonly number[];
    };

/** A memory reference taken apart: `U5[10..1F]` → `U5`, `10`, `1F`. */
const CELLS = /^([^[\].\s]+)\[\s*([^\].]+?)\s*(?:\.\.\s*([^\].]+?)\s*)?\]$/;

/** A module memory's cells taken apart: `u_fifo.mem[10..1F]` → `u_fifo.mem`, `10`, `1F`. */
const MEMORY_CELLS = /^(.+?)\s*\[\s*([^\].]+?)\s*(?:\.\.\s*([^\].]+?)\s*)?\]$/;

/** An inner signal's slice taken apart: `count[3:0]`, `count[3..0]`, `count[2]`. */
const SLICE = /^(.+?)\s*\[\s*(\d+)\s*(?:(?::|\.\.)\s*(\d+)\s*)?\]$/;

/**
 * An address as the memory tools take it: hex, bare or with `0x`, `$` or `h` (`7F0`, `0x7F0`,
 * `$7F0`, `7F0h`), from `offset` (a module memory's first address, HDL-6) for `words` words; or
 * why not.
 */
export function parseAddress(text: string, words: number, offset = 0): number | string {
  const trimmed = text.trim();
  const hex = trimmed.replace(/^(0x|\$)/i, '').replace(/h$/i, '');
  const first = offset.toString(16).toUpperCase();
  const last = (offset + words - 1).toString(16).toUpperCase();
  if (!/^[0-9a-f]+$/i.test(hex)) return `Type a hex address, ${first} to ${last}.`;
  const address = Number.parseInt(hex, 16);
  if (address < offset) return `The first address is ${first}.`;
  return address < offset + words ? address : `The last address is ${last}.`;
}

/**
 * One bit a probe shows: a net's id, a bit of a signal inside a part (HDL-4), or `undefined` for a
 * bus member no net is named after (it reads `Z`).
 */
export type SignalBit = string | InnerBit | undefined;

/** Whether two probe bits are the same net or the same bit inside the same part. */
export function sameSignalBit(a: SignalBit, b: SignalBit): boolean {
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  return a.part === b.part && a.signal === b.signal && a.bit === b.bit;
}

/**
 * A probe bit as a recorder channel's source in `sim`: a net's index, or the bit inside its part;
 * undefined where `sim` has no such net or part (it runs another netlist than the design).
 */
export function channelSource(sim: Simulator, bit: SignalBit): ChannelSource | undefined {
  if (bit === undefined) return undefined;
  if (typeof bit !== 'string') return innerReader(sim, bit) ? bit : undefined;
  try {
    return sim.netIndex(bit);
  } catch {
    return undefined;
  }
}

/** A probe bit's level in `sim` now: `Z` for a member no net is named after, `X` for a bit lost. */
export function signalBitLevel(sim: Simulator, bit: SignalBit): Level {
  const source = channelSource(sim, bit);
  if (source === undefined) return bit === undefined ? Level.Z : Level.X;
  return typeof source === 'number'
    ? (sim.levels[source] as Level)
    : (innerReader(sim, source)?.() ?? Level.X);
}

/** What a probe shows: nets or bits inside parts, bit 0 first. */
export interface ProbeTarget {
  /** Bit 0 first. */
  readonly bits: readonly SignalBit[];
  /**
   * Each bit's own reference, bit 0 first — a bus's members (`D0`), a group's, a module signal's
   * bits (`A1/state[0]`) —, the identity a recorder's channel keeps across compiles.
   */
  readonly keys: readonly string[];
  /** Read as a value (a bus or a group), not as one level. */
  readonly vector: boolean;
}

/**
 * A memory of the design, with its definition's description of it: a chip's, by its part
 * (`U5`, `A1/U3`), or a module's, by its name (`A1/rom`, HDL-6).
 */
export interface MemoryPart {
  /** The memory's reference: `U5`, `A1/U3`, `A1/rom`. */
  readonly id: string;
  /** The part holding it, as the simulator names it: `U5`, `A1/U3`, `A1/U1` (a module's part). */
  readonly part: string;
  readonly type: string;
  readonly definition: AnyComponentDefinition;
  readonly memory: MemoryDef;
}

/** Designators in the order people count them: `U2` before `U10`. */
export function compareDesignators(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/** One circuit's compile result as it appears at an instance path (`''`: the top). */
interface Scope {
  readonly path: string;
  readonly result: CompileResult;
  /** Local part id by local id: the simulated parts. */
  readonly parts: ReadonlyMap<string, NetlistComponent>;
  /** Local net id by local pin (`U1.A`), simulated and instance pins. */
  readonly pinNets: ReadonlyMap<string, string>;
  /** Local net id by local net id and by every name of a local net. */
  readonly nets: ReadonlyMap<string, string>;
  /** Designators of the instances placed in this circuit, with the circuit each places. */
  readonly instances: ReadonlyMap<string, string>;
  /** A Verilog module's circuit: its part, whose named signals are this scope's too (HDL-4). */
  readonly module?: NetlistComponent;
}

/**
 * Parts and nets of a compiled design (or of one compiled circuit), by reference. Inside an
 * instance a reference starts with its path (`A1/U3.Q0`, `A1/A2/CLK`); the rest names a part, a
 * pin, a net, a bus or cells of that instance's circuit. Targets carry flat netlist ids.
 */
export class Resolver {
  readonly #registry: ComponentRegistry;
  readonly #design: Design | undefined;
  readonly #parts = new Map<string, NetlistComponent>();
  readonly #scopes = new Map<string, Scope>();
  /** Each flat net's outermost local net: where `netReference` names it from. */
  readonly #home = new Map<string, { readonly scope: Scope; readonly net: CircuitNet }>();

  constructor(source: CompileResult | Design, registry: ComponentRegistry) {
    this.#registry = registry;
    if ('instances' in source) {
      this.#design = source;
      for (const component of source.netlist.components) this.#parts.set(component.id, component);
      const paths = ['', ...source.instances.map((i) => i.path)];
      for (const path of paths) {
        const result = source.circuits.get(source.circuitAt(path)!)!;
        const placed = source.instances.filter((i) => i.parent === path);
        this.#scopes.set(
          path,
          scope(path, result, new Map(placed.map((i) => [i.designator, i.circuit] as const))),
        );
      }
    } else {
      this.#design = undefined;
      for (const component of source.netlist.components) this.#parts.set(component.id, component);
      this.#scopes.set('', scope('', source, new Map()));
    }
    const byDepth = [...this.#scopes.values()].sort((a, b) => depth(a.path) - depth(b.path));
    for (const s of byDepth) {
      for (const net of s.result.nets) {
        const flat = this.#flatNet(s, net.id);
        if (flat !== undefined && !this.#home.has(flat)) this.#home.set(flat, { scope: s, net });
      }
    }
  }

  /** The simulated parts, in netlist order (inner parts by path: `A1/U3`). */
  get parts(): readonly NetlistComponent[] {
    return [...this.#parts.values()];
  }

  /**
   * The memories of the design in designator order: chips by their part, inner ones by path
   * (`A1/U3`, `U2`); a module's by name after its instance's path (`A1/rom`; `rom` in the
   * module's own circuit, HDL-6).
   */
  memories(): MemoryPart[] {
    const found: MemoryPart[] = [];
    for (const { id, type } of this.#parts.values()) {
      const definition = this.#registry.get(type);
      if (definition?.memory) {
        found.push({ id, part: id, type, definition, memory: definition.memory });
      }
    }
    for (const s of this.#scopes.values()) {
      const definition = s.module && this.#registry.get(s.module.type);
      if (!s.module || !definition) continue;
      const prefix = s.path === '' ? '' : `${s.path}/`;
      for (const memory of definition.memories ?? []) {
        const part = prefix + s.module.id;
        found.push({ id: prefix + memory.name!, part, type: s.module.type, definition, memory });
      }
    }
    return found.sort((a, b) => compareDesignators(a.id, b.id));
  }

  /**
   * What `reference` names — a part (`U5`), a pin (`U5.A0`), a net by name or id (`CLK`,
   * `U1.Y`), a bus by its name (`D[0..7]`), cells of a memory part (`U5[1F]`, `U5[10..1F]`:
   * addresses as `parseAddress` takes them; a memory's designator before `[` wins over a bus
   * name), each also inside an instance after its path (`A1/U3.Q0`, `A1/A2/D[0..3]`); an
   * instance's pin (`A1.CLK`) is the net there — or why it names nothing.
   */
  resolve(reference: string): Target | string {
    const text = reference.trim();
    if (text === '') return 'empty reference';
    // Walk down the instances the leading segments name; the rest is a reference inside. Net
    // names may contain `/` (`R/W`): if the rest names nothing there, try it further out.
    const segments = text.split('/');
    const chain: Scope[] = [this.#scopes.get('')!];
    for (let i = 0; i < segments.length - 1; i++) {
      const inner = this.#scopes.get(childPath(chain.at(-1)!.path, segments[i]!));
      if (!inner) break;
      chain.push(inner);
    }
    let first: Target | string | undefined;
    for (let level = chain.length - 1; level >= 0; level--) {
      const rest = segments.slice(level).join('/');
      const target = this.#resolveIn(chain[level]!, rest);
      if (typeof target !== 'string') return target;
      first ??=
        level === chain.length - 1 ? (this.#pathError(chain[level]!, rest) ?? target) : target;
    }
    return first!;
  }

  /** Why a path stops: `A9/U1` → `no instance A9`, `U1/U2` → `U1 is not a subcircuit`. */
  #pathError(s: Scope, rest: string): string | undefined {
    const slash = rest.indexOf('/');
    if (slash <= 0) return undefined;
    const head = rest.slice(0, slash);
    const where = s.path === '' ? '' : ` in ${s.path}`;
    if (s.parts.has(head)) return `${head} is not a subcircuit`;
    return s.nets.has(head) ? undefined : `no instance ${head}${where}`;
  }

  /**
   * A reference without a path, inside the circuit at scope `s`: what it names there today, else
   * — in a Verilog module's circuit — a named signal of the module (HDL-4), so no reference that
   * names a pin or a net changes meaning.
   */
  #resolveIn(s: Scope, text: string): Target | string {
    const found = this.#resolveNamed(s, text);
    if (typeof found !== 'string' || !s.module) return found;
    return this.#moduleMemory(s, s.module, text) ?? this.#inner(s, s.module, text) ?? found;
  }

  /**
   * A memory of the module `part` (HDL-6), whole (`rom`, `u_fifo.mem`) or its cells (`rom[1F]`,
   * `rom[10..1F]`, at its Verilog addresses); undefined where `text` names none.
   */
  #moduleMemory(s: Scope, part: NetlistComponent, text: string): Target | string | undefined {
    const memories = this.#registry.get(part.type)?.memories ?? [];
    if (memories.length === 0) return undefined;
    const prefix = s.path === '' ? '' : `${s.path}/`;
    const id = prefix + part.id;
    const whole = memories.find((m) => m.name === text);
    if (whole)
      return { kind: 'memory', part: id, type: part.type, memory: whole, name: prefix + text };
    const cells = MEMORY_CELLS.exec(text);
    const memory = cells && memories.find((m) => m.name === cells[1]);
    if (!cells || !memory) return undefined;
    return this.#cells(prefix + memory.name!, id, part.type, memory, cells[2]!, cells[3]);
  }

  /** A pin, net, bus, part or cells of the circuit at scope `s`, or why not. */
  #resolveNamed(s: Scope, text: string): Target | string {
    const prefix = s.path === '' ? '' : `${s.path}/`;
    const flat = (net: string) => this.#flatNet(s, net);
    const cells = CELLS.exec(text);
    const owner = cells && s.parts.get(cells[1]!);
    if (cells && owner) {
      const memory = this.#registry.get(owner.type)?.memory;
      const id = prefix + owner.id;
      if (memory) return this.#cells(id, id, owner.type, memory, cells[2]!, cells[3]);
      if (!isBusName(text)) return `${prefix}${owner.id} holds no memory`;
    }
    if (isBusName(text)) {
      const members = busMembers(text).map((name) => {
        const net = s.nets.get(name);
        return net === undefined ? undefined : flat(net);
      });
      if (members.every((net) => net === undefined)) {
        return `no net of ${text} is named on ${s.path === '' ? 'this circuit' : s.path}`;
      }
      return { kind: 'bus', bus: prefix + text, members };
    }
    const part = s.parts.get(text);
    if (part) return { kind: 'part', part: prefix + part.id, type: part.type };
    if (s.instances.has(text)) {
      return `${prefix}${text} is a subcircuit: name a part or a signal inside it (${prefix}${text}/…)`;
    }
    const dot = text.indexOf('.');
    if (dot > 0) {
      const id = text.slice(0, dot);
      const pin = text.slice(dot + 1);
      if (s.instances.has(id)) return this.#instancePin(s, id, pin);
      if (!s.parts.has(id)) return `no part ${prefix}${id}`;
      const net = s.pinNets.get(text);
      return net === undefined
        ? `${prefix}${id} has no pin ${pin}`
        : { kind: 'pin', part: prefix + id, pin, net: flat(net)! };
    }
    const net = s.nets.get(text);
    if (net !== undefined) return { kind: 'net', net: flat(net)! };
    return `no part or net named ${prefix}${text}`;
  }

  /**
   * A named signal of the module `part` (`state`, `u_core.count`), whole or sliced by its own
   * indices (`count[3:0]`, `count[3..0]`, `count[2]`); undefined where `text` names none.
   */
  #inner(s: Scope, part: NetlistComponent, text: string): Target | string | undefined {
    const view = this.#registry.get(part.type)?.signals;
    if (!view) return undefined;
    const prefix = s.path === '' ? '' : `${s.path}/`;
    const target = (signal: number, bits: readonly number[]): Target => {
      const { name, lsb, width } = view.list[signal]!;
      return {
        kind: 'inner',
        part: prefix + part.id,
        type: part.type,
        signal,
        name: prefix + name,
        lsb,
        width,
        bits,
      };
    };
    const whole = view.list.findIndex((signal) => signal.name === text);
    if (whole >= 0) return target(whole, range(0, view.list[whole]!.width - 1));
    const slice = SLICE.exec(text);
    const index = slice ? view.list.findIndex((signal) => signal.name === slice[1]) : -1;
    if (!slice || index < 0) {
      return noSignal(s, view, this.#registry.get(part.type)?.memories ?? [], text);
    }
    const { name, lsb, width } = view.list[index]!;
    const ends = [Number(slice[2]), Number(slice[3] ?? slice[2])];
    const outside = ends.find((i) => i < lsb || i >= lsb + width);
    if (outside !== undefined) {
      return `${prefix}${name} is ${declared(name, lsb, width)}: no bit ${outside}`;
    }
    return target(index, range(Math.min(...ends) - lsb, Math.max(...ends) - lsb));
  }

  /** An instance's pin: the net it is on (a bus pin: its port's bits inside). */
  #instancePin(s: Scope, id: string, pin: string): Target | string {
    const prefix = s.path === '' ? '' : `${s.path}/`;
    const net = s.pinNets.get(`${id}.${pin}`);
    if (net !== undefined) return { kind: 'net', net: this.#flatNet(s, net)! };
    const inner = this.#scopes.get(childPath(s.path, id));
    if (inner && isBusName(pin)) {
      const members = busMembers(pin).map((name) => {
        const local = inner.nets.get(name);
        return local === undefined ? undefined : this.#flatNet(inner, local);
      });
      return { kind: 'bus', bus: `${prefix}${id}.${pin}`, members };
    }
    return `${prefix}${id} has no pin ${pin}`;
  }

  #flatNet(s: Scope, net: string): string | undefined {
    return this.#design ? this.#design.netOf(s.path, net) : net;
  }

  /** Cells of memory `name` (held by `part`) from `first` to `last`, as addresses go. */
  #cells(
    name: string,
    part: string,
    type: string,
    memory: MemoryDef,
    first: string,
    last: string | undefined,
  ): Target | string {
    const offset = memory.offset ?? 0;
    const from = parseAddress(first, memory.words, offset);
    if (typeof from === 'string') return `${name}[${first}]: ${from}`;
    const to = last === undefined ? from : parseAddress(last, memory.words, offset);
    if (typeof to === 'string') return `${name}[${last}]: ${to}`;
    return {
      kind: 'cells',
      part,
      type,
      memory,
      name,
      from: Math.min(from, to) - offset,
      to: Math.max(from, to) - offset,
    };
  }

  /**
   * The bits a signal reference shows — a net, a pin, a bus, a signal inside a module — with
   * their references (`D0`…, `A1/state[0]`…), or why it shows none.
   */
  signal(reference: string): ProbeTarget | string {
    const text = reference.trim();
    const target = this.resolve(text);
    if (typeof target === 'string') return target;
    const keys = isBusName(text) ? busMembers(text) : [text];
    switch (target.kind) {
      case 'part':
        return `${target.part} is a part: probe one of its pins`;
      case 'pin':
      case 'net':
        return { bits: [target.net], keys, vector: false };
      case 'bus':
        return { bits: target.members, keys, vector: true };
      case 'cells':
      case 'memory':
        return `${text} is memory, not a signal`;
      case 'inner': {
        const { part, signal, name, lsb, width, bits } = target;
        return {
          bits: bits.map((bit) => ({ part, signal, bit })),
          keys: width === 1 ? [name] : bits.map((bit) => `${name}[${lsb + bit}]`),
          vector: bits.length > 1,
        };
      }
    }
  }

  /** The bits a probe shows; a group's members must each be one signal. */
  probe(probe: Probe): ProbeTarget | string {
    if (!isGroupProbe(probe)) return this.signal(probe.ref);
    const bits: SignalBit[] = [];
    for (const member of probe.members) {
      const target = this.signal(member);
      if (typeof target === 'string') return `${member}: ${target}`;
      if (target.vector) return `${member} is a bus: a group's members are single signals`;
      bits.push(target.bits[0]);
    }
    return { bits, keys: [...probe.members], vector: true };
  }

  /**
   * The reference to probe a flat net by, from the outermost circuit it is in: its name there,
   * else a pin on it (a driving one first, then an instance's pin), since an unnamed net's id
   * changes with the wiring; inside an instance after its path (`A1/CLK`, `A1/U2.Y`).
   * Undefined for a net no pin is on.
   */
  netReference(net: string): string | undefined {
    const home = this.#home.get(net);
    if (!home) return undefined;
    const prefix = home.scope.path === '' ? '' : `${home.scope.path}/`;
    const found = home.net;
    if (found.names.length > 0) return prefix + found.names[0];
    const pin =
      found.pins.find((p) => p.dir === 'out' || p.dir === 'tristate' || p.dir === 'bidir') ??
      found.pins[0] ??
      found.instancePins[0];
    return pin && `${prefix}${pin.component}.${pin.pin}`;
  }
}

const depth = (path: string) => (path === '' ? 0 : path.split('/').length);

const childPath = (path: string, designator: string) =>
  path === '' ? designator : `${path}/${designator}`;

function scope(path: string, result: CompileResult, instances: ReadonlyMap<string, string>): Scope {
  const parts = new Map(result.netlist.components.map((c) => [c.id, c] as const));
  const only = result.netlist.components.length === 1 ? parts.get(MODULE_PART) : undefined;
  const module = only?.type.startsWith('hdl/') ? only : undefined;
  const pinNets = new Map<string, string>();
  const nets = new Map<string, string>();
  for (const net of result.nets) {
    nets.set(net.id, net.id);
    for (const name of net.names) nets.set(name, net.id);
    for (const pin of [...net.pins, ...net.instancePins]) {
      pinNets.set(`${pin.component}.${pin.pin}`, net.id);
    }
  }
  return { path, result, parts, pinNets, nets, instances, ...(module && { module }) };
}

/** `from` … `to`, both included. */
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** How a signal is declared: `[3:0]`, or one bit `[4]` where its index isn't 0. */
function declared(name: string, lsb: number, width: number): string {
  if (width === 1) return lsb === 0 ? `${name}, one bit` : `${name}[${lsb}]`;
  return `${name}[${lsb + width - 1}:${lsb}]`;
}

/** Why `text` names no signal or memory of a module: the names there are, the first few. */
function noSignal(
  s: Scope,
  view: SignalsDef,
  memories: readonly MemoryDef[],
  text: string,
): string {
  const where = s.path === '' ? 'this module' : s.path;
  const names = view.list.map((signal) => signal.name);
  const few = (list: readonly string[]) =>
    list.length > 8 ? `${list.slice(0, 8).join(', ')}, …` : list.join(', ');
  const stored = memories.length === 0 ? '' : `; memories: ${few(memories.map((m) => m.name!))}`;
  if (names.length === 0 && memories.length === 0)
    return `no part, net or signal named ${text} in ${where}: it keeps no named signals`;
  return `no part, net or signal named ${text} in ${where} (signals: ${few(names)}${stored})`;
}

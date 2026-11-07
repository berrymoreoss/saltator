/**
 * The resolver: references as the app writes them (`U5`, `U5.A0`, `CLK`, `D[0..7]`, `U5[1F]`) turned into
 * the parts and nets of a compiled circuit. The memory inspector finds its memories through it;
 * probes (R13), watches and breakpoints (R14) and test benches (R15) will too, so subcircuit
 * instance paths (`U5/D0`, R11) are added here once. Spec: docs/circuit.md#resolver.
 */
import {
  type AnyComponentDefinition,
  busMembers,
  type ComponentRegistry,
  isBusName,
  type MemoryDef,
  type NetlistComponent,
} from '../core';
import type { CircuitNet } from './checks';
import type { CompileResult } from './compile';
import { isGroupProbe, type Probe } from './document';

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
      /** Cells `from` … `to` (inclusive, `from ≤ to`) of a memory part: `U5[1F]`, `U5[10..1F]`. */
      readonly kind: 'cells';
      readonly part: string;
      readonly type: string;
      readonly memory: MemoryDef;
      readonly from: number;
      readonly to: number;
    };

/** A memory reference taken apart: `U5[10..1F]` → `U5`, `10`, `1F`. */
const CELLS = /^([^[\].\s]+)\[\s*([^\].]+?)\s*(?:\.\.\s*([^\].]+?)\s*)?\]$/;

/**
 * An address as the memory tools take it: hex, bare or with `0x`, `$` or `h` (`7F0`, `0x7F0`,
 * `$7F0`, `7F0h`), below `words`; or why not.
 */
export function parseAddress(text: string, words: number): number | string {
  const trimmed = text.trim();
  const hex = trimmed.replace(/^(0x|\$)/i, '').replace(/h$/i, '');
  const last = (words - 1).toString(16).toUpperCase();
  if (!/^[0-9a-f]+$/i.test(hex)) return `Type a hex address, 0 to ${last}.`;
  const address = Number.parseInt(hex, 16);
  return address < words ? address : `The last address is ${last}.`;
}

/** What a probe shows: nets, bit 0 first. */
export interface ProbeTarget {
  /** Net ids, bit 0 first; `undefined` for a bus member no net is named after (it reads `Z`). */
  readonly nets: readonly (string | undefined)[];
  /** Read as a value (a bus or a group), not as one level. */
  readonly vector: boolean;
}

/** A part holding memory, with its definition's description of it. */
export interface MemoryPart {
  readonly id: string;
  readonly type: string;
  readonly definition: AnyComponentDefinition;
  readonly memory: MemoryDef;
}

/** Designators in the order people count them: `U2` before `U10`. */
export function compareDesignators(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/** Parts and nets of one compiled circuit, by reference. */
export class Resolver {
  readonly #registry: ComponentRegistry;
  readonly #parts = new Map<string, NetlistComponent>();
  /** Net id by pin (`U1.A`). */
  readonly #pinNets = new Map<string, string>();
  /** Net id by net id and by every name of a net. */
  readonly #nets = new Map<string, string>();
  readonly #netsById = new Map<string, CircuitNet>();

  constructor(result: CompileResult, registry: ComponentRegistry) {
    this.#registry = registry;
    for (const component of result.netlist.components) this.#parts.set(component.id, component);
    for (const net of result.nets) {
      this.#netsById.set(net.id, net);
      this.#nets.set(net.id, net.id);
      for (const name of net.names) this.#nets.set(name, net.id);
      for (const pin of net.pins) this.#pinNets.set(`${pin.component}.${pin.pin}`, net.id);
    }
  }

  /** The simulated parts, in netlist order. */
  get parts(): readonly NetlistComponent[] {
    return [...this.#parts.values()];
  }

  /** The parts that hold memory, in designator order. */
  memories(): MemoryPart[] {
    const found: MemoryPart[] = [];
    for (const { id, type } of this.#parts.values()) {
      const definition = this.#registry.get(type);
      if (definition?.memory) found.push({ id, type, definition, memory: definition.memory });
    }
    return found.sort((a, b) => compareDesignators(a.id, b.id));
  }

  /**
   * What `reference` names — a part (`U5`), a pin (`U5.A0`), a net by name or id (`CLK`,
   * `U1.Y`), a bus by its name (`D[0..7]`), cells of a memory part (`U5[1F]`, `U5[10..1F]`:
   * addresses as `parseAddress` takes them; a memory's designator before `[` wins over a bus
   * name) — or why it names nothing.
   */
  resolve(reference: string): Target | string {
    const text = reference.trim();
    if (text === '') return 'empty reference';
    if (text.includes('/')) return `"${text}": paths into subcircuits come with R11`;
    const cells = CELLS.exec(text);
    const owner = cells && this.#parts.get(cells[1]!);
    if (cells && owner) {
      const memory = this.#registry.get(owner.type)?.memory;
      if (memory) return this.#cells(owner, memory, cells[2]!, cells[3]);
      if (!isBusName(text)) return `${owner.id} holds no memory`;
    }
    if (isBusName(text)) {
      const members = busMembers(text).map((name) => this.#nets.get(name));
      if (members.every((net) => net === undefined)) {
        return `no net of ${text} is named on this circuit`;
      }
      return { kind: 'bus', bus: text, members };
    }
    const part = this.#parts.get(text);
    if (part) return { kind: 'part', part: part.id, type: part.type };
    const dot = text.indexOf('.');
    if (dot > 0) {
      const id = text.slice(0, dot);
      const pin = text.slice(dot + 1);
      if (!this.#parts.has(id)) return `no part ${id}`;
      const net = this.#pinNets.get(text);
      return net === undefined ? `${id} has no pin ${pin}` : { kind: 'pin', part: id, pin, net };
    }
    const net = this.#nets.get(text);
    if (net !== undefined) return { kind: 'net', net };
    return `no part or net named ${text}`;
  }

  #cells(
    part: NetlistComponent,
    memory: MemoryDef,
    first: string,
    last: string | undefined,
  ): Target | string {
    const from = parseAddress(first, memory.words);
    if (typeof from === 'string') return `${part.id}[${first}]: ${from}`;
    const to = last === undefined ? from : parseAddress(last, memory.words);
    if (typeof to === 'string') return `${part.id}[${last}]: ${to}`;
    return {
      kind: 'cells',
      part: part.id,
      type: part.type,
      memory,
      from: Math.min(from, to),
      to: Math.max(from, to),
    };
  }

  /** The nets a signal reference shows — a net, a pin or a bus — or why it shows none. */
  signal(reference: string): ProbeTarget | string {
    const target = this.resolve(reference);
    if (typeof target === 'string') return target;
    switch (target.kind) {
      case 'part':
        return `${target.part} is a part: probe one of its pins`;
      case 'pin':
        return { nets: [target.net], vector: false };
      case 'net':
        return { nets: [target.net], vector: false };
      case 'bus':
        return { nets: target.members, vector: true };
      case 'cells':
        return `${reference.trim()} is memory, not a signal`;
    }
  }

  /** The nets a probe shows; a group's members must each be one signal. */
  probe(probe: Probe): ProbeTarget | string {
    if (!isGroupProbe(probe)) return this.signal(probe.ref);
    const nets: string[] = [];
    for (const member of probe.members) {
      const target = this.signal(member);
      if (typeof target === 'string') return `${member}: ${target}`;
      if (target.vector) return `${member} is a bus: a group's members are single signals`;
      nets.push(target.nets[0]!);
    }
    return { nets, vector: true };
  }

  /**
   * The reference to probe a net by: its name, else a pin on it (a driving one first), since an
   * unnamed net's id changes with the wiring. Undefined for a net no pin is on.
   */
  netReference(net: string): string | undefined {
    const found = this.#netsById.get(net);
    if (!found) return undefined;
    if (found.names.length > 0) return found.names[0];
    const pin =
      found.pins.find((p) => p.dir === 'out' || p.dir === 'tristate' || p.dir === 'bidir') ??
      found.pins[0];
    return pin && `${pin.component}.${pin.pin}`;
  }
}

/**
 * The resolver: references as the app writes them (`U5`, `U5.A0`, `CLK`, `D[0..7]`) turned into
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
import type { CompileResult } from './compile';

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
    };

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

  constructor(result: CompileResult, registry: ComponentRegistry) {
    this.#registry = registry;
    for (const component of result.netlist.components) this.#parts.set(component.id, component);
    for (const net of result.nets) {
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
   * `U1.Y`), a bus by its name (`D[0..7]`) — or why it names nothing.
   */
  resolve(reference: string): Target | string {
    const text = reference.trim();
    if (text === '') return 'empty reference';
    if (text.includes('/')) return `"${text}": paths into subcircuits come with R11`;
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
}

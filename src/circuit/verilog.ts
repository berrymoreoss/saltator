/**
 * Circuits written in Verilog (HDL-1, ADR-0030): a circuit whose content is a compiled module
 * (`Circuit.verilog`). Its ports are the instance's pins, a vector one bus pin; compiled on its
 * own it is one part, `U1` of type `hdl/<circuit id>`, with a net per port bit named after its
 * pin, so flattening and benches treat it as any circuit: `A1/U1` in an instance, its bits
 * joined to the outer bus member by member. Spec: docs/circuit.md#verilog-modules.
 */
import {
  type HdlMessage,
  type HdlPartResult,
  hdlPortName,
  hdlPortPins,
  type NetlistComponent,
} from '../core';
import type { CircuitNet, DesignIssue, PlacedPin } from './checks';
import type { CompileResult } from './compile';
import type { Circuit } from './document';
import type { CircuitPort } from './subcircuit';

/** The designator of the part a module runs as in its circuit: `A1/U1` in instance `A1`. */
export const MODULE_PART = 'U1';

/** A module's ports as its instances' pins: in declaration order, inputs left, outputs right. */
export function modulePorts(circuit: Circuit): CircuitPort[] {
  const module = circuit.verilog?.module;
  if (!module) return [];
  return module.ports.map((port, i) => ({
    component: MODULE_PART,
    name: hdlPortName(port),
    direction: port.dir,
    side: port.dir === 'in' ? 'left' : 'right',
    bus: port.bits.length > 1,
    at: [0, i],
  }));
}

/** A module's message as a design issue, its source location in front. */
export function moduleIssue(message: HdlMessage): DesignIssue {
  return {
    severity: message.severity,
    code: message.severity === 'error' ? 'hdl-error' : 'hdl-warning',
    message: message.src ? `${message.src}: ${message.message}` : message.message,
    ...(message.src && { src: message.src }),
  };
}

/**
 * Compiles a module's circuit, given the part its registry made of it (undefined while it has
 * no IR). Never throws: no IR yet is an `hdl-not-compiled` warning, the module's errors and
 * warnings are `hdl-error` and `hdl-warning` issues, and a module in error has no part.
 */
export function compileModule(circuit: Circuit, part: HdlPartResult | undefined): CompileResult {
  const module = circuit.verilog?.module;
  const issues: DesignIssue[] = [];
  if (!module) {
    issues.push({
      severity: 'warning',
      code: 'hdl-not-compiled',
      message: 'not compiled yet: paste the JSON Yosys made, then Compile',
    });
  }
  const messages = part?.messages ?? [];
  for (const message of messages) issues.push(moduleIssue(message));
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));

  const definition = part?.definition;
  const components: NetlistComponent[] = definition
    ? [{ id: MODULE_PART, type: definition.type }]
    : [];
  const nets: CircuitNet[] = [];
  for (const port of module?.ports ?? []) {
    for (const pin of hdlPortPins(port)) {
      const placed: PlacedPin = {
        component: MODULE_PART,
        pin,
        dir: port.dir,
        weak: false,
        sense: false,
        at: [0, 0],
      };
      nets.push({
        id: pin,
        names: [pin],
        pins: definition ? [placed] : [],
        schematicPins: [],
        instancePins: [],
        wires: [],
      });
    }
  }
  return {
    netlist: {
      components,
      nets: nets.map((net) => ({
        id: net.id,
        pins: net.pins.map((p) => ({ component: p.component, pin: p.pin })),
      })),
    },
    nets,
    wireNets: new Map(),
    buses: [],
    wireBuses: new Map(),
    junctions: [],
    busJunctions: [],
    openPins: new Set(),
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
  };
}

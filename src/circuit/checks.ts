/**
 * Design checks: static problems found while compiling, before anything is simulated. Each issue
 * carries enough location data (component, pin, wire, net, point) to be shown on the canvas.
 * Spec: docs/circuit.md#design-checks.
 */
import { busMembers, isBusName, isDriverPin, type PinDir, type PortDirection } from '../core';
import type { WireEnd } from './connectivity';
import type { Wire } from './document';
import type { Point } from './geometry';

export type DesignIssueCode =
  | 'unknown-type'
  | 'invalid-props'
  | 'shorted-outputs'
  | 'undriven-input'
  | 'dangling-wire'
  | 'multiple-net-names'
  | 'single-net-label'
  | 'bus-entry-member'
  | 'duplicate-port';

export interface DesignIssue {
  readonly severity: 'error' | 'warning';
  readonly code: DesignIssueCode;
  readonly message: string;
  readonly component?: string;
  readonly pin?: string;
  readonly wire?: string;
  readonly net?: string;
  readonly at?: Point;
}

/** A pin of a compiled component, placed on the grid. */
export interface PlacedPin {
  readonly component: string;
  readonly pin: string;
  readonly dir: PinDir;
  readonly weak: boolean;
  /** Observes the net without loading it (LEDs, probes): never an undriven input. */
  readonly sense: boolean;
  /** The output is tied to this level (rails, constants). */
  readonly constant?: 0 | 1;
  /** The circuit-wide net the pin joins by name (net labels, VCC and GND symbols). */
  readonly net?: string;
  /** The pin of a port (R11a): the circuit's interface pin of that direction, named `net`. */
  readonly port?: PortDirection;
  /**
   * The pin of a subcircuit instance (R11a): it connects through to the instance's inside, so
   * what drives it is there — a possible driver here, never a push-pull output.
   */
  readonly instance?: true;
  readonly at: Point;
}

/** A net of the compiled circuit, with everything on it in document order. */
export interface CircuitNet {
  readonly id: string;
  /**
   * The names its pins give it, the one it is called by first: names from simulated pins (VCC,
   * GND) before names from net labels, each in code-point order. Empty for unnamed nets.
   */
  readonly names: readonly string[];
  /** Pins of simulated parts (the netlist's pins). */
  readonly pins: readonly PlacedPin[];
  /** Pins of schematic-only parts (net labels): drawn and connected, never simulated. */
  readonly schematicPins: readonly PlacedPin[];
  /** Pins of subcircuit instances (R11a): they join nets inside the instances when flattened. */
  readonly instancePins: readonly PlacedPin[];
  readonly wires: readonly Wire[];
}

/**
 * A bus of the compiled circuit: bus lines and the bus pins on them (bus entries' bus ends, bus
 * labels), joined geometrically and by bus label names. It carries no level of its own: its
 * members are ordinary nets, named `D0`…`D7` for a bus called `D[0..7]`.
 */
export interface CircuitBus {
  readonly id: string;
  /** The names its bus labels give it, in code-point order; it is called by the first. */
  readonly names: readonly string[];
  /** Member net names of its first name, least significant first; empty for an unnamed bus. */
  readonly members: readonly string[];
  /** Bus pins on it, in document order. */
  readonly pins: readonly PlacedPin[];
  readonly wires: readonly Wire[];
}

const pinName = (p: PlacedPin) => `${p.component}.${p.pin}`;

/**
 * Nets with two or more strong push-pull outputs: a short circuit as soon as they disagree.
 * Outputs tied to the same level (two VCC symbols) count as one source. Pull resistors (`weak`
 * pins) and tri-state outputs are fine; their conflicts are runtime `contention` diagnostics.
 */
export function shortedOutputs(nets: readonly CircuitNet[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const net of nets) {
    const outputs = net.pins.filter((p) => p.dir === 'out' && !p.weak);
    const second = secondSource(outputs);
    if (second === undefined) continue;
    issues.push({
      severity: 'error',
      code: 'shorted-outputs',
      message: `outputs shorted together on net "${net.id}": ${outputs.map(pinName).join(', ')}`,
      net: net.id,
      component: second.component,
      pin: second.pin,
      at: second.at,
    });
  }
  return issues;
}

/** The first output that is a different source than the ones before it, if any. */
function secondSource(outputs: readonly PlacedPin[]): PlacedPin | undefined {
  const tied = new Set<0 | 1>();
  let sources = 0;
  for (const pin of outputs) {
    if (pin.constant !== undefined) {
      if (tied.has(pin.constant)) continue;
      tied.add(pin.constant);
    }
    if (++sources === 2) return pin;
  }
  return undefined;
}

/**
 * Inputs on nets that nothing could drive: unconnected, or connected only to other inputs. A net
 * named in `driven` may be driven from outside the circuit (the names of its input and
 * bidirectional ports, a bus port's members).
 */
export function undrivenInputs(
  nets: readonly CircuitNet[],
  driven: ReadonlySet<string> = new Set(),
): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const net of nets) {
    const inputs = [...net.pins, ...net.instancePins];
    if (inputs.some((p) => isDriverPin(p.dir))) continue;
    if (net.names.some((name) => driven.has(name))) continue;
    const alone = inputs.length === 1 && net.wires.length === 0 && net.schematicPins.length === 0;
    for (const pin of inputs) {
      if (pin.dir !== 'in' || pin.sense) continue;
      issues.push({
        severity: 'warning',
        code: 'undriven-input',
        message: alone
          ? `input ${pinName(pin)} is not connected (reads as X)`
          : `input ${pinName(pin)} is on net "${net.id}", which nothing drives (reads as X)`,
        component: pin.component,
        pin: pin.pin,
        net: net.id,
        at: pin.at,
      });
    }
  }
  return issues;
}

/**
 * Wire and bus ends that touch nothing — usually a wire that stops one cell short of a pin. A
 * wire ending on a bus (`onBus`) gets a hint: wires and buses connect only through bus entries.
 */
export function danglingWires(
  ends: readonly WireEnd[],
  wires: readonly Wire[],
  onBus: (at: Point) => boolean = () => false,
): DesignIssue[] {
  return ends.map(({ wire, at }) => {
    const { id, bus } = wires[wire]!;
    const where = `ends at (${at[0]}, ${at[1]})`;
    const message = bus
      ? `bus ${id} ${where} without touching anything`
      : onBus(at)
        ? `wire ${id} ${where} on a bus without connecting to it (use a bus entry)`
        : `wire ${id} ${where} without touching anything`;
    return { severity: 'warning', code: 'dangling-wire', message, wire: id, at };
  });
}

/**
 * Nets with more than one name (labels `CLK` and `CLOCK` on one wire, a label on a VCC wire):
 * usually a mistake, as in KiCad. The net is called by its first name; the issue sits at the first
 * pin giving it the second.
 */
export function multipleNetNames(nets: readonly CircuitNet[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const net of nets) {
    const second = net.names[1];
    if (second === undefined) continue;
    const pin = [...net.pins, ...net.schematicPins].find((p) => p.net === second)!;
    issues.push({
      severity: 'warning',
      code: 'multiple-net-names',
      message: `net "${net.id}" has several names: ${net.names.join(', ')} (it is called ${net.id})`,
      net: net.id,
      component: pin.component,
      pin: pin.pin,
      at: pin.at,
    });
  }
  return issues;
}

/**
 * Buses with more than one name (bus labels `D[0..7]` and `A[0..7]` on one bus line), as
 * `multiple-net-names`: the bus is called by its first name.
 */
export function multipleBusNames(buses: readonly CircuitBus[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const bus of buses) {
    const second = bus.names[1];
    if (second === undefined) continue;
    const pin = bus.pins.find((p) => p.net === second)!;
    issues.push({
      severity: 'warning',
      code: 'multiple-net-names',
      message: `bus "${bus.id}" has several names: ${bus.names.join(', ')} (it is called ${bus.id})`,
      component: pin.component,
      pin: pin.pin,
      at: pin.at,
    });
  }
  return issues;
}

/**
 * Bus entries on a named bus whose net name isn't one of the bus's members (`D9` on `D[0..7]`):
 * the bit joins its name, but not as part of that bus. `entryNames` maps each bus entry (a part
 * with an unnamed bus pin) to the net name its other pin joins.
 */
export function busEntryMembers(
  buses: readonly CircuitBus[],
  entryNames: ReadonlyMap<string, string>,
): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const bus of buses) {
    if (bus.members.length === 0) continue;
    for (const pin of bus.pins) {
      const name = entryNames.get(pin.component);
      if (name === undefined || bus.members.includes(name)) continue;
      issues.push({
        severity: 'warning',
        code: 'bus-entry-member',
        message: `bus entry ${pin.component} joins ${name}, which is not a member of bus ${bus.id}`,
        component: pin.component,
        pin: pin.pin,
        at: pin.at,
      });
    }
  }
  return issues;
}

/**
 * Net labels and bus entries whose name nothing else uses (no other label or entry, no VCC/GND
 * symbol): they join nothing by name, which is usually a typo (`CKL` for `CLK`). `entries` are
 * the bus entries among the schematic-only parts. Names a port gives (`portNames`: its name,
 * a bus port's members) never count: the port is their connection to the outside.
 */
export function singleNetLabels(
  nets: readonly CircuitNet[],
  entries: ReadonlySet<string> = new Set(),
  portNames: ReadonlySet<string> = new Set(),
): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const net of nets) {
    for (const label of net.schematicPins) {
      const name = label.net;
      if (name === undefined || portNames.has(name)) continue;
      const uses = [...net.pins, ...net.schematicPins].filter((p) => p.net === name).length;
      if (uses > 1) continue;
      const kind = entries.has(label.component) ? 'bus entry' : 'net label';
      issues.push({
        severity: 'warning',
        code: 'single-net-label',
        message: `${kind} ${label.component} "${name}" is the only one with this name, so it joins nothing (a typo?)`,
        net: net.id,
        component: label.component,
        pin: label.pin,
        at: label.at,
      });
    }
  }
  return issues;
}

/** A port of the compiled circuit: its part, name and direction, where its pin is. */
export interface PlacedPort {
  readonly component: string;
  readonly pin: string;
  readonly name: string;
  readonly direction: PortDirection;
  readonly at: Point;
}

/** The net names a port gives: its name, or a bus port's members. */
export function portBits(name: string): readonly string[] {
  return isBusName(name) ? busMembers(name) : [name];
}

/**
 * Ports that give a name another port gives already: two ports named `CLK`, or `D3` beside the
 * bus port `D[0..7]`. An instance would have two pins for one signal; the first port keeps it.
 */
export function duplicatePorts(ports: readonly PlacedPort[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const owner = new Map<string, PlacedPort>();
  for (const port of ports) {
    const bits = portBits(port.name);
    const clash = bits.map((bit) => [bit, owner.get(bit)] as const).find(([, first]) => first);
    if (clash) {
      const [bit, first] = clash as readonly [string, PlacedPort];
      issues.push({
        severity: 'error',
        code: 'duplicate-port',
        message:
          first.name === port.name
            ? `ports ${first.component} and ${port.component} are both named ${port.name}`
            : `port ${port.component} "${port.name}" gives ${bit}, which port ${first.component} "${first.name}" gives already`,
        component: port.component,
        pin: port.pin,
        at: port.at,
      });
      continue;
    }
    for (const bit of bits) owner.set(bit, port);
  }
  return issues;
}

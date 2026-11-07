/**
 * Design checks: static problems found while compiling, before anything is simulated. Each issue
 * carries enough location data (component, pin, wire, net, point) to be shown on the canvas.
 * Spec: docs/circuit.md#design-checks.
 */
import { isDriverPin, type PinDir } from '../core';
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
  | 'single-net-label';

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

/** Inputs on nets that nothing could drive: unconnected, or connected only to other inputs. */
export function undrivenInputs(nets: readonly CircuitNet[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const net of nets) {
    if (net.pins.some((p) => isDriverPin(p.dir))) continue;
    const alone = net.pins.length === 1 && net.wires.length === 0 && net.schematicPins.length === 0;
    for (const pin of net.pins) {
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
 * Net labels whose name nothing else uses (no other label, no VCC/GND symbol): they join nothing
 * by name, which is usually a typo (`CKL` for `CLK`).
 */
export function singleNetLabels(nets: readonly CircuitNet[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  for (const net of nets) {
    for (const label of net.schematicPins) {
      const name = label.net;
      if (name === undefined) continue;
      const uses = [...net.pins, ...net.schematicPins].filter((p) => p.net === name).length;
      if (uses > 1) continue;
      issues.push({
        severity: 'warning',
        code: 'single-net-label',
        message: `net label ${label.component} "${name}" is the only one with this name, so it joins nothing (a typo?)`,
        net: net.id,
        component: label.component,
        pin: label.pin,
        at: label.at,
      });
    }
  }
  return issues;
}

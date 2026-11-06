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
  | 'dangling-wire';

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
  readonly at: Point;
}

/** A net of the compiled circuit, with everything on it in document order. */
export interface CircuitNet {
  readonly id: string;
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
    const alone = net.pins.length === 1 && net.wires.length === 0;
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

/** Wire ends that touch nothing — usually a wire that stops one cell short of a pin. */
export function danglingWires(ends: readonly WireEnd[], wires: readonly Wire[]): DesignIssue[] {
  return ends.map(({ wire, at }) => ({
    severity: 'warning',
    code: 'dangling-wire',
    message: `wire ${wires[wire]!.id} ends at (${at[0]}, ${at[1]}) without touching anything`,
    wire: wires[wire]!.id,
    at,
  }));
}

/**
 * Circuits for the test bench's unit tests, built from the bench's test parts: `cell` (an AND
 * through ports), `memory` (a RAM behind bus ports), `roms` (a ROM with an image) and `main`
 * (switches, a button, a DIP switch, clocks, a flip-flop).
 */
import { CircuitBuilder } from '../builder';
import { type Circuit, type CircuitDocument, SCHEMA_VERSION } from '../document';
import { benchTestRegistry } from './test-parts';

const registry = benchTestRegistry();

/** A builder with `label(pin, name)`: a net label (or a port) right on a pin's tip. */
function builder(id: string, name: string) {
  const b = new CircuitBuilder(registry, { id, name });
  let n = 0;
  const at = (pin: string) => b.pin(pin);
  return {
    b,
    add: (id: string, type: string, x: number, y: number, props = {}) => {
      b.add(id, type, { at: [x, y], props });
    },
    label: (pin: string, name: string) => {
      b.add(`NL${++n}`, 'test/label', { at: at(pin), props: { name } });
    },
    port: (pin: string, name: string, direction: 'in' | 'out' | 'bidir') => {
      b.add(`P${++n}`, 'test/port', { at: at(pin), props: { name, direction } });
    },
  };
}

/** `cell`: Y = A and B through ports. */
export function cell(): Circuit {
  const c = builder('cell', 'Cell');
  c.add('U1', 'test/and', 0, 0);
  c.port('U1.A', 'A', 'in');
  c.port('U1.B', 'B', 'bidir'); // driven as well
  c.port('U1.Y', 'Y', 'out');
  return c.b.build();
}

/** `memory`: a RAM addressed through the bus port `A[0..3]`, its data out on `D[0..7]`. */
function memory(): Circuit {
  const c = builder('memory', 'Memory');
  c.add('U1', 'test/ram', 0, 0);
  for (let i = 0; i < 4; i++) c.label(`U1.A${i}`, `A${i}`);
  for (let i = 0; i < 8; i++) c.label(`U1.D${i}`, `D${i}`);
  c.b.add('PA', 'test/port', { at: [-20, 0], props: { name: 'A[0..3]', direction: 'in' } });
  c.b.add('PD', 'test/port', { at: [-20, 4], props: { name: 'D[0..7]', direction: 'out' } });
  return c.b.build();
}

/** `roms`: a PROM addressed through ports, its data out on `D[0..7]`. */
function roms(): Circuit {
  const c = builder('roms', 'ROMs');
  c.add('U1', 'test/prom', 0, 0, { contents: '0000:11223344' });
  c.port('U1.A0', 'A0', 'in');
  c.port('U1.A1', 'A1', 'in');
  for (let i = 0; i < 8; i++) c.label(`U1.D${i}`, `D${i}`);
  return c.b.build();
}

/** `panel`: a switch into a flip-flop clocked by a manual clock; a button and a DIP switch. */
function panel(): Circuit {
  const c = builder('main', 'Main');
  c.add('SW1', 'test/switch', 0, 0);
  c.add('SW2', 'test/button', 0, 10);
  c.add('SW3', 'test/dips', 0, 20);
  c.add('X1', 'test/clock', 0, 40);
  c.add('X2', 'test/clock', 0, 50, { mode: 'auto' });
  c.add('U1', 'test/dff', 20, 0);
  c.add('U2', 'test/and', 20, 10);
  c.label('SW1.Y', 'DATA');
  c.label('U1.D', 'DATA');
  c.label('X1.Y', 'STEP');
  c.label('U1.CLK', 'STEP');
  c.label('U1.Q', 'Q');
  c.label('SW2.Y', 'PUSH');
  c.label('U2.A', 'PUSH');
  c.label('SW3.Y0', 'S0');
  c.label('U2.B', 'S0');
  c.label('U2.Y', 'BOTH');
  c.label('X2.Y', 'FREE');
  return c.b.build();
}

/** The test circuits in one document: `main` (the panel, the top), `cell`, `memory`, `roms`. */
export function benchTestDocument(): CircuitDocument {
  return { schemaVersion: SCHEMA_VERSION, circuits: [panel(), cell(), memory(), roms()] };
}

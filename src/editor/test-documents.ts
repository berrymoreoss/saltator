/**
 * Documents of several circuits for the editor's tests (R11a, R11b): small modules with ports,
 * placed twice, one or two levels deep. Test support only.
 */
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  type ComponentInstance,
  documentRegistry,
  emptyCircuit,
  type Point,
  SCHEMA_VERSION,
} from '../circuit';
import { type ComponentRegistry, Level, ns, strong } from '../core';
import { Editor } from './editor';
import { FakeClock } from './fake-clock';

export function port(
  id: string,
  name: string,
  x: number,
  y: number,
  direction = 'in',
): ComponentInstance {
  return {
    id,
    type: 'net/port',
    x,
    y,
    rotation: 0,
    flip: false,
    props: { name, direction, side: 'auto' },
  };
}

export function label(id: string, name: string, at: Point): ComponentInstance {
  return { id, type: 'net/label', x: at[0], y: at[1], rotation: 0, flip: false, props: { name } };
}

/** Joins each list of pins by net labels of one name. */
function join(b: CircuitBuilder, joins: readonly (readonly [string, readonly string[]])[]): void {
  for (const [name, pins] of joins) {
    for (const [i, pin] of pins.entries()) {
      b.add(`NL${name}${i}`, 'net/label', { at: b.pin(pin), props: { name } });
    }
  }
}

/** `reg`: a 74HC74 latching D on CP's rising edge to Q; set, reset and the spare tied high. */
export function registerCircuit(library: ComponentRegistry): Circuit {
  const b = new CircuitBuilder(library, { id: 'reg', name: 'Register' });
  b.add('U1', '74xx/74hc74', { at: [10, 0] });
  b.add('PWR1', 'io/vcc', { at: [30, 0] });
  const pins = (names: string[]) => names.map((n) => b.pin(`U1.${n}`));
  const circuit = b.build();
  const high = pins(['1SD', '1RD', '2SD', '2RD', '2D', '2CP']).map((at, i) =>
    label(`NL${i}`, 'VCC', at),
  );
  const [d, cp, q] = pins(['1D', '1CP', '1Q']) as [Point, Point, Point];
  return {
    ...circuit,
    components: [
      ...circuit.components,
      ...high,
      port('P1', 'D', d[0], d[1]),
      port('P2', 'CP', cp[0], cp[1]),
      port('P3', 'Q', q[0], q[1], 'out'),
    ],
  };
}

/**
 * Two registers A1, A2 (`reg`) in Main: `test/driver`s D1, D2 on their D inputs, CK on both
 * clocks (the library must have `test/driver`).
 */
export function registerDesign(library: ComponentRegistry): CircuitDocument {
  const module = registerCircuit(library);
  const draft = shell(
    [module],
    [
      ['A1', 'reg', [30, 0]],
      ['A2', 'reg', [30, 20]],
    ],
  );
  const top = new CircuitBuilder(documentRegistry(draft, library));
  top.add('A1', 'sub/reg', { at: [30, 0] });
  top.add('A2', 'sub/reg', { at: [30, 20] });
  top.add('D1', 'test/driver', { at: [0, 0] });
  top.add('D2', 'test/driver', { at: [0, 10] });
  top.add('CK', 'test/driver', { at: [0, 20] });
  join(top, [
    ['DA', ['D1.Y', 'A1.D']],
    ['DB', ['D2.Y', 'A2.D']],
    ['CLOCK', ['CK.Y', 'A1.CP', 'A2.CP']],
  ]);
  return { schemaVersion: SCHEMA_VERSION, circuits: [top.build(), module] };
}

/**
 * The registers of `registerDesign` in an editor, run (on a fake clock) until 1 is latched
 * into A1 and 0 into A2, then paused. `step(until)` runs to a time; `q(path)` reads `1Q`.
 */
export function latchedRegisters(library: ComponentRegistry) {
  const clock = new FakeClock();
  clock.cost = 0.001;
  const editor = new Editor(library, registerDesign(library), {}, { simulation: { clock } });
  const { simulation } = editor;
  const step = (until: number) => {
    simulation.runTo({ kind: 'time', until, label: 'test' });
    for (let i = 0; i < 1000 && simulation.state === 'running'; i++) clock.frame(16);
  };
  simulation.run();
  simulation.pause();
  const act = (id: string, level: Level) => simulation.action(id, strong(level));
  act('D1', Level.L1);
  act('D2', Level.L0);
  act('CK', Level.L0);
  step(ns(100));
  act('CK', Level.L1);
  step(ns(200));
  const q = (path: string) => simulation.simulator!.pinLevel(path, '1Q');
  return { editor, simulation, clock, step, q };
}

/**
 * `lamp`: an LED D1 from port IN to a ground rail, placed twice in Main — A1 fed by driver
 * D1, A2 by D2.
 */
export function lampDesign(library: ComponentRegistry): CircuitDocument {
  const b = new CircuitBuilder(library, { id: 'lamp', name: 'Lamp' });
  b.add('D1', 'io/led', { at: [10, 0] });
  b.add('PWR1', 'io/gnd', { at: [20, 6] });
  const [a, k] = [b.pin('D1.A'), b.pin('D1.K')];
  const built = b.build();
  const lamp: Circuit = {
    ...built,
    components: [...built.components, port('P1', 'IN', a[0], a[1]), label('NL1', 'GND', k)],
  };
  const top = new CircuitBuilder(documentRegistry(shell([lamp], []), library));
  top.add('A1', 'sub/lamp', { at: [30, 0] });
  top.add('A2', 'sub/lamp', { at: [30, 20] });
  top.add('D1', 'test/driver', { at: [0, 0] });
  top.add('D2', 'test/driver', { at: [0, 20] });
  join(top, [
    ['X1', ['D1.Y', 'A1.IN']],
    ['X2', ['D2.Y', 'A2.IN']],
  ]);
  return { schemaVersion: SCHEMA_VERSION, circuits: [top.build(), lamp] };
}

/** `inverter`: a NOT gate U1 between ports A (in) and Y (out), joined by labels at its pins. */
export function inverterCircuit(library: ComponentRegistry): Circuit {
  const b = new CircuitBuilder(library, { id: 'inverter', name: 'Inverter' });
  b.add('U1', 'prim/not', { at: [10, 0] });
  const [a, y] = [b.pin('U1.A'), b.pin('U1.Y')];
  const circuit = b.build();
  return {
    ...circuit,
    components: [
      ...circuit.components,
      port('P1', 'A', a[0], a[1]),
      port('P2', 'Y', y[0], y[1], 'out'),
    ],
  };
}

/**
 * Two levels: `chain` — inverters A1 → A2 between ports IN and OUT, MID between them — placed
 * twice in Main (A1 fed by driver D1, A2 by D2; outputs on labels Q1, Q2). Instance paths
 * `A1`, `A1/A1`, `A1/A2`, `A2`, `A2/A1`, `A2/A2`.
 */
export function chainDesign(library: ComponentRegistry): CircuitDocument {
  const inverter = inverterCircuit(library);
  const inner = new CircuitBuilder(documentRegistry(shell([inverter], []), library), {
    id: 'chain',
    name: 'Chain',
  });
  inner.add('A1', 'sub/inverter', { at: [10, 0] });
  inner.add('A2', 'sub/inverter', { at: [10, 10] });
  join(inner, [['MID', ['A1.Y', 'A2.A']]]);
  const [a, y] = [inner.pin('A1.A'), inner.pin('A2.Y')];
  const built = inner.build();
  const chain: Circuit = {
    ...built,
    components: [
      ...built.components,
      port('P1', 'IN', a[0], a[1]),
      port('P2', 'OUT', y[0], y[1], 'out'),
    ],
  };
  const draft = shell([chain, inverter], []);
  const top = new CircuitBuilder(documentRegistry(draft, library));
  top.add('A1', 'sub/chain', { at: [30, 0] });
  top.add('A2', 'sub/chain', { at: [30, 20] });
  top.add('D1', 'test/driver', { at: [0, 0] });
  top.add('D2', 'test/driver', { at: [0, 20] });
  join(top, [
    ['X1', ['D1.Y', 'A1.IN']],
    ['X2', ['D2.Y', 'A2.IN']],
    ['Q1', ['A1.OUT']],
    ['Q2', ['A2.OUT']],
  ]);
  return { schemaVersion: SCHEMA_VERSION, circuits: [top.build(), chain, inverter] };
}

/** A document whose Main only places instances (to build the real Main with its registry). */
function shell(
  circuits: readonly Circuit[],
  instances: readonly (readonly [string, string, Point])[],
): CircuitDocument {
  const components = instances.map(
    ([id, circuit, [x, y]]): ComponentInstance => ({
      id,
      type: `sub/${circuit}`,
      x,
      y,
      rotation: 0,
      flip: false,
      props: {},
    }),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    circuits: [{ ...emptyCircuit(), components }, ...circuits],
  };
}

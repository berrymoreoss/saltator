/**
 * What the script editor completes (R15b), pure: the bench API after `b.`, the script's globals,
 * and inside a string the circuit's references — ports, named nets, buses, parts and pins — so
 * a bench names what is there. Spec: docs/editor.md#tests; the API: docs/circuit.md#test-benches.
 */
import { type Circuit, type CompileResult, circuitPorts } from '../circuit';
import type { ComponentRegistry } from '../core';
import { moduleSignalReferences } from './waveforms-view';

/** One completion: what is written, what kind of thing it is, a line about it. */
export interface ScriptCompletion {
  readonly label: string;
  readonly type: 'function' | 'property' | 'variable' | 'constant' | 'class' | 'text';
  readonly detail?: string;
  readonly info?: string;
}

/** The bench API (`b.…`), as docs/circuit.md's table has it. */
export const BENCH_API: readonly ScriptCompletion[] = [
  fn('set', '({ ref: value, … })', 'Inputs now: ports, switches, buttons, DIP switches'),
  fn('press', '(ref)', 'Presses a button'),
  fn('release', '(ref)', 'Releases a button'),
  fn('action', '(ref, payload)', 'Any part’s action, for parts the bench doesn’t operate'),
  fn('clock', '(ref, count = 1)', 'count steps of a pulse: LOW, rising at ¼, falling at ¾'),
  fn('wait', '(time)', 'Time passes, inputs held: us(10) or "10us"'),
  fn(
    'row',
    '(inputs, outputs, note?)',
    'One step: inputs at its start, outputs checked at its end',
  ),
  fn('table', '`…`', 'Rows of a text table: header "inputs | outputs", one step a row'),
  fn('expect', '({ ref: value, … }, note?)', 'Checks now: signals and memory cells (U5[1F])'),
  fn('get', '(ref)', 'A signal’s or cell’s value now'),
  fn('memory', '(ref, address, bytes)', 'Bytes into a memory: an array or hex text'),
  fn('loadIntelHex', '(ref, text)', 'An Intel HEX file’s text into a memory'),
  fn('setStep', '(time)', 'The step a row or a pulse takes (default 1 µs)'),
  fn('random', '()', 'A number in [0, 1), seeded by the bench’s name'),
  fn('log', '(…)', 'A line in the report'),
  fn('fail', '(message)', 'A failure that ends the bench'),
  { label: 'now', type: 'property', detail: 'ps', info: 'The simulated time' },
  { label: 'step', type: 'property', detail: 'ps', info: 'The step a row or a pulse takes' },
];

/** What a script sees at its top level. */
export const SCRIPT_GLOBALS: readonly ScriptCompletion[] = [
  {
    label: 'bench',
    type: 'function',
    detail: '(name, (b) => { … })',
    info: 'Registers a bench: run on a fresh simulation of this circuit',
  },
  ...['ps', 'ns', 'us', 'ms', 's'].map(
    (unit): ScriptCompletion => ({
      label: unit,
      type: 'function',
      detail: '(n)',
      info: `n ${unit === 'us' ? 'µs' : unit} in picoseconds`,
    }),
  ),
];

/**
 * The references a bench of `circuit` can name: its ports (the inputs it drives, the outputs it
 * checks), named nets and buses, signals inside its Verilog modules (HDL-4: `A1/state`, or its
 * own), parts and their pins, names first. `registry` is the design's (it knows the modules).
 */
export function scriptReferences(
  circuit: Circuit,
  compiled: CompileResult | undefined,
  registry: ComponentRegistry,
): ScriptCompletion[] {
  const seen = new Set<string>();
  const out: ScriptCompletion[] = [];
  const add = (completion: ScriptCompletion) => {
    if (seen.has(completion.label)) return;
    seen.add(completion.label);
    out.push(completion);
  };
  const busRange = new Map<string, string>();
  for (const bus of compiled?.buses ?? []) {
    // Its members are its first name's (`D` → D0…D7): `D[0..7]` names them all.
    const name = bus.names[0];
    if (name !== undefined && bus.members.length > 0) {
      busRange.set(name, `${name}[0..${bus.members.length - 1}]`);
    }
  }
  for (const port of circuitPorts(circuit, registry)) {
    const direction = { in: 'input', out: 'output', bidir: 'bidirectional' }[port.direction];
    const label = port.bus ? (busRange.get(port.name) ?? port.name) : port.name;
    add({ label, type: 'variable', detail: `${direction} port` });
  }
  for (const [name, range] of busRange)
    add({ label: range, type: 'variable', detail: `bus ${name}` });
  for (const net of compiled?.nets ?? []) {
    for (const name of net.names) add({ label: name, type: 'variable', detail: 'net' });
  }
  for (const { ref, detail } of moduleSignalReferences(circuit, registry)) {
    add({ label: ref, type: 'variable', detail });
  }
  const parts = [...circuit.components].sort((a, b) =>
    a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
  for (const part of parts) {
    const definition = registry.get(part.type);
    if (!definition || part.type.startsWith('net/')) continue;
    add({ label: part.id, type: 'class', detail: definition.name });
  }
  const pins: string[] = [];
  for (const net of compiled?.nets ?? []) {
    for (const pin of [...net.pins, ...net.instancePins]) pins.push(`${pin.component}.${pin.pin}`);
  }
  pins.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const pin of pins) add({ label: pin, type: 'constant', detail: 'pin' });
  return out;
}

function fn(label: string, detail: string, info: string): ScriptCompletion {
  return { label, type: 'function', detail, info };
}

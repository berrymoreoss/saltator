/**
 * `pnpm hdl:examples` (HDL-1): writes the Verilog examples — `examples/verilog-*.logic.json` —
 * from the sources in `examples/verilog/`, synthesized by the system `yosys` with the command
 * modules are made with and compiled to the IR, around a top circuit built here. Deterministic:
 * the same sources and Yosys give the same files. `pnpm check` reads what it wrote.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  documentRegistry,
  emptyVerilogCircuit,
  normalizeWires,
  SCHEMA_VERSION,
  scriptLines,
  serializeDocument,
} from '../src/circuit/index.ts';
import { type PropValue, resolveProps } from '../src/core/index.ts';
import { createDefaultRegistry, fromYosys } from '../src/library/index.ts';
import { hasYosys, runYosys } from './yosys.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = join(ROOT, 'examples/verilog');
const library = createDefaultRegistry();

/** A module's circuit: its source synthesized and compiled, with its own benches. */
function moduleCircuit(id: string, name: string, file: string, script: string): Circuit {
  const run = runYosys(join(SOURCES, file));
  if (run.json === undefined) throw new Error(`${file}: yosys failed\n${run.log}`);
  const { module, messages } = fromYosys(run.json);
  if (!module) throw new Error(`${file}: ${messages.map((m) => m.message).join('; ')}`);
  return { ...emptyVerilogCircuit(id, name), verilog: { module }, testScript: scriptLines(script) };
}

/** The top circuit around the modules, every part's props written resolved (as the editor). */
function document(top: (b: Builder) => void, script: string, modules: Circuit[]): CircuitDocument {
  const draft: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [...modules] };
  const registry = documentRegistry(draft, library);
  const builder = new Builder(registry);
  top(builder);
  const main = normalizeWires({ ...builder.build(), testScript: scriptLines(script) });
  const components = main.components.map((c) => ({
    ...c,
    props: resolveProps(registry.get(c.type)!, c.props),
  }));
  return { schemaVersion: SCHEMA_VERSION, circuits: [{ ...main, components }, ...modules] };
}

/** The circuit builder with the few shapes these examples repeat. */
class Builder extends CircuitBuilder {
  /** A net label named `name` at the end of a wire `length` cells left (−) or right of `pin`. */
  label(id: string, name: string, pin: string, length: number): this {
    const [x, y] = this.pin(pin);
    const at: [number, number] = [x + length, y];
    this.add(id, 'net/label', { at, rotation: length < 0 ? 180 : 0, props: { name } });
    return this.wire(pin, at);
  }

  /** A net label `name` at the end of a wire `length` cells down from `pin` (a pin at the bottom). */
  labelDown(id: string, name: string, pin: string, length: number): this {
    const [x, y] = this.pin(pin);
    const at: [number, number] = [x, y + length];
    this.add(id, 'net/label', { at, rotation: 90, props: { name } });
    return this.wire(pin, at);
  }

  /** A bus label `name` at the end of a bus line `length` cells left (−) or right of bus pin `pin`. */
  busLabel(id: string, name: string, pin: string, length: number): this {
    const [x, y] = this.pin(pin);
    const at: [number, number] = [x + length, y];
    this.add(id, 'net/label', { at, rotation: length < 0 ? 180 : 0, props: { name } });
    return this.bus(pin, at);
  }

  switch(id: string, label: string, at: [number, number], on = false): this {
    const props: Record<string, PropValue> = { on };
    return this.add(id, 'io/switch', { at, label, props });
  }
}

// ── Verilog Address Decoder ──────────────────────────────────────────────────────────────

const DECODER_BENCHES = `// The decoder alone, through its ports: every region of the memory map at its edges.
bench('decodes the memory map', (b) => {
  b.table\`
    addr[15..12] phi2 | ram_cs_n via_cs_n rom_cs_n
    0x0          1    | 0        1        1         # RAM $0000
    0x3          1    | 0        1        1         # RAM up to $3FFF
    0x3          0    | 1        1        1         # RAM only while PHI2 is HIGH
    0x4          1    | 1        1        1         # $4000-$5FFF: nothing
    0x5          1    | 1        1        1
    0x6          1    | 1        0        1         # VIA $6000
    0x7          0    | 1        0        1         # VIA up to $7FFF, whatever PHI2
    0x8          1    | 1        1        0         # ROM $8000
    0xF          0    | 1        1        0         # ROM up to $FFFF
  \`;
});

bench('selects 15 ns after the address changes', (b) => {
  b.set({ 'addr[15..12]': 0x0, phi2: 1 });
  b.wait(us(1));
  b.set({ 'addr[15..12]': 0x8 });
  b.wait(ns(14));
  b.expect({ rom_cs_n: 1, ram_cs_n: 0 }, 'not yet');
  b.wait(ns(1));
  b.expect({ rom_cs_n: 0, ram_cs_n: 1 }, 'after its delay');
});
`;

const DECODER_MAIN_BENCHES = `// The board: A15-A12 and PHI2 switches, an LED on each chip select (lit when selected).
const address = (b, high) =>
  b.set({ SW1: (high >> 3) & 1, SW2: (high >> 2) & 1, SW3: (high >> 1) & 1, SW4: high & 1 });

bench('lights the chip each address selects', (b) => {
  b.set({ SW5: 1 });
  for (const [high, ram, via, rom] of [
    [0x0, 0, 1, 1],
    [0x3, 0, 1, 1],
    [0x4, 1, 1, 1],
    [0x6, 1, 0, 1],
    [0x7, 1, 0, 1],
    [0x8, 1, 1, 0],
    [0xf, 1, 1, 0],
  ]) {
    address(b, high);
    b.wait(us(1));
    b.expect({ RAM_CS: ram, VIA_CS: via, ROM_CS: rom }, \`A15-A12 = \${high.toString(16)}\`);
  }
});

bench('keeps RAM deselected while PHI2 is LOW', (b) => {
  address(b, 0x0);
  b.set({ SW5: 0 });
  b.wait(us(1));
  b.expect({ RAM_CS: 1, VIA_CS: 1, ROM_CS: 1 });
});
`;

function addressDecoder(): CircuitDocument {
  const decoder = moduleCircuit(
    'address-decoder',
    'Address Decoder',
    'address_decoder.v',
    DECODER_BENCHES,
  );
  return document(
    (b) => {
      const switches = ['A15', 'A14', 'A13', 'A12', 'PHI2'];
      switches.forEach((name, i) => {
        b.switch(`SW${i + 1}`, name, [0, i * 4]);
        b.label(`NL${i + 1}`, name, `SW${i + 1}.Y`, 4);
      });
      b.add('A1', 'sub/address-decoder', { at: [28, 2] });
      b.busLabel('NL6', 'A[15..12]', 'A1.addr[15..12]', -5);
      b.label('NL7', 'PHI2', 'A1.phi2', -5);
      // Active LOW selects: each LED from VCC into the select, lit while it is LOW.
      const outputs = [
        ['ram_cs_n', 'RAM_CS', 'RAM'],
        ['via_cs_n', 'VIA_CS', 'VIA'],
        ['rom_cs_n', 'ROM_CS', 'ROM'],
      ] as const;
      outputs.forEach(([pin, net, chip], i) => {
        b.label(`NL${8 + i}`, net, `A1.${pin}`, 5);
        const y = 2 + i * 5;
        b.add(`D${i + 1}`, 'io/led', {
          at: [62, y],
          rotation: 180,
          label: chip,
          props: { color: 'green' },
        });
        b.label(`NL${11 + i}`, net, `D${i + 1}.K`, -4);
        b.add(`V${i + 1}`, 'io/vcc', { at: [b.pin(`D${i + 1}.A`)[0] + 2, y - 2] });
        b.connect(`D${i + 1}.A`, `V${i + 1}.Y`);
      });
    },
    DECODER_MAIN_BENCHES,
    [decoder],
  );
}

// ── Verilog Counter and Traffic Light ────────────────────────────────────────────────────

const COUNTER_BENCHES = `// The counter alone: reset, ten clocks with the carry at 9, and holding while disabled.
bench('counts 0-9 and carries', (b) => {
  b.row({ rst: 1, en: 1, clk: 0 }, { 'q[3..0]': 0, co: 0 });
  b.set({ rst: 0 });
  for (let n = 1; n <= 12; n++) {
    b.row({ clk: 'C' }, { 'q[3..0]': n % 10, co: n % 10 === 9 ? 1 : 0 }, \`clock \${n}\`);
  }
});

bench('holds while disabled, without a carry', (b) => {
  b.row({ rst: 1, en: 1, clk: 0 }, { 'q[3..0]': 0 });
  b.set({ rst: 0 });
  b.clock('clk', 9);
  b.table\`
    en clk | q[3..0] co
    1  -   | 9       1
    0  -   | 9       0     # co only while enabled
    0  C   | 9       0     # disabled: holds
    1  C   | 0       0
  \`;
});

bench('starts unknown until reset', (b) => {
  b.row({ rst: 0, en: 1, clk: 0 }, { 'q[3..0]': 'unknown' });
});
`;

const TRAFFIC_BENCHES = `// The state machine alone: reset to red, then one step per clock while tick is HIGH.
bench('steps red, green, yellow, red on ticks', (b) => {
  b.row({ rst: 1, tick: 0, clk: 'C' }, { red: 1, yellow: 0, green: 0 });
  b.set({ rst: 0 });
  b.table\`
    tick clk | red yellow green
    1    C   | 0   0      1
    0    C   | 0   0      1      # no tick: stays
    1    C   | 0   1      0
    1    C   | 1   0      0
    1    C   | 0   0      1
  \`;
});

bench('is unknown until reset', (b) => {
  b.row({ rst: 0, tick: 1, clk: 'C' }, { red: 'X', green: 'X' });
});
`;

const COUNTER_MAIN_BENCHES = `// The board: a 4 Hz clock; RST resets both modules, the light steps on the counter's carry.
bench('counts, and steps the light every ten clocks', (b) => {
  b.set({ SW1: 1, SW2: 1 });
  b.wait(ms(300));
  b.expect({ 'Q[3..0]': 0, RED: 1, GREEN: 0 }, 'reset');
  b.set({ SW1: 0 });
  b.wait(ms(1000));
  b.expect({ 'Q[3..0]': 4, RED: 1 }, 'four clocks later');
  b.wait(ms(1500));
  b.expect({ 'Q[3..0]': 0, RED: 0, GREEN: 1 }, 'the carry stepped the light');
});
`;

function counterAndTrafficLight(): CircuitDocument {
  const counter = moduleCircuit(
    'decade-counter',
    'Decade Counter',
    'decade_counter.v',
    COUNTER_BENCHES,
  );
  const traffic = moduleCircuit(
    'traffic-light',
    'Traffic Light',
    'traffic_light.v',
    TRAFFIC_BENCHES,
  );
  return document(
    (b) => {
      b.add('X1', 'io/clock', { at: [0, 0], label: 'CLK', props: { frequency: 4 } });
      b.label('NL1', 'CLK', 'X1.Y', 4);
      b.switch('SW1', 'RST', [0, 5], true);
      b.label('NL2', 'RST', 'SW1.Y', 4);
      b.switch('SW2', 'EN', [0, 10], true);
      b.label('NL3', 'EN', 'SW2.Y', 4);

      b.add('A1', 'sub/decade-counter', { at: [28, 0] });
      b.label('NL4', 'CLK', 'A1.clk', -5);
      b.label('NL5', 'RST', 'A1.rst', -5);
      b.label('NL6', 'EN', 'A1.en', -5);
      b.busLabel('NL7', 'Q[3..0]', 'A1.q[3..0]', 5);
      b.label('NL8', 'CO', 'A1.co', 5);
      b.add('U1', 'io/hex-display', { at: [56, 0], label: 'COUNT' });
      for (let i = 0; i < 4; i++) b.labelDown(`NL${9 + i}`, `Q${i}`, `U1.D${i}`, 2);

      b.add('A2', 'sub/traffic-light', { at: [28, 14] });
      b.label('NL13', 'CLK', 'A2.clk', -5);
      b.label('NL14', 'RST', 'A2.rst', -5);
      b.label('NL15', 'CO', 'A2.tick', -5);
      const lights = [
        ['red', 'RED', 'red'],
        ['yellow', 'YELLOW', 'yellow'],
        ['green', 'GREEN', 'green'],
      ] as const;
      lights.forEach(([pin, net, color], i) => {
        b.label(`NL${16 + i}`, net, `A2.${pin}`, 5);
        const y = 19 + i * 4;
        b.add(`D${i + 1}`, 'io/led', { at: [56, y], label: net, props: { color } });
        b.label(`NL${19 + i}`, net, `D${i + 1}.A`, -4);
        b.add(`G${i + 1}`, 'io/gnd', { at: [b.pin(`D${i + 1}.K`)[0] + 3, y + 1] });
        b.connect(`D${i + 1}.K`, `G${i + 1}.Y`);
      });
    },
    COUNTER_MAIN_BENCHES,
    [counter, traffic],
  );
}

if (!hasYosys()) {
  console.error('yosys is not on the PATH (macOS: brew install yosys)');
  process.exit(2);
}
for (const [id, make] of [
  ['verilog-address-decoder', addressDecoder],
  ['verilog-counter-traffic-light', counterAndTrafficLight],
] as const) {
  writeFileSync(join(ROOT, 'examples', `${id}.logic.json`), serializeDocument(make()));
  console.log(`wrote examples/${id}.logic.json`);
}

/**
 * `pnpm hdl:examples` (HDL-1): writes the Verilog examples — `examples/verilog-*.saltator.json` —
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
import { hasYosys, runYosys, type YosysDesign } from './yosys.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = join(ROOT, 'examples/verilog');
const library = createDefaultRegistry();

/** A module's circuit: its sources synthesized and compiled, with its own benches. */
function moduleCircuit(
  id: string,
  name: string,
  file: string,
  script: string,
  design: YosysDesign = {},
): Circuit {
  const run = runYosys(join(SOURCES, file), design);
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

const TRAFFIC_BENCHES = `// The state machine alone: reset to red, then one step per clock while tick is HIGH. The
// state register is read inside the module (RED 0, GREEN 1, YELLOW 2), as the lights show it.
bench('steps red, green, yellow, red on ticks', (b) => {
  b.row({ rst: 1, tick: 0, clk: 'C' }, { red: 1, yellow: 0, green: 0, state: 0 });
  b.set({ rst: 0 });
  b.table\`
    tick clk | red yellow green state
    1    C   | 0   0      1     1
    0    C   | 0   0      1     1      # no tick: stays
    1    C   | 0   1      0     2
    1    C   | 1   0      0     0
    1    C   | 0   0      1     1
  \`;
});

bench('is unknown until reset', (b) => {
  b.row({ rst: 0, tick: 1, clk: 'C' }, { red: 'X', green: 'X', state: 'X' });
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

// ── Verilog UART ─────────────────────────────────────────────────────────────────────────

const UART_TX_BENCHES = `// The transmitter alone: the byte out of tx a bit every 8 clocks.
const frame = (byte) => [0, ...Array.from({ length: 8 }, (_, i) => (byte >> i) & 1), 1];

bench('sends a start bit, the byte least significant bit first, a stop bit', (b) => {
  b.row({ rst: 1, start: 0, 'data[7..0]': 0xa5, clk: 'C' }, { tx: 1, busy: 0 });
  b.set({ rst: 0 });
  b.row({ start: 1, clk: 'C' }, { tx: 0, busy: 1 }, 'the start bit');
  for (const [i, bit] of frame(0xa5).slice(1).entries()) {
    b.clock('clk', 8);
    b.expect({ tx: bit, busy: 1 }, i < 8 ? \`data bit \${i}\` : 'the stop bit');
  }
  b.clock('clk', 8);
  b.expect({ tx: 1, busy: 0 }, 'idle again');
});

bench('sends one byte for a start held down', (b) => {
  b.row({ rst: 1, start: 0, 'data[7..0]': 0xff, clk: 'C' }, { busy: 0 });
  b.set({ rst: 0 });
  b.row({ start: 1, clk: 'C' }, { busy: 1 });
  b.clock('clk', 80);
  b.expect({ busy: 0, tx: 1 }, 'done, start still held');
  b.clock('clk', 16);
  b.expect({ busy: 0 }, 'nothing more until start rises again');
});
`;

const UART_RX_BENCHES = `// The receiver alone: rx driven a bit every 8 clocks, as the transmitter sends them.
const send = (b, byte, stop = 1) => {
  for (const bit of [0, ...Array.from({ length: 8 }, (_, i) => (byte >> i) & 1), stop]) {
    b.set({ rx: bit });
    b.clock('clk', 8);
  }
};

bench('receives bytes and holds the last, valid', (b) => {
  b.row({ rst: 1, rx: 1, clk: 'C' }, { valid: 0, err: 0 });
  b.set({ rst: 0 });
  b.clock('clk', 4);
  send(b, 0x5a);
  b.expect({ 'data[7..0]': 0x5a, valid: 1, err: 0 });
  b.clock('clk', 16);
  b.expect({ 'data[7..0]': 0x5a, valid: 1 }, 'held while the line idles');
  send(b, 0xc3);
  b.expect({ 'data[7..0]': 0xc3, valid: 1, err: 0 });
});

bench('reports a stop bit at 0 as a framing error', (b) => {
  b.row({ rst: 1, rx: 1, clk: 'C' }, { err: 0 });
  b.set({ rst: 0 });
  b.clock('clk', 4);
  send(b, 0x81, 0);
  b.expect({ err: 1, valid: 0 });
});
`;

const UART_MAIN_BENCHES = `// The board: the DIP switch sets a byte, SEND sends it down LINE at 100 clocks a second, 8 a bit;
// the receiver's byte lights the LED bar, as the switches are set.
const sendByte = (b, byte) => {
  b.set({ SW2: byte });
  b.wait(ms(50));
  b.press('BTN1');
  b.wait(ms(50));
  b.expect({ BUSY: 1 }, 'sending');
  b.release('BTN1');
  b.wait(ms(1000));
};

bench('sends the byte on the switches; the receiver shows it', (b) => {
  b.wait(ms(50));
  b.expect({ LINE: 1, BUSY: 0, VALID: 0 }, 'idle from power-up');
  sendByte(b, 0x5a);
  b.expect({ 'R[7..0]': 0x5a, VALID: 1, ERR: 0, BUSY: 0, LINE: 1 });
  sendByte(b, 0xc3);
  b.expect({ 'R[7..0]': 0xc3, VALID: 1, ERR: 0 });
});

bench('inside the modules: the frame in the shift register, the bits left to send', (b) => {
  b.set({ SW2: 0x5a });
  b.wait(ms(50));
  b.expect({ 'A1/shift': 0x3ff, 'A1/left': 0 }, 'idle: the line held at 1');
  b.press('BTN1'); // the clock rises at 55 ms: the transmitter loads the frame
  b.wait(ms(15));
  b.expect({ 'A1/shift': 0x2b4, 'A1/left': 10 }, 'stop bit, 0x5A, start bit');
  b.release('BTN1');
  b.wait(ms(320)); // four bits out (80 ms each), the receiver in the middle of the byte
  b.expect({ 'A1/left': 6, 'A2/at': 5, 'A2/shift[7:5]': 0b010 });
  b.wait(ms(700));
  b.expect({ 'A1/left': 0, 'A2/shift': 0x5a, 'R[7..0]': 0x5a });
});

bench('RST stops a byte on its way', (b) => {
  b.set({ SW2: 0xff });
  b.press('BTN1');
  b.wait(ms(300));
  b.release('BTN1');
  b.set({ SW1: 1 });
  b.wait(ms(50));
  b.expect({ BUSY: 0, LINE: 1, VALID: 0 });
});
`;

function uart(): CircuitDocument {
  const tx = moduleCircuit('uart-tx', 'UART Transmitter', 'uart_tx.v', UART_TX_BENCHES);
  const rx = moduleCircuit('uart-rx', 'UART Receiver', 'uart_rx.v', UART_RX_BENCHES);
  return document(
    (b) => {
      // HDL-4: the waveforms show the registers inside the modules next to the line.
      for (const probe of [
        { ref: 'SEND' },
        { ref: 'LINE' },
        { ref: 'A1/shift', radix: 'bin' as const },
        { ref: 'A1/left', radix: 'dec' as const },
        { ref: 'A2/at', radix: 'dec' as const },
        { ref: 'A2/shift' },
        { ref: 'VALID' },
      ]) {
        b.probe(probe);
      }
      b.add('X1', 'io/clock', { at: [0, 0], label: 'CLK', props: { frequency: 100 } });
      b.label('NL1', 'CLK', 'X1.Y', 4);
      b.switch('SW1', 'RST', [0, 5]);
      b.label('NL2', 'RST', 'SW1.Y', 4);
      b.add('BTN1', 'io/button', { at: [0, 10], label: 'SEND', props: { contact: 'spdt' } });
      b.label('NL3', 'SEND', 'BTN1.Y', 4);
      // Switch k sets bit k - 1, as the LED bar shows the received byte: LED k is bit k - 1.
      b.add('SW2', 'io/dip-switch', {
        at: [0, 15],
        label: 'BYTE',
        props: { count: 8, contact: 'spdt' },
      });
      for (let i = 0; i < 8; i++) b.label(`NL${4 + i}`, `D${i}`, `SW2.S${i + 1}`, 4);

      b.add('A1', 'sub/uart-tx', { at: [28, 0] });
      b.label('NL12', 'CLK', 'A1.clk', -5);
      b.label('NL13', 'RST', 'A1.rst', -5);
      b.label('NL14', 'SEND', 'A1.start', -5);
      b.busLabel('NL15', 'D[7..0]', 'A1.data[7..0]', -5);
      b.label('NL16', 'LINE', 'A1.tx', 5);
      b.label('NL17', 'BUSY', 'A1.busy', 5);

      b.add('A2', 'sub/uart-rx', { at: [28, 16] });
      b.label('NL18', 'CLK', 'A2.clk', -5);
      b.label('NL19', 'RST', 'A2.rst', -5);
      b.label('NL20', 'LINE', 'A2.rx', -5);
      b.busLabel('NL21', 'R[7..0]', 'A2.data[7..0]', 5);
      b.label('NL22', 'VALID', 'A2.valid', 5);
      b.label('NL23', 'ERR', 'A2.err', 5);

      const lights = [
        ['LINE', 'yellow', 0],
        ['BUSY', 'yellow', 4],
        ['VALID', 'green', 16],
        ['ERR', 'red', 20],
      ] as const;
      lights.forEach(([net, color, y], i) => {
        b.add(`D${i + 1}`, 'io/led', { at: [58, y], label: net, props: { color } });
        b.label(`NL${24 + i}`, net, `D${i + 1}.A`, -4);
        b.add(`G${i + 1}`, 'io/gnd', { at: [b.pin(`D${i + 1}.K`)[0] + 3, y + 1] });
        b.connect(`D${i + 1}.K`, `G${i + 1}.Y`);
      });
      b.add('D5', 'io/led-bar', { at: [60, 26], label: 'RX', props: { count: 8, color: 'green' } });
      for (let i = 0; i < 8; i++) b.label(`NL${28 + i}`, `R${i}`, `D5.A${i + 1}`, -4);
      // The cathodes on one wire to ground.
      b.wire('D5.K1', 'D5.K8');
      b.add('G5', 'io/gnd', { at: [b.pin('D5.K8')[0] + 3, b.pin('D5.K8')[1] + 1] });
      b.connect('D5.K8', 'G5.Y');
    },
    UART_MAIN_BENCHES,
    [tx, rx],
  );
}

// ── Verilog PicoRV32 ─────────────────────────────────────────────────────────────────────

const PICORV32_BENCHES = `// The module alone: the input port is n, the output port shows the n-th Fibonacci number (as
// a byte), as the program in the RAM computes it (picorv32/firmware/main.c). The core runs
// from power-up; a pulse of clk is one of its cycles. An instruction takes 3 to 6, a step of
// the loop about 25: a new n shows after the step in progress and n steps.
const fibonacci = (n) => {
  let [a, b] = [0, 1];
  while (n-- > 0) [a, b] = [b, (a + b) & 255];
  return a;
};

bench('runs the program from power-up: F(n) of the input on the output', (b) => {
  b.set({ resetn: 1, 'in[7..0]': 10 });
  b.clock('clk', 400);
  b.expect({ 'out[7..0]': 55, trap: 0 }, 'F(10)');
  for (const [n, cycles] of [
    [13, 700],
    [0, 400],
  ]) {
    b.set({ 'in[7..0]': n });
    b.clock('clk', cycles);
    b.expect({ 'out[7..0]': fibonacci(n) }, \`F(\${n})\`);
  }
});

bench('holds the core while resetn is LOW, the output at 0', (b) => {
  b.set({ resetn: 1, 'in[7..0]': 10 });
  b.clock('clk', 400);
  b.expect({ 'out[7..0]': 55 });
  b.set({ resetn: 0 });
  b.clock('clk', 2);
  b.expect({ 'out[7..0]': 0, 'cpu.reg_pc': 0 }, 'in reset: the program counter back at 0');
  b.set({ resetn: 1 });
  b.clock('clk', 400);
  b.expect({ 'out[7..0]': 55 }, 'running again');
});

bench('inside: the program in the RAM, the stack pointer in the register file', (b) => {
  b.expect({ 'ram[0]': 0x00001137 }, 'the first instruction, lui sp, 0x1');
  b.set({ resetn: 1, 'in[7..0]': 3 });
  b.clock('clk', 100);
  b.expect({ 'cpu.cpuregs[2]': 0x1000 }, 'x2 (sp): the top of the RAM, as start.S set it');
});

bench('runs a program the bench loads instead; EBREAK stops the core', (b) => {
  // Four instructions over firmware.hex from address 0, one 32-bit word each.
  b.memory('ram', 0, [
    0x10000537, // lui    a0, 0x10000    a0 = 0x1000_0000, the output port
    0x05a00593, // li     a1, 0x5a
    0x00b52023, // sw     a1, 0(a0)      the output port = 0x5A
    0x00100073, // ebreak                the core stops: trap
  ]);
  b.set({ resetn: 1, 'in[7..0]': 0 });
  b.clock('clk', 40);
  b.expect({ 'out[7..0]': 0x5a, trap: 1 });
});
`;

const PICORV32_MAIN_BENCHES = `// The board: n on the DIP switch (switch 1 is bit 0), the n-th Fibonacci number on the LED bar
// and the hex digits. The clock runs at 10 kHz: 100 ms are 1 000 cycles of the core, a step of
// its loop about 25.
bench('shows the n-th Fibonacci number of the switches', (b) => {
  b.set({ SW2: 10 });
  b.wait(ms(50));
  b.expect({ 'OUT[7..0]': 55, TRAP: 0 }, 'F(10) = 55: 0x37 on the hex digits');
  b.set({ SW2: 13 });
  b.wait(ms(100));
  b.expect({ 'OUT[7..0]': 233 }, 'F(13) = 233: 0xE9');
});

bench('RESET holds the core; released, the program starts again', (b) => {
  b.set({ SW2: 7 });
  b.wait(ms(50));
  b.expect({ 'OUT[7..0]': 13 });
  b.press('SW1');
  b.wait(ms(1));
  b.expect({ 'OUT[7..0]': 0, 'A1/cpu.reg_pc': 0 }, 'in reset');
  b.release('SW1');
  b.wait(ms(50));
  b.expect({ 'OUT[7..0]': 13 }, 'running again');
});
`;

function picorv32(): CircuitDocument {
  const soc = moduleCircuit('soc', 'PicoRV32 SoC', 'picorv32/soc.v', PICORV32_BENCHES, {
    with: ['picorv32.v'],
    top: 'soc',
  });
  return document(
    (b) => {
      // HDL-4: the waveforms show the core's program counter and its bus next to the ports.
      for (const probe of [
        { ref: 'RESETN' },
        { ref: 'A1/cpu.reg_pc' },
        { ref: 'A1/mem_addr' },
        { ref: 'N[7..0]' },
        { ref: 'OUT[7..0]' },
        { ref: 'TRAP' },
      ]) {
        b.probe(probe);
      }
      b.add('X1', 'io/clock', { at: [0, 0], label: 'CLK', props: { frequency: 10_000 } });
      b.label('NL1', 'CLK', 'X1.Y', 4);
      // RESET: a button to ground with a pull-up, as on a breadboard (the core resets itself
      // at power-up).
      b.add('SW1', 'io/button', { at: [0, 5], label: 'RESET', props: { contact: 'spst-gnd' } });
      b.label('NL2', 'RESETN', 'SW1.Y', 4);
      b.add('R1', 'prim/pull', { at: [0, 9], props: { direction: 'up' } });
      b.label('NL3', 'RESETN', 'R1.Y', 4);
      // Switch k sets bit k - 1 of n, as the LED bar shows the result: LED k is bit k - 1.
      b.add('SW2', 'io/dip-switch', {
        at: [0, 14],
        label: 'N',
        props: { count: 8, contact: 'spdt' },
      });
      for (let i = 0; i < 8; i++) b.label(`NL${4 + i}`, `N${i}`, `SW2.S${i + 1}`, 4);

      b.add('A1', 'sub/soc', { at: [28, 0] });
      b.label('NL12', 'CLK', 'A1.clk', -5);
      b.label('NL13', 'RESETN', 'A1.resetn', -5);
      b.busLabel('NL14', 'N[7..0]', 'A1.in[7..0]', -5);
      b.busLabel('NL15', 'OUT[7..0]', 'A1.out[7..0]', 5);
      b.label('NL16', 'TRAP', 'A1.trap', 5);

      // The result in hex (U1 the high digit) and in binary.
      b.add('U1', 'io/hex-display', { at: [58, 0], label: 'OUT' });
      b.add('U2', 'io/hex-display', { at: [64, 0] });
      for (let i = 0; i < 4; i++) {
        b.labelDown(`NL${17 + i}`, `OUT${4 + i}`, `U1.D${i}`, 2);
        b.labelDown(`NL${21 + i}`, `OUT${i}`, `U2.D${i}`, 2);
      }
      b.add('D1', 'io/led-bar', {
        at: [60, 14],
        label: 'OUT',
        props: { count: 8, color: 'green' },
      });
      for (let i = 0; i < 8; i++) b.label(`NL${25 + i}`, `OUT${i}`, `D1.A${i + 1}`, -4);
      b.wire('D1.K1', 'D1.K8');
      b.add('G1', 'io/gnd', { at: [b.pin('D1.K8')[0] + 3, b.pin('D1.K8')[1] + 1] });
      b.connect('D1.K8', 'G1.Y');
      b.add('D2', 'io/led', { at: [60, 28], label: 'TRAP', props: { color: 'red' } });
      b.label('NL33', 'TRAP', 'D2.A', -4);
      b.add('G2', 'io/gnd', { at: [b.pin('D2.K')[0] + 3, 29] });
      b.connect('D2.K', 'G2.Y');
    },
    PICORV32_MAIN_BENCHES,
    [soc],
  );
}

if (!hasYosys()) {
  console.error('yosys is not on the PATH (macOS: brew install yosys)');
  process.exit(2);
}
for (const [id, make] of [
  ['verilog-address-decoder', addressDecoder],
  ['verilog-counter-traffic-light', counterAndTrafficLight],
  ['verilog-uart', uart],
  ['verilog-picorv32', picorv32],
] as const) {
  writeFileSync(join(ROOT, 'examples', `${id}.saltator.json`), serializeDocument(make()));
  console.log(`wrote examples/${id}.saltator.json`);
}

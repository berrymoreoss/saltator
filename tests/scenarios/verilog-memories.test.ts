/**
 * Memories in modules (HDL-6) across the layers: a document's Verilog modules with memories, run
 * by the library's interpreter, loaded and checked by test benches — in a module's own benches
 * and through an instance placed in a circuit — headless, as `pnpm test:circuits` and the app's
 * sandbox run them.
 */
import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  documentRegistry,
  emptyVerilogCircuit,
  functionScriptHost,
  runTestScript,
  SCHEMA_VERSION,
  scriptLines,
} from '../../src/circuit';
import { type HdlModule, writeIntelHex } from '../../src/core';
import { createDefaultRegistry, fromYosys } from '../../src/library';
import { YOSYS_FIXTURES } from '../../src/library/hdl/fixtures';

const library = createDefaultRegistry();
const host = functionScriptHost();

function moduleOf(name: string): HdlModule {
  const { module } = fromYosys(YOSYS_FIXTURES[name]);
  if (!module) throw new Error(`fixture ${name} doesn't convert`);
  return module;
}

const verilog = (id: string, module: HdlModule, script = ''): Circuit => ({
  ...emptyVerilogCircuit(id, id),
  verilog: { module },
  testScript: scriptLines(script),
});

/** Runs the benches of `circuit` in `document`: each bench's name, status and failures. */
function run(document: CircuitDocument, circuit: string) {
  const { error, results } = runTestScript(document, circuit, library, host);
  if (error) throw new Error(error.message);
  return results.map((r) => [
    r.name,
    r.status,
    [...r.failures.map((f) => f.message), ...(r.error ? [r.error.message] : [])],
  ]);
}

/** A module's own benches. */
const own = (fixture: string, script: string) =>
  run(
    { schemaVersion: SCHEMA_VERSION, circuits: [verilog(fixture, moduleOf(fixture), script)] },
    fixture,
  );

describe("a module's own benches load and check its memories", () => {
  it('a register file: loaded in the setup, read through its ports, its cells checked', () => {
    const script = `
bench('loads and reads', (b) => {
  b.memory('regs', 2, '42 43');
  b.memory('regs', 0, [0x10]);
  b.set({ clk: 0, we: 0, 'rs1[2..0]': 2, 'rs2[2..0]': 3, 'rd[2..0]': 0, 'wd[7..0]': 0 });
  b.wait('1us');
  b.expect({ 'r1[7..0]': 0x42, 'r2[7..0]': 0x43, 'regs[0]': 0x10, 'regs[2..3]': [0x42, 0x43] });
  b.expect({ 'regs[4]': 'X' });
  b.row({ we: 1, 'rd[2..0]': 4, 'wd[7..0]': 0x99, clk: 'C' }, { 'regs[4]': 0x99 });
  b.expect({ 'regs[2..3]': [0x42, 0x44] });
});

bench('says what is wrong', (b) => {
  b.memory('regs', 8, [1]);
});

bench('checks cells, not a whole memory', (b) => {
  b.expect({ regs: 1 });
});`;
    expect(own('mem_regfile', script)).toEqual([
      ['loads and reads', 'fail', ['regs[3] is 0x43, expected 0x44']],
      ['says what is wrong', 'error', ['regs: an address 0…0x7, got 8']],
      [
        'checks cells, not a whole memory',
        'error',
        ['regs is a memory: check its cells (regs[…])'],
      ],
    ]);
  });

  it("starts from the contents Yosys read, at the memory's own addresses", () => {
    const script = `
bench('power-up contents', (b) => {
  b.expect({ 'rom[0..1]': [0x48, 0x65], 'rom[A]': 'X' });
});

bench('addressed from 16', (b) => {
  b.expect({ 'm[10]': 16, 'm[19]': 25 });
  b.memory('m', 0x12, [0xAA]);
  b.expect({ 'm[12]': 0xAA });
  b.memory('m', 0, [1]);
});`;
    expect(own('mem_rom', script.split("bench('addressed")[0]!)).toEqual([
      ['power-up contents', 'pass', []],
    ]);
    expect(own('mem_offset', `bench('addressed${script.split("bench('addressed")[1]!}`)).toEqual([
      ['addressed from 16', 'error', ['m: an address 0x10…0x19, got 0']],
    ]);
  });

  it('a FIFO: pushed and popped through its ports, its buffer checked inside', () => {
    const script = `
bench('pushes three, pops one', (b) => {
  b.set({ clk: 0, rst: 1, push: 0, pop: 0, 'din[7..0]': 0 });
  b.row({ clk: 'C' }, { empty: 1, full: 0 });
  b.set({ rst: 0, push: 1 });
  for (const byte of [0x11, 0x22, 0x33]) b.row({ 'din[7..0]': byte, clk: 'C' }, { empty: 0 });
  b.expect({ 'buffer[0..2]': [0x11, 0x22, 0x33], 'buffer[3]': 'X', 'dout[7..0]': 0x11 });
  b.set({ push: 0, pop: 1 });
  b.row({ clk: 'C' }, { 'dout[7..0]': 0x22 });
});`;
    expect(own('mem_fifo', script)).toEqual([['pushes three, pops one', 'pass', []]]);
  });

  it('a 32-bit RAM takes words, and Intel HEX packed little-endian', () => {
    // addi x0, x0, 0 (0x00000013) and addi x1, x0, 1 (0x00100093), as a RISC-V toolchain writes them.
    const program = writeIntelHex(Uint8Array.from([0x13, 0, 0, 0, 0x93, 0, 0x10, 0]));
    const script = `
bench('loads a program', (b) => {
  b.loadIntelHex('ram', ${JSON.stringify(program)});
  b.memory('ram', 2, 'DEADBEEF 1');
  b.set({ clk: 0, we: 0, 'a[3..0]': 2, 'd[31..0]': 0 });
  b.wait('1us');
  b.expect({ 'ram[0..1]': [0x13, 0x100093], 'q[31..0]': 0xdeadbeef, 'ram[3]': 1 });
});`;
    expect(own('mem_word32', script)).toEqual([['loads a program', 'pass', []]]);
  });
});

describe("a circuit's benches reach the memories of the modules it places", () => {
  it('by the instance path', () => {
    const regfile = verilog('regfile', moduleOf('mem_regfile'));
    const draft: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [regfile] };
    const script = `
bench('through A1', (b) => {
  b.memory('A1/regs', 5, [0x5A]);
  b.expect({ 'A1/regs[5]': 0x5A, 'A1/regs[6]': 'X' });
});`;
    const main = new CircuitBuilder(documentRegistry(draft, library))
      .add('A1', 'sub/regfile', { at: [20, 0] })
      .tests(script)
      .build();
    expect(run({ schemaVersion: SCHEMA_VERSION, circuits: [main, regfile] }, 'main')).toEqual([
      ['through A1', 'pass', []],
    ]);
  });
});

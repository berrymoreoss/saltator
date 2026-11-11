/**
 * The Verilog PicoRV32 example (HDL-7) across the layers: the RAM of its module holds the program
 * `pnpm riscv:firmware` built (the example regenerated after it), and its benches catch a broken
 * program — one instruction changed in the image fails them with what the port showed.
 */
import { describe, expect, it } from 'vitest';
import firmware from '../../examples/verilog/picorv32/firmware.hex?raw';
import { exampleDocument } from '../../src/app/example-files';
import {
  type CircuitDocument,
  functionScriptHost,
  runBench,
  runTestScript,
} from '../../src/circuit';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();
const host = functionScriptHost();

/** The example's document with every `from` word of its RAM image replaced by `to`. */
function patched(from: number, to: number): CircuitDocument {
  const document = exampleDocument('verilog-picorv32');
  const hex = (word: number) => word.toString(16).toUpperCase().padStart(8, '0');
  return {
    ...document,
    circuits: document.circuits.map((c) => {
      const module = c.verilog?.module;
      if (module === undefined) return c;
      const memories = module.memories.map((m) =>
        m.name === 'ram' ? { ...m, init: m.init?.replaceAll(hex(from), hex(to)) } : m,
      );
      return { ...c, verilog: { ...c.verilog, module: { ...module, memories } } };
    }),
  };
}

describe('Verilog PicoRV32', () => {
  it('holds the program of firmware.hex in its RAM from address 0', () => {
    const words = firmware
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('//'))
      .join('')
      .toUpperCase();
    const soc = exampleDocument('verilog-picorv32').circuits.find((c) => c.id === 'soc');
    const ram = soc?.verilog?.module?.memories.find((m) => m.name === 'ram');
    expect(ram).toMatchObject({ width: 32, size: 1024, offset: 0 });
    expect(ram?.init).toBe(`0000:${words}`);
  });

  it('fails its benches when the program is broken: add becomes sub', () => {
    // 0x54: add a3, a4, a3 — the loop's sum (firmware.lst); sub a3, a4, a3 instead.
    const broken = patched(0x00d706b3, 0x40d706b3);
    expect(broken).not.toEqual(exampleDocument('verilog-picorv32'));
    const { results } = runTestScript(broken, 'soc', registry, host);
    expect(results[0]).toMatchObject({ status: 'fail' });
    expect(results[0]!.failures[0]).toMatchObject({ line: 14, ref: 'out[7..0]', expected: '0x37' });
    const board = runBench(
      broken,
      'main',
      'shows the n-th Fibonacci number of the switches',
      registry,
      host,
    );
    expect(board.status).toBe('fail');
  });
});

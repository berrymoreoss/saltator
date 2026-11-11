import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, levelChar, us } from '../../core';
import { Bench, type BenchValues } from '../../core/testing';
import { YOSYS_FIXTURES } from './fixtures';
import { fromYosys } from './from-yosys';
import { hdlPart } from './module-part';

function part(name: string): AnyComponentDefinition {
  const { module, messages } = fromYosys(YOSYS_FIXTURES[name]);
  if (!module) throw new Error(`${name}: ${messages.map((m) => m.message).join('; ')}`);
  const { definition } = hdlPart(`hdl/${name.replaceAll('_', '-')}`, name, module);
  if (!definition) throw new Error(`${name}: no definition`);
  return definition;
}

/** Pin values for a word: `word('a', 0, 3, 5)` → `{ a0: 1, a1: 0, a2: 1 }`; `'X'` for every bit. */
function word(name: string, lsb: number, width: number, value: number | 'X'): BenchValues {
  return Object.fromEntries(
    Array.from({ length: width }, (_, i) => [
      `${name}${lsb + i}`,
      value === 'X' ? 'X' : (((value >> i) & 1) as 0 | 1),
    ]),
  );
}

/** A word's pins as text, most significant first (`'1X01'`). */
function read(bench: Bench, name: string, width: number): string {
  return Array.from({ length: width }, (_, i) => levelChar(bench.get(`${name}${i}`)))
    .reverse()
    .join('');
}

/** One rising edge of `clk` (held low first), then time for the outputs. */
function tick(bench: Bench, clk = 'clk'): void {
  bench.set({ [clk]: 0 });
  bench.run(us(1));
  bench.set({ [clk]: 1 });
  bench.run(us(1));
}

/** mem_regfile: 8 × 8, written at rd on clk while we, read at rs1 and rs2 at once. */
function regfile(): Bench {
  const bench = new Bench(part('mem_regfile'));
  bench.set({ clk: 0, we: 0, ...word('rs1', 0, 3, 0), ...word('rs2', 0, 3, 0) });
  bench.set({ ...word('rd', 0, 3, 0), ...word('wd', 0, 8, 0) });
  bench.run(us(1));
  return bench;
}

function write(bench: Bench, at: number, value: number): void {
  bench.set({ we: 1, ...word('rd', 0, 3, at), ...word('wd', 0, 8, value) });
  tick(bench);
  bench.set({ we: 0 });
}

describe('memories in modules (HDL-6)', () => {
  it('a register file: written on the clock, read at once by two ports; unwritten words X', () => {
    const bench = regfile();
    expect(read(bench, 'r1', 8)).toBe('XXXXXXXX');
    write(bench, 3, 0xa5);
    write(bench, 5, 0x3c);
    bench.set({ ...word('rs1', 0, 3, 3), ...word('rs2', 0, 3, 5) });
    bench.run(us(1));
    expect(read(bench, 'r1', 8)).toBe('10100101');
    expect(read(bench, 'r2', 8)).toBe('00111100');
    // Disabled, the clock writes nothing.
    bench.set({ ...word('rd', 0, 3, 3), ...word('wd', 0, 8, 0xff) });
    tick(bench);
    expect(read(bench, 'r1', 8)).toBe('10100101');
    expect(bench.diagnostics).toEqual([]);
  });

  it('reads after its delay, a read address changing alone', () => {
    const bench = regfile();
    write(bench, 1, 0x01);
    write(bench, 2, 0x02);
    bench.set(word('rs1', 0, 3, 1));
    bench.run(us(1));
    bench.set(word('rs1', 0, 3, 2));
    bench.run(14_000);
    expect(read(bench, 'r1', 8)).toBe('00000001');
    bench.run(2_000);
    expect(read(bench, 'r1', 8)).toBe('00000010');
  });

  it('starts with the contents of $readmemh and initial blocks, X beyond them', () => {
    const rom = new Bench(part('mem_rom'));
    rom.set({ clk: 0, ...word('a', 0, 4, 1) });
    tick(rom);
    expect(read(rom, 'q', 8)).toBe('01100101'); // 'e' of "Hello, ROM"
    rom.set(word('a', 0, 4, 9));
    tick(rom);
    expect(read(rom, 'q', 8)).toBe('01001101'); // 'M'
    rom.set(word('a', 0, 4, 10));
    tick(rom);
    expect(read(rom, 'q', 8)).toBe('XXXXXXXX');
    // m[16:25]: addresses 16 to 25 hold their initial values, the rest of a[4:0] reads X.
    const offset = new Bench(part('mem_offset'));
    offset.set({ clk: 0, we: 0, ...word('a', 0, 5, 17), ...word('d', 0, 8, 0) });
    offset.run(us(1));
    expect(read(offset, 'q', 8)).toBe('00010001');
    offset.set(word('a', 0, 5, 15));
    offset.run(us(1));
    expect(read(offset, 'q', 8)).toBe('XXXXXXXX');
    offset.set({ we: 1, ...word('a', 0, 5, 26), ...word('d', 0, 8, 0x55) });
    tick(offset);
    offset.set({ we: 0, ...word('a', 0, 5, 25) });
    offset.run(us(1));
    expect(read(offset, 'q', 8)).toBe('00011001'); // a write outside the memory changes nothing
  });

  it('merges the words an unknown address could select, all X past 8 unknown bits', () => {
    const bench = regfile();
    write(bench, 0, 0x0f);
    write(bench, 1, 0x0e);
    bench.set({ rs10: 'X', rs11: 0, rs12: 0 });
    bench.run(us(1));
    expect(read(bench, 'r1', 8)).toBe('0000111X');
    // An unknown bit selecting an unwritten word: unknown wherever that word is.
    bench.set({ rs11: 'X' });
    bench.run(us(1));
    expect(read(bench, 'r1', 8)).toBe('XXXXXXXX');
    // A reset loop's integer address has 32 bits: 9 unknown ones are too many to merge.
    const loop = new Bench(part('mem_reset_loop'));
    loop.set({ clk: 0, rst: 1, we: 0, ...word('a', 0, 2, 0), ...word('d', 0, 8, 0) });
    tick(loop);
    expect(read(loop, 'q', 8)).toBe('00000000');
    loop.set({ a0: 'X', a1: 'X' });
    loop.run(us(1));
    expect(read(loop, 'q', 8)).toBe('00000000');
  });

  it('a write that may happen or may hit several words makes X the bits it would change', () => {
    const bench = regfile();
    for (let a = 0; a < 4; a++) write(bench, a, 0x0f);
    // An unknown enable: the word at rd is X where wd differs.
    bench.set({ we: 'X', ...word('rd', 0, 3, 0), ...word('wd', 0, 8, 0x0c) });
    tick(bench);
    bench.set({ we: 0 });
    bench.run(us(1));
    expect(read(bench, 'r1', 8)).toBe('000011XX');
    // An unknown write address: every word it could hit, the same way.
    bench.set({ we: 1, rd0: 'X', rd1: 1, rd2: 0, ...word('wd', 0, 8, 0x1f) });
    tick(bench);
    bench.set({ we: 0, ...word('rs1', 0, 3, 2), ...word('rs2', 0, 3, 3) });
    bench.run(us(1));
    expect(read(bench, 'r1', 8)).toBe('000X1111');
    expect(read(bench, 'r2', 8)).toBe('000X1111');
    // An uncertain clock edge (0 → X): the word it may have written.
    bench.set({ we: 1, ...word('rd', 0, 3, 3), ...word('wd', 0, 8, 0x10) });
    bench.set({ clk: 0 });
    bench.run(us(1));
    bench.set({ clk: 'X' });
    bench.run(us(1));
    expect(read(bench, 'r2', 8)).toBe('000XXXXX');
  });

  it('data changing at the clock edge writes X where it matters, reported', () => {
    const bench = regfile();
    write(bench, 0, 0x00);
    bench.set({ clk: 0, we: 1, ...word('rd', 0, 3, 0), ...word('wd', 0, 8, 0x03) });
    bench.run(us(1));
    bench.set({ clk: 1, ...word('wd', 0, 8, 0x05) });
    bench.run(us(1));
    expect(read(bench, 'r1', 8)).toBe('00000XX1');
    const setup = bench.diagnostics.find((d) => d.kind === 'setup-violation');
    expect(setup?.message).toMatch(
      /^wd\d changed at the clock edge of memory regs's write: it writes X/,
    );
  });

  it('two write ports at one edge: the later statement wins; without priority, X where they differ', () => {
    const run = (name: string) => {
      const bench = new Bench(part(name));
      bench.set({ clk: 0, w1: 1, w2: 1, ...word('ra', 0, 3, 2) });
      bench.set({ ...word('a1', 0, 3, 2), ...word('a2', 0, 3, 2) });
      bench.set({ ...word('d1', 0, 4, 0b0011), ...word('d2', 0, 4, 0b0101) });
      tick(bench);
      return read(bench, 'q', 4);
    };
    expect(run('mem_two_writes')).toBe('0101');
    expect(run('mem_collide')).toBe('0XX1');
  });

  it('writes a byte at a time where the enables say', () => {
    const bench = new Bench(part('mem_bytes'));
    bench.set({ clk: 0, ...word('we', 0, 2, 0b11), ...word('a', 0, 4, 7) });
    bench.set(word('d', 0, 16, 0x1234));
    tick(bench);
    bench.set({ ...word('we', 0, 2, 0b10), ...word('d', 0, 16, 0xabcd) });
    tick(bench);
    expect(read(bench, 'q', 16)).toBe((0xab34).toString(2).padStart(16, '0'));
  });

  it('writes on a clock made by logic, every other edge', () => {
    const bench = new Bench(part('mem_divided'));
    bench.set({ clk: 0, we: 1, ...word('a', 0, 2, 1), ...word('d', 0, 4, 9) });
    bench.run(us(1));
    tick(bench); // div 0 → 1: written
    expect(read(bench, 'q', 4)).toBe('1001');
    bench.set(word('d', 0, 4, 6));
    tick(bench); // div 1 → 0
    expect(read(bench, 'q', 4)).toBe('1001');
    tick(bench); // div 0 → 1
    expect(read(bench, 'q', 4)).toBe('0110');
    expect(bench.diagnostics).toEqual([]);
  });

  it('a FIFO: pushes, pops in order, empty and full', () => {
    const bench = new Bench(part('mem_fifo'));
    bench.set({ clk: 0, rst: 1, push: 0, pop: 0, ...word('din', 0, 8, 0) });
    tick(bench);
    bench.set({ rst: 0 });
    expect(bench.get('empty')).toBe(1);
    bench.set({ push: 1 });
    for (const byte of [0x11, 0x22, 0x33]) {
      bench.set(word('din', 0, 8, byte));
      tick(bench);
    }
    bench.set({ push: 0, pop: 1 });
    bench.run(us(1));
    expect(read(bench, 'dout', 8)).toBe('00010001');
    tick(bench);
    expect(read(bench, 'dout', 8)).toBe('00100010');
    bench.set({ pop: 0, push: 1 });
    for (let n = 0; n < 14; n++) tick(bench);
    expect([bench.get('full'), bench.get('empty')]).toEqual([1, 0]);
    expect(bench.diagnostics).toEqual([]);
  });

  it('runs on to the same values after a snapshot is restored', () => {
    const bench = regfile();
    write(bench, 0, 1);
    const snapshot = bench.sim.snapshot();
    const run = () => {
      const values: string[] = [];
      for (let n = 1; n < 5; n++) {
        write(bench, n, n * 3);
        bench.set(word('rs1', 0, 3, n));
        bench.run(us(1));
        values.push(read(bench, 'r1', 8));
      }
      return values;
    };
    const first = run();
    bench.sim.restore(snapshot);
    bench.set(word('rs1', 0, 3, 4));
    bench.run(us(1));
    expect(read(bench, 'r1', 8)).toBe('XXXXXXXX');
    expect(run()).toEqual(first);
  });

  it('reports a floating pin whose X a write stores', () => {
    const bench = new Bench(part('mem_regfile'));
    bench.set({ clk: 0, we: 1, ...word('rd', 0, 3, 0) });
    bench.set({ ...word('rs1', 0, 3, 0), ...word('rs2', 0, 3, 0) });
    bench.run(us(1));
    bench.set({ clk: 1 });
    bench.run(us(1));
    const floating = bench.diagnostics.filter((d) => d.kind === 'floating-input');
    expect(floating.map((d) => d.pin).sort()).toEqual(
      ['wd0', 'wd1', 'wd2', 'wd3', 'wd4', 'wd5', 'wd6', 'wd7'].sort(),
    );
  });
});

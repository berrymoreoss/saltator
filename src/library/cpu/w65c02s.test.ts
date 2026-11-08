import { describe, expect, it } from 'vitest';
import { type CpuView, Level, levelChar, ns, pinsOf, resolveProps, type Time } from '../../core';
import { Bench, type BenchValue, type BenchValues } from '../../core/testing';
import { createDefaultRegistry } from '../registry';
import { w65c02s } from './w65c02s';

const hex = (value: number, digits = 4) => value.toString(16).padStart(digits, '0');

const data = (value: number | 'Z' | 'X'): BenchValues =>
  Object.fromEntries(
    Array.from({ length: 8 }, (_, i): [string, BenchValue] => [
      `D${i}`,
      typeof value === 'string' ? value : (value >> i) & 1 ? Level.L1 : Level.L0,
    ]),
  );

/**
 * A W65C02S on a bench with a 64 KB memory the test plays: PHI2 at 1 MHz (500 ns phases); in
 * each cycle the address is read 100 ns after PHI2 falls, a read gets its byte then, a write's
 * byte is taken just before PHI2 falls.
 */
class Board {
  readonly bench = new Bench(w65c02s);
  readonly memory = new Uint8Array(0x10000);
  readonly trace: string[] = [];

  constructor(program: readonly number[] = [], at = 0x8000) {
    this.memory.set(program, at);
    this.memory[0xfffc] = at & 0xff;
    this.memory[0xfffd] = at >> 8;
    this.bench.set({ RDY: 1, IRQB: 1, NMIB: 1, BE: 1, SOB: 1, RESB: 1, PHI2: 1 });
    this.bench.run(ns(500));
  }

  get cpu(): CpuView {
    return w65c02s.cpu!.view(this.bench.sim.stateOf('DUT'));
  }

  /** The address pins as a number, or their text when a bit isn't 0 or 1. */
  address(): number | string {
    let value = 0;
    let text = '';
    for (let i = 15; i >= 0; i--) {
      const level = this.bench.get(`A${i}`);
      text += levelChar(level);
      if (level === Level.L1) value |= 1 << i;
    }
    return /^[01]+$/.test(text) ? value : text;
  }

  dataByte(): number | string {
    let value = 0;
    let text = '';
    for (let i = 7; i >= 0; i--) {
      const level = this.bench.get(`D${i}`);
      text += levelChar(level);
      if (level === Level.L1) value |= 1 << i;
    }
    return /^[01]+$/.test(text) ? value : text;
  }

  /** One clock cycle; `during` is applied 200 ns after PHI2 falls (off the edges). */
  cycle(during?: BenchValues): void {
    const { bench } = this;
    bench.set({ PHI2: 0 });
    bench.run(ns(100));
    const address = this.address();
    const rw = bench.get('RWB');
    const sync = levelChar(bench.get('SYNC'));
    const vpb = levelChar(bench.get('VPB'));
    // A read of unknown address bits gets unknown data, as a memory merging cells would give.
    if (rw === Level.L0) bench.set(data('Z'));
    else bench.set(data(typeof address === 'number' ? (this.memory[address] ?? 0) : 'X'));
    bench.run(ns(100));
    if (during) bench.set(during);
    bench.run(ns(300));
    bench.set({ PHI2: 1 });
    bench.run(ns(499));
    const where = typeof address === 'number' ? hex(address) : address;
    if (rw === Level.L0) {
      const byte = this.dataByte();
      if (typeof address === 'number' && typeof byte === 'number') this.memory[address] = byte;
      this.trace.push(`${where} w ${typeof byte === 'number' ? hex(byte, 2) : byte}`);
    } else {
      this.trace.push(
        `${where} ${rw === Level.L1 ? 'r' : levelChar(rw)}${sync === '1' ? ' sync' : ''}${vpb === '0' ? ' vpb' : ''}`,
      );
    }
    bench.run(ns(1));
  }

  cycles(n: number, during?: BenchValues): this {
    for (let i = 0; i < n; i++) this.cycle(i === 0 ? during : undefined);
    return this;
  }

  /** RESB LOW for `held` cycles, released mid-cycle, then the reset sequence. */
  reset(held = 2): this {
    this.cycle({ RESB: 0 });
    this.cycles(held - 1);
    this.cycle({ RESB: 1 });
    this.cycles(7);
    return this;
  }

  kinds(): string[] {
    return this.bench.diagnostics.map((d) => d.kind);
  }
}

/** The changes of `pin` after `stimulus`, as `[ns, level]`, over `span`. */
function changes(bench: Bench, stimulus: BenchValues, pin: string, span: Time = ns(200)) {
  const net = bench.sim.netIndex(pin);
  const start = bench.now;
  const seen: [number, string][] = [];
  const off = bench.sim.onNetChange((t, n, level) => {
    if (n === net) seen.push([(t - start) / 1000, levelChar(level)]);
  });
  try {
    bench.set(stimulus);
    bench.run(span);
  } finally {
    off();
  }
  return seen;
}

describe('W65C02S part', () => {
  it('has the pinout of Figure 3-1 and is in the default registry', () => {
    const pins = pinsOf(w65c02s, resolveProps(w65c02s));
    const byNumber = Object.fromEntries(pins.map((p) => [p.number, p.name]));
    expect(byNumber).toMatchObject({
      1: 'VPB',
      2: 'RDY',
      3: 'PHI1O',
      4: 'IRQB',
      5: 'MLB',
      6: 'NMIB',
      7: 'SYNC',
      8: 'VDD',
      9: 'A0',
      20: 'A11',
      21: 'VSS',
      22: 'A12',
      25: 'A15',
      26: 'D7',
      33: 'D0',
      34: 'RWB',
      35: 'NC',
      36: 'BE',
      37: 'PHI2',
      38: 'SOB',
      39: 'PHI2O',
      40: 'RESB',
    });
    expect(pins).toHaveLength(40);
    expect(createDefaultRegistry().get('cpu/w65c02s')).toBe(w65c02s);
  });

  it('shows unknown outputs from power-on until a reset (§3.11)', () => {
    const board = new Board([0xea]);
    board.cycles(3);
    expect(board.trace).toEqual(['XXXXXXXXXXXXXXXX X', 'XXXXXXXXXXXXXXXX X', 'XXXXXXXXXXXXXXXX X']);
    expect(board.cpu.mode).toBe('unknown');
    expect(board.kinds()).toEqual([]);
  });

  it('resets in seven cycles through the vector, then runs a program', () => {
    // LDX #$FF, TXS, LDA #$42, STA $0200, JSR $8010, BRA *;  $8010: INC $0200, RTS
    const board = new Board([
      0xa2, 0xff, 0x9a, 0xa9, 0x42, 0x8d, 0x00, 0x02, 0x20, 0x10, 0x80, 0x80, 0xfe,
    ]);
    board.memory.set([0xee, 0x00, 0x02, 0x60], 0x8010);
    board.reset();
    expect(board.trace.slice(-7)).toEqual([
      'XXXXXXXXXXXXXXXX r',
      'XXXXXXXXXXXXXXXX r',
      '00000001XXXXXXXX r',
      '00000001XXXXXXXX r',
      '00000001XXXXXXXX r',
      'fffc r vpb',
      'fffd r vpb',
    ]);
    board.cycles(40);
    expect(board.trace[10]).toBe('8000 r sync');
    expect(board.memory[0x0200]).toBe(0x43);
    expect(board.cpu.values.slice(0, 4)).toEqual([0x42, 0xff, 0, 0xff]);
    expect(board.kinds()).toEqual([]);
  });

  describe('bus timing (Figure 6-3)', () => {
    const running = () => {
      const board = new Board([0xa9, 0x55, 0x8d, 0x01, 0x02, 0xea]); // LDA #$55, STA $0201, NOP
      board.reset();
      return board;
    };

    it('holds a changing address line tAH, X until tADS; a steady line does not move', () => {
      const board = running(); // the next cycle reads $8001 after $8000
      board.cycle(); // fetch 8000 → next 8001
      const bench = board.bench;
      const steady: string[] = [];
      const a15 = bench.sim.netIndex('A15');
      const off = bench.sim.onNetChange((_, net) => {
        if (net === a15) steady.push('A15 moved');
      });
      expect(changes(bench, { PHI2: 0 }, 'A0')).toEqual([
        [10, 'X'],
        [30, '1'],
      ]);
      off();
      expect(steady).toEqual([]);
    });

    it('drives write data X from PHI2 rising, valid tMDS later, held tDHW after it falls', () => {
      const board = running();
      board.cycles(5); // LDA #, then STA $0201: opcode and two operand cycles
      const bench = board.bench;
      bench.set({ PHI2: 0 });
      bench.run(ns(200)); // the write cycle's address is out; the test's data released
      bench.set(data('Z'));
      bench.run(ns(300));
      expect(board.address()).toBe(0x0201);
      expect(levelChar(bench.get('RWB'))).toBe('0');
      expect(changes(bench, { PHI2: 1 }, 'D1', ns(499))).toEqual([
        [0, 'X'],
        [25, '0'],
      ]);
      expect(changes(bench, { PHI2: 0 }, 'D1', ns(100))).toEqual([[10, 'Z']]);
    });

    it('follows PHI2 on PHI2O and PHI1O 10 ns later (an estimate)', () => {
      const board = new Board();
      expect(changes(board.bench, { PHI2: 0 }, 'PHI2O')).toEqual([[10, '0']]);
      expect(changes(board.bench, { PHI2: 1 }, 'PHI1O')).toEqual([[10, '0']]);
    });

    it('releases the address bus and RWB tBVD after BE falls, drives again after it rises', () => {
      const board = running();
      expect(changes(board.bench, { BE: 0 }, 'A15', ns(100))).toEqual([[25, 'Z']]);
      expect(levelChar(board.bench.get('RWB'))).toBe('Z');
      expect(levelChar(board.bench.get('SYNC'))).not.toBe('Z');
      expect(changes(board.bench, { BE: 1 }, 'A15', ns(100))).toEqual([
        [0, 'X'],
        [25, '1'],
      ]);
    });
  });

  describe('requirements (Table 6-3)', () => {
    /** LDA # with its operand changed `offset` ns from PHI2 falling (negative: before). */
    const lateOperand = (offset: number) => {
      const board = new Board([0xa9, 0x0f, 0xea]);
      board.reset();
      board.cycle(); // fetch LDA
      const bench = board.bench;
      bench.set({ PHI2: 0 });
      bench.run(ns(500));
      bench.set({ PHI2: 1 });
      bench.run(ns(500 + Math.min(offset, 0)));
      // The operand cycle: the test changed bit 4 at `offset`.
      if (offset < 0) bench.set({ D4: 1 });
      bench.run(ns(-Math.min(offset, 0)));
      bench.set({ PHI2: 0 });
      if (offset > 0) {
        bench.run(ns(offset));
        bench.set({ D4: 1 });
      }
      bench.run(ns(100));
      return board;
    };

    it.each([
      [-10, 'silent', 0],
      [-9, 'setup-violation', 0x10],
      [10, 'silent', 0],
      [9, 'hold-violation', 0x10],
    ])('read data changing %i ns from PHI2 falling: %s', (offset, kind, unknownA) => {
      const board = lateOperand(offset);
      expect(board.kinds()).toEqual(kind === 'silent' ? [] : [kind]);
      expect(board.cpu.unknown[0]).toBe(unknownA);
    });

    it('checks PHI2 pulse widths and cycle time, and loses the CPU on a violation', () => {
      const board = new Board([0xea]);
      board.reset();
      const bench = board.bench;
      bench.set({ PHI2: 0 });
      bench.run(ns(34));
      bench.set({ PHI2: 1 });
      bench.run(ns(100));
      expect(board.kinds()).toEqual(['pulse-width-violation']);
      expect(board.cpu.mode).toBe('unknown');
      bench.run(ns(50));
      expect(levelChar(bench.get('A0'))).toBe('X');
    });

    it('loses the CPU when PHI2 goes unknown once it was known', () => {
      const board = new Board([0xea]);
      board.reset();
      board.bench.set({ PHI2: 'X' });
      board.bench.run(ns(100));
      expect(board.cpu.mode).toBe('unknown');
      expect(board.bench.diagnostics.map((d) => d.message)).toContain(
        "DUT: PHI2 went unknown, so did the CPU's state",
      );
    });

    it('wants RESB LOW for two cycles', () => {
      const board = new Board([0xea]);
      board.reset(1);
      expect(board.kinds()).toEqual(['pulse-width-violation']);
      expect(board.cpu.mode).toBe('unknown');
      board.reset(2);
      expect(board.cpu.mode).toBe('running');
    });

    it('reports RESB released less than tPCS before PHI2 falls', () => {
      const board = new Board([0xea]);
      board.cycles(3, { RESB: 0 });
      board.bench.set({ PHI2: 0 });
      board.bench.run(ns(500));
      board.bench.set({ PHI2: 1 });
      board.bench.run(ns(495));
      board.bench.set({ RESB: 1 });
      board.bench.run(ns(5));
      board.cycle();
      expect(board.kinds()).toEqual(['setup-violation', 'cpu-lost']);
    });
  });

  describe('control lines', () => {
    it('halts while RDY is LOW, address held, and goes on after it rises', () => {
      const board = new Board([0xe8, 0xe8, 0xe8, 0xe8]); // INX ×4
      board.reset();
      board.cycles(2); // INX
      board.cycles(3, { RDY: 0 });
      board.cycle({ RDY: 1 });
      board.cycles(4);
      expect(board.trace.slice(10)).toEqual([
        '8000 r sync',
        '8001 r',
        '8001 r sync',
        '8001 r sync',
        '8001 r sync',
        '8001 r sync',
        '8002 r',
        '8002 r sync',
        '8003 r',
        '8003 r sync',
      ]);
      expect(board.cpu.values[1]! & ~board.cpu.unknown[1]!).toBe(board.cpu.values[1]);
    });

    it('pulls RDY LOW in WAI: a short against a driven HIGH', () => {
      const board = new Board([0xcb, 0xea]); // WAI
      board.reset();
      board.cycles(4);
      expect(board.cpu.mode).toBe('waiting');
      expect(board.kinds()).toEqual(['contention']);
    });

    it('pulls RDY LOW in WAI: fine with nothing else driving it', () => {
      const board = new Board([0xcb, 0xea]);
      board.reset();
      board.cycles(3);
      const bench = board.bench;
      bench.set({ PHI2: 0 }); // the end of WAI's third cycle: RDY is sampled HIGH here
      bench.run(ns(15)); // past tPCH, before the CPU pulls RDY down
      bench.set({ RDY: 'Z' });
      bench.run(ns(100));
      expect([board.cpu.mode, levelChar(bench.get('RDY'))]).toEqual(['waiting', '0']);
      expect(board.kinds()).toEqual([]);
    });

    it('loses the CPU when RDY floats (no pull-up)', () => {
      const board = new Board([0xea, 0xea]);
      board.reset();
      board.cycles(2, { RDY: 'Z' });
      expect(board.cpu.mode).toBe('unknown');
      expect(board.kinds()).toContain('floating-input');
    });

    it('takes NMIB on its falling edge through $FFFA', () => {
      const board = new Board([0xea, 0xea, 0xea]);
      board.memory.set([0x00, 0x90], 0xfffa);
      board.reset();
      board.cycles(2, { NMIB: 0 });
      board.cycles(9);
      expect(board.trace).toContain('fffa r vpb');
      expect(board.cpu.values[4]).toBeGreaterThanOrEqual(0x9000);
    });

    it('sets V when SOB falls', () => {
      const board = new Board([0xea, 0xea]);
      board.reset();
      board.cycle({ SOB: 0 });
      board.cycle();
      expect(board.cpu.values[5]! & 0x40).toBe(0x40);
    });

    it('is lost on an unknown opcode, reports it, and comes back with RESB', () => {
      const board = new Board([0xea]);
      board.reset();
      board.cycle({ IRQB: 1 }); // NOP fetch
      board.cycle(); // NOP's second cycle; the next fetch reads a floating bus
      board.memory[0x8001] = 0xea;
      const bench = board.bench;
      bench.set({ PHI2: 0 });
      bench.run(ns(100));
      bench.set(data('Z'));
      bench.run(ns(400));
      bench.set({ PHI2: 1 });
      bench.run(ns(500));
      bench.set({ PHI2: 0 });
      bench.run(ns(100));
      expect(board.kinds()).toContain('cpu-lost');
      expect(board.bench.diagnostics.find((d) => d.kind === 'cpu-lost')?.message).toBe(
        'DUT fetched an opcode with unknown bits at 0x8001: its state is unknown until RESB',
      );
      expect(levelChar(bench.get('A0'))).toBe('X');
      bench.set({ PHI2: 1 });
      bench.run(ns(500));
      board.reset();
      expect(board.cpu.mode).toBe('running');
    });
  });
});

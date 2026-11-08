import { describe, expect, it } from 'vitest';
import {
  createCore,
  endCycle,
  Flag,
  holdReset,
  LostReason,
  loadRegisters,
  Mode,
  type Registers,
  setOverflow,
  startReset,
  type W65C02SCore,
} from './w65c02s-core';

/** One bus cycle as a test sees it. */
interface Cycle {
  readonly address: string;
  readonly rw: 'r' | 'w';
  readonly data: string;
  readonly sync: number;
  readonly vpb: number;
  readonly mlb: number;
}

const hex = (value: number, digits = 2) => value.toString(16).padStart(digits, '0');

/** A 64 KB RAM around a core; `unknown` marks bits a read returns as `X`. */
class Machine {
  readonly core: W65C02SCore = createCore();
  readonly ram = new Uint8Array(0x10000);
  readonly unknown = new Uint8Array(0x10000);
  readonly trace: Cycle[] = [];

  constructor(registers?: Partial<Registers>, program: readonly number[] = [], at = 0x0200) {
    this.ram.set(program, at);
    if (registers) {
      loadRegisters(this.core, { a: 0, x: 0, y: 0, s: 0xff, p: 0x24, pc: at, ...registers });
    }
  }

  /** Runs `n` cycles. */
  cycles(n: number): this {
    for (let i = 0; i < n; i++) this.cycle();
    return this;
  }

  cycle(): void {
    const c = this.core;
    const address = c.uaddr ? `${hex(c.addr, 4)}/${hex(c.uaddr, 4)}` : hex(c.addr, 4);
    if (c.write) {
      if (c.uaddr === 0) {
        this.ram[c.addr] = c.wdata;
        this.unknown[c.addr] = c.uwdata;
      }
      this.trace.push({ address, rw: 'w', data: hex(c.wdata), ...this.flags() });
      endCycle(c, 0, 0);
    } else {
      const data = this.ram[c.addr] ?? 0;
      const unknown = c.uaddr ? 0xff : (this.unknown[c.addr] ?? 0);
      this.trace.push({ address, rw: 'r', data: hex(data), ...this.flags() });
      endCycle(c, data, unknown);
    }
  }

  private flags() {
    return { sync: this.core.sync, vpb: this.core.vpb, mlb: this.core.mlb };
  }

  /** Runs until the next opcode fetch (at most 20 cycles); returns the cycles it took. */
  instruction(): number {
    let n = 0;
    do {
      this.cycle();
      n++;
    } while (this.core.sync !== 1 && this.core.mode === Mode.running && n < 20);
    return n;
  }

  /** The trace as `addr r/w data` strings, from cycle `from`. */
  bus(from = 0): string[] {
    return this.trace.slice(from).map((c) => `${c.address} ${c.rw} ${c.data}`);
  }
}

describe('W65C02S core', () => {
  describe('bus cycles', () => {
    it('marks opcode fetches with SYNC and nothing else', () => {
      const m = new Machine({}, [0xa9, 0x12, 0xea, 0xea]); // LDA #$12, NOP
      m.instruction();
      m.instruction();
      expect(m.trace.map((c) => c.sync)).toEqual([1, 0, 1, 0]);
      expect(m.core.a).toBe(0x12);
    });

    it('holds MLB LOW on the modify and write cycles of read-modify-write (§3.5)', () => {
      const m = new Machine({ x: 1 }, [0xe6, 0x10, 0x1e, 0x00, 0x30]); // INC $10, ASL $3000,X
      m.ram[0x10] = 0x7f;
      m.ram[0x3001] = 0x81;
      m.instruction();
      m.instruction();
      expect(m.trace.map((c) => `${c.address} ${c.rw} ${c.mlb}`)).toEqual([
        '0200 r 1',
        '0201 r 1',
        '0010 r 1',
        '0010 r 0',
        '0010 w 0',
        '0202 r 1',
        '0203 r 1',
        '0204 r 1',
        '3001 r 1',
        '3001 r 0',
        '3001 w 0',
      ]);
      expect([m.ram[0x10], m.ram[0x3001], m.core.p & Flag.C]).toEqual([0x80, 0x02, 1]);
    });

    it("reads JMP (a)'s pointer high byte without the carry, then with it (Table 7-1)", () => {
      const m = new Machine({}, [0x6c, 0xff, 0x12]); // JMP ($12FF)
      m.ram[0x12ff] = 0x34;
      m.ram[0x1200] = 0x99; // where the NMOS 6502 takes the high byte from
      m.ram[0x1300] = 0x56;
      expect(m.instruction()).toBe(6);
      expect(m.bus(3)).toEqual(['12ff r 34', '1200 r 99', '1300 r 56']);
      expect(m.core.pc).toBe(0x5634);
    });

    it('re-reads the last instruction byte when indexing crosses a page (Table 7-1)', () => {
      const m = new Machine({ x: 0x10 }, [0xbd, 0xf8, 0x30]); // LDA $30F8,X
      m.ram[0x3108] = 0x42;
      expect(m.instruction()).toBe(5);
      expect(m.bus()).toEqual(['0200 r bd', '0201 r f8', '0202 r 30', '0202 r 30', '3108 r 42']);
    });
  });

  describe('decimal mode', () => {
    it.each([
      // [A, operand, C in, A out, C out, N, Z] — Bruce Clark's sequence 1 at its boundaries
      [0x50, 0x50, 0, 0x00, 1, 0, 1],
      [0x49, 0x50, 0, 0x99, 0, 1, 0],
      [0x99, 0x01, 0, 0x00, 1, 0, 1],
      [0x09, 0x01, 0, 0x10, 0, 0, 0],
      [0x58, 0x46, 1, 0x05, 1, 0, 0],
    ])('ADC: %s + %s + C%s = %s, C %s, N %s, Z %s, one cycle more', (a, b, cin, r, cout, n, z) => {
      const m = new Machine({ a, p: 0x2c | cin }, [0x69, b]);
      expect(m.instruction()).toBe(3);
      expect([
        m.core.a,
        m.core.p & Flag.C,
        (m.core.p & Flag.N) >> 7,
        (m.core.p & Flag.Z) >> 1,
      ]).toEqual([r, cout, n, z]);
    });

    it.each([
      [0x46, 0x12, 1, 0x34, 1],
      [0x40, 0x13, 1, 0x27, 1],
      [0x32, 0x02, 0, 0x29, 1],
      [0x12, 0x21, 1, 0x91, 0],
      [0x00, 0x01, 1, 0x99, 0],
    ])('SBC: %s − %s with C%s = %s, C %s', (a, b, cin, r, cout) => {
      const m = new Machine({ a, p: 0x2c | cin }, [0xe9, b]);
      expect(m.instruction()).toBe(3);
      expect([m.core.a, m.core.p & Flag.C]).toEqual([r, cout]);
    });

    it('takes the extra cycle at the operand address for memory operands', () => {
      const m = new Machine({ a: 0x15, p: 0x28 }, [0x65, 0x40]); // ADC $40
      m.ram[0x40] = 0x27;
      expect(m.instruction()).toBe(4);
      expect(m.bus(2)).toEqual(['0040 r 27', '0040 r 27']);
      expect(m.core.a).toBe(0x42);
    });
  });

  describe('reset', () => {
    it('powers on unknown and does nothing until reset', () => {
      const m = new Machine();
      expect(m.core.mode).toBe(Mode.unknown);
      m.cycles(3);
      expect(m.core.mode).toBe(Mode.unknown);
    });

    it('runs the seven-cycle sequence: two PC reads, three stack reads, the vector (§3.11)', () => {
      const m = new Machine();
      m.ram[0xfffc] = 0x00;
      m.ram[0xfffd] = 0x80;
      m.ram[0x8000] = 0xea;
      holdReset(m.core);
      m.cycles(2);
      startReset(m.core);
      m.cycles(7);
      expect(m.trace.slice(2).map((c) => `${c.address} ${c.rw} vpb${c.vpb} sync${c.sync}`)).toEqual(
        [
          '0000/ffff r vpb1 sync0',
          '0000/ffff r vpb1 sync0',
          '0100/00ff r vpb1 sync0',
          '0100/00ff r vpb1 sync0',
          '0100/00ff r vpb1 sync0',
          'fffc r vpb0 sync0',
          'fffd r vpb0 sync0',
        ],
      );
      const c = m.core;
      expect([c.mode, c.pc, c.addr, c.sync]).toEqual([Mode.running, 0x8000, 0x8000, 1]);
      // D and I by hardware; every other register is the software's to set.
      expect([c.p & (Flag.D | Flag.I), c.up & (Flag.D | Flag.I)]).toEqual([Flag.I, 0]);
      expect([c.ua, c.ux, c.uy, c.us]).toEqual([0xff, 0xff, 0xff, 0xff]);
      expect(c.up & (Flag.N | Flag.V | Flag.Z | Flag.C)).toBe(Flag.N | Flag.V | Flag.Z | Flag.C);
    });

    it('decrements a known S by three and reads where an interrupt would push', () => {
      const m = new Machine({ s: 0xfd }, [0xea]);
      holdReset(m.core);
      m.cycles(1);
      startReset(m.core);
      m.cycles(7);
      expect(m.bus(1).slice(2, 5)).toEqual(['01fd r 00', '01fc r 00', '01fb r 00']);
      expect(m.core.s).toBe(0xfa);
    });
  });

  describe('interrupts', () => {
    const vectors = (m: Machine) => {
      m.ram.set([0x00, 0x90], 0xfffa); // NMI → $9000
      m.ram.set([0x00, 0xa0], 0xfffe); // IRQ/BRK → $A000
      m.ram[0x9000] = 0x40; // RTI
      m.ram[0xa000] = 0x40;
    };

    it('takes IRQ after the instruction: pushes PC and P with B clear, vector with VPB', () => {
      const m = new Machine({ p: 0x20 }, [0xea, 0xea]);
      vectors(m);
      m.core.irq = 1;
      m.instruction(); // NOP, then the poll
      const from = m.trace.length;
      expect(m.instruction()).toBe(7);
      expect(m.bus(from)).toEqual([
        '0201 r ea',
        '0201 r ea',
        '01ff w 02',
        '01fe w 01',
        '01fd w 20',
        'fffe r 00',
        'ffff r a0',
      ]);
      expect(m.trace.slice(from + 5).map((c) => c.vpb)).toEqual([0, 0]);
      expect([m.core.pc, m.core.p & Flag.I]).toEqual([0xa000, Flag.I]);
      m.core.irq = 0;
      m.instruction(); // RTI
      expect([m.core.pc, m.core.p & Flag.I]).toEqual([0x0201, 0]);
    });

    it('ignores IRQ while I is set; takes NMI on its edge whatever I', () => {
      const m = new Machine({ p: 0x24 }, [0xea, 0xea, 0xea]);
      vectors(m);
      m.core.irq = 1;
      m.instruction();
      m.instruction();
      expect(m.core.pc).toBe(0x0202);
      m.core.nmi = 1;
      m.instruction();
      m.instruction();
      expect([m.core.pc, m.core.nmi]).toEqual([0x9000, 0]);
    });

    it('takes an IRQ waiting during CLI only after the next instruction', () => {
      const m = new Machine({ p: 0x24 }, [0x58, 0xe8, 0xea]); // CLI, INX, NOP
      vectors(m);
      m.core.irq = 1;
      m.instruction(); // CLI: the poll still sees I set
      m.instruction(); // INX
      expect([m.core.x, m.core.pc]).toEqual([1, 0x0202]);
      m.instruction(); // the interrupt
      expect(m.core.pc).toBe(0xa000);
    });

    it('BRK skips its signature byte and pushes B set', () => {
      const m = new Machine({ p: 0x20 }, [0x00, 0xff, 0xea]);
      vectors(m);
      expect(m.instruction()).toBe(7);
      expect([m.ram[0x1ff], m.ram[0x1fe], m.ram[0x1fd]]).toEqual([0x02, 0x02, 0x30]);
      expect(m.core.pc).toBe(0xa000);
      expect(m.core.p & Flag.D).toBe(0);
    });

    it('WAI waits until IRQB; with I set the program goes on without the interrupt', () => {
      const m = new Machine({ p: 0x24 }, [0xcb, 0xe8]); // WAI, INX
      vectors(m);
      expect(m.instruction()).toBe(3);
      expect(m.core.mode).toBe(Mode.waiting);
      m.cycles(5);
      expect(m.core.mode).toBe(Mode.waiting);
      m.core.irq = 1;
      m.cycle();
      expect([m.core.mode, m.core.pc, m.core.sync]).toEqual([Mode.running, 0x0201, 1]);
    });

    it('WAI with I clear wakes into the IRQ sequence', () => {
      const m = new Machine({ p: 0x20 }, [0xcb]);
      vectors(m);
      m.instruction();
      m.core.irq = 1;
      m.cycle();
      m.instruction();
      expect(m.core.pc).toBe(0xa000);
    });

    it('STP stops until reset', () => {
      const m = new Machine({}, [0xdb]);
      m.instruction();
      expect(m.core.mode).toBe(Mode.stopped);
      m.core.irq = 1;
      m.core.nmi = 1;
      m.cycles(4);
      expect(m.core.mode).toBe(Mode.stopped);
    });

    it('SOB sets V', () => {
      const m = new Machine({ p: 0x20 });
      setOverflow(m.core);
      expect(m.core.p & Flag.V).toBe(Flag.V);
    });
  });

  describe('unknown bits', () => {
    it('keeps logic exact per bit: AND #$0F clears the unknown high nibble', () => {
      const m = new Machine({}, [0xa5, 0x10, 0x29, 0x0f]); // LDA $10, AND #$0F
      m.unknown[0x10] = 0xf0; // 0000 with XXXX above it
      m.instruction();
      expect([m.core.ua, m.core.up & (Flag.N | Flag.Z)]).toEqual([0xf0, Flag.N | Flag.Z]);
      m.instruction();
      expect([m.core.a, m.core.ua, m.core.up & (Flag.N | Flag.Z)]).toEqual([0x00, 0, 0]);
      expect(m.core.p & Flag.Z).toBe(Flag.Z);
    });

    it('knows Z is 0 when a known bit is 1', () => {
      const m = new Machine({}, [0xa5, 0x10]);
      m.ram[0x10] = 0x01;
      m.unknown[0x10] = 0xf0;
      m.instruction();
      expect([m.core.p & Flag.Z, m.core.up & Flag.Z]).toEqual([0, 0]);
    });

    it('makes a sum unknown from its lowest unknown bit up, and the carry', () => {
      const m = new Machine({ a: 0x01, p: 0x20 }, [0x65, 0x10]); // ADC $10
      m.unknown[0x10] = 0x08;
      m.instruction();
      expect([m.core.a, m.core.ua, m.core.up & (Flag.C | Flag.V)]).toEqual([
        0x01,
        0xf8,
        Flag.C | Flag.V,
      ]);
    });

    it('stores unknown bits as unknown and indexes into unknown address bits', () => {
      const m = new Machine({ x: 0 }, [0xa6, 0x10, 0x9d, 0x00, 0x30]); // LDX $10, STA $3000,X
      m.unknown[0x10] = 0x01;
      m.instruction();
      m.instruction();
      const write = m.trace[m.trace.length - 1];
      expect([write?.address, write?.rw]).toEqual(['3000/00ff', 'w']);
      expect(m.core.mode).toBe(Mode.running);
    });

    it.each<[string, number[], (m: Machine) => void, number]>([
      [
        'an opcode with unknown bits',
        [0xa5, 0x10],
        (m) => (m.unknown[0x0200] = 0x04),
        LostReason.opcode,
      ],
      [
        'a branch on an unknown flag',
        [0xa5, 0x10, 0xf0, 0x02],
        (m) => (m.unknown[0x10] = 0xff),
        LostReason.branch,
      ],
      [
        'a jump to unknown bits',
        [0x6c, 0x10, 0x00],
        (m) => (m.unknown[0x11] = 0x80),
        LostReason.pc,
      ],
      [
        'a page crossing nobody knows',
        [0xa6, 0x10, 0xbd, 0xf0, 0x30],
        (m) => (m.unknown[0x10] = 0x10),
        LostReason.page,
      ],
      [
        'ADC with D unknown',
        [0x28, 0x69, 0x01],
        (m) => (m.unknown[0x0100] = 0x08),
        LostReason.decimal,
      ],
    ])('is lost by %s', (_, program, setup, reason) => {
      const m = new Machine({ s: 0xff }, program);
      setup(m);
      for (let i = 0; i < 4 && m.core.mode === Mode.running; i++) m.instruction();
      expect([m.core.mode, m.core.lostReason]).toEqual([Mode.unknown, reason]);
    });

    it('is lost when an IRQ may be taken; a reset brings it back', () => {
      const m = new Machine({ p: 0x20 }, [0xea, 0xea]);
      m.core.irq = 2;
      m.instruction();
      expect([m.core.mode, m.core.lostReason]).toEqual([Mode.unknown, LostReason.interrupt]);
      m.ram.set([0x00, 0x02], 0xfffc);
      holdReset(m.core);
      m.cycle();
      startReset(m.core);
      m.core.irq = 0;
      m.cycles(7);
      expect([m.core.mode, m.core.pc, m.core.sync]).toEqual([Mode.running, 0x0200, 1]);
    });

    it('pushes to page 1 at unknown addresses when S is unknown', () => {
      const m = new Machine({}, [0x48]); // PHA
      m.core.us = 0xff;
      m.instruction();
      expect(m.trace[2]?.address).toBe('0100/00ff');
    });
  });
});

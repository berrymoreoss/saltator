/**
 * Memory chips in circuits: a 6116 written and read back over a bus through a 74HC245 (the bus
 * turning round around a write), an AT28C16 replacing a hex-to-7-segment decoder, and a register
 * latching a RAM's output before its access time. Limits from the data sheets (6116-25: tAA
 * 25 ns, tWHZ 16 ns, tOHZ 10 ns; AT28C16: tACC 150 ns); 74HC delays typical (245: ten 11 ns).
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import { compileCircuit, Resolver } from '../../src/circuit';
import {
  ERASED,
  formatImage,
  isTimingViolation,
  KernelDiagnosticKind,
  ns,
  Simulator,
} from '../../src/core';
import { createDefaultRegistry } from '../../src/library';
import { levels, set, simulate } from './support';

const DATA = [0, 1, 2, 3, 4, 5, 6, 7];
const contentions = (sim: Simulator) =>
  sim.diagnostics.entries.filter((d) => d.kind === KernelDiagnosticKind.CONTENTION);
const violations = (sim: Simulator) =>
  sim.diagnostics.entries.filter((d) => isTimingViolation(d.kind));

/** The byte on nets `D0`…`D7` as bits, D7 first. */
const bus = (sim: Simulator) => levels(sim, ...DATA.map((i) => `D${7 - i}`));

/**
 * Data switches → 74HC245 (A → B) → bus D → 6116 I/O. WRITE (active LOW) enables the 245 and
 * takes WE̅ LOW; the RAM's OE̅ is either WRITE inverted by a 74HC04 or a separate driver.
 */
function ramOnBus(oe: 'inverted' | 'driver'): Simulator {
  return simulate((b) => {
    b.add('U1', 'mem/6116', { powerOn: 'zeros' }).add('U2', '74xx/74hc245');
    b.add('WR', 'test/driver').add('G', 'io/gnd').add('V', 'io/vcc');
    b.net('WR', 'WR.Y', 'U2.OE', 'U1.WE').connect('V.Y', 'U2.DIR');
    b.connect('G.Y', 'U1.CS');
    if (oe === 'inverted') {
      b.add('U3', '74xx/74hc04').connect('WR.Y', 'U3.1A').net('OE', 'U3.1Y', 'U1.OE');
      for (const n of [2, 3, 4, 5, 6]) b.connect('G.Y', `U3.${n}A`);
    } else {
      b.add('OE', 'test/driver').net('OE', 'OE.Y', 'U1.OE');
    }
    for (const i of DATA) {
      b.add(`S${i}`, 'test/driver').connect(`S${i}.Y`, `U2.A${i}`);
      b.net(`D${i}`, `U2.B${i}`, `U1.IO${i}`);
    }
    for (let i = 0; i < 11; i++) b.add(`AD${i}`, 'test/driver').connect(`AD${i}.Y`, `U1.A${i}`);
    return b;
  });
}

function setAddress(sim: Simulator, value: number) {
  for (let i = 0; i < 11; i++) set(sim, `AD${i}`, (value >> i) & 1 ? 1 : 0);
}
function setSwitches(sim: Simulator, value: number) {
  for (const i of DATA) set(sim, `S${i}`, (value >> i) & 1 ? 1 : 0);
}

describe('a 6116 on a bus', () => {
  it('stores what the switches put through the 245 and shows it when WRITE is released', () => {
    const sim = ramOnBus('inverted');
    set(sim, 'WR', 1);
    setAddress(sim, 3);
    setSwitches(sim, 0x5a);
    sim.runFor(ns(100));
    expect(bus(sim)).toBe('00000000'); // the RAM reads its zeroed cell onto the bus
    set(sim, 'WR', 0);
    sim.runFor(ns(100));
    expect(bus(sim)).toBe('01011010'); // the 245 drives the switches onto the bus
    set(sim, 'WR', 1);
    sim.runFor(ns(100));
    expect(bus(sim)).toBe('01011010'); // the RAM reads back the stored byte
    setAddress(sim, 4);
    sim.runFor(ns(100));
    expect(bus(sim)).toBe('00000000');
    expect(violations(sim)).toEqual([]);
  });

  it('with OE̅ following WRITE the RAM still drives when the 245 turns on: a bus fight', () => {
    // The 245 drives 11 ns (ten) after WRITE falls; the RAM releases tWHZ = 16 ns after WE̅
    // falls (its OE̅ rises 9 ns later still, tOHZ = 10 ns after that): 5 ns where both drive
    // and the bits that differ fight, as on a board.
    const sim = ramOnBus('inverted');
    set(sim, 'WR', 1);
    setAddress(sim, 0);
    setSwitches(sim, 0x0f);
    sim.runFor(ns(100));
    set(sim, 'WR', 0);
    sim.runFor(ns(100));
    const fights = contentions(sim);
    expect(fights.map((d) => d.net).sort()).toEqual(['D0', 'D1', 'D2', 'D3']);
    expect(fights.every((d) => d.time === ns(100 + 11))).toBe(true);
  });

  it('with OE̅ HIGH before the write starts, the bus turns round cleanly', () => {
    const sim = ramOnBus('driver');
    set(sim, 'WR', 1);
    set(sim, 'OE', 1);
    setAddress(sim, 0);
    setSwitches(sim, 0x0f);
    sim.runFor(ns(100));
    set(sim, 'WR', 0);
    sim.runFor(ns(100));
    set(sim, 'WR', 1);
    sim.runFor(ns(100));
    set(sim, 'OE', 0);
    sim.runFor(ns(100));
    expect(bus(sim)).toBe('00001111');
    expect(contentions(sim)).toEqual([]);
    expect(violations(sim)).toEqual([]);
  });
});

/** Segments a–g of the hex digits on a common-cathode display (bit 0 = a). */
const SEGMENTS = [
  0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71,
];

describe('an AT28C16 as a hex-to-7-segment decoder', () => {
  const decoder = () => {
    const image = new Uint8Array(2048).fill(ERASED);
    SEGMENTS.forEach((segments, digit) => {
      image[digit] = segments;
    });
    return simulate((b) => {
      b.add('U1', 'mem/at28c16', { contents: formatImage(image) }).add('DS1', 'io/seven-segment');
      b.add('G', 'io/gnd').add('V', 'io/vcc');
      b.connect('G.Y', 'U1.CE', 'U1.OE', 'DS1.COM').connect('V.Y', 'U1.WE');
      for (let i = 4; i < 11; i++) b.connect('G.Y', `U1.A${i}`);
      for (let i = 0; i < 4; i++)
        b.add(`SW${i}`, 'test/driver').net(`A${i}`, `SW${i}.Y`, `U1.A${i}`);
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((s, i) => {
        b.net(s, `U1.IO${i}`, `DS1.${s}`);
      });
      return b;
    });
  };
  const segments = (sim: Simulator) => levels(sim, 'g', 'f', 'e', 'd', 'c', 'b', 'a');

  it('lights each hex digit 150 ns after the switches change', () => {
    const sim = decoder();
    for (let digit = 0; digit < 16; digit++) {
      for (let i = 0; i < 4; i++) set(sim, `SW${i}`, (digit >> i) & 1 ? 1 : 0);
      sim.runFor(ns(149));
      if (digit > 0) expect(segments(sim)).toBe('XXXXXXX');
      sim.runFor(ns(1));
      expect(segments(sim), `digit ${digit}`).toBe(SEGMENTS[digit]!.toString(2).padStart(7, '0'));
    }
    expect(sim.diagnostics.entries).toEqual([]);
  });
});

describe('sampling a RAM too early', () => {
  /** A 6116 reading address 0 or 1 (0x00, 0xFF), its outputs into a 74HC574 clocked by CP. */
  const pipeline = () => {
    const sim = simulate((b) => {
      b.add('U1', 'mem/6116', { powerOn: 'zeros' }).add('U2', '74xx/74hc574');
      b.add('G', 'io/gnd').add('V', 'io/vcc').add('A0', 'test/driver').add('CP', 'test/driver');
      b.connect('G.Y', 'U1.CS', 'U1.OE', 'U2.OE').connect('V.Y', 'U1.WE');
      for (let i = 1; i < 11; i++) b.connect('G.Y', `U1.A${i}`);
      b.net('A0', 'A0.Y', 'U1.A0').net('CP', 'CP.Y', 'U2.CP');
      for (const i of DATA) b.net(`D${i}`, `U1.IO${i}`, `U2.D${i}`).net(`Q${i}`, `U2.Q${i}`);
      return b;
    });
    set(sim, 'A0', 0);
    set(sim, 'CP', 0);
    sim.runFor(ns(100));
    sim.action('U1', { type: 'poke', address: 1, data: [0xff] });
    sim.runFor(ns(100));
    return sim;
  };
  const q = (sim: Simulator) => levels(sim, ...DATA.map((i) => `Q${7 - i}`));

  it('latches X when clocked before tAA = 25 ns, the byte after', () => {
    const early = pipeline();
    set(early, 'A0', 1);
    early.runFor(ns(20));
    set(early, 'CP', 1);
    early.runFor(ns(100));
    expect(q(early)).toBe('XXXXXXXX');

    const late = pipeline();
    set(late, 'A0', 1);
    late.runFor(ns(25 + 12)); // tAA, then the 574's set-up time
    set(late, 'CP', 1);
    late.runFor(ns(100));
    expect(q(late)).toBe('11111111');
    expect(violations(late)).toEqual([]);
  });
});

describe('the resolver over RAM by Hand', () => {
  const registry = createDefaultRegistry();
  const result = compileCircuit(exampleDocument('ram-by-hand').circuits[0]!, registry);
  const resolver = new Resolver(result, registry);

  it('finds the 6116 and its address pins', () => {
    const [ram, ...others] = resolver.memories();
    expect(others).toEqual([]);
    expect(ram).toMatchObject({ id: 'U1', type: 'mem/6116' });
    expect(ram!.memory.addressPins).toEqual(Array.from({ length: 11 }, (_, i) => `A${i}`));
  });

  it('names the nets the simulator has: a pin, a net label, the data bus', () => {
    const sim = new Simulator(result.netlist, registry);
    const pin = resolver.resolve('U1.A0');
    expect(pin).toMatchObject({ kind: 'pin', net: 'A0' });
    expect(sim.netIndex((pin as { net: string }).net)).toBe(sim.pinNet('U1', 'A0'));
    expect(resolver.resolve('D7')).toEqual({ kind: 'net', net: 'D7' });
    expect(resolver.resolve('D[7..0]')).toMatchObject({
      members: DATA.map((i) => `D${i}`),
    });
  });
});

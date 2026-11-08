import { describe, expect, it } from 'vitest';
import { Level, ms, ns, pinsOf, resolveProps, timingOf, us } from '../../core';
import { hd44780, hd44780ControllerTiming, hd44780Symbol } from './hd44780';
import { Hd44780Diagnostic, Iface } from './hd44780-controller';
import { hd44780Frame } from './hd44780-frame';
import { HD44780_SIZES } from './hd44780-modules';
import { LcdBench } from './test-helpers';

const BF = (text: string) => text[0];
const AC = (text: string) => Number.parseInt(text.slice(1), 2);

describe('HD44780 module pins', () => {
  it('has the 16-pin header in module order (Newhaven NHD-0216K1Z)', () => {
    const pins = pinsOf(hd44780, resolveProps(hd44780, {}));
    expect(pins.map((p) => `${p.number} ${p.label ?? p.name}`)).toEqual([
      '1 VSS',
      '2 VDD',
      '3 V0',
      '4 RS',
      '5 R/W̅',
      '6 E',
      '7 DB0',
      '8 DB1',
      '9 DB2',
      '10 DB3',
      '11 DB4',
      '12 DB5',
      '13 DB6',
      '14 DB7',
      '15 A',
      '16 K',
    ]);
    expect(pins.filter((p) => p.dir === 'bidir').map((p) => p.name)).toHaveLength(8);
  });

  it('keeps the pins where they are whatever the size: 1–16 along the bottom', () => {
    for (const size of HD44780_SIZES) {
      const symbol = hd44780Symbol(size);
      expect(symbol.width, size).toBeGreaterThanOrEqual(18);
      for (const [name, place] of Object.entries(symbol.pins)) {
        const number = pinsOf(hd44780, resolveProps(hd44780, {})).find((p) => p.name === name)!
          .number!;
        expect(place, `${size} ${name}`).toEqual({ side: 'bottom', offset: number });
      }
    }
    expect(hd44780Symbol('40x2').width).toBeGreaterThan(hd44780Symbol('16x2').width);
    expect(hd44780Symbol('20x4').height).toBeGreaterThan(hd44780Symbol('20x2').height);
  });

  it('pulls DB0–DB7 up: a released bus reads HIGH', () => {
    const lcd = new LcdBench();
    expect(lcd.busText()).toBe('11111111');
    lcd.bench.expectNoDiagnostics();
  });
});

describe('HD44780 power-on (internal reset)', () => {
  it('is busy for 10 ms, then in the reset state: 8-bit, 1 line, display off, increment', () => {
    const lcd = new LcdBench({}, ms(5));
    expect(BF(lcd.read(0))).toBe('1');
    lcd.run(ms(6));
    expect(lcd.read(0)).toBe('00000000');
    const c = lcd.controller;
    expect([c.iface, c.n, c.f, c.d, c.c, c.b, c.id, c.s, c.unknown]).toEqual([
      Iface.EIGHT,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
    ]);
    expect(lcd.text).toEqual([' '.repeat(16), ' '.repeat(16)]);
    // Reading the busy flag before 15 ms is allowed; writing isn't.
    lcd.bench.expectNoDiagnostics();
  });

  it("prints Ben Eater's Hello, world in 8-bit mode", () => {
    const lcd = new LcdBench();
    lcd.initEightBit().data('Hello, world!');
    expect(lcd.text).toEqual(['Hello, world!   ', ' '.repeat(16)]);
    expect(AC(lcd.read(0))).toBe(13);
    lcd.bench.expectNoDiagnostics();
  });

  it('prints in 4-bit mode after the data sheet initialization (Figure 24)', () => {
    const lcd = new LcdBench();
    lcd.initFourBit();
    expect(lcd.fourBit).toBe(true);
    for (const ch of 'Hi 4-bit') lcd.byte4(1, ch.charCodeAt(0));
    expect(lcd.text[0]).toBe('Hi 4-bit        ');
    lcd.bench.expectNoDiagnostics();
  });
});

describe('HD44780 instructions (Table 6)', () => {
  const ready = () => new LcdBench().initEightBit();

  it('clears the display: spaces, address 0, unshifted, increment; busy 1.52 ms', () => {
    const lcd = ready().command(0x04).data('AB').command(0x18); // decrement, shift left
    lcd.write(0, 0x01).run(ms(1.5));
    expect(BF(lcd.read(0))).toBe('1');
    lcd.run(us(30));
    expect(lcd.read(0)).toBe('00000000');
    const c = lcd.controller;
    expect([c.shift, c.id, c.ac]).toEqual([0, 1, 0]);
    expect(lcd.text[0]).toBe(' '.repeat(16));
  });

  it('returns home without touching DDRAM; busy 1.52 ms', () => {
    const lcd = ready().data('Hey').command(0x18);
    lcd.write(0, 0x02).run(ms(1.5));
    expect(BF(lcd.read(0))).toBe('1');
    lcd.run(us(30));
    expect(lcd.read(0)).toBe('00000000');
    expect(lcd.text[0]).toBe('Hey             ');
    expect(lcd.controller.shift).toBe(0);
  });

  it('sets the entry mode: decrement writes leftwards, S shifts the display', () => {
    const lcd = ready()
      .command(0x80 | 5)
      .command(0x04)
      .data('abc');
    expect(lcd.text[0]).toBe('   cba          ');
    expect(AC(lcd.read(0))).toBe(2);
    const shifting = ready().command(0x07).data('xy');
    expect(shifting.controller.shift).toBe(2);
    expect(shifting.text[0]).toBe(' '.repeat(16)); // written at 0, 1: shifted off the left
  });

  it('turns the display, cursor and blink on and off', () => {
    const lcd = ready().data('A').command(0x08);
    expect(lcd.text[0]).toBe(' '.repeat(16));
    lcd.command(0x0f);
    expect(lcd.text[0]!.startsWith('A')).toBe(true);
    const c = lcd.controller;
    expect([c.d, c.c, c.b]).toEqual([1, 1, 1]);
    // The cursor is at address 1: its bottom row is all on; blinking, the cell is all on.
    const steady = hd44780Frame(c, '16x2', 'A00', false);
    expect(steady.rows[8 + 7]).toBe(0x1f);
    const blink = hd44780Frame(c, '16x2', 'A00', true);
    expect([...blink.rows.slice(8, 16)]).toEqual(Array(8).fill(0x1f));
  });

  it('moves the cursor and shifts the display (S/C, R/L)', () => {
    const lcd = ready().data('ABC');
    lcd.command(0x10).command(0x10); // cursor left twice
    expect(AC(lcd.read(0))).toBe(1);
    lcd.command(0x14); // cursor right
    expect(AC(lcd.read(0))).toBe(2);
    lcd.command(0x18); // display left
    expect(lcd.text[0]).toBe('BC              ');
    lcd.command(0x1c).command(0x1c); // display right twice
    expect(lcd.text[0]).toBe(' ABC            ');
    expect(lcd.controller.shift).toBe(79);
  });

  it('crosses from the end of line 1 to line 2 in 2-line mode', () => {
    const lcd = ready()
      .command(0x80 | 0x27)
      .data('ab');
    expect(AC(lcd.read(0))).toBe(0x41);
    expect(lcd.text[1]!.startsWith('b')).toBe(true);
  });

  it('shows line 2 only in 2-line mode, and warns of the 5 × 10 font', () => {
    const lcd = new LcdBench().command(0x38).command(0x0c).command(0xc0).data('2');
    expect(lcd.text[1]!.startsWith('2')).toBe(true);
    lcd.command(0x30); // 1 line: the second line of glass isn't driven
    expect(lcd.text).toEqual([' '.repeat(16), ' '.repeat(16)]);
    lcd.command(0x38);
    expect(lcd.text[1]!.startsWith('2')).toBe(true);
    lcd.bench.expectNoDiagnostics();
    lcd.command(0x34);
    expect(lcd.diagnostics()).toEqual([expect.stringMatching(/^unsupported-font: /)]);
  });

  it('defines characters in CGRAM: code 0 and its mirror 8', () => {
    const lcd = ready().command(0x40);
    lcd.data([0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f, 0x00]);
    lcd.command(0x80).data([0x00, 0x08]);
    const frame = hd44780Frame(lcd.controller, '16x2', 'A00', false);
    const box = [0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f, 0x00];
    expect([...frame.rows.slice(0, 8)]).toEqual(box);
    expect([...frame.rows.slice(8, 16)]).toEqual(box);
    expect(lcd.text[0]!.slice(0, 2)).toBe('··');
  });

  it('reports a DDRAM address the mode lacks', () => {
    const lcd = ready().command(0x80 | 0x28);
    expect(lcd.diagnostics()).toEqual([
      'invalid-address: DDRAM address 0x28 doesn’t exist in 2-line mode (0x00–0x27, 0x40–0x67)'.replace(
        '’',
        "'",
      ),
    ]);
  });

  it('reads the busy flag and the old address until tADD after a write', () => {
    const lcd = ready().command(0x80 | 0x05);
    lcd.write(1, 0x41).run(us(30));
    const busy = lcd.read(0);
    expect([BF(busy), AC(busy)]).toEqual(['1', 5]);
    // BF clears 37 µs after E fell; the address follows tADD = 5.6 µs later.
    lcd.run(us(7.5));
    const between = lcd.read(0);
    expect([BF(between), AC(between)]).toEqual(['0', 5]);
    lcd.run(us(6));
    expect(AC(lcd.read(0))).toBe(6);
  });

  it('reads data from the address set, then the next ones; a read after a write is invalid', () => {
    const lcd = ready().data('xyz').command(0x80);
    expect(lcd.readByte(1)).toBe(0x78);
    lcd.run(us(60));
    expect(lcd.readByte(1)).toBe(0x79);
    lcd.run(us(60));
    expect(AC(lcd.read(0))).toBe(2);
    lcd.data('Z');
    expect(lcd.read(1)).toBe('XXXXXXXX');
    expect(lcd.diagnostics()).toEqual([expect.stringMatching(/^invalid-read: /)]);
    lcd.run(us(60));
    // The invalid read moved on and reloaded: the next read is good (a space at 4).
    expect(lcd.readByte(1)).toBe(0x20);
  });

  it('scales execution times with the oscillator (37 µs at 270 kHz → 52.6 µs at 190 kHz)', () => {
    const slow = new LcdBench({ oscillator: 190_000 }).initEightBit();
    slow.write(0, 0x06).run(us(50));
    expect(BF(slow.read(0))).toBe('1');
    slow.run(us(3));
    expect(BF(slow.read(0))).toBe('0');
    expect(hd44780ControllerTiming(190_000).exec).toBe(Math.round((us(37) * 270) / 190));
  });
});

describe('HD44780 4-bit interface', () => {
  it('reads the busy flag and address in two nibbles: BF AC6–4, then AC3–0', () => {
    const lcd = new LcdBench().initFourBit();
    lcd.byte4(0, 0x80 | 0x4b);
    const high = lcd.read(0);
    const low = lcd.read(0);
    expect(high).toBe('01001111'); // BF 0, AC6–4 = 100; DB3–DB0 pulled up
    expect(low).toBe('10111111'); // AC3–0 = 1011
    expect(lcd.fourBit && lcd.controller.iface).toBe(Iface.HIGH);
  });

  it('gets out of step when a byte loses a nibble, as on the bench after a CPU reset', () => {
    const lcd = new LcdBench().initFourBit();
    lcd.nibble(1, 0x4); // a reset mid-byte: the low nibble never comes
    for (const ch of 'OK') lcd.byte4(1, ch.charCodeAt(0));
    expect(lcd.text[0]!.slice(0, 2)).not.toBe('OK');
    // The data sheet's resynchronization (0x3, 0x3, 0x3, 0x2) brings it back.
    lcd.nibble(0, 0x3).run(ms(4.2)).nibble(0, 0x3).run(us(110)).nibble(0, 0x3).run(us(110));
    lcd.nibble(0, 0x2).run(us(60));
    lcd.byte4(0, 0x28).byte4(0, 0x01, ms(2));
    for (const ch of 'OK') lcd.byte4(1, ch.charCodeAt(0));
    expect(lcd.text[0]!.slice(0, 2)).toBe('OK');
  });
});

describe('HD44780 reads on the bus', () => {
  it('drives X from E rising until tDDR, holds the data tDHR after E falls, then releases', () => {
    const lcd = new LcdBench().initEightBit();
    const b = lcd.bench;
    b.set({ RS: 0, RW: 1, DB7: 'Z', DB0: 'Z' });
    b.run(ns(100));
    const seen: [number, Level][] = [];
    const net = b.sim.netIndex('DB0');
    const start = b.now;
    const off = b.sim.onNetChange((t, n, level) => {
      if (n === net) seen.push([(t - start) / 1000, level]);
    });
    b.set({ E: 1 });
    b.run(ns(300));
    b.set({ E: 0 });
    b.run(ns(100));
    off();
    // AC = 0: DB0 X at the rise, 0 at 160 ns, released 5 ns after E fell at 300 ns.
    expect(seen).toEqual([
      [0, Level.X],
      [160, Level.L0],
      [305, Level.L1],
    ]);
  });

  it('fights a driver left on the bus during a read', () => {
    const lcd = new LcdBench().initEightBit();
    const b = lcd.bench;
    b.set({ RS: 0, RW: 1, DB0: 1 });
    b.run(ns(100));
    b.set({ E: 1 });
    b.run(ns(300));
    expect(b.diagnostics.map((d) => d.kind)).toContain('contention');
  });
});

describe('HD44780 timing data', () => {
  it('records the 5 V bus timing and the execution times at the oscillator', () => {
    const timing = timingOf(hd44780, resolveProps(hd44780, {}))!;
    expect(timing.typical).toEqual({});
    expect(timing.min).toMatchObject({
      tcycE: ns(500),
      PWEH: ns(230),
      tAS: ns(40),
      tAH: ns(10),
      tDSW: ns(80),
      tH: ns(10),
      tDHR: ns(5),
      'power-on to first write': ms(15),
    });
    expect(timing.max).toMatchObject({
      tDDR: ns(160),
      'Clear display': us(1520),
      'Return home': us(1520),
      'other instructions': us(37),
      'internal reset (BF = 1)': ms(10),
    });
    const slow = timingOf(hd44780, resolveProps(hd44780, { oscillator: 190_000 }))!;
    expect(slow.max!['Clear display']).toBe(Math.round((us(1520) * 270) / 190));
  });

  it('names its diagnostics', () => {
    expect(Hd44780Diagnostic.BUSY).toBe('busy-violation');
  });
});

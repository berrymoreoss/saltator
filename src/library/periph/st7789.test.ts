import { describe, expect, it } from 'vitest';
import { pinsOf, resolveProps, us } from '../../core';
import { st7789, st7789Symbol } from './st7789';
import { Cmd, COMMANDS, PIXEL_X, STREAM, St7789Diagnostic } from './st7789-controller';
import { ST7789_PANELS } from './st7789-panels';
import { TftBench } from './st7789-test-helpers';

const pins = pinsOf(st7789, resolveProps(st7789, {}));

describe('ST7789 module pins', () => {
  it('has the 8-pin breakout header in module order (MSP2008, DM-TFT114-397)', () => {
    expect(pins.map((p) => `${p.number} ${p.name}`)).toEqual([
      '1 GND',
      '2 VCC',
      '3 SCL',
      '4 SDA',
      '5 RES',
      '6 DC',
      '7 CS',
      '8 BLK',
    ]);
  });

  it('keeps the pins where they are whatever the panel: 1–8 along the bottom', () => {
    for (const panel of ST7789_PANELS) {
      const symbol = st7789Symbol(panel);
      expect(symbol.width, panel).toBeGreaterThanOrEqual(10);
      for (const pin of pins) {
        expect(symbol.pins[pin.name], `${panel} ${pin.name}`).toEqual({
          side: 'bottom',
          offset: pin.number,
        });
      }
      // Raised by what it grows over the shortest panel, so the bottom edge stays put.
      expect(symbol.height - (symbol.raise ?? 0), panel).toBe(st7789Symbol('240x240').height);
    }
    expect(st7789Symbol('240x320').height).toBeGreaterThan(st7789Symbol('240x240').height);
    expect(st7789Symbol('240x240').width).toBeGreaterThan(st7789Symbol('135x240').width);
  });
});

describe('ST7789 command table', () => {
  it('has the parameter counts of the data sheet tables', () => {
    const count = (code: number) => COMMANDS.get(code)?.params;
    expect(count(Cmd.CASET)).toBe(4);
    expect(count(Cmd.RASET)).toBe(4);
    expect(count(Cmd.VSCRDEF)).toBe(6);
    expect(count(Cmd.VSCSAD)).toBe(2);
    expect(count(Cmd.RAMWR)).toBe(STREAM);
    expect(count(Cmd.WRMEMC)).toBe(STREAM);
    expect(count(0xb2)).toBe(5); // PORCTRL
    expect(count(0xe0)).toBe(14); // PVGAMCTRL
    expect(count(0xe2)).toBe(64); // DGMLUTR
    expect(COMMANDS.has(0xd6)).toBe(false);
    expect([...COMMANDS.values()].filter((c) => c.read).map((c) => c.name)).toContain('RDDID');
  });
});

describe('ST7789 power-on and resets', () => {
  it('powers on asleep, display off, 18-bit, the whole memory as the window, memory unknown', () => {
    const c = new TftBench().controller;
    expect([c.sleep, c.display, c.inversion, c.idle, c.partial]).toEqual([1, 0, 0, 0, 0]);
    expect([c.colmod, c.madctl]).toEqual([0x06, 0x00]);
    expect([c.xs, c.xe, c.ys, c.ye]).toEqual([0, 239, 0, 319]);
    expect([c.tfa, c.vsa, c.bfa, c.vsp, c.psl, c.pel]).toEqual([0, 320, 0, 0, 0, 319]);
    expect([c.ramctrl1, c.ramctrl2]).toEqual([0x00, 0xf0]);
    expect(c.gram.every((word) => word === PIXEL_X)).toBe(true);
  });

  it('a RESX pulse of 10 µs sets the hardware defaults again', () => {
    const tft = new TftBench();
    tft.command(Cmd.SLPOUT).command(Cmd.COLMOD, [0x55]).command(Cmd.MADCTL, [0x60]);
    tft.command(Cmd.CASET, [0, 10, 0, 20]);
    expect([tft.controller.sleep, tft.controller.colmod, tft.controller.xe]).toEqual([0, 0x55, 20]);
    tft.reset(us(10));
    const c = tft.controller;
    expect([c.sleep, c.colmod, c.madctl, c.xs, c.xe]).toEqual([1, 0x06, 0x00, 0, 239]);
    expect(tft.diagnostics()).toEqual([]);
  });

  it('holds the interface while RESX is LOW: bytes then are lost', () => {
    const tft = new TftBench();
    tft.bench.set({ RES: 0 });
    tft.command(Cmd.SLPOUT);
    tft.bench.set({ RES: 1 });
    tft.run(us(1));
    expect(tft.controller.sleep).toBe(1);
  });

  it('SWRESET sets the software defaults; COLMOD and MADCTL keep their values', () => {
    const tft = new TftBench();
    tft.command(Cmd.SLPOUT).command(Cmd.DISPON).command(Cmd.COLMOD, [0x55]);
    tft.command(Cmd.MADCTL, [0x20]).command(Cmd.CASET, [0, 1, 0, 2]);
    tft.command(Cmd.SWRESET);
    const c = tft.controller;
    expect([c.sleep, c.display, c.colmod, c.madctl]).toEqual([1, 0, 0x55, 0x20]);
    // MV = 1: the window's ends are exchanged (CASET/RASET "S/W Reset" defaults).
    expect([c.xs, c.xe, c.ys, c.ye]).toEqual([0, 319, 0, 239]);
  });
});

describe('ST7789 serial interface', () => {
  it('takes a command and its parameters in one CS frame, or each byte in its own', () => {
    const tft = new TftBench();
    tft.command(Cmd.CASET, [0x00, 0x34, 0x00, 0xba]);
    expect([tft.controller.xs, tft.controller.xe]).toEqual([52, 186]);
    tft.byte(0, Cmd.RASET).byte(1, 0x00).byte(1, 0x28).byte(1, 0x01).byte(1, 0x17);
    expect([tft.controller.ys, tft.controller.ye]).toEqual([40, 279]);
    expect(tft.diagnostics()).toEqual([]);
  });

  it('works with CS tied LOW (the 7-pin modules)', () => {
    const tft = new TftBench();
    tft.select();
    tft.bits(0, Cmd.SLPOUT).bits(0, Cmd.MADCTL).bits(1, 0xc0);
    expect([tft.controller.sleep, tft.controller.madctl]).toEqual([0, 0xc0]);
  });

  it('samples D/CX on the 8th rising edge only', () => {
    const tft = new TftBench();
    tft
      .select()
      .bits(1, Cmd.INVON >> 1, 7)
      .bits(0, Cmd.INVON & 1, 1)
      .deselect();
    expect(tft.controller.inversion).toBe(1);
    expect(tft.diagnostics()).toEqual([]);
  });

  it('ignores SCL while CS is HIGH', () => {
    const tft = new TftBench();
    tft.bits(0, Cmd.SLPOUT); // CS HIGH
    expect(tft.controller.sleep).toBe(1);
    tft.command(Cmd.SLPOUT);
    expect(tft.controller.sleep).toBe(0);
  });

  it('drops a byte CS cuts short and takes the next one whole (§8.5, Figure 20)', () => {
    const tft = new TftBench();
    tft.select().bits(0, 0b10110, 5).deselect();
    tft.command(Cmd.INVON);
    expect(tft.controller.inversion).toBe(1);
    expect(tft.diagnostics()).toEqual([`${St7789Diagnostic.PARTIAL_BYTE} CS`]);
  });

  it('keeps the parameters sent before a break; the rest keep their values (Figure 21)', () => {
    const tft = new TftBench();
    tft.command(Cmd.CASET, [0x00, 0x10]); // XS only
    tft.command(Cmd.RASET, [0x00, 0x05, 0x00, 0x06]);
    const c = tft.controller;
    expect([c.xs, c.xe, c.ys, c.ye]).toEqual([16, 239, 5, 6]);
    expect(tft.diagnostics()).toEqual([]);
  });

  it('sets the display modes', () => {
    const tft = new TftBench();
    const flags = () => {
      const c = tft.controller;
      return [c.sleep, c.display, c.inversion, c.idle, c.partial];
    };
    tft.command(Cmd.SLPOUT).command(Cmd.DISPON).command(Cmd.INVON);
    tft.command(Cmd.IDMON).command(Cmd.PTLON);
    expect(flags()).toEqual([0, 1, 1, 1, 1]);
    tft.command(Cmd.NORON).command(Cmd.IDMOFF).command(Cmd.INVOFF);
    tft.command(Cmd.DISPOFF).command(Cmd.SLPIN);
    expect(flags()).toEqual([1, 0, 0, 0, 0]);
  });

  it('stores the scroll, partial and RAM control registers byte by byte', () => {
    const tft = new TftBench();
    tft.command(Cmd.VSCRDEF, [0x00, 0x03, 0x01, 0x3b, 0x00, 0x02]);
    tft.command(Cmd.VSCSAD, [0x00, 0x04]);
    tft.command(Cmd.PTLAR, [0x00, 0x10, 0x00, 0x20]);
    tft.command(Cmd.RAMCTRL, [0x00, 0xf8]);
    const c = tft.controller;
    expect([c.tfa, c.vsa, c.bfa, c.vsp]).toEqual([3, 315, 2, 4]);
    expect([c.psl, c.pel, c.ramctrl2]).toEqual([16, 32, 0xf8]);
  });
});

describe('ST7789 commands it doesn’t take', () => {
  it('warns about a command the data sheet doesn’t have and ignores its parameters', () => {
    const tft = new TftBench();
    tft.command(0xd6, [0xa1]); // in the MSP1141 vendor initialization
    tft.command(Cmd.MADCTL, [0x00]);
    expect(tft.diagnostics()).toEqual([St7789Diagnostic.UNKNOWN_COMMAND]);
  });

  it('warns that a read is not simulated and ignores the bytes until the next command', () => {
    const tft = new TftBench();
    tft.command(0x04, [0x00, 0x00, 0x00]); // RDDID
    tft.command(Cmd.INVON);
    expect(tft.diagnostics()).toEqual([St7789Diagnostic.READ]);
    expect(tft.controller.inversion).toBe(1);
  });

  it('warns about data no command takes', () => {
    const tft = new TftBench();
    tft.data([0x12]);
    tft.command(Cmd.MADCTL, [0x00, 0x01]);
    expect(tft.diagnostics()).toEqual([`${St7789Diagnostic.STRAY_DATA} ×2`]);
    expect(tft.controller.madctl).toBe(0x00);
  });

  it('counts the parameters of commands without a visible effect', () => {
    const tft = new TftBench();
    tft.command(0xb2, [0x0c, 0x0c, 0x00, 0x33, 0x33]); // PORCTRL
    tft.command(0xe0, [0xd0, 4, 13, 17, 19, 43, 63, 84, 76, 24, 13, 11, 31, 35]);
    expect(tft.diagnostics()).toEqual([]);
  });
});

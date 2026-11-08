/**
 * The ST7789 module's program for TFT Color Bars, run through the controller byte by byte at
 * the times the streamer sends them: the SMPTE bars on the glass, the waits kept at the clock
 * the program was counted for and broken at twice that.
 */
import { describe, expect, it } from 'vitest';
import {
  createSt7789Controller,
  type St7789Controller,
  st7789Frame,
  st7789ReceiveByte,
} from '../../src/library';
import { HEIGHT, PASS_BYTES, rgb565, smpte, streamBytes, streamTime, WIDTH } from './tft-program';

/** Feeds `passes` passes of the stream, the bytes completing at `speed` times the clock. */
function run(passes: number, speed = 1): { ctl: St7789Controller; warnings: string[] } {
  const ctl = createSt7789Controller();
  const warnings: string[] = [];
  for (let pass = 0; pass < passes; pass++) {
    let i = 0;
    for (const byte of streamBytes()) {
      const now = streamTime(pass * PASS_BYTES + i++) / speed;
      if (byte.cs) continue;
      st7789ReceiveByte(ctl, now, byte.dc, byte.value, 0, (kind) => warnings.push(kind));
    }
  }
  return { ctl, warnings };
}

/** What the glass shows for a 5-6-5 color: EPF 11 (R0 = B0 = G0), 6 bits to 8. */
function shown(color: number): number {
  const w = rgb565(color);
  const g6 = (w >> 5) & 0x3f;
  const r6 = ((w >> 11) << 1) | (g6 & 1);
  const b6 = ((w & 0x1f) << 1) | (g6 & 1);
  const to8 = (v: number) => (v << 2) | (v >> 4);
  return (to8(r6) << 16) | (to8(g6) << 8) | to8(b6);
}

/** Picture points that differ from the bars (at most `limit` of them). */
function wrong(ctl: St7789Controller, limit = 5): string[] {
  const frame = st7789Frame(ctl, '240x320');
  const out: string[] = [];
  for (let y = 0; y < HEIGHT && out.length < limit; y++) {
    for (let x = 0; x < WIDTH && out.length < limit; x++) {
      // MADCTL 60h: the picture's (x, y) is the memory's column 239 − y, row x.
      const got = frame.pixels[x * frame.width + (239 - y)]!;
      const want = shown(smpte(x, y));
      if (got !== want) out.push(`(${x}, ${y}): ${got.toString(16)} ≠ ${want.toString(16)}`);
    }
  }
  return out;
}

describe('TFT Color Bars program', () => {
  it('draws the SMPTE bars in one pass, keeping every wait', () => {
    const { ctl, warnings } = run(1);
    expect(warnings).toEqual([]);
    expect(wrong(ctl)).toEqual([]);
    expect(ctl.unknown).toBe(0);
  });

  it('draws them again on the next pass (SLPOUT has no effect then)', () => {
    const { ctl, warnings } = run(2);
    expect(warnings).toEqual([]);
    expect(wrong(ctl)).toEqual([]);
  });

  it('breaks the waits clocked at twice the speed it was counted for', () => {
    const { warnings } = run(1, 2);
    expect(warnings).toContain('wait-violation');
  });

  it('has the bars where SMPTE EG 1-1990 puts them', () => {
    expect([smpte(0, 0), smpte(319, 0), smpte(160, 170), smpte(0, 239), smpte(319, 239)]).toEqual([
      0xc0c0c0, 0x0000c0, 0x131313, 0x00214c, 0x131313,
    ]);
  });
});

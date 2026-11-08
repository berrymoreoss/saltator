/**
 * TFT Color Bars runs headless: after RESET the streamer initializes the ST7789 with every wait
 * kept and draws the SMPTE bars row block by row block, with no diagnostics; clocked faster
 * than its waits were counted for, the module says so.
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import { type Circuit, compileCircuit } from '../../src/circuit';
import { ms, parseImage, Simulator } from '../../src/core';
import { createDefaultRegistry, st7789Controller, st7789Frame } from '../../src/library';
import { colorBarsRoms, HEIGHT, rgb565, smpte, TFT_CLOCK_HZ, WIDTH } from './tft-program';

const registry = createDefaultRegistry();

function load(edit?: (circuit: Circuit) => Circuit): Simulator {
  const circuit = exampleDocument('tft-color-bars').circuits[0]!;
  return new Simulator(compileCircuit(edit ? edit(circuit) : circuit, registry).netlist, registry);
}

/** A press and release of RESET as a hand does it, off the clock's edges. */
const HAND = ms(5) + 123_457;

function reset(sim: Simulator) {
  sim.action('SW1', { type: 'press' });
  sim.runFor(HAND);
  sim.action('SW1', { type: 'release' });
}

/** What the glass shows for a 5-6-5 color: EPF 11 (R0 = B0 = G0), 6 bits to 8. */
function shown(color: number): number {
  const w = rgb565(color);
  const g6 = (w >> 5) & 0x3f;
  const to8 = (v: number) => (v << 2) | (v >> 4);
  return (
    (to8(((w >> 11) << 1) | (g6 & 1)) << 16) | (to8(g6) << 8) | to8(((w & 0x1f) << 1) | (g6 & 1))
  );
}

/** Points of picture rows [0, rows) that differ from the bars (a few). */
function wrong(sim: Simulator, rows = HEIGHT): string[] {
  const frame = st7789Frame(st7789Controller(sim.stateOf('DS1'))!, '240x320');
  const out: string[] = [];
  for (let y = 0; y < rows && out.length < 5; y++) {
    for (let x = 0; x < WIDTH && out.length < 5; x++) {
      const got = frame.pixels[x * frame.width + (239 - y)]!;
      const want = shown(smpte(x, y));
      if (got !== want) out.push(`(${x}, ${y}): ${got.toString(16)} ≠ ${want.toString(16)}`);
    }
  }
  return out;
}

const kinds = (sim: Simulator) => sim.diagnostics.entries.map((d) => `${d.kind}: ${d.message}`);

describe('TFT Color Bars', () => {
  it('holds the program of tft-program.ts in its EEPROMs', () => {
    const parts = exampleDocument('tft-color-bars').circuits[0]!.components;
    const contents = (id: string) => String(parts.find((c) => c.id === id)!.props.contents);
    const roms = colorBarsRoms();
    expect([...parseImage(contents('U3'), roms.pixels.length)]).toEqual([...roms.pixels]);
    expect([...parseImage(contents('U4'), roms.control.length)]).toEqual([...roms.control]);
  });

  it('initializes and draws the bars block by block after RESET, with no diagnostics', () => {
    const sim = load();
    sim.runFor(ms(1) + 31_416);
    reset(sim);
    // Block 0 (131 ms) initializes, each block after it draws 8 rows in 131 ms. (The whole
    // picture, 4.1 s, came out exact with no diagnostics too: 29M events, too slow for here.)
    sim.runFor(ms(131 + 131 + 2));
    expect(wrong(sim, 8)).toEqual([]);
    expect(kinds(sim)).toEqual([]);
    const ctl = st7789Controller(sim.stateOf('DS1'))!;
    expect([ctl.sleep, ctl.display, ctl.inversion, ctl.unknown]).toEqual([0, 1, 1, 0]);
  }, 30_000);

  /** The example with its clock at `hz`. */
  const at = (hz: number) =>
    load((circuit) => ({
      ...circuit,
      components: circuit.components.map((c) =>
        c.id === 'X1' ? { ...c, props: { ...c.props, frequency: hz } } : c,
      ),
    }));

  it('breaks the waits at twice the clock its program was counted for, and says so', () => {
    const sim = at(2 * TFT_CLOCK_HZ);
    sim.runFor(ms(1) + 31_416);
    reset(sim);
    sim.runFor(ms(70));
    expect(sim.diagnostics.entries.map((d) => d.kind)).toContain('wait-violation');
  });
});

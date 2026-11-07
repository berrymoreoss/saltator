/**
 * The LCD examples run headless: LCD Hello, World prints its two lines after RESET and again
 * after a second RESET (the data sheet's initialization works from 4-bit mode too), and only up
 * to the clock its waits were written for; LCD by Hand takes Ben Eater's instructions from its
 * switches.
 */
import { describe, expect, it } from 'vitest';
import { exampleDocument } from '../../src/app/example-files';
import { type Circuit, compileCircuit } from '../../src/circuit';
import { formatImage, ms, parseImage, Simulator, type Time } from '../../src/core';
import { createDefaultRegistry, hd44780Controller, hd44780Text } from '../../src/library';
import { helloProgram, LINE_1, LINE_2, MAX_STEP_HZ } from './lcd-program';

const registry = createDefaultRegistry();

function load(id: string, edit?: (circuit: Circuit) => Circuit): Simulator {
  const circuit = exampleDocument(id).circuits[0]!;
  return new Simulator(compileCircuit(edit ? edit(circuit) : circuit, registry).netlist, registry);
}

const text = (sim: Simulator) => hd44780Text(hd44780Controller(sim.stateOf('DS1'))!, '16x2', 'A00');
const kinds = (sim: Simulator) => sim.diagnostics.entries.map((d) => `${d.kind} ${d.message}`);

/**
 * Presses and releases a button, letting time pass as a hand does — and off the clock's edges:
 * releasing RESET 8 ns before the counter's clock falls is a recovery violation (a real one).
 */
const HAND = ms(5) + 123_457;

function click(sim: Simulator, id: string) {
  sim.action(id, { type: 'press' });
  sim.runFor(HAND);
  sim.action(id, { type: 'release' });
  sim.runFor(HAND);
}

describe('LCD Hello, World', () => {
  it('holds the program of lcd-program.ts in its EEPROM', () => {
    const u3 = exampleDocument('lcd-hello-world').circuits[0]!.components.find(
      (c) => c.id === 'U3',
    )!;
    expect(u3.props.contents).toBe(formatImage(Uint8Array.from(helloProgram())));
    expect([...parseImage(String(u3.props.contents), 2048)]).toEqual(helloProgram());
  });

  it('prints both lines after RESET, again after a second RESET, with no diagnostics', () => {
    const sim = load('lcd-hello-world');
    sim.runFor(ms(30) + 31_416);
    expect(text(sim)).toEqual([' '.repeat(16), ' '.repeat(16)]); // display off since power-on
    click(sim, 'SW1');
    sim.runFor(ms(600));
    const expected = [LINE_1.padEnd(16), LINE_2.padEnd(16)];
    expect(text(sim)).toEqual(expected);
    // At 2048 steps Q11 stops the counter.
    sim.runFor(ms(2100));
    const events = sim.stats.events;
    sim.runFor(ms(100));
    expect(sim.level('STOP')).toBe(1);
    expect(sim.stats.events - events).toBeLessThan(500); // only CLK and the latch
    click(sim, 'SW1');
    sim.runFor(ms(600));
    expect(text(sim)).toEqual(expected);
    expect(kinds(sim)).toEqual([]);
  });

  /** The example with its clock at `hz`, run until it printed. */
  function at(hz: number, until: Time): Simulator {
    const sim = load('lcd-hello-world', (circuit) => ({
      ...circuit,
      components: circuit.components.map((c) =>
        c.id === 'X1' ? { ...c, props: { ...c.props, frequency: hz } } : c,
      ),
    }));
    sim.runFor(ms(1) + 31_416);
    click(sim, 'SW1');
    sim.runFor(until);
    return sim;
  }

  it('runs clean up to the clock its waits were counted for', () => {
    const sim = at(MAX_STEP_HZ, ms(60));
    expect(text(sim)).toEqual([LINE_1.padEnd(16), LINE_2.padEnd(16)]);
    expect(kinds(sim)).toEqual([]);
  });

  it('loses an instruction when clocked faster, and says so though the text looks right', () => {
    // At 20 kHz the wait after Clear display is 1.2 ms: the entry mode that follows is lost —
    // harmless here (Clear already set I/D), a bug waiting on the bench.
    const sim = at(2 * MAX_STEP_HZ, ms(30));
    expect(sim.diagnostics.entries.map((d) => d.kind)).toContain('busy-violation');
    expect(text(sim)).toEqual([LINE_1.padEnd(16), LINE_2.padEnd(16)]);
  });
});

describe('LCD by Hand', () => {
  /** Sets the DATA switches to `byte` (S1 = DB0). */
  function data(sim: Simulator, byte: number) {
    for (let i = 0; i < 8; i++) {
      sim.action('SW1', { type: 'set', index: i, on: ((byte >> i) & 1) === 1 });
      sim.runFor(ms(1));
    }
  }

  it("takes Ben Eater's instructions from the switches, then letters with RS on", () => {
    const sim = load('lcd-by-hand');
    sim.runFor(ms(20));
    click(sim, 'SW3'); // DATA starts at 0x38: function set, 8-bit, 2 lines
    for (const byte of [0x0e, 0x06]) {
      data(sim, byte);
      click(sim, 'SW3');
    }
    sim.action('SW2', { type: 'toggle' }); // RS: data
    sim.runFor(ms(1));
    for (const ch of 'Hi!') {
      data(sim, ch.charCodeAt(0));
      click(sim, 'SW3');
    }
    expect(text(sim)).toEqual([`Hi!${' '.repeat(13)}`, ' '.repeat(16)]);
    const c = hd44780Controller(sim.stateOf('DS1'))!;
    expect([c.n, c.d, c.c, c.ac]).toEqual([1, 1, 1, 3]);
    expect(kinds(sim)).toEqual([]);
  });
});

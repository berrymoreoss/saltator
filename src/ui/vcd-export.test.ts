import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { ns, us } from '../core';
import { Editor, type SimClock, SPEEDS } from '../editor';
import { createDefaultRegistry } from '../library';
import { formatSpan, vcdFile, vcdFileName, vcdSpan } from './vcd-export';

const registry = createDefaultRegistry();

/** A wall clock and frame scheduler under the test's control. */
class TestClock implements SimClock {
  time = 0;
  #frames: (() => void)[] = [];
  now = () => this.time;
  requestFrame(callback: () => void): () => void {
    this.#frames.push(callback);
    return () => {
      this.#frames = this.#frames.filter((f) => f !== callback);
    };
  }
  frames(count: number): void {
    for (let i = 0; i < count; i++) {
      this.time += 16;
      const frames = this.#frames;
      this.#frames = [];
      for (const f of frames) f();
    }
  }
}

function setup(probes = true) {
  const b = new CircuitBuilder(registry).add('X1', 'io/clock', {
    at: [0, 0],
    props: { frequency: 1e6 },
  });
  if (probes) b.probe({ ref: 'X1.Y', name: 'CLK' }).probe({ ref: 'Q9.Y' });
  const clock = new TestClock();
  const editor = new Editor(registry, b.build(), {}, { simulation: { clock } });
  editor.simulation.setSpeed(SPEEDS.find((s) => s.id === '1us')!);
  return { clock, editor };
}

const options = { range: 'all' as const, title: 'Clock: test', date: 'today', version: 'Saltator' };

describe('vcdFile', () => {
  it('says why there is nothing to export', () => {
    expect(vcdFile(setup(false).editor.analyzer, options)).toBe(
      'Nothing to export: probe some signals first.',
    );
    expect(vcdFile(setup().editor.analyzer, options)).toBe(
      'Nothing recorded yet: run the simulation first.',
    );
  });

  it('dumps the probes that resolve over the whole record or between the cursors', () => {
    const { clock, editor } = setup();
    editor.simulation.run();
    clock.frames(100); // 1.6 µs
    editor.simulation.pause();
    const { analyzer } = editor;
    expect(vcdSpan(analyzer, 'cursors')).toBeUndefined();
    expect(vcdFile(analyzer, { ...options, range: 'cursors' })).toBe(
      'Place cursors A and B to export the span between them.',
    );
    const all = vcdFile(analyzer, options);
    if (typeof all === 'string') throw new Error(all);
    expect(all).toMatchObject({ name: 'Clock_ test.vcd', signals: 1, from: 0, to: us(1.6) });
    expect(all.text).toContain('$var wire 1 ! CLK $end');
    expect(all.text).toContain('$scope module Clock__test $end');
    expect(all.text).toContain('#500000\n1!');

    analyzer.setCursor('A', ns(1200));
    analyzer.setCursor('B', ns(400));
    expect(formatSpan(vcdSpan(analyzer, 'cursors')!)).toBe('400 ns – 1.2 µs');
    const span = vcdFile(analyzer, { ...options, range: 'cursors' });
    if (typeof span === 'string') throw new Error(span);
    expect(span.text.split('$enddefinitions $end\n')[1]).toBe(
      [
        '#400000',
        '$dumpvars',
        '0!',
        '$end',
        '#500000',
        '1!',
        '#1000000',
        '0!',
        '#1200000',
        '',
      ].join('\n'),
    );
  });

  it('names the file after the document', () => {
    expect(vcdFileName('Data Bus')).toBe('Data Bus.vcd');
    expect(vcdFileName('a/b:c')).toBe('a_b_c.vcd');
    expect(vcdFileName('  ')).toBe('waveforms.vcd');
  });
});

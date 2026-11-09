import { describe, expect, it } from 'vitest';
import { defineComponent } from './component';
import { Drive, Level, not, strong } from './logic';
import { NetlistBuilder } from './netlist';
import { Recorder } from './recorder';
import { Registry } from './registry';
import { Simulator } from './simulator';
import { ns } from './time';
import { vcdIdentifier, vcdName, writeVcd } from './vcd';

/** Toggles every 10 ns from 0 at t = 0. */
const clock = defineComponent<Record<string, never>, { level: Level }>({
  type: 'test/clock',
  name: 'CLK',
  title: 'Clock',
  pins: [{ name: 'Y', dir: 'out' }],
  create: () => ({
    createState: () => ({ level: Level.L0 }),
    init(ctx) {
      ctx.drive(0, Drive.STRONG_0, 0);
      ctx.wakeAfter(ns(10));
    },
    wake(ctx) {
      ctx.state.level = not(ctx.state.level);
      ctx.drive(0, strong(ctx.state.level), 0);
      ctx.wakeAfter(ns(10));
    },
  }),
});

const source = defineComponent({
  type: 'test/source',
  name: 'S',
  title: 'Source',
  pins: [{ name: 'Y', dir: 'tristate' }],
  create: () => ({
    action(ctx, payload) {
      ctx.drive(0, payload as Drive, 0);
    },
  }),
});

const registry = new Registry([clock, source]);

/** CLK, and a 2-bit bus D0, D1 floating until 5 ns, then 1 (5 ns) and 2 (15 ns); 25 ns long. */
function recorded() {
  const netlist = new NetlistBuilder()
    .add('C', 'test/clock')
    .net('CLK', 'C.Y')
    .add('S0', 'test/source')
    .net('D0', 'S0.Y')
    .add('S1', 'test/source')
    .net('D1', 'S1.Y')
    .build();
  const sim = new Simulator(netlist, registry);
  const recorder = new Recorder();
  const clk = recorder.addChannel();
  const d0 = recorder.addChannel();
  const d1 = recorder.addChannel();
  recorder.attach(
    sim,
    new Map([
      [clk, sim.netIndex('CLK')],
      [d0, sim.netIndex('D0')],
      [d1, sim.netIndex('D1')],
    ]),
  );
  sim.runUntil(ns(5));
  sim.action('S0', Drive.STRONG_1);
  sim.action('S1', Drive.STRONG_0);
  sim.runUntil(ns(15));
  sim.action('S0', Drive.STRONG_0);
  sim.action('S1', Drive.STRONG_1);
  sim.runUntil(ns(25));
  return { recorder, clk, d0, d1 };
}

describe('writeVcd', () => {
  it('dumps 1-bit wires and vectors from the start of the record to its end', () => {
    const { recorder, clk, d0, d1 } = recorded();
    const text = writeVcd(
      recorder,
      [
        { name: 'CLK', channels: [clk] },
        { name: 'D[0..1]', channels: [d0, d1] },
        { name: '~{RD}', channels: [clk] },
      ],
      { scope: 'Main Board', date: '2026-11-07 21:00', version: 'Saltator 0.1' },
    );
    expect(text).toBe(
      [
        '$date',
        '  2026-11-07 21:00',
        '$end',
        '$version',
        '  Saltator 0.1',
        '$end',
        '$timescale 1ps $end',
        '$scope module Main_Board $end',
        '$var wire 1 ! CLK $end',
        '$var wire 2 " D [1:0] $end',
        '$var wire 1 # RD_n $end',
        '$upscope $end',
        '$enddefinitions $end',
        '#0',
        '$dumpvars',
        '0!',
        'bzz "',
        '0#',
        '$end',
        '#5000',
        'b01 "',
        '#10000',
        '1!',
        '1#',
        '#15000',
        'b10 "',
        '#20000',
        '0!',
        '0#',
        '#25000',
        '',
      ].join('\n'),
    );
  });

  it('dumps a range: the values at its start, the changes inside, its end', () => {
    const { recorder, clk, d0, d1 } = recorded();
    const text = writeVcd(
      recorder,
      [
        { name: 'CLK', channels: [clk] },
        { name: 'D', channels: [d0, d1] },
      ],
      { from: ns(12), to: ns(18) },
    );
    expect(text.split('$enddefinitions $end\n')[1]).toBe(
      ['#12000', '$dumpvars', '1!', 'b01 "', '$end', '#15000', 'b10 "', '#18000', ''].join('\n'),
    );
    expect(text.startsWith('$timescale 1ps $end\n$scope module logic $end\n')).toBe(true);
  });

  it('writes x where a channel has no data, and ends on its last change without a repeat', () => {
    const recorder = new Recorder();
    const none = recorder.addChannel();
    const { recorder: full, clk } = recorded();
    expect(writeVcd(recorder, [{ name: 'A', channels: [none] }])).toContain('$dumpvars\nx!\n$end');
    const text = writeVcd(full, [{ name: 'CLK', channels: [clk] }], { to: ns(20) });
    expect(text.endsWith('#20000\n0!\n')).toBe(true);
  });

  it('leaves out changes a dump can’t tell apart: X, then no data, are both x', () => {
    const netlist = new NetlistBuilder().add('S0', 'test/source').net('D0', 'S0.Y').build();
    const sim = new Simulator(netlist, registry);
    const recorder = new Recorder();
    const d0 = recorder.addChannel();
    recorder.attach(sim, new Map([[d0, sim.netIndex('D0')]]));
    sim.runUntil(ns(5));
    sim.action('S0', Drive.STRONG_X);
    sim.runUntil(ns(8));
    recorder.attach(sim, new Map()); // its net is gone: no data from 8 ns
    sim.runUntil(ns(10));
    const body = writeVcd(recorder, [{ name: 'D0', channels: [d0] }])
      .split('$end\n')
      .at(-1);
    expect(body).toBe('#5000\nx!\n#10000\n');
  });

  it('gives every signal a unique name and identifier', () => {
    const { recorder, clk } = recorded();
    const text = writeVcd(recorder, [
      { name: 'CLK', channels: [clk] },
      { name: 'CLK', channels: [clk] },
    ]);
    expect(text).toContain('$var wire 1 ! CLK $end\n$var wire 1 " CLK_2 $end');
  });
});

describe('vcdName and vcdIdentifier', () => {
  it('makes names VCD readers take as one reference', () => {
    expect(vcdName('CLK')).toBe('CLK');
    expect(vcdName('~{RD}')).toBe('RD_n');
    expect(vcdName('~{CE}1')).toBe('CE_n1');
    expect(vcdName('D[0..7]')).toBe('D');
    expect(vcdName('U1.Q0')).toBe('U1_Q0');
    expect(vcdName('program counter')).toBe('program_counter');
    expect(vcdName('7SEG')).toBe('_7SEG');
    expect(vcdName('')).toBe('_');
  });

  it('counts identifiers in printable ASCII, longer ones after the 94 single characters', () => {
    expect(vcdIdentifier(0)).toBe('!');
    expect(vcdIdentifier(93)).toBe('~');
    expect(vcdIdentifier(94)).toBe('!!');
    expect(vcdIdentifier(95)).toBe('"!');
    const ids = Array.from({ length: 20_000 }, (_, i) => vcdIdentifier(i));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[!-~]+$/.test(id))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  documentRegistry,
  emptyVerilogCircuit,
  type Point,
  SCHEMA_VERSION,
} from '../circuit';
import { formatImage, ns, placeImage, readIntelHex } from '../core';
import { createDefaultRegistry, fromYosys } from '../library';
import { YOSYS_FIXTURES } from '../library/hdl/fixtures';
import { Editor } from './editor';
import { FakeClock } from './fake-clock';
import { ACCESS_FADE_MS, memorySize, STOPPED_MODULE_MEMORY, STOPPED_RAM } from './memory-inspector';
import { MAX_SPEED } from './simulation';

const registry = createDefaultRegistry();

/** Adds a net label named `name` whose point is on pin `pin` (no wire needed). */
function label(b: CircuitBuilder, id: string, name: string, pin: string): CircuitBuilder {
  const probe = new CircuitBuilder(registry).add('L', 'net/label', { at: [0, 0], props: { name } });
  const [dx, dy] = probe.pin('L.N');
  const [x, y] = b.pin(pin);
  return b.add(id, 'net/label', { at: [x - dx, y - dy] as Point, props: { name } });
}

/**
 * U1: an AT28C16 holding A5 5A at 0 and 3C at 5, always reading; U2: a 6116 reading at the
 * same address, its outputs on. A1–A10 LOW; SW1 sets A0 of both.
 */
function circuit(): Circuit {
  const b = new CircuitBuilder(registry)
    .add('U1', 'mem/at28c16', { at: [10, 0], props: { contents: '0000:A55A 0005:3C' } })
    .add('U2', 'mem/6116', { at: [40, 0] })
    .add('SW1', 'io/switch', { at: [0, 40] })
    .add('PWR1', 'io/gnd', { at: [0, 50] })
    .add('PWR2', 'io/vcc', { at: [10, 50] });
  let n = 0;
  label(b, `NL${++n}`, 'A0', 'SW1.Y');
  for (const [u, select] of [
    ['U1', 'CE'],
    ['U2', 'CS'],
  ] as const) {
    label(b, `NL${++n}`, 'A0', `${u}.A0`);
    for (let i = 1; i < 11; i++) label(b, `NL${++n}`, 'GND', `${u}.A${i}`);
    label(b, `NL${++n}`, 'GND', `${u}.${select}`);
    label(b, `NL${++n}`, 'GND', `${u}.OE`);
    label(b, `NL${++n}`, 'VCC', `${u}.WE`);
  }
  return b.build();
}

function setup() {
  const clock = new FakeClock();
  const editor = new Editor(registry, circuit(), {}, { simulation: { clock } });
  return { clock, editor, inspector: editor.memory, simulation: editor.simulation };
}

const contentsOf = (editor: Editor, id: string) =>
  editor.state.get().circuit.components.find((c) => c.id === id)!.props.contents;

describe('MemoryInspector: memories and cells', () => {
  it('lists the memories of the circuit in designator order, with their size', () => {
    const { inspector } = setup();
    expect(inspector.memories().map((m) => [m.label, m.volatile])).toEqual([
      ['U1 · AT28C16 · 2K × 8', false],
      ['U2 · 6116 · 2K × 8', true],
    ]);
    expect(inspector.entry('U2')!.addressPins).toHaveLength(11);
    expect([memorySize(32768, 8), memorySize(16, 4), memorySize(1000, 8)]).toEqual([
      '32K × 8',
      '16 × 4',
      '1000 × 8',
    ]);
  });

  it('follows the document', () => {
    const { editor, inspector } = setup();
    editor.renamePart('U2', 'U10');
    expect(inspector.memories().map((m) => m.id)).toEqual(['U1', 'U10']);
  });

  it('shows a stopped ROM’s image and says why a stopped RAM shows nothing', () => {
    const { inspector } = setup();
    const rom = inspector.cells('U1');
    expect(rom.kind).toBe('image');
    expect([...(rom as { data: Uint8Array }).data.subarray(0, 6)]).toEqual([
      0xa5, 0x5a, 0xff, 0xff, 0xff, 0x3c,
    ]);
    expect(inspector.cells('U2')).toEqual({ kind: 'none', reason: STOPPED_RAM });
    expect(inspector.cells('U9')).toEqual({ kind: 'none', reason: 'No memory U9 in the circuit.' });
    expect(inspector.address('U1')).toBeUndefined();
  });

  it('shows the live cells and the address on the pins while simulating', () => {
    const { clock, inspector, simulation } = setup();
    simulation.run();
    clock.frame(16);
    const ram = inspector.cells('U2');
    expect(ram.kind).toBe('live');
    expect((ram as { view: { unknown: Uint8Array } }).view.unknown[0]).toBe(0xff); // powers on X
    expect(inspector.address('U1')).toEqual({ value: 0, text: '0x000' });
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(inspector.address('U2')).toEqual({ value: 1, text: '0x001' });
  });
});

describe('MemoryInspector: access highlighting', () => {
  it('lights a cell read in the latest frame and fades it out over the fade time', () => {
    const { clock, inspector, simulation } = setup();
    simulation.run();
    clock.frame(16);
    const view = (inspector.cells('U1') as { view: { readAt: Float64Array } }).view;
    expect(view.readAt[0]).toBe(ns(150));
    expect(inspector.intensity(view.readAt[0]!)).toBe(1);
    expect(inspector.fading).toBe(true);
    clock.frames(15, 16); // 240 ms later
    expect(inspector.intensity(view.readAt[0]!)).toBeCloseTo(1 - 240 / ACCESS_FADE_MS, 5);
    clock.frames(20, 16);
    expect(inspector.intensity(view.readAt[0]!)).toBe(0);
    expect(inspector.intensity(view.readAt[1]!)).toBe(0); // never read
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(inspector.intensity(view.readAt[1]!)).toBe(1);
    expect(inspector.intensity(view.readAt[0]!)).toBe(0);
  });

  it('keeps cells read in every frame lit', () => {
    const { clock, inspector, simulation } = setup();
    simulation.run();
    clock.frame(16);
    const view = (inspector.cells('U1') as { view: { readAt: Float64Array } }).view;
    for (let frame = 0; frame < 20; frame++) {
      simulation.action('SW1', { type: 'toggle' }); // the address flips 0 ↔ 1 every frame
      clock.frame(16);
      if (frame === 0) continue;
      expect(inspector.intensity(view.readAt[0]!)).toBeGreaterThan(0.9);
      expect(inspector.intensity(view.readAt[1]!)).toBeGreaterThan(0.9);
    }
  });

  it('while paused, keeps what the last step touched lit', () => {
    const { clock, inspector, simulation } = setup();
    simulation.step(); // power-on at t = 0
    while (simulation.simulator!.now < ns(150)) simulation.step();
    const view = (inspector.cells('U1') as { view: { readAt: Float64Array } }).view;
    clock.frame(2000);
    simulation.setSpeed(MAX_SPEED); // a state change while paused, no time passing
    expect(inspector.intensity(view.readAt[0]!)).toBe(1);
    expect(inspector.fading).toBe(false);
  });

  it('starts over when the simulation powers on again', () => {
    const { clock, inspector, simulation } = setup();
    simulation.run();
    clock.frames(40, 16);
    simulation.reset();
    clock.frame(16);
    const view = (inspector.cells('U1') as { view: { readAt: Float64Array } }).view;
    expect(inspector.intensity(view.readAt[0]!)).toBe(1);
  });
});

describe('MemoryInspector: after a rewind', () => {
  it('shows the cells as they were and lights none of them until something runs', () => {
    const { clock, inspector, simulation } = setup();
    simulation.step(); // power-on
    simulation.runTo({ kind: 'time', until: ns(500), label: 'Run To' });
    simulation.action('U2', { type: 'poke', address: 0, data: [0x11] });
    simulation.runTo({ kind: 'time', until: ns(1000), label: 'Run To' });
    simulation.action('U2', { type: 'poke', address: 0, data: [0x22] });
    simulation.runTo({ kind: 'time', until: ns(1500), label: 'Run To' });
    const view = () =>
      (inspector.cells('U2') as { view: { data: Uint8Array; writtenAt: Float64Array } }).view;
    expect(view().data[0]).toBe(0x22);
    clock.frame(16);
    simulation.rewindTo(ns(800));
    expect(view().data[0]).toBe(0x11);
    expect(view().writtenAt[0]).toBe(ns(500));
    expect(inspector.intensity(view().writtenAt[0]!)).toBe(0);
    // The replay writes 0x22 again at 1 µs: news once it happens.
    simulation.runTo({ kind: 'time', until: ns(1200), label: 'Run To' });
    expect(view().data[0]).toBe(0x22);
    expect(inspector.intensity(view().writtenAt[0]!)).toBe(1);
  });
});

describe('MemoryInspector: edits', () => {
  it('writes a ROM’s image as one undo step per run of edits, stopped or running', () => {
    const { clock, editor, inspector, simulation } = setup();
    expect(inspector.write('U1', 2, [0x12])).toBeUndefined();
    expect(inspector.write('U1', 3, [0x34])).toBeUndefined();
    expect(contentsOf(editor, 'U1')).toBe('0000:A55A1234FF3C');
    expect(editor.history.get().past.map((e) => e.label)).toEqual(['Edit U1 contents']);
    simulation.run();
    clock.frame(16);
    expect(inspector.write('U1', 0, [0x77])).toBeUndefined();
    clock.frame(16);
    const view = (inspector.cells('U1') as { view: { data: Uint8Array } }).view;
    expect(view.data[0]).toBe(0x77); // the running ROM restarted from its new image
    expect(simulation.simulator!.pinLevel('U1', 'IO0')).toBe(1);
    editor.undo();
    expect(contentsOf(editor, 'U1')).toBe('0000:A55A 0005:3C');
  });

  it('pokes a simulated RAM without touching the document; refuses a stopped one', () => {
    const { clock, editor, inspector, simulation } = setup();
    expect(inspector.write('U2', 0, [0x42])).toBe(STOPPED_RAM);
    simulation.run();
    clock.frame(16);
    expect(inspector.write('U2', 0, [0x42, 0x43])).toBeUndefined();
    const view = (inspector.cells('U2') as { view: { data: Uint8Array; writtenAt: Float64Array } })
      .view;
    expect([view.data[0], view.data[1]]).toEqual([0x42, 0x43]);
    expect(inspector.intensity(view.writtenAt[0]!)).toBe(1);
    expect(editor.history.get().past).toEqual([]);
  });

  it('refuses bytes outside the memory or out of range', () => {
    const { inspector } = setup();
    expect(inspector.write('U1', 2047, [1, 2])).toBe('U1 holds bytes 0x00–0xFF at 0–2047.');
    expect(inspector.write('U1', 0, [256])).toBe('U1 holds bytes 0x00–0xFF at 0–2047.');
    expect(inspector.write('U9', 0, [1])).toBe('No memory U9 in the circuit.');
  });

  it('loads an image file as one step, erases a ROM, and gives the bytes to save', () => {
    const { clock, editor, inspector, simulation } = setup();
    const file = readIntelHex(':03001000010203E7\n:00000001FF');
    const writes = placeImage(file, 2048, { at: 0x10, eraseRest: true });
    expect(inspector.load('U1', writes as never)).toBeUndefined();
    expect(contentsOf(editor, 'U1')).toBe('0010:010203');
    expect(inspector.erase('U1')).toBeUndefined();
    expect(contentsOf(editor, 'U1')).toBe('');
    expect(editor.history.get().past.map((e) => e.label)).toEqual([
      'Load image into U1',
      'Erase U1',
    ]);
    expect(inspector.erase('U2')).toBe("U2 is a RAM: it can't be erased.");
    expect(inspector.contents('U2')).toBe(STOPPED_RAM);
    const rom = inspector.contents('U1') as { bytes: Uint8Array; unknownBytes: number };
    expect(formatImage(rom.bytes)).toBe('');
    simulation.run();
    clock.frame(16);
    expect(inspector.load('U2', [{ address: 4, bytes: new Uint8Array([9]) }])).toBeUndefined();
    const ram = inspector.contents('U2') as { bytes: Uint8Array; unknownBytes: number };
    expect([ram.bytes[4], ram.unknownBytes]).toEqual([9, 2047]);
  });
});

describe("MemoryInspector: a module's memories (HDL-6)", () => {
  /** mem_regfile as A1 (8 × 8), mem_word32 as A2 (16 × 32), mem_offset as A3 (m[16:25]). */
  function withModules() {
    const modules = ['mem_regfile', 'mem_word32', 'mem_offset'].map((name): Circuit => {
      const { module } = fromYosys(YOSYS_FIXTURES[name]);
      return { ...emptyVerilogCircuit(name.replace('_', '-'), name), verilog: { module } };
    });
    const draft: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: modules };
    const main = new CircuitBuilder(documentRegistry(draft, registry))
      .add('A1', 'sub/mem-regfile', { at: [0, 0] })
      .add('A2', 'sub/mem-word32', { at: [0, 40] })
      .add('A3', 'sub/mem-offset', { at: [0, 80] })
      .build();
    const clock = new FakeClock();
    const document: CircuitDocument = {
      schemaVersion: SCHEMA_VERSION,
      circuits: [main, ...modules],
    };
    const editor = new Editor(registry, document, {}, { simulation: { clock } });
    return { editor, inspector: editor.memory, simulation: editor.simulation };
  }

  it('lists them by name inside their instance, the part holding them apart', () => {
    const { inspector } = withModules();
    expect(
      inspector.memories().map((m) => [m.label, m.part, m.offset, m.bytes, m.volatile]),
    ).toEqual([
      ['A1/regs · mem_regfile · 8 × 8', 'A1/U1', 0, 8, true],
      ['A2/ram · mem_word32 · 16 × 32', 'A2/U1', 0, 64, true],
      ['A3/m · mem_offset · 10 × 8', 'A3/U1', 16, 10, true],
    ]);
    expect(inspector.address('A1/regs')).toBeUndefined();
  });

  it('shows the power-up contents while stopped, read-only', () => {
    const { inspector } = withModules();
    const cells = inspector.cells('A3/m');
    expect(cells.kind).toBe('power-up');
    if (cells.kind !== 'power-up') return;
    expect([...cells.data.slice(0, 3)]).toEqual([16, 17, 18]);
    expect(inspector.cells('A1/regs')).toMatchObject({ kind: 'power-up' });
    expect(inspector.write('A3/m', 0, [1])).toBe(STOPPED_MODULE_MEMORY);
    expect(inspector.contents('A3/m')).toMatchObject({ unknownBytes: 0 });
  });

  it('takes edits and loads while simulating: words, bytes of wider words, files little-endian', () => {
    const { inspector, simulation } = withModules();
    simulation.step(); // power-on at t = 0
    expect(inspector.write('A1/regs', 2, [0x42])).toBeUndefined();
    const live = (id: string) => {
      const cells = inspector.cells(id);
      if (cells.kind !== 'live') throw new Error(`${id} is not live`);
      return cells.view;
    };
    expect(live('A1/regs').data[2]).toBe(0x42);
    expect(live('A1/regs').unknown[2]).toBe(0);
    expect(inspector.write('A1/regs', 2, [0x100])).toBe('A1/regs holds bytes 0x00–0xFF at 0–7.');
    expect(inspector.write('A2/ram', 1, [0xdeadbeef])).toBeUndefined();
    expect(inspector.writeByte('A2/ram', 1, 0, 0x11)).toBeUndefined();
    expect(live('A2/ram').data[1]).toBe(0xdeadbe11);
    expect(inspector.write('A2/ram', 16, [1])).toBe(
      'A2/ram holds words 0x00000000–0xFFFFFFFF at 0–F.',
    );
    expect(inspector.load('A2/ram', [{ address: 8, bytes: Uint8Array.from([1, 2, 3, 4]) }])).toBe(
      undefined,
    );
    expect(live('A2/ram').data[2]).toBe(0x04030201);
    const saved = inspector.contents('A2/ram');
    if (typeof saved === 'string') throw new Error(saved);
    expect([...saved.bytes.slice(4, 12)]).toEqual([0x11, 0xbe, 0xad, 0xde, 1, 2, 3, 4]);
    expect(inspector.write('A3/m', 0, [0x55])).toBeUndefined();
    expect(live('A3/m').data[0]).toBe(0x55);
    // Reset powers on again: the contents Yosys read are back, the edits gone.
    simulation.reset();
    expect(live('A3/m').data[0]).toBe(16);
    expect(live('A2/ram').unknown[1]).toBe(0xffffffff);
  });

  it("is watched in the Debug tab at the memory's own addresses", () => {
    const { editor, simulation } = withModules();
    expect(editor.debug.addWatch('A3/m[11]')).toBeUndefined();
    expect(editor.debug.addWatch('A3/m[1]')).toBe('A3/m[1]: The first address is 10.');
    simulation.step();
    expect(editor.debug.watches.get().map((w) => [w.reference, w.value])).toEqual([
      ['A3/m[0x11]', '0x11'],
    ]);
  });
});

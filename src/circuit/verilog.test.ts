import { describe, expect, it } from 'vitest';
import { type HdlModule, levelChar, ns, pinsOf, Registry, Simulator, symbolOf } from '../core';
import { compileCircuit } from './compile';
import { CompileCache, compileDesign } from './design';
import {
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  emptyVerilogCircuit,
  SCHEMA_VERSION,
} from './document';
import { partLayout, placementOf, placePins } from './layout';
import { circuitPorts, documentRegistry } from './subcircuit';
import { testAnd, testHigh, testModule, testRegistry } from './test-parts';

const library = testRegistry();

const part = (
  id: string,
  type: string,
  x: number,
  y: number,
  props: Record<string, string | number> = {},
): ComponentInstance => ({ id, type, x, y, rotation: 0, flip: false, props });

const vgate: Circuit = { ...emptyVerilogCircuit('vgate', 'Gate'), verilog: { module: testModule } };
const main = (components: ComponentInstance[]): Circuit => ({
  id: 'main',
  name: 'Main',
  components,
  wires: [],
  probes: [],
  testScript: [],
});
const doc = (...circuits: Circuit[]): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits,
});

/** Where pin `pin` of instance `id` of the top circuit is. */
function pinAt(document: CircuitDocument, id: string, pin: string): [number, number] {
  const registry = documentRegistry(document, library);
  const instance = document.circuits[0]!.components.find((c) => c.id === id)!;
  const definition = registry.get(instance.type)!;
  const placed = placePins(partLayout(definition, {}), placementOf(instance));
  return placed.find((p) => p.name === pin)!.at as [number, number];
}

describe('a Verilog module as a circuit', () => {
  it('has its ports as pins: declaration order, inputs left, outputs right, vectors as buses', () => {
    expect(circuitPorts(vgate, library).map((p) => [p.name, p.direction, p.side, p.bus])).toEqual([
      ['clk', 'in', 'left', false],
      ['a', 'in', 'left', false],
      ['b', 'in', 'left', false],
      ['d[1..0]', 'in', 'left', true],
      ['y', 'out', 'right', false],
      ['q', 'out', 'right', false],
      ['e[1..0]', 'out', 'right', true],
    ]);
    expect(circuitPorts(emptyVerilogCircuit('v', 'V'), library)).toEqual([]);
  });

  it('gets an instance definition with bus pins and the delay, and its part to run', () => {
    const registry = documentRegistry(doc(main([]), vgate), library);
    const instance = registry.get('sub/vgate')!;
    expect(instance.title).toBe('Verilog module: clk, a, b, d[1..0] → y, q, e[1..0]');
    expect(instance.props?.map((p) => [p.key, p.default])).toEqual([['delay', ns(15)]]);
    expect(pinsOf(instance, {}).map((p) => `${p.name}:${p.dir}${p.bus ? ':bus' : ''}`)).toEqual([
      'clk:in',
      'a:in',
      'b:in',
      'd[1..0]:nc:bus',
      'y:out',
      'q:out',
      'e[1..0]:nc:bus',
    ]);
    expect(symbolOf(instance, {})?.kind).toBe('subcircuit');
    expect(registry.get('hdl/vgate')?.type).toBe('hdl/vgate');
    expect(registry.modulePart('vgate')?.messages).toEqual([]);
    expect(registry.list().map((d) => d.type)).not.toContain('hdl/vgate');
    expect(registry.hdlPart).toBe(library.hdlPart);
  });

  it('keeps its part while the IR and the name stay, and makes a new one when they change', () => {
    const first = documentRegistry(doc(main([]), vgate), library);
    const part1 = first.get('hdl/vgate');
    const edited = documentRegistry(
      doc(main([part('H1', 'test/high', 0, 0)]), vgate),
      library,
      first,
    );
    expect(edited.get('hdl/vgate')).toBe(part1);
    const copy: HdlModule = { ...testModule };
    const recompiled = documentRegistry(
      doc(main([]), { ...vgate, verilog: { module: copy } }),
      library,
      edited,
    );
    expect(recompiled.get('hdl/vgate')).not.toBe(part1);
    // The instance's definition stays: same name and ports.
    expect(recompiled.get('sub/vgate')).toBe(first.get('sub/vgate'));
  });

  it('compiles on its own to one part U1 and a net per port bit', () => {
    const result = compileCircuit(vgate, documentRegistry(doc(main([]), vgate), library));
    expect(result.netlist.components).toEqual([{ id: 'U1', type: 'hdl/vgate' }]);
    expect(result.netlist.nets.map((n) => n.id)).toEqual([
      'clk',
      'a',
      'b',
      'd0',
      'd1',
      'y',
      'q',
      'e0',
      'e1',
    ]);
    expect(result.nets[3]).toMatchObject({ id: 'd0', names: ['d0'] });
    expect(result.issues).toEqual([]);
  });

  it('says when it is not compiled yet, and when its part has errors or warnings', () => {
    const empty = compileCircuit(emptyVerilogCircuit('v', 'V'), library);
    expect(empty.netlist).toEqual({ components: [], nets: [] });
    expect(empty.issues).toEqual([
      {
        severity: 'warning',
        code: 'hdl-not-compiled',
        message: 'not compiled yet: paste the JSON Yosys made, then Compile',
      },
    ]);
    const failing = new Registry([], {
      hdlPart: () => ({
        messages: [
          { severity: 'warning', message: 'a latch is inferred for q', src: 'g.v:5.1-5.9' },
          { severity: 'error', message: 'a combinational loop through y', src: 'g.v:4.1-4.9' },
        ],
      }),
    });
    const result = compileCircuit(vgate, failing);
    expect(result.netlist.components).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        severity: 'error',
        code: 'hdl-error',
        message: 'g.v:4.1-4.9: a combinational loop through y',
        src: 'g.v:4.1-4.9',
      },
      {
        severity: 'warning',
        code: 'hdl-warning',
        message: 'g.v:5.1-5.9: a latch is inferred for q',
        src: 'g.v:5.1-5.9',
      },
    ]);
    expect(compileCircuit(vgate, new Registry([testAnd])).issues[0]?.message).toBe(
      'Verilog modules need a parts library that runs them',
    );
  });
});

describe('a Verilog module placed in a circuit', () => {
  const placed = (props: Record<string, number> = {}) => {
    const shell = doc(
      main([part('H1', 'test/high', 0, 0), part('A1', 'sub/vgate', 20, 0, props)]),
      vgate,
    );
    const label = (id: string, name: string, at: [number, number], type = 'test/label') =>
      part(id, type, at[0], at[1], { name });
    const top = shell.circuits[0]!;
    return doc(
      main([
        ...top.components,
        label('NL1', 'HIGH', pinAt(shell, 'H1', 'Y')),
        label('NL2', 'HIGH', pinAt(shell, 'A1', 'a')),
        label('NL3', 'HIGH', pinAt(shell, 'A1', 'b')),
        label('NL4', 'HIGH', pinAt(shell, 'A1', 'clk')),
        label('BL1', 'D[1..0]', pinAt(shell, 'A1', 'd[1..0]'), 'test/bus-label'),
        label('BL2', 'D[1..0]', pinAt(shell, 'A1', 'e[1..0]'), 'test/bus-label'),
      ]),
      vgate,
    );
  };

  it('flattens to its part A1/U1 with the instance delay, joined to the outer nets', () => {
    const design = compileDesign(placed({ delay: ns(5) }), library);
    expect(design.netlist.components).toEqual([
      { id: 'H1', type: 'test/high' },
      { id: 'A1/U1', type: 'hdl/vgate', props: { delay: ns(5) } },
    ]);
    const pins = (id: string) => design.netlist.nets.find((n) => n.id === id)?.pins;
    expect(pins('HIGH')).toEqual([
      { component: 'H1', pin: 'Y' },
      { component: 'A1/U1', pin: 'clk' },
      { component: 'A1/U1', pin: 'a' },
      { component: 'A1/U1', pin: 'b' },
    ]);
    // A bus at its bus pins joins bit by bit: e = d, so D0 and D1 loop back.
    expect(pins('D0')).toEqual([
      { component: 'A1/U1', pin: 'd0' },
      { component: 'A1/U1', pin: 'e0' },
    ]);
    expect(design.instances).toEqual([
      { path: 'A1', designator: 'A1', parent: '', circuit: 'vgate' },
    ]);
    expect(design.ok).toBe(true);
    const sim = new Simulator(design.netlist, design.registry);
    sim.settle();
    expect(levelChar(sim.pinLevel('A1/U1', 'y'))).toBe('1');
  });

  it("gives its part no props when the instance has none (the part's default delay)", () => {
    const design = compileDesign(placed(), library);
    expect(design.netlist.components[1]).toEqual({ id: 'A1/U1', type: 'hdl/vgate' });
  });

  it('runs as the top circuit, its port bits named nets', () => {
    const design = compileDesign(doc(main([]), vgate), library, { top: 'vgate' });
    expect(design.netlist.components).toEqual([{ id: 'U1', type: 'hdl/vgate' }]);
    expect(design.netOf('', 'd1')).toBe('d1');
  });

  it('reports its errors in its circuit, and leaves its part out', () => {
    const failing = new Registry([testHigh], {
      hdlPart: () => ({ messages: [{ severity: 'error', message: 'no' }] }),
    });
    const design = compileDesign(placed(), failing);
    expect(design.ok).toBe(false);
    expect(design.issues.filter((i) => i.code === 'hdl-error')).toEqual([
      { severity: 'error', code: 'hdl-error', message: 'no', circuit: 'vgate' },
    ]);
    expect(design.netlist.components.map((c) => c.id)).toEqual(['H1']);
  });

  it('is compiled again when its part changes, and kept while it does not', () => {
    const cache = new CompileCache();
    const document = placed();
    const first = compileDesign(document, library, { cache });
    const again = compileDesign({ ...document }, library, { cache });
    expect(again.circuits.get('vgate')).toBe(first.circuits.get('vgate'));
    const recompiled = doc(document.circuits[0]!, {
      ...vgate,
      verilog: { module: { ...testModule } },
    });
    const third = compileDesign(recompiled, library, { cache });
    expect(third.circuits.get('vgate')).not.toBe(first.circuits.get('vgate'));
  });
});

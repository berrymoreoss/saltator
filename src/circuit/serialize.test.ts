import { describe, expect, it } from 'vitest';
import { type CircuitDocument, emptyDocument } from './document';
import { parseDocument } from './schema';
import { serializeDocument } from './serialize';
import { testModule } from './test-parts';

const document: CircuitDocument = {
  schemaVersion: 7,
  circuits: [
    {
      id: 'main',
      name: 'Latch "SR"',
      components: [
        { id: 'U1', type: 'prim/nand', x: 10, y: 4, rotation: 0, flip: false, props: {} },
        {
          id: 'U2',
          type: 'prim/nand',
          label: 'Q̅ side',
          x: 10,
          y: 9,
          rotation: 90,
          flip: true,
          props: { inputs: 3, delay: 2000 },
        },
      ],
      wires: [
        { id: 'w1', from: [4, 2], to: [9, 2] },
        { id: 'w2', from: [9, 2], to: [9, -7] },
        { id: 'w3', from: [20, 0], to: [20, 8], bus: true },
      ],
      probes: [
        { ref: 'U1.Y' },
        { ref: 'D[0..7]', name: 'data', radix: 'bin' },
        { name: 'PC', members: ['U1.Y', 'U2.Y'], radix: 'dec' },
      ],
      testScript: ["bench('latches', (b) => {", '  b.row({ S: 0 }, { Q: 1 }); // "set"', '});'],
    },
    { id: 'sub', name: 'Empty', components: [], wires: [], probes: [], testScript: [] },
  ],
};

const text = `{
  "schemaVersion": 7,
  "circuits": [
    {
      "id": "main",
      "name": "Latch \\"SR\\"",
      "components": [
        { "id": "U1", "type": "prim/nand", "x": 10, "y": 4 },
        { "id": "U2", "type": "prim/nand", "label": "Q̅ side", "x": 10, "y": 9, "rotation": 90, "flip": true, "props": { "inputs": 3, "delay": 2000 } }
      ],
      "wires": [
        { "id": "w1", "from": [4, 2], "to": [9, 2] },
        { "id": "w2", "from": [9, 2], "to": [9, -7] },
        { "id": "w3", "from": [20, 0], "to": [20, 8], "bus": true }
      ],
      "probes": [
        { "ref": "U1.Y" },
        { "ref": "D[0..7]", "name": "data", "radix": "bin" },
        { "name": "PC", "members": ["U1.Y", "U2.Y"], "radix": "dec" }
      ],
      "testScript": [
        "bench('latches', (b) => {",
        "  b.row({ S: 0 }, { Q: 1 }); // \\"set\\"",
        "});"
      ]
    },
    {
      "id": "sub",
      "name": "Empty",
      "components": [],
      "wires": []
    }
  ]
}
`;

describe('serializeDocument', () => {
  it('writes one line per component, wire, probe and script line, with defaults omitted', () => {
    expect(serializeDocument(document)).toBe(text);
  });

  it('round-trips losslessly', () => {
    expect(parseDocument(serializeDocument(document))).toEqual(document);
    expect(serializeDocument(parseDocument(text))).toBe(text);
    expect(parseDocument(serializeDocument(emptyDocument()))).toEqual(emptyDocument());
  });

  it('writes valid JSON', () => {
    expect(JSON.parse(serializeDocument(document)).circuits[0].components[1].props).toEqual({
      inputs: 3,
      delay: 2000,
    });
  });
});

describe('serializeDocument: Verilog modules', () => {
  const withModule: CircuitDocument = {
    schemaVersion: 7,
    circuits: [
      { id: 'main', name: 'Main', components: [], wires: [], probes: [], testScript: [] },
      {
        id: 'gate',
        name: 'Gate',
        components: [],
        wires: [],
        probes: [],
        testScript: [],
        verilog: { module: testModule },
      },
      {
        id: 'new',
        name: 'New',
        components: [],
        wires: [],
        probes: [],
        testScript: [],
        verilog: {},
      },
    ],
  };

  it('writes a line per port, signal and cell, and no parts or wires', () => {
    const saved = serializeDocument(withModule);
    expect(saved).toContain(`      "verilog": {
        "module": {
          "format": 1,
          "top": "gate",
          "creator": "Yosys 0.70",
          "bitCount": 7,
          "ports": [
            { "name": "clk", "dir": "in", "lsb": 0, "bits": [0] },`);
    expect(saved).toContain(
      '            { "type": "$and", "src": "gate.v:4.10-4.15", "ports": { "A": [1], "B": [2], "Y": [5] }, "params": {} },',
    );
    expect(saved).toContain('          "signals": [],');
    expect(saved).toContain(`      "id": "new",
      "name": "New",
      "verilog": {}
    }`);
  });

  it('round-trips losslessly', () => {
    expect(parseDocument(serializeDocument(withModule))).toEqual(withModule);
  });
});

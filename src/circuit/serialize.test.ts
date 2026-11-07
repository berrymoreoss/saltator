import { describe, expect, it } from 'vitest';
import { type CircuitDocument, emptyDocument } from './document';
import { parseDocument } from './schema';
import { serializeDocument } from './serialize';

const document: CircuitDocument = {
  schemaVersion: 2,
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
    },
    { id: 'sub', name: 'Empty', components: [], wires: [] },
  ],
};

const text = `{
  "schemaVersion": 2,
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
  it('writes one line per component and wire, with defaults omitted', () => {
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

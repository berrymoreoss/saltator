/**
 * The example files in `examples/` are documents the app opens as they are: each one is listed in
 * `EXAMPLE_FILES`, loads, is already in the canonical form the app saves (so saving it unchanged
 * writes the same bytes), and compiles without design issues. What each circuit does is tested in
 * its own scenario (hello-led.test.ts, …).
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FILES, exampleDocument, exampleText } from '../../src/app/example-files';
import {
  compileDesign,
  documentRegistry,
  normalizeWires,
  parseDocument,
  serializeDocument,
} from '../../src/circuit';
import { resolveProps } from '../../src/core';
import { createDefaultRegistry } from '../../src/library';

const registry = createDefaultRegistry();
// The test's own listing of the folder (tests are typed without Node APIs).
const FILES = import.meta.glob<string>('../../examples/*.logic.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('example files', () => {
  it('every file in examples/ is listed, and every listed example has a file', () => {
    const ids = Object.keys(FILES).map((path) => path.replace(/^.*\/(.*)\.logic\.json$/, '$1'));
    expect(ids.sort()).toEqual(EXAMPLE_FILES.map((e) => e.id).sort());
  });

  it('the app bundles each file as it is on disk', () => {
    for (const { id } of EXAMPLE_FILES) {
      expect(exampleText(id)).toBe(FILES[`../../examples/${id}.logic.json`]);
    }
  });

  describe.each(EXAMPLE_FILES)('$id', ({ id }) => {
    const text = exampleText(id);
    const document = exampleDocument(id);
    const parts = documentRegistry(document, registry);

    it('is canonical: saved as serializeDocument writes it, every circuit’s wires normalized', () => {
      expect(serializeDocument(document)).toBe(text);
      expect(serializeDocument(parseDocument(text))).toBe(text);
      for (const circuit of document.circuits) expect(normalizeWires(circuit)).toEqual(circuit);
    });

    it('stores every resolved prop of known parts, as the editor does', () => {
      for (const circuit of document.circuits) {
        for (const component of circuit.components) {
          const definition = parts.get(component.type);
          expect(definition, component.type).toBeDefined();
          expect(component.props, component.id).toEqual(resolveProps(definition!, component.props));
        }
      }
    });

    it('compiles without design issues, every circuit and the flattened design', () => {
      expect(compileDesign(document, registry).issues).toEqual([]);
    });
  });
});

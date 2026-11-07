/**
 * Writing documents as JSON: fixed key order, defaults omitted, one line per component and per
 * wire, so a saved file diffs well in git (one edit = one changed line).
 */
import type { CircuitDocument, ComponentInstance, Wire } from './document';

/** Serializes a document to JSON text (ends with a newline). `loadDocument` reads it back. */
export function serializeDocument(document: CircuitDocument): string {
  const circuits = document.circuits.map((circuit) =>
    [
      '    {',
      `      "id": ${JSON.stringify(circuit.id)},`,
      `      "name": ${JSON.stringify(circuit.name)},`,
      `      "components": ${list(circuit.components.map(componentJson), '      ')},`,
      `      "wires": ${list(circuit.wires.map(wireJson), '      ')}`,
      '    }',
    ].join('\n'),
  );
  return [
    '{',
    `  "schemaVersion": ${document.schemaVersion},`,
    `  "circuits": [\n${circuits.join(',\n')}\n  ]`,
    '}',
    '',
  ].join('\n');
}

function componentJson(c: ComponentInstance): Record<string, unknown> {
  return {
    id: c.id,
    type: c.type,
    ...(c.label !== undefined && { label: c.label }),
    x: c.x,
    y: c.y,
    ...(c.rotation !== 0 && { rotation: c.rotation }),
    ...(c.flip && { flip: true }),
    ...(Object.keys(c.props).length > 0 && { props: c.props }),
  };
}

function wireJson(w: Wire): Record<string, unknown> {
  return { id: w.id, from: w.from, to: w.to, ...(w.bus && { bus: true }) };
}

/** A JSON array with one inline item per line. */
function list(items: readonly Record<string, unknown>[], indent: string): string {
  if (items.length === 0) return '[]';
  return `[\n${items.map((item) => `${indent}  ${inline(item)}`).join(',\n')}\n${indent}]`;
}

/** Single-line JSON with a space after `:` and `,`: `{ "id": "w1", "from": [0, 2] }`. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return JSON.stringify(value);
}

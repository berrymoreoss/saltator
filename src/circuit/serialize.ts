/**
 * Writing documents as JSON: fixed key order, defaults omitted, one line per component, per
 * wire and per probe, so a saved file diffs well in git (one edit = one changed line). A circuit
 * without probes leaves the key out.
 */
import {
  type CircuitDocument,
  type ComponentInstance,
  isGroupProbe,
  type Probe,
  type Wire,
} from './document';

/** Serializes a document to JSON text (ends with a newline). `loadDocument` reads it back. */
export function serializeDocument(document: CircuitDocument): string {
  const circuits = document.circuits.map((circuit) =>
    [
      '    {',
      `      "id": ${JSON.stringify(circuit.id)},`,
      `      "name": ${JSON.stringify(circuit.name)},`,
      `      "components": ${list(circuit.components.map(componentJson), '      ')},`,
      `      "wires": ${list(circuit.wires.map(wireJson), '      ')}${circuit.probes.length > 0 ? ',' : ''}`,
      ...(circuit.probes.length > 0
        ? [`      "probes": ${list(circuit.probes.map(probeJson), '      ')}`]
        : []),
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

function probeJson(p: Probe): Record<string, unknown> {
  const radix = p.radix !== undefined && { radix: p.radix };
  if (isGroupProbe(p)) return { name: p.name, members: p.members, ...radix };
  return { ref: p.ref, ...(p.name !== undefined && { name: p.name }), ...radix };
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

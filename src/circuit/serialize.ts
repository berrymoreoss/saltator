/**
 * Writing documents as JSON: fixed key order, defaults omitted, one line per component, per
 * wire, per probe and per line of the test script — and for a Verilog module per port, signal,
 * memory and cell — so a saved file diffs well in git (one edit = one changed line). A circuit without
 * probes or a test script leaves the key out; a Verilog module leaves out its parts and wires.
 */
import type { HdlModule } from '../core';
import {
  type CircuitDocument,
  type ComponentInstance,
  isGroupProbe,
  type Probe,
  type Wire,
} from './document';

/** Serializes a document to JSON text (ends with a newline). `loadDocument` reads it back. */
export function serializeDocument(document: CircuitDocument): string {
  const circuits = document.circuits.map((circuit) => {
    const fields = [
      `"id": ${JSON.stringify(circuit.id)}`,
      `"name": ${JSON.stringify(circuit.name)}`,
      ...(circuit.verilog
        ? [`"verilog": ${verilogJson(circuit.verilog.module)}`]
        : [
            `"components": ${list(circuit.components.map(componentJson), '      ')}`,
            `"wires": ${list(circuit.wires.map(wireJson), '      ')}`,
          ]),
      ...(circuit.probes.length > 0
        ? [`"probes": ${list(circuit.probes.map(probeJson), '      ')}`]
        : []),
      ...(circuit.testScript.length > 0
        ? [`"testScript": ${list(circuit.testScript, '      ')}`]
        : []),
    ];
    return ['    {', fields.map((f) => `      ${f}`).join(',\n'), '    }'].join('\n');
  });
  return [
    '{',
    `  "schemaVersion": ${document.schemaVersion},`,
    `  "circuits": [\n${circuits.join(',\n')}\n  ]`,
    '}',
    '',
  ].join('\n');
}

/**
 * A Verilog module: `{}`, or its IR with a line per port, signal, memory and cell, and per path
 * and check of its timing (HDL-2).
 */
function verilogJson(module: HdlModule | undefined): string {
  if (!module) return '{}';
  const indent = '          ';
  const fields = [
    `"format": ${module.format}`,
    `"top": ${JSON.stringify(module.top)}`,
    `"creator": ${JSON.stringify(module.creator)}`,
    `"bitCount": ${module.bitCount}`,
    `"ports": ${list(module.ports, indent)}`,
    `"signals": ${list(module.signals, indent)}`,
    `"memories": ${list(module.memories, indent)}`,
    `"cells": ${list(module.cells, indent)}`,
  ];
  if (module.specify) {
    const inner = `${indent}  `;
    fields.push(
      [
        '"specify": {',
        `${inner}"paths": ${list(module.specify.paths, inner)},`,
        `${inner}"checks": ${list(module.specify.checks, inner)}`,
        `${indent}}`,
      ].join('\n'),
    );
  }
  return [
    '{',
    '        "module": {',
    fields.map((f) => `${indent}${f}`).join(',\n'),
    '        }',
    '      }',
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
function list(items: readonly unknown[], indent: string): string {
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

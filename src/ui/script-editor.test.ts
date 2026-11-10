import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  type CircuitDocument,
  compileCircuit,
  compileDesign,
  emptyVerilogCircuit,
  SCHEMA_VERSION,
} from '../circuit';
import { registerCircuit } from '../editor/test-documents';
import { createDefaultRegistry, fromYosys } from '../library';
import { YOSYS_FIXTURES } from '../library/hdl/fixtures';
import { scriptReferences } from './script-completions';
import { marksToDiagnostics, scriptCompletionSource, textChange } from './script-editor';

const registry = createDefaultRegistry();

/** A register module: ports D, CP in and Q out, a 74HC74 (U1), VCC labels. */
const circuit = () => registerCircuit(registry);

/** The completions offered with the cursor at `|` in `text`. */
function complete(text: string, explicit = false): { from: number; labels: string[] } | null {
  const pos = text.indexOf('|');
  const doc = text.replace('|', '');
  const state = EditorState.create({ doc, extensions: [javascript()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const c = circuit();
  const source = scriptCompletionSource(() =>
    scriptReferences(c, compileCircuit(c, registry), registry),
  );
  const result = source(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
  return result && { from: result.from, labels: result.options.map((o) => o.label) };
}

describe('scriptCompletionSource', () => {
  it('completes the bench API after b.', () => {
    const result = complete("bench('x', (b) => { b.ro| });");
    expect(result?.from).toBe("bench('x', (b) => { b.".length);
    expect(result?.labels).toContain('row');
    expect(result?.labels).toContain('loadIntelHex');
  });

  it('completes the circuit’s references inside a string, from the reference typed', () => {
    const result = complete("bench('x', (b) => { b.set({ 'U1.| });");
    expect(result?.from).toBe("bench('x', (b) => { b.set({ '".length);
    expect(result?.labels.slice(0, 3)).toEqual(['D', 'CP', 'Q']); // ports first
    expect(result?.labels).toContain('VCC');
    expect(result?.labels).toContain('U1');
    expect(result?.labels).toContain('U1.1Q');
  });

  it('completes references in a table', () => {
    const result = complete("bench('x', (b) => b.table`\n  D CP | |\n`);");
    expect(result?.labels).toContain('Q');
  });

  it('completes the globals at a word, nothing in comments or after another object', () => {
    expect(complete('ben|')?.labels).toContain('bench');
    expect(complete('// ben|')).toBeNull();
    expect(complete('Math.ra|')).toBeNull();
    expect(complete('|')).toBeNull();
    expect(complete('|', true)?.labels).toContain('us');
  });
});

describe('scriptReferences', () => {
  it('lists ports with their direction, nets, parts and pins, each once', () => {
    const c = circuit();
    const refs = scriptReferences(c, compileCircuit(c, registry), registry);
    expect(refs.slice(0, 3)).toEqual([
      { label: 'D', type: 'variable', detail: 'input port' },
      { label: 'CP', type: 'variable', detail: 'input port' },
      { label: 'Q', type: 'variable', detail: 'output port' },
    ]);
    expect(refs.find((r) => r.label === 'U1')).toEqual({
      label: 'U1',
      type: 'class',
      detail: '74HC74',
    });
    expect(refs.some((r) => r.label === 'P1' || r.label === 'NL0')).toBe(false); // net parts
    expect(new Set(refs.map((r) => r.label)).size).toBe(refs.length);
  });

  it("lists a module's own signals in its benches (HDL-4)", () => {
    const { module } = fromYosys(YOSYS_FIXTURES.traffic);
    const traffic: Circuit = { ...emptyVerilogCircuit('traffic', 'T'), verilog: { module } };
    const document: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [traffic] };
    const design = compileDesign(document, registry);
    const refs = scriptReferences(traffic, design.circuits.get('traffic'), design.registry);
    expect(refs.find((r) => r.label === 'state')).toEqual({
      label: 'state',
      type: 'variable',
      detail: 'signal [1:0]',
    });
  });
});

describe('marksToDiagnostics', () => {
  it('covers a mark’s line, clamped to the text', () => {
    const doc = Text.of(['one', 'two']);
    expect(
      marksToDiagnostics(doc, [
        { line: 2, severity: 'error', message: 'here' },
        { line: 9, severity: 'warning', message: 'past the end' },
      ]),
    ).toEqual([
      { from: 4, to: 7, severity: 'error', message: 'here' },
      { from: 4, to: 7, severity: 'warning', message: 'past the end' },
    ]);
  });
});

describe('textChange', () => {
  it('changes only what differs', () => {
    expect(textChange('same', 'same')).toBeUndefined();
    expect(textChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
    expect(textChange('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' });
    expect(textChange('abc', '')).toEqual({ from: 0, to: 3, insert: '' });
  });
});

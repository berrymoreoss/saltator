/**
 * The script editor's CodeMirror pieces that need no DOM (R15b): the completion source (the
 * bench API after `b.`, the globals, the circuit's references in strings and tables), marks at
 * lines as lint diagnostics, and the smallest change that brings the editor's text to the
 * document's. The view is ScriptEditor.tsx; both load with the Tests tab, not before.
 * Spec: docs/editor.md#tests.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import type { ChangeSpec, Text } from '@codemirror/state';
import { BENCH_API, SCRIPT_GLOBALS, type ScriptCompletion } from './script-completions';

/** A mark at a script line: the script's error, a failure, a bench's error. */
export interface ScriptMark {
  readonly line: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
}

const toCompletion = (c: ScriptCompletion): Completion => ({
  label: c.label,
  type: c.type,
  ...(c.detail !== undefined && { detail: c.detail }),
  ...(c.info !== undefined && { info: c.info }),
});

/** A reference's characters: `A1/U3.Q0`, `D[0..7]`, `~{RST}`, `U5[1F]`. */
const REFERENCE = /[\w./~{}[\]-]*$/;

/**
 * The completion source: `references()` gives the circuit's references now (they change as it
 * is edited).
 */
export function scriptCompletionSource(
  references: () => readonly ScriptCompletion[],
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (node.name === 'String' || node.name === 'TemplateString') {
      // Inside a string or a table: the reference being typed, from its start.
      const before = context.state.sliceDoc(node.from, context.pos);
      const typed = REFERENCE.exec(before.slice(node.name === 'String' ? 1 : 0))?.[0] ?? '';
      if (node.name === 'String' && context.pos <= node.from) return null;
      return {
        from: context.pos - typed.length,
        options: references().map(toCompletion),
        validFor: /^[\w./~{}[\]-]*$/,
      };
    }
    if (node.name === 'Comment' || node.name === 'LineComment' || node.name === 'BlockComment') {
      return null;
    }
    const member = context.matchBefore(/\bb\.\w*$/);
    if (member) {
      return { from: member.from + 2, options: BENCH_API.map(toCompletion), validFor: /^\w*$/ };
    }
    const word = context.matchBefore(/\w+$/);
    if (!word && !context.explicit) return null;
    if (word && /\.\w*$/.test(context.state.sliceDoc(word.from - 1, word.to))) return null;
    return {
      from: word?.from ?? context.pos,
      options: SCRIPT_GLOBALS.map(toCompletion),
      validFor: /^\w*$/,
    };
  };
}

/** Marks as lint diagnostics over their lines (a line past the end marks the last). */
export function marksToDiagnostics(doc: Text, marks: readonly ScriptMark[]): Diagnostic[] {
  return marks.map((mark) => {
    const line = doc.line(Math.min(Math.max(1, mark.line), doc.lines));
    return { from: line.from, to: line.to, severity: mark.severity, message: mark.message };
  });
}

/** The smallest change turning `from` into `to` (the common start and end kept), if any. */
export function textChange(from: string, to: string): ChangeSpec | undefined {
  if (from === to) return undefined;
  let start = 0;
  const shorter = Math.min(from.length, to.length);
  while (start < shorter && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < shorter - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

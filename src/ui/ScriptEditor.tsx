/**
 * The test script editor (R15b): CodeMirror 6 with JavaScript highlighting in the app's colors,
 * line numbers, marks (the script's error, failures) in the gutter and under their lines,
 * completion of the bench API and the circuit's references, search and replace, its own undo
 * while typing. Loaded lazily with the Tests tab (`React.lazy`). The document is the source of
 * truth: typing reports the text (`onChange`), and a text from the document (an undo, a load)
 * replaces the editor's without entering its history. Spec: docs/editor.md#tests; ADR-0026.
 */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, EditorSelection, EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import type { ScriptCompletion } from './script-completions';
import {
  marksToDiagnostics,
  type ScriptMark,
  scriptCompletionSource,
  textChange,
} from './script-editor';

/** What the Tests tab does to the editor. */
export interface ScriptEditorApi {
  /** Writes `text` at the cursor (replacing the selection) and focuses the editor. */
  insert(text: string): void;
  /** Puts the cursor at the start of `line`, scrolled into the middle, and focuses. */
  goTo(line: number): void;
  focus(): void;
}

export interface ScriptEditorProps {
  /** The script's text in the document. */
  readonly value: string;
  /** The text after the user changed it. */
  readonly onChange: (text: string) => void;
  /** Focus left the editor (typing after that is another undo step). */
  readonly onBlur?: () => void;
  readonly marks: readonly ScriptMark[];
  /** The circuit's references, for completion (read when completing). */
  readonly references: readonly ScriptCompletion[];
  readonly placeholder?: string;
  /** The editor's API once it is there; undefined when it goes. */
  readonly onReady?: (api: ScriptEditorApi | undefined) => void;
  /** Its accessible name. */
  readonly label: string;
}

/** Marks transactions that bring in the document's text: not the user's, not for `onChange`. */
const fromDocument = Annotation.define<boolean>();

const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.modifier],
    color: 'var(--code-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--code-number)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--code-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--code-function)',
  },
  { tag: [tags.propertyName], color: 'var(--code-property)' },
  { tag: tags.invalid, color: 'var(--error)' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--text-ui)',
    color: 'var(--fg)',
    backgroundColor: 'var(--input-bg)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-gutters': {
    backgroundColor: 'var(--panel-bg)',
    color: 'var(--fg-subtle)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--hover-bg)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover-bg)', color: 'var(--fg-muted)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--active-bg)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--active-bg)' },
  '.cm-matchingBracket': {
    outline: '1px solid var(--border-strong)',
    backgroundColor: 'transparent',
  },
  '.cm-placeholder': { color: 'var(--fg-subtle)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--error)',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--warning)',
    textUnderlineOffset: '3px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--menu-bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-fg)',
  },
  '.cm-completionDetail': { color: 'var(--fg-muted)', marginLeft: '1em', fontStyle: 'normal' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' },
  '.cm-panels': { backgroundColor: 'var(--panel-header-bg)', color: 'var(--fg)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-search input, .cm-search button': { fontSize: 'var(--text-small)' },
  '.cm-textfield': {
    backgroundColor: 'var(--input-bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--toolbar-bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
  },
});

/** CodeMirror's keys, without the ones the app's commands have (Mod+Enter runs the tests). */
const APP_KEYS = new Set(['Mod-Enter', 'Mod-Shift-Enter']);
const keys = [
  ...closeBracketsKeymap,
  ...defaultKeymap.filter((k) => !APP_KEYS.has(k.key ?? '')),
  ...searchKeymap,
  ...historyKeymap,
  ...completionKeymap,
  indentWithTab,
];

export function ScriptEditor(props: ScriptEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;

  // Made once; later props reach it through `latest` and the effects below.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return undefined;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          lintGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: false }),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          javascript(),
          javascriptLanguage.data.of({
            autocomplete: scriptCompletionSource(() => latest.current.references),
          }),
          autocompletion({ icons: false }),
          syntaxHighlighting(highlight),
          theme,
          keymap.of(keys),
          placeholder(latest.current.placeholder ?? ''),
          EditorView.contentAttributes.of({ 'aria-label': latest.current.label }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((t) => t.annotation(fromDocument))) return;
            latest.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => {
              latest.current.onBlur?.();
            },
          }),
        ],
      }),
    });
    view.current = editor;
    const api: ScriptEditorApi = {
      insert(text) {
        editor.dispatch(editor.state.replaceSelection(text), { scrollIntoView: true });
        editor.focus();
      },
      goTo(line) {
        const doc = editor.state.doc;
        const at = doc.line(Math.min(Math.max(1, line), doc.lines)).from;
        editor.dispatch({
          selection: EditorSelection.cursor(at),
          effects: EditorView.scrollIntoView(at, { y: 'center' }),
        });
        editor.focus();
      },
      focus: () => editor.focus(),
    };
    latest.current.onReady?.(api);
    return () => {
      latest.current.onReady?.(undefined);
      view.current = undefined;
      editor.destroy();
    };
  }, []);

  // The document's text: an undo, another load. Not the user's typing (that's already in).
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const change = textChange(editor.state.doc.toString(), props.value);
    if (!change) return;
    editor.dispatch({ changes: change, annotations: [fromDocument.of(true)] });
  }, [props.value]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(
      setDiagnostics(editor.state, marksToDiagnostics(editor.state.doc, props.marks)),
    );
  }, [props.marks]);

  return <div ref={host} className="script-editor" data-testid="script-editor" />;
}

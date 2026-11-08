import {
  Ban,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleMinus,
  CirclePlay,
  CircleX,
  Clock,
  FastForward,
  LoaderCircle,
  Play,
  Square,
} from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { BenchEntry, Circuit } from '../circuit';
import type { Editor } from '../editor';
import { useStore, useStoreValue } from './hooks';
import { Splitter } from './Panel';
import type { ScriptEditorApi } from './ScriptEditor';
import { scriptReferences } from './script-completions';
import type { TestSession } from './test-session';
import {
  type BenchRow,
  type BenchState,
  benchNote,
  type CircuitTests,
  isStale,
  marksOf,
  type ResultLine,
  refItems,
  resultLines,
  starterScript,
  testCounts,
  testsBadge,
  where,
} from './tests-view';

// CodeMirror loads with the tab, not with the app.
const ScriptEditor = lazy(() =>
  import('./ScriptEditor').then((m) => ({ default: m.ScriptEditor })),
);

interface TestsPanelProps {
  readonly editor: Editor;
  readonly tests: TestSession;
  /** The editor's API, for commands (Insert Image… writes at its cursor). */
  readonly onEditorReady?: (api: ScriptEditorApi | undefined) => void;
  /** Toolbar actions beside Run (Insert Image…). */
  readonly actions?: ReactNode;
}

/** How long typing pauses before the script is listed again (its errors marked). */
const CHECK_DELAY = 300;

/**
 * The Tests tab of the bottom dock (R15b): the open circuit's test script on the left, the
 * results of the benches run on the right — Run, Run All, a bench at a time, Cancel — each
 * failure a click away from its line and its signal. Spec: docs/editor.md#tests.
 */
export function TestsPanel({ editor, tests, onEditorReady, actions }: TestsPanelProps) {
  const state = useStore(tests.state);
  const listing = useStore(tests.listing);
  const document = useStoreValue(editor.state, (s) => s.document);
  const circuit = useStoreValue(editor.state, (s) => s.circuit);
  const design = useStoreValue(editor.state, (s) => s.design);
  const registry = useStoreValue(editor.state, (s) => s.design.registry);
  const source = circuit.testScript.join('\n');
  const api = useRef<ScriptEditorApi | undefined>(undefined);
  /** A line to go to once the editor of its circuit is there. */
  const pending = useRef<{ circuit: string; line: number } | undefined>(undefined);
  const [width, setWidth] = useState(380);

  useEffect(() => {
    const timer = setTimeout(() => void tests.check(circuit.id, source), CHECK_DELAY);
    return () => clearTimeout(timer);
  }, [tests, circuit.id, source]);

  const marks = useMemo(
    () => marksOf(state, listing, document, circuit.id, source),
    [state, listing, document, circuit.id, source],
  );
  const references = useMemo(
    () => scriptReferences(circuit, design.circuits.get(circuit.id), registry),
    [circuit, design, registry],
  );
  const listed = listing?.circuit === circuit.id && listing.source === source ? listing : undefined;

  /** Opens circuit `id` (if it isn't) and puts the editor at `line`; shows `ref` on the canvas. */
  const go = (id: string, line: number | undefined, ref?: string) => {
    if (editor.state.get().circuit.id !== id) editor.openCircuit(id);
    if (ref !== undefined) {
      const { circuit: open, design: now } = editor.state.get();
      editor.locateItems(refItems(ref, open, now.circuits.get(open.id)));
    }
    if (line === undefined) return;
    if (api.current && editor.state.get().circuit.id === id && pending.current === undefined) {
      api.current.goTo(line);
    } else {
      pending.current = { circuit: id, line };
    }
  };

  const ready = (next: ScriptEditorApi | undefined) => {
    api.current = next;
    onEditorReady?.(next);
    const wanted = pending.current;
    if (next && wanted && wanted.circuit === editor.state.get().circuit.id) {
      pending.current = undefined;
      next.goTo(wanted.line);
    }
  };

  const ordered = [
    ...state.circuits.filter((c) => c.circuit === circuit.id),
    ...state.circuits.filter((c) => c.circuit !== circuit.id),
  ];
  const nameOf = (id: string) => document.circuits.find((c) => c.id === id)?.name ?? id;
  const benchCount = listed && !listed.script.error ? listed.script.benches.length : undefined;
  const anyScript = document.circuits.some((c) => c.testScript.length > 0);

  return (
    <div className="tests" data-testid="tests-panel">
      <div className="waves-toolbar tests-toolbar">
        <button
          type="button"
          className="tool-button memory-action"
          title="Run the benches of this circuit (Mod+Enter)"
          disabled={source.trim() === ''}
          onClick={() => void tests.runOpen()}
        >
          <Play size={13} /> Run
        </button>
        <button
          type="button"
          className="tool-button memory-action"
          title="Run the benches of every circuit (Mod+Shift+Enter)"
          disabled={!anyScript}
          onClick={() => void tests.runAll()}
        >
          <FastForward size={13} /> Run All
        </button>
        <button
          type="button"
          className="tool-button memory-action"
          title="Stop the run"
          disabled={!state.run}
          onClick={() => tests.cancel()}
        >
          <Square size={12} /> Cancel
        </button>
        {actions && <span className="toolbar-divider" />}
        {actions}
        <span className="toolbar-divider" />
        <span className="tests-title" data-testid="tests-title">
          {circuit.name}
          {benchCount !== undefined && ` · ${benchCount} bench${benchCount === 1 ? '' : 'es'}`}
        </span>
        <RunStatus tests={tests} nameOf={nameOf} />
      </div>
      <div className="tests-body">
        <div className="tests-editor">
          <Suspense fallback={<div className="messages-empty muted">Loading the editor…</div>}>
            <ScriptEditor
              key={circuit.id}
              value={source}
              onChange={(text) => editor.setTestScript(circuit.id, text)}
              onBlur={() => editor.sealHistory()}
              marks={marks}
              references={references}
              placeholder={`// No test script for ${circuit.name} yet: write bench('name', (b) => { … }), or start from Starter Script.`}
              label={`Test script of ${circuit.name}`}
              onReady={ready}
            />
          </Suspense>
          {source === '' && (
            <button
              type="button"
              className="tool-button memory-action tests-starter"
              onClick={() => editor.setTestScript(circuit.id, starterScript(circuit, registry))}
            >
              Starter Script
            </button>
          )}
        </div>
        <Splitter
          orientation="vertical"
          size={width}
          direction={-1}
          onResize={(size) => setWidth(Math.min(Math.max(size, 220), 900))}
          label="Resize the test results"
        />
        <section
          className="tests-results"
          style={{ width }}
          aria-label="Test results"
          data-testid="test-results"
        >
          {ordered.length === 0 && (
            <OpenCircuitListed
              circuit={circuit}
              benches={listed?.script.benches}
              error={listed?.script.error}
              onRun={(bench) => void tests.runBench(circuit.id, bench)}
              onGo={(line) => go(circuit.id, line)}
            />
          )}
          {ordered.map((c) => (
            <CircuitResults
              key={c.circuit}
              tests={c}
              name={nameOf(c.circuit)}
              stale={(basis) => isStale(basis, document, c.circuit)}
              running={state.run !== undefined}
              onRun={(bench) => void tests.runBench(c.circuit, bench)}
              onGo={(line, ref) => go(c.circuit, line, ref)}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

/** Where the run is, or why the last one ended early, or the counts. */
function RunStatus({ tests, nameOf }: { tests: TestSession; nameOf: (id: string) => string }) {
  const state = useStore(tests.state);
  if (state.run) {
    const { run } = state;
    const current = run.current;
    return (
      <span className="tests-status running" data-testid="tests-status">
        <LoaderCircle size={12} className="spin" />
        {run.total > 0
          ? `Running ${Math.min(run.done + 1, run.total)} of ${run.total}`
          : 'Starting'}
        {current && `: ${nameOf(current.circuit)} › ${current.bench}`}
      </span>
    );
  }
  if (state.notice) {
    return (
      <span className="tests-status notice" role="status" data-testid="tests-status">
        {state.notice}
      </span>
    );
  }
  return null;
}

/** The open circuit's benches as listed, before any run: names to run, or the script's error. */
function OpenCircuitListed({
  circuit,
  benches,
  error,
  onRun,
  onGo,
}: {
  circuit: Circuit;
  benches: readonly BenchEntry[] | undefined;
  error: { readonly message: string; readonly line?: number } | undefined;
  onRun: (bench: string) => void;
  onGo: (line: number | undefined) => void;
}) {
  if (error) {
    return (
      <ul className="tests-list">
        <ResultLineItem
          item={{ kind: 'error', text: where(error.message, error.line), ...at(error.line) }}
          onGo={onGo}
        />
      </ul>
    );
  }
  if (!benches || benches.length === 0) {
    return (
      <div className="messages-empty muted">
        <Circle size={13} /> {benches ? `${circuit.name} has no benches yet.` : 'Listing…'}
      </div>
    );
  }
  return (
    <ul className="tests-list">
      {benches.map((b) => (
        <li key={b.name} className="tests-bench" data-testid="bench-row">
          <StateIcon state="idle" />
          <button type="button" className="tests-name link-button" onClick={() => onGo(b.line)}>
            {b.name}
          </button>
          <RunBenchButton name={b.name} onRun={onRun} />
          <span className="tests-note">not run yet</span>
        </li>
      ))}
    </ul>
  );
}

function CircuitResults({
  tests,
  name,
  stale,
  running,
  onRun,
  onGo,
}: {
  tests: CircuitTests;
  name: string;
  stale: (basis: CircuitTests['benches'][number]['basis']) => boolean;
  running: boolean;
  onRun: (bench: string) => void;
  onGo: (line: number | undefined, ref?: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const passed = tests.benches.filter((r) => r.state === 'pass').length;
  const failed =
    tests.benches.filter((r) => r.state === 'fail' || r.state === 'error').length +
    (tests.scriptError ? 1 : 0);
  const anyStale =
    tests.benches.some((r) => r.result && stale(r.basis)) ||
    (tests.scriptError !== undefined && stale(tests.scriptError.basis));
  return (
    <div className="tests-circuit" data-testid="circuit-results">
      <button
        type="button"
        className="waves-list-header tests-circuit-header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="tests-circuit-name">{name}</span>
        <span className="tests-counts">
          {passed > 0 && <span className="ok">✓ {passed}</span>}
          {failed > 0 && <span className="bad">✗ {failed}</span>}
          {anyStale && (
            <span className="stale" title="The circuit or its script changed since: run again">
              stale
            </span>
          )}
        </span>
      </button>
      {open && (
        <ul className="tests-list">
          {tests.scriptError && (
            <ResultLineItem
              item={{
                kind: 'error',
                text: `the script doesn't load: ${where(tests.scriptError.message, tests.scriptError.line)}`,
                ...at(tests.scriptError.line),
              }}
              onGo={(line) => onGo(line)}
            />
          )}
          {tests.benches.map((row) => (
            <BenchResult
              key={row.name}
              row={row}
              stale={row.result !== undefined && stale(row.basis)}
              running={running}
              onRun={onRun}
              onGo={onGo}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BenchResult({
  row,
  stale,
  running,
  onRun,
  onGo,
}: {
  row: BenchRow;
  stale: boolean;
  running: boolean;
  onRun: (bench: string) => void;
  onGo: (line: number | undefined, ref?: string) => void;
}) {
  const lines = row.result ? resultLines(row.result) : [];
  return (
    <>
      <li
        className={`tests-bench${stale ? ' is-stale' : ''}`}
        data-testid="bench-row"
        data-state={row.state}
      >
        <StateIcon state={row.state} />
        <button type="button" className="tests-name link-button" onClick={() => onGo(row.line)}>
          {row.name}
        </button>
        {!running && <RunBenchButton name={row.name} onRun={onRun} />}
        <span className="tests-note">{benchNote(row)}</span>
      </li>
      {lines.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a result's lines don't move
        <ResultLineItem key={i} item={item} onGo={onGo} />
      ))}
    </>
  );
}

function ResultLineItem({
  item,
  onGo,
}: {
  item: ResultLine;
  onGo: (line: number | undefined, ref?: string) => void;
}) {
  const goes = item.line !== undefined || item.ref !== undefined;
  return (
    <li className={`tests-line ${item.kind}`} data-testid="result-line">
      {goes ? (
        <button
          type="button"
          className="link-button"
          title={item.line !== undefined ? `Go to line ${item.line}` : 'Show it on the canvas'}
          onClick={() => onGo(item.line, item.ref)}
        >
          {item.text}
        </button>
      ) : (
        <span>{item.text}</span>
      )}
    </li>
  );
}

function RunBenchButton({ name, onRun }: { name: string; onRun: (bench: string) => void }) {
  return (
    <button
      type="button"
      className="icon-button tests-run-one"
      title={`Run "${name}"`}
      aria-label={`Run ${name}`}
      onClick={() => onRun(name)}
    >
      <CirclePlay size={13} />
    </button>
  );
}

function StateIcon({ state }: { state: BenchState | 'idle' }) {
  switch (state) {
    case 'pass':
      return <CircleCheck size={13} className="tests-icon ok" aria-label="passed" />;
    case 'fail':
      return <CircleX size={13} className="tests-icon bad" aria-label="failed" />;
    case 'error':
      return <Ban size={13} className="tests-icon bad" aria-label="error" />;
    case 'running':
      return <LoaderCircle size={13} className="tests-icon spin" aria-label="running" />;
    case 'queued':
      return <Clock size={13} className="tests-icon muted" aria-label="waiting" />;
    case 'not-run':
      return <CircleMinus size={13} className="tests-icon muted" aria-label="not run" />;
    default:
      return <Circle size={13} className="tests-icon muted" aria-label="not run yet" />;
  }
}

/** The Tests tab's badge: failures, or the benches passed. */
export function TestsBadge({ editor, tests }: { editor: Editor; tests: TestSession }) {
  const state = useStore(tests.state);
  const document = useStoreValue(editor.state, (s) => s.document);
  const counts = testCounts(state, document);
  const badge = testsBadge(counts);
  if (!badge) return null;
  return <span className={counts.failed > 0 ? 'tab-badge error' : 'tab-badge ok'}>{badge}</span>;
}

const at = (line: number | undefined) => (line === undefined ? {} : { line });

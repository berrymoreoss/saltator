import { Pencil, Plus, X } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { PROBE_RADIXES, type ProbeRadix } from '../circuit';
import { formatTime, parseTime } from '../core';
import type { Breakpoint, BreakpointView, Editor, WatchView } from '../editor';
import { CONDITIONS, isValueCondition } from './condition-terms';
import { Dialog } from './Dialogs';
import { type DraftTerm, draftOf, toDebugTerm } from './debug-view';
import { useStore } from './hooks';
import { referenceSuggestions } from './waveforms-view';

/** What the breakpoint dialog edits: a breakpoint, or a new one on `signal`. */
export interface BreakpointDialogRequest {
  readonly id?: number;
  readonly signal?: string;
}

interface DebugPanelProps {
  readonly editor: Editor;
  /** Grows when Simulate ▸ Run To… asks for the Run To box. */
  readonly runToRequest: number;
  readonly onEditBreakpoint: (request: BreakpointDialogRequest) => void;
}

/**
 * The Debug tab of the bottom dock (R14): steps (Step Clock, Run For, Run To), breaks on errors
 * and warnings, the breakpoints and the watches. Spec: docs/editor.md#debugger.
 */
export function DebugPanel({ editor, runToRequest, onEditBreakpoint }: DebugPanelProps) {
  const { debug } = editor;
  const setup = useStore(debug.setup);
  const status = useStore(editor.simulation.status);
  const [notice, setNotice] = useState<string>();
  const [runTo, setRunTo] = useState('');
  const runToBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (runToRequest > 0) runToBox.current?.focus();
  }, [runToRequest]);
  const clock = debug.clock();
  const runForText = formatTime(setup.runFor);
  const said = status.state === 'running' && status.goal ? `${status.goal}…` : status.reason;

  const submitRunTo = (e: FormEvent) => {
    e.preventDefault();
    const time = parseTime(runTo.trim());
    setNotice(
      time === undefined ? `"${runTo}" is not a time, e.g. 1.5 ms.` : debug.runToTime(time),
    );
  };

  return (
    <div className="debug" data-testid="debug-panel">
      <div className="waves-toolbar debug-toolbar">
        <button
          type="button"
          className="tool-button memory-action"
          title="Back to the previous breakpoint hit (Alt+F5)"
          disabled={status.state === 'stopped'}
          onClick={() => setNotice(debug.reverseContinue())}
        >
          Reverse Continue
        </button>
        <button
          type="button"
          className="tool-button memory-action"
          title="Back to right before the step clock's last active edge (Alt+F8)"
          disabled={clock.net === undefined || status.state === 'stopped'}
          onClick={() => setNotice(debug.stepBackClock())}
        >
          Step Back Clock
        </button>
        <button
          type="button"
          className="tool-button memory-action"
          title="Run to right before the step clock's next active edge but one (F8)"
          disabled={clock.net === undefined || status.state === 'halted'}
          onClick={() => setNotice(debug.stepClock())}
        >
          Step Clock
        </button>
        <ClockBox
          editor={editor}
          value={setup.clock ?? ''}
          placeholder={debug.defaultClock() ?? 'clock'}
          onNotice={setNotice}
        />
        <select
          className="toolbar-select"
          aria-label="Active edge"
          value={setup.edge}
          onChange={(e) => debug.setClock(setup.clock, e.target.value as 'rise' | 'fall')}
        >
          <option value="rise">↑ rising</option>
          <option value="fall">↓ falling</option>
        </select>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="tool-button memory-action"
          title="Run for this long, then pause (Shift+F8)"
          disabled={status.state === 'halted'}
          onClick={() => setNotice(debug.runFor())}
        >
          Run For
        </button>
        <TimeBox
          key={runForText}
          label="Run For duration"
          initial={runForText}
          onTime={(t) => debug.setRunFor(t)}
        />
        <span className="toolbar-divider" />
        <form className="waves-add" onSubmit={submitRunTo}>
          <button
            type="submit"
            className="tool-button memory-action"
            title="Run to this simulated time, then pause"
            disabled={runTo.trim() === '' || status.state === 'halted'}
          >
            Run To
          </button>
          <input
            ref={runToBox}
            className="prop-input time-input"
            aria-label="Run To time"
            placeholder="1.5 ms"
            value={runTo}
            onChange={(e) => setRunTo(e.target.value)}
          />
        </form>
        <span className="toolbar-divider" />
        <label className="check-label" title="Pause at every contention and timing violation">
          <input
            type="checkbox"
            checked={setup.breakOnErrors}
            onChange={(e) => debug.setBreakOn({ errors: e.target.checked })}
          />
          Break on errors
        </label>
        <label className="check-label" title="Pause at every floating input and other warning">
          <input
            type="checkbox"
            checked={setup.breakOnWarnings}
            onChange={(e) => debug.setBreakOn({ warnings: e.target.checked })}
          />
          Break on warnings
        </label>
        {said && (
          <span className="debug-reason" data-testid="debug-reason" title={said}>
            {said}
          </span>
        )}
      </div>
      {(notice ?? clock.problem) && (
        <div className="waves-notice">
          <span className="field-error" role="alert">
            {notice ?? clock.problem}
          </span>
          {notice && (
            <button
              type="button"
              className="icon-button"
              title="Dismiss"
              onClick={() => setNotice(undefined)}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="debug-body">
        <Breakpoints editor={editor} onEdit={onEditBreakpoint} />
        <Watches editor={editor} onNotice={setNotice} />
      </div>
    </div>
  );
}

/** The Debug tab's badge: how many breakpoints are enabled. */
export function DebugBadge({ editor }: { readonly editor: Editor }) {
  const setup = useStore(editor.debug.setup);
  const enabled = setup.breakpoints.filter((b) => b.enabled).length;
  return enabled > 0 ? <span className="tab-badge">{enabled}</span> : null;
}

/** The step clock: a reference, empty for the default. */
function ClockBox(props: {
  editor: Editor;
  value: string;
  placeholder: string;
  onNotice: (text?: string) => void;
}) {
  const { editor, value, placeholder, onNotice } = props;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const { scene } = useStore(editor.state);
  const commit = () => {
    if (text.trim() === value) return;
    const problem = editor.debug.setClock(text.trim() === '' ? undefined : text);
    onNotice(problem);
    if (problem) setText(value);
  };
  return (
    <>
      <input
        className="prop-input clock-input"
        list="debug-clock-suggestions"
        aria-label="Step clock"
        title="The clock Step Clock steps by (empty: the net CLK, else the first clock part)"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <datalist id="debug-clock-suggestions">
        {referenceSuggestions(scene.compiled, text).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

/** A time typed in place: kept when it parses, marked when it doesn't. */
function TimeBox(props: { label: string; initial: string; onTime: (t: number) => void }) {
  const [text, setText] = useState(props.initial);
  const time = parseTime(text.trim());
  const valid = time !== undefined && time > 0;
  return (
    <input
      className={valid ? 'prop-input time-input' : 'prop-input time-input invalid'}
      aria-label={props.label}
      aria-invalid={!valid}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (valid) props.onTime(time);
        else setText(props.initial);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && valid) props.onTime(time);
      }}
    />
  );
}

function Breakpoints({
  editor,
  onEdit,
}: {
  editor: Editor;
  onEdit: (request: BreakpointDialogRequest) => void;
}) {
  const { debug } = editor;
  const views = useStore(debug.breakpoints);
  const anyEnabled = views.some((v) => v.breakpoint.enabled);
  return (
    <section className="debug-section" aria-label="Breakpoints">
      <div className="waves-list-header debug-header">
        <span>Breakpoints</span>
        <span className="debug-header-actions">
          <button
            type="button"
            className="tool-button memory-action"
            disabled={views.length === 0}
            onClick={() => debug.enableAll(!anyEnabled)}
          >
            {anyEnabled ? 'Disable all' : 'Enable all'}
          </button>
          <button
            type="button"
            className="tool-button memory-action"
            title="Add a breakpoint"
            onClick={() => onEdit({})}
          >
            <Plus size={12} /> Add…
          </button>
        </span>
      </div>
      {views.length === 0 ? (
        <div className="messages-empty muted">
          No breakpoints: Add… one, or right-click a wire or pin and choose Break When … Rises.
        </div>
      ) : (
        <ul className="debug-list">
          {views.map((view) => (
            <BreakpointRow key={view.breakpoint.id} editor={editor} view={view} onEdit={onEdit} />
          ))}
        </ul>
      )}
    </section>
  );
}

function hitsText(view: BreakpointView): string {
  const { hits, breakpoint } = view;
  if (breakpoint.hitCount) return `${hits} of ${breakpoint.hitCount}`;
  return hits === 1 ? '1 hit' : `${hits} hits`;
}

function BreakpointRow(props: {
  editor: Editor;
  view: BreakpointView;
  onEdit: (request: BreakpointDialogRequest) => void;
}) {
  const { editor, view, onEdit } = props;
  const { breakpoint } = view;
  return (
    <li className="debug-row" data-testid="breakpoint">
      <input
        type="checkbox"
        aria-label={`Breakpoint ${breakpoint.id} enabled`}
        checked={breakpoint.enabled}
        onChange={(e) =>
          editor.debug.updateBreakpoint(breakpoint.id, { enabled: e.target.checked })
        }
      />
      <span className="debug-id mono">{breakpoint.id}</span>
      <span
        className={view.problem ? 'debug-text mono unresolved' : 'debug-text mono'}
        title={view.problem ?? view.text}
      >
        {view.text}
      </span>
      <span className="debug-hits mono">{hitsText(view)}</span>
      <button
        type="button"
        className="icon-button"
        title="Edit the breakpoint"
        onClick={() => onEdit({ id: breakpoint.id })}
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        className="icon-button"
        title="Remove the breakpoint"
        onClick={() => editor.debug.removeBreakpoint(breakpoint.id)}
      >
        <X size={12} />
      </button>
    </li>
  );
}

function Watches({ editor, onNotice }: { editor: Editor; onNotice: (text?: string) => void }) {
  const { debug } = editor;
  const views = useStore(debug.watches);
  const { scene } = useStore(editor.state);
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = debug.addWatch(text);
    onNotice(problem);
    if (!problem) setText('');
  };
  return (
    <section className="debug-section" aria-label="Watches">
      <div className="waves-list-header debug-header">
        <span>Watches</span>
        <form className="waves-add" onSubmit={submit}>
          <input
            className="prop-input"
            list="debug-watch-suggestions"
            aria-label="Watch to add"
            placeholder="Watch: CLK, D[0..7], U5[1F]"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <datalist id="debug-watch-suggestions">
            {referenceSuggestions(scene.compiled, text).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button type="submit" className="tool-button memory-action" disabled={text.trim() === ''}>
            Add
          </button>
        </form>
      </div>
      {views.length === 0 ? (
        <div className="messages-empty muted">
          Watch signals, groups of single signals and memory cells: CLK, U3.Q0 U3.Q1, U5[10..1F].
        </div>
      ) : (
        <ul className="debug-list">
          {views.map((view) => (
            <WatchRow key={view.reference} editor={editor} view={view} />
          ))}
        </ul>
      )}
    </section>
  );
}

function WatchRow({ editor, view }: { editor: Editor; view: WatchView }) {
  const [renaming, setRenaming] = useState(false);
  const rename = (name: string) => {
    editor.debug.updateWatch(view.index, { name });
    setRenaming(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') rename(e.currentTarget.value);
    if (e.key === 'Escape') setRenaming(false);
  };
  return (
    <li className="debug-row" data-testid="watch">
      {renaming ? (
        <input
          className="prop-input debug-text"
          aria-label="Watch name"
          defaultValue={view.watch.name ?? ''}
          placeholder={view.reference}
          // biome-ignore lint/a11y/noAutofocus: the row was double-clicked to rename it
          autoFocus
          onBlur={(e) => rename(e.currentTarget.value)}
          onKeyDown={onKey}
        />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: a list row's name, renamed as the Waveforms rows are
        <span
          className={view.problem ? 'debug-text unresolved' : 'debug-text'}
          title={view.problem ?? `${view.reference} — double-click to rename`}
          onDoubleClick={() => setRenaming(true)}
        >
          {view.label}
        </span>
      )}
      <span
        className={view.changed ? 'debug-value mono changed' : 'debug-value mono'}
        data-testid="watch-value"
        title={view.changed ? 'Changed since the last stop' : undefined}
      >
        {view.value}
      </span>
      {view.vector ? (
        <select
          className="toolbar-select radix-select"
          aria-label={`Radix of ${view.label}`}
          value={view.watch.radix ?? 'hex'}
          onChange={(e) =>
            editor.debug.updateWatch(view.index, { radix: e.target.value as ProbeRadix })
          }
        >
          {PROBE_RADIXES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : (
        <span className="radix-select" />
      )}
      <button
        type="button"
        className="icon-button"
        title="Remove the watch"
        onClick={() => editor.debug.removeWatch(view.index)}
      >
        <X size={12} />
      </button>
    </li>
  );
}

/** Add or edit a breakpoint: terms (ANDed, at most one edge) on typed signals, a hit count. */
export function BreakpointDialog({
  editor,
  request,
  onClose,
}: {
  editor: Editor;
  request: BreakpointDialogRequest;
  onClose: () => void;
}) {
  const { debug } = editor;
  const { scene } = useStore(editor.state);
  const existing: Breakpoint | undefined = debug.setup
    .get()
    .breakpoints.find((b) => b.id === request.id);
  const [terms, setTerms] = useState<DraftTerm[]>(
    existing
      ? existing.terms.map(draftOf)
      : [{ signal: request.signal ?? '', condition: 'rise', value: '' }],
  );
  const [hitCount, setHitCount] = useState(String(existing?.hitCount ?? 1));
  const count = Number(hitCount);
  const built = terms.map(toDebugTerm);
  const problems = [
    ...(Number.isInteger(count) && count >= 1 ? [] : ['the hit count is a whole number ≥ 1']),
    ...(terms.some((t) => t.signal.trim() === '') ? ['every term needs a signal'] : []),
  ];
  if (problems.length === 0) problems.push(...debug.termProblems(built));
  const set = (i: number, change: Partial<DraftTerm>) =>
    setTerms((list) => list.map((t, k) => (k === i ? { ...t, ...change } : t)));
  const save = () => {
    const result =
      existing === undefined
        ? debug.addBreakpoint(built, count)
        : debug.updateBreakpoint(existing.id, { terms: built, hitCount: count });
    if (typeof result !== 'string') onClose();
  };

  return (
    <Dialog
      title={existing ? `Breakpoint ${existing.id}` : 'Add Breakpoint'}
      onClose={onClose}
      testId="breakpoint-dialog"
    >
      <p className="muted">
        The run pauses at every instant every term holds (at most one edge; without one, when they
        start to hold). A signal is a net, a pin, a bus, or single signals bit 0 first.
      </p>
      <datalist id="breakpoint-suggestions">
        {referenceSuggestions(scene.compiled, terms.at(-1)?.signal ?? '').map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {terms.map((term, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: terms have no identity of their own
        <div key={i} className="trigger-term">
          <input
            className="prop-input signal-input"
            list="breakpoint-suggestions"
            aria-label="Signal"
            placeholder="CLK, U1.Y, D[0..7]"
            value={term.signal}
            onChange={(e) => set(i, { signal: e.target.value })}
          />
          <select
            className="toolbar-select"
            aria-label="Condition"
            value={term.condition}
            onChange={(e) => set(i, { condition: e.target.value })}
          >
            {CONDITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {isValueCondition(term.condition) && (
            <input
              className="prop-input"
              aria-label="Value"
              placeholder="hex, X for any: 3F"
              value={term.value}
              onChange={(e) => set(i, { value: e.target.value })}
            />
          )}
          <button
            type="button"
            className="icon-button"
            title="Remove the term"
            onClick={() => setTerms((list) => list.filter((_, k) => k !== i))}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="tool-button memory-action"
        onClick={() =>
          setTerms((list) => [...list, { signal: '', condition: 'level:1', value: '' }])
        }
      >
        Add term
      </button>
      <div className="trigger-window">
        <label>
          Pause from hit{' '}
          <input
            className="prop-input count-input"
            aria-label="Hit count"
            value={hitCount}
            onChange={(e) => setHitCount(e.target.value)}
          />{' '}
          on
        </label>
      </div>
      {problems.length > 0 && (
        <p className="field-error" role="alert">
          {problems.join('; ')}
        </p>
      )}
      <div className="dialog-actions">
        <span className="dialog-actions-gap" />
        <button type="button" className="dialog-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="dialog-button primary"
          disabled={problems.length > 0}
          onClick={save}
        >
          {existing ? 'Save' : 'Add'}
        </button>
      </div>
    </Dialog>
  );
}

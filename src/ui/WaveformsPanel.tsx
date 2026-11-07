import { ChevronDown, ChevronRight, Maximize2, Minus, Plus, Ungroup, X } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import { PROBE_RADIXES, type ProbeRadix } from '../circuit';
import { formatTime, Level, parseTime } from '../core';
import {
  type AnalyzerChannel,
  type AnalyzerCondition,
  type AnalyzerTerm,
  type CanvasTheme,
  drawWaveforms,
  type Editor,
  probeKey,
  WAVE_RULER_HEIGHT,
  waveformTheme,
} from '../editor';
import {
  CONDITIONS,
  conditionId,
  conditionTerm,
  isValueCondition,
  levelText,
} from './condition-terms';
import { Dialog } from './Dialogs';
import type { ImageFileAccess } from './files';
import { useStore } from './hooks';
import { formatSpan, type VcdRange, vcdFile, vcdSpan } from './vcd-export';
import {
  cursorReadout,
  referenceSuggestions,
  rowAt,
  rowKey,
  waveKey,
  waveRows,
  wheelFactor,
} from './waveforms-view';

interface WaveformsPanelProps {
  readonly editor: Editor;
  readonly theme: CanvasTheme;
  /** Buttons at the toolbar's end (Export VCD…). */
  readonly actions?: ReactNode;
}

/**
 * The Waveforms tab of the bottom dock: the circuit's probes over simulated time, as a logic
 * analyzer shows them — a signal list with values at cursor A, a timing diagram with zoom, pan
 * and two cursors, a trigger. Spec: docs/editor.md#waveforms-tab.
 */
export function WaveformsPanel({ editor, theme, actions }: WaveformsPanelProps) {
  const { analyzer } = editor;
  const channels = useStore(analyzer.channels);
  const view = useStore(analyzer.view);
  const trigger = useStore(analyzer.trigger);
  useStore(analyzer.revision);
  useStore(editor.simulation.ticks);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [marked, setMarked] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<string>();
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [scroll, setScroll] = useState(0);
  // A probe the canvas refused says why here.
  const request = useStore(editor.requests);
  useEffect(() => {
    if (request?.kind === 'probed') setNotice(request.problem);
  }, [request]);
  const rows = waveRows(channels, expanded);
  const readout = cursorReadout(view);
  const valueTime = view.cursorA ?? analyzer.end;

  const toggleExpanded = (channel: AnalyzerChannel) =>
    setExpanded((set) => {
      const next = new Set(set);
      const key = rowKey(channel);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const pick = (index: number, extend: boolean) => {
    analyzer.select(index);
    setMarked((set) => {
      if (!extend) return new Set([index]);
      const next = new Set(set);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  const group = () => {
    const name = window.prompt('Name of the group (its value is read bit 0 first, top first):');
    if (name === null) return;
    const problem = analyzer.groupProbes(
      [...marked].sort((a, b) => a - b),
      name,
    );
    setNotice(problem);
    if (!problem) setMarked(new Set());
  };

  return (
    <div className="waves" data-testid="waves-panel">
      <div className="waves-toolbar">
        <AddSignal editor={editor} onNotice={setNotice} />
        <button
          type="button"
          className="tool-button memory-action"
          disabled={marked.size < 2}
          title="Group the picked single signals into one value (Ctrl/⌘-click to pick)"
          onClick={group}
        >
          Group…
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className={
            trigger.status === 'off'
              ? 'tool-button memory-action'
              : 'tool-button memory-action pressed'
          }
          title="Stop the run when a condition holds"
          onClick={() => setTriggerOpen(true)}
          data-testid="trigger-button"
        >
          {trigger.status === 'off'
            ? 'Trigger…'
            : trigger.status === 'armed'
              ? 'Armed'
              : `Triggered at ${formatTime(trigger.time)}`}
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="tool-button"
          title="Zoom out (-)"
          onClick={() => analyzer.zoom(0.5)}
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          className="tool-button"
          title="Zoom in (+)"
          onClick={() => analyzer.zoom(2)}
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className={view.mode === 'fit' ? 'tool-button pressed' : 'tool-button'}
          title="Zoom to fit the whole record (Home)"
          onClick={() => analyzer.zoomToFit()}
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          className={
            view.mode === 'follow'
              ? 'tool-button memory-action pressed'
              : 'tool-button memory-action'
          }
          title="Keep now at the right edge (End)"
          onClick={() => analyzer.followNow()}
        >
          Follow
        </button>
        <span className="waves-readout" data-testid="cursor-readout">
          {readout.a !== undefined && <span className="cursor-a">A {readout.a}</span>}
          {readout.b !== undefined && <span className="cursor-b">B {readout.b}</span>}
          {readout.delta !== undefined && (
            <span>
              Δ {readout.delta}
              {readout.frequency !== undefined && ` · ${readout.frequency}`}
            </span>
          )}
          {readout.a === undefined && readout.b === undefined && (
            <span className="muted">Click to place cursor A, Shift+click for B</span>
          )}
        </span>
        <span className="waves-actions">{actions}</span>
      </div>
      {notice && (
        <div className="field-error waves-notice" role="alert">
          {notice}
          <button
            type="button"
            className="icon-button"
            title="Dismiss"
            onClick={() => setNotice(undefined)}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {channels.length === 0 ? (
        <div className="empty-note">
          Probe signals to see them here: choose the Probe tool (P) and click wires, pins or buses,
          right-click one and choose Add to Waveforms, or type a name above (CLK, U1.Y, D[0..7]).
        </div>
      ) : (
        <div className="waves-body">
          <div className="waves-list" onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
            <div className="waves-list-header" style={{ height: WAVE_RULER_HEIGHT }}>
              <span>Signal</span>
              <span>{view.cursorA !== undefined ? 'at A' : 'Value'}</span>
            </div>
            {rows.map((row) => {
              const { channel } = row;
              const key = `${channel.index}:${row.bit ?? 'all'}`;
              if (row.bit !== undefined) {
                const level = analyzer.recorder.level(channel.bits[row.bit]!, valueTime);
                return (
                  <div key={key} className="waves-row bit" style={{ height: row.height }}>
                    <span className="waves-name">{channel.bitLabels[row.bit]}</span>
                    <span className="waves-value">
                      {level === undefined ? '' : levelText(level)}
                    </span>
                  </div>
                );
              }
              return (
                <ChannelRow
                  key={key}
                  editor={editor}
                  channel={channel}
                  height={row.height}
                  value={analyzer.valueAt(channel, valueTime)}
                  selected={view.selected === channel.index}
                  marked={marked.has(channel.index)}
                  expanded={expanded.has(rowKey(channel))}
                  onPick={(extend) => pick(channel.index, extend)}
                  onExpand={() => toggleExpanded(channel)}
                />
              );
            })}
          </div>
          <Plot editor={editor} theme={theme} rows={rows} scroll={scroll} />
        </div>
      )}
      {triggerOpen && (
        <TriggerDialog editor={editor} channels={channels} onClose={() => setTriggerOpen(false)} />
      )}
    </div>
  );
}

/** The Waveforms tab's badge: how many signals are probed, `T` once a trigger is armed. */
export function WavesBadge({ editor }: { readonly editor: Editor }) {
  const channels = useStore(editor.analyzer.channels);
  const trigger = useStore(editor.analyzer.trigger);
  return (
    <>
      {channels.length > 0 && <span className="tab-badge">{channels.length}</span>}
      {trigger.status === 'armed' && <span className="tab-badge warning">T</span>}
    </>
  );
}

/** The Add signal box: a reference with completion. */
function AddSignal({ editor, onNotice }: { editor: Editor; onNotice: (text?: string) => void }) {
  const [text, setText] = useState('');
  const { scene } = useStore(editor.state);
  const suggestions = referenceSuggestions(scene.compiled, text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ref = text.trim();
    if (ref === '') return;
    const problem = editor.analyzer.addProbe({ ref });
    onNotice(problem);
    if (!problem) setText('');
  };
  return (
    <form className="waves-add" onSubmit={submit}>
      <input
        className="prop-input"
        list="waves-suggestions"
        value={text}
        placeholder="Add signal: CLK, U1.Y, D[0..7]"
        aria-label="Signal to add"
        onChange={(e) => setText(e.target.value)}
      />
      <datalist id="waves-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button type="submit" className="tool-button memory-action" disabled={text.trim() === ''}>
        Add
      </button>
    </form>
  );
}

interface ChannelRowProps {
  readonly editor: Editor;
  readonly channel: AnalyzerChannel;
  readonly height: number;
  readonly value: string;
  readonly selected: boolean;
  readonly marked: boolean;
  readonly expanded: boolean;
  readonly onPick: (extend: boolean) => void;
  readonly onExpand: () => void;
}

/** A channel in the list: name, value, radix and the row's actions. */
function ChannelRow(props: ChannelRowProps) {
  const { editor, channel, height, value, selected, marked, expanded, onPick, onExpand } = props;
  const { analyzer } = editor;
  const [renaming, setRenaming] = useState(false);
  const className = [
    'waves-row',
    selected && 'selected',
    marked && 'marked',
    channel.problem && 'broken',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the plot takes the keys (↑/↓ pick a row)
    // biome-ignore lint/a11y/noStaticElementInteractions: a list row; the plot handles the keys
    <div
      className={className}
      style={{ height }}
      title={channel.problem ?? channel.reference}
      onClick={(e) => onPick(e.metaKey || e.ctrlKey || e.shiftKey)}
      onDoubleClick={() => setRenaming(true)}
      data-testid="waves-row"
    >
      {channel.vector ? (
        <button
          type="button"
          className="icon-button"
          title={expanded ? 'Collapse' : 'Show its bits'}
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="waves-indent" />
      )}
      {renaming ? (
        <input
          className="prop-input waves-rename"
          defaultValue={channel.label}
          // biome-ignore lint/a11y/noAutofocus: renaming starts by a double click on the row
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(false);
            if (e.key === 'Enter') {
              analyzer.updateProbe(channel.index, { name: e.currentTarget.value });
              setRenaming(false);
            }
            e.stopPropagation();
          }}
          onBlur={() => setRenaming(false)}
        />
      ) : (
        <span className="waves-name">{channel.label}</span>
      )}
      {channel.vector && (
        <select
          className="toolbar-select waves-radix"
          value={channel.radix}
          title="How the value is written"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            analyzer.updateProbe(channel.index, { radix: e.target.value as ProbeRadix })
          }
        >
          {PROBE_RADIXES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      )}
      <span className="waves-value" data-testid="waves-value">
        {channel.problem ? '—' : value}
      </span>
      {channel.vector && 'members' in channel.probe && (
        <button
          type="button"
          className="icon-button waves-row-action"
          title="Ungroup"
          onClick={(e) => {
            e.stopPropagation();
            analyzer.ungroup(channel.index);
          }}
        >
          <Ungroup size={12} />
        </button>
      )}
      <button
        type="button"
        className="icon-button waves-row-action"
        title="Remove from Waveforms"
        onClick={(e) => {
          e.stopPropagation();
          analyzer.removeProbe(channel.index);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface PlotProps {
  readonly editor: Editor;
  readonly theme: CanvasTheme;
  readonly rows: ReturnType<typeof waveRows>;
  readonly scroll: number;
}

/** The timing diagram: a canvas the analyzer's view is drawn on, with mouse and keys. */
function Plot({ editor, theme, rows, scroll }: PlotProps) {
  const { analyzer } = editor;
  const view = useStore(analyzer.view);
  const trigger = useStore(analyzer.trigger);
  const revision = useStore(analyzer.revision);
  const sim = useStore(editor.simulation.status);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(0);
  const drag = useRef<{ x: number; moved: boolean } | undefined>(undefined);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const box = canvas.getBoundingClientRect();
      analyzer.setWidth(box.width);
      setHeight(box.height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [analyzer]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` grows with the record, which the drawing reads through the recorder
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || view.width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaveforms(
      ctx,
      {
        recorder: analyzer.recorder,
        view,
        rows: rows.map((row) => ({ ...row, y: row.y - scroll })),
        height,
        live: sim.state !== 'stopped',
        ...(trigger.status === 'triggered' && { trigger: trigger.time }),
      },
      waveformTheme(theme),
    );
  }, [analyzer, view, rows, scroll, height, sim.state, trigger, theme, revision]);

  const xOf = (e: { clientX: number }) =>
    e.clientX - canvasRef.current!.getBoundingClientRect().left;
  const yOf = (e: { clientY: number }) =>
    e.clientY - canvasRef.current!.getBoundingClientRect().top - WAVE_RULER_HEIGHT;

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { x: xOf(e), moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = xOf(e);
    if (!d.moved && Math.abs(x - d.x) < 3) return;
    d.moved = true;
    analyzer.pan(d.x - x);
    d.x = x;
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = undefined;
    if (!d || d.moved) return;
    const row = rowAt(rows, yOf(e), scroll);
    const t = analyzer.snap(analyzer.timeAt(xOf(e)), row?.channel);
    analyzer.setCursor(e.shiftKey ? 'B' : 'A', t);
    if (row) analyzer.select(row.channel.index);
  };
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      analyzer.pan(e.shiftKey ? e.deltaY : e.deltaX);
    } else {
      analyzer.zoom(wheelFactor(e.deltaY), xOf(e));
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const action = waveKey(e.key, e.shiftKey);
    if (!action) return;
    e.preventDefault(); // keys the plot handles never reach the shortcuts (lesson R12b)
    switch (action.kind) {
      case 'zoom':
        analyzer.zoom(action.factor);
        break;
      case 'pan':
        analyzer.pan(action.pages * view.width);
        break;
      case 'edge':
        analyzer.edge(action.direction, action.cursor);
        break;
      case 'fit':
        analyzer.zoomToFit();
        break;
      case 'follow':
        analyzer.followNow();
        break;
      case 'remove':
        if (view.selected !== undefined) analyzer.removeProbe(view.selected);
        break;
      case 'clearCursors':
        analyzer.setCursor('A', undefined);
        analyzer.setCursor('B', undefined);
        break;
      case 'select': {
        const count = analyzer.channels.get().length;
        if (count === 0) break;
        const from = view.selected ?? (action.step > 0 ? -1 : count);
        analyzer.select(Math.min(count - 1, Math.max(0, from + action.step)));
        break;
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="waves-plot"
      tabIndex={0}
      aria-label="Timing diagram"
      data-testid="waves-plot"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    />
  );
}

interface DraftTerm {
  readonly probe: string;
  readonly condition: string;
  readonly value: string;
}

function toTerm(draft: DraftTerm): AnalyzerTerm {
  const { kind, level } = conditionTerm(draft.condition);
  if (kind === 'level') return { probe: draft.probe, kind, level: level ?? Level.L1 };
  if (isValueCondition(draft.condition)) return { probe: draft.probe, kind, value: draft.value };
  return { probe: draft.probe, kind };
}

/** The Trigger dialog: terms (ANDed), where the trigger sits in the window, and the window. */
function TriggerDialog({
  editor,
  channels,
  onClose,
}: {
  editor: Editor;
  channels: readonly AnalyzerChannel[];
  onClose: () => void;
}) {
  const { analyzer } = editor;
  const state = useStore(analyzer.trigger);
  const view = analyzer.view.get();
  const usable = channels.filter((c) => c.problem === undefined);
  const first = usable[0];
  const initial: DraftTerm[] =
    state.status === 'off'
      ? first
        ? [{ probe: probeKey(first.probe), condition: first.vector ? 'equal' : 'rise', value: '' }]
        : []
      : state.condition.terms.map((t) => ({
          probe: t.probe,
          condition: conditionId(t.kind, t.level),
          value: t.value ?? '',
        }));
  const [terms, setTerms] = useState<DraftTerm[]>(initial);
  const [position, setPosition] = useState(
    state.status === 'off' ? 0.1 : (state.condition.position ?? 0.1),
  );
  const [window, setWindow] = useState(
    formatTime(
      state.status === 'off' ? view.width * view.scale || 1_000_000 : (state.condition.window ?? 0),
    ),
  );
  const parsedWindow = parseTime(window);
  const condition: AnalyzerCondition = {
    terms: terms.map(toTerm),
    position,
    ...(parsedWindow !== undefined && parsedWindow > 0 && { window: parsedWindow }),
  };
  const problems =
    parsedWindow === undefined || parsedWindow <= 0
      ? ['the window must be a time, e.g. 10 µs']
      : analyzer.conditionProblems(condition);
  const channelOf = (key: string) => channels.find((c) => probeKey(c.probe) === key);
  const set = (i: number, change: Partial<DraftTerm>) =>
    setTerms((list) => list.map((t, k) => (k === i ? { ...t, ...change } : t)));

  return (
    <Dialog title="Trigger" onClose={onClose} testId="trigger-dialog">
      <p className="muted">
        Single shot: when every term holds (at most one edge), the run goes on for the rest of the
        window and pauses with the trigger in view.
      </p>
      {terms.map((term, i) => {
        const channel = channelOf(term.probe);
        const options = CONDITIONS.filter((c) => (channel?.vector ? c.vector : true));
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: terms have no identity of their own
          <div key={i} className="trigger-term">
            <select
              className="toolbar-select"
              aria-label="Signal"
              value={term.probe}
              onChange={(e) => {
                const next = channelOf(e.target.value);
                set(i, {
                  probe: e.target.value,
                  ...(next?.vector && !term.condition.includes('qual') && { condition: 'equal' }),
                  ...(!next?.vector && term.condition.includes('qual') && { condition: 'rise' }),
                });
              }}
            >
              {usable.map((c) => (
                <option key={probeKey(c.probe)} value={probeKey(c.probe)}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              className="toolbar-select"
              aria-label="Condition"
              value={term.condition}
              onChange={(e) => set(i, { condition: e.target.value })}
            >
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {(term.condition === 'equal' || term.condition === 'notEqual') && (
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
        );
      })}
      <button
        type="button"
        className="tool-button memory-action"
        disabled={!first}
        onClick={() =>
          first &&
          setTerms((list) => [
            ...list,
            {
              probe: probeKey(first.probe),
              condition: first.vector ? 'equal' : 'level:1',
              value: '',
            },
          ])
        }
      >
        Add term
      </button>
      <div className="trigger-window">
        <label>
          Window{' '}
          <input
            className="prop-input"
            aria-label="Window"
            value={window}
            onChange={(e) => setWindow(e.target.value)}
          />
        </label>
        <label>
          Trigger at{' '}
          <select
            className="toolbar-select"
            aria-label="Trigger position"
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          >
            {[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => (
              <option key={p} value={p}>
                {Math.round(p * 100)} % of the window
              </option>
            ))}
          </select>
        </label>
      </div>
      {problems.length > 0 && terms.length > 0 && (
        <p className="field-error" role="alert">
          {problems.join('; ')}
        </p>
      )}
      <div className="dialog-actions">
        {state.status !== 'off' && (
          <button
            type="button"
            className="dialog-button"
            onClick={() => {
              analyzer.disarm();
              onClose();
            }}
          >
            Disarm
          </button>
        )}
        <span className="dialog-actions-gap" />
        <button type="button" className="dialog-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="dialog-button primary"
          disabled={problems.length > 0}
          onClick={() => {
            if (!analyzer.arm(condition)) onClose();
          }}
        >
          Arm
        </button>
      </div>
    </Dialog>
  );
}

/** Export VCD…: the whole record or the span between the cursors, saved as a `.vcd` file. */
export function VcdExportAction({
  editor,
  title,
  files,
}: {
  editor: Editor;
  title: () => string;
  files: ImageFileAccess;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<VcdRange>('all');
  const [problem, setProblem] = useState<string>();
  useStore(editor.analyzer.view);
  useStore(editor.analyzer.revision);
  const close = () => {
    setOpen(false);
    setProblem(undefined);
  };
  const save = async () => {
    const file = vcdFile(editor.analyzer, {
      range,
      title: title(),
      date: new Date().toISOString(),
      version: 'Logic',
    });
    if (typeof file === 'string') {
      setProblem(file);
      return;
    }
    const saved = await files.saveBytes(new TextEncoder().encode(file.text), file.name, 'vcd');
    if (saved !== undefined) close();
  };
  const all = vcdSpan(editor.analyzer, 'all');
  const cursors = vcdSpan(editor.analyzer, 'cursors');
  return (
    <>
      <button
        type="button"
        className="tool-button memory-action"
        title="Save the waveforms as a Value Change Dump (GTKWave, Surfer, PulseView)"
        onClick={() => {
          setRange(cursors ? 'cursors' : 'all');
          setOpen(true);
        }}
      >
        Export VCD…
      </button>
      {open && (
        <Dialog title="Export VCD" onClose={close} testId="vcd-dialog">
          <fieldset className="image-kinds">
            <label className="image-option">
              <input type="radio" checked={range === 'all'} onChange={() => setRange('all')} />
              Whole record {all && <span className="muted mono">{formatSpan(all)}</span>}
            </label>
            <label className="image-option">
              <input
                type="radio"
                checked={range === 'cursors'}
                disabled={!cursors}
                onChange={() => setRange('cursors')}
              />
              Between cursors A and B{' '}
              {cursors ? (
                <span className="muted mono">{formatSpan(cursors)}</span>
              ) : (
                <span className="muted">(place both)</span>
              )}
            </label>
          </fieldset>
          <p className="muted">
            Every probe that resolves, 1-bit signals as wires and buses and groups as vectors, at a
            1 ps timescale.
          </p>
          {problem && (
            <p className="field-error" role="alert">
              {problem}
            </p>
          )}
          <div className="dialog-actions">
            <span className="dialog-actions-gap" />
            <button type="button" className="dialog-button" onClick={close}>
              Cancel
            </button>
            <button type="button" className="dialog-button primary" onClick={() => void save()}>
              Save…
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

import { CircleCheck, CircleX, Play, TriangleExclamationPoint } from 'lucide-react';
import { type Diagnostic, diagnosticSeverity, formatTime } from '../core';
import type { Editor } from '../editor';
import { formatCount, formatFrequency, statsRows } from './debug-view';
import { useStore, useStoreValue } from './hooks';

/** Where a diagnostic is: `U1.A`, `U3`, `net U1.Y`. */
export function diagnosticLocation(d: Diagnostic): string {
  if (d.component) return d.pin ? `${d.component}.${d.pin}` : d.component;
  return d.net ? `net ${d.net}` : '';
}

/** When: `at 12 ns`, or `12 ns … 1.5 µs ×40` for a repeated one. */
export function diagnosticWhen(d: Diagnostic): string {
  if (d.count === 1) return `at ${formatTime(d.time)}`;
  return `${formatTime(d.time)} … ${formatTime(d.lastTime)} ×${d.count}`;
}

/**
 * The Simulation tab: what the kernel and the parts reported while simulating, beside the run
 * statistics (R14).
 */
export function SimulationPanel({ editor }: { readonly editor: Editor }) {
  return (
    <div className="sim-tab">
      <Diagnostics editor={editor} />
      <RunStatistics editor={editor} />
    </div>
  );
}

/**
 * The run's counters since power-on and for the last run, and — measured on request — the
 * nets that change most (a forgotten fast clock, a ring that oscillates).
 */
function RunStatistics({ editor }: { readonly editor: Editor }) {
  useStore(editor.simulation.ticks);
  const active = useStoreValue(editor.simulation.status, (s) => s.state !== 'stopped');
  const { debug } = editor;
  if (!active) return null;
  const rows = statsRows(debug.stats());
  const activity = debug.activity();
  return (
    <aside className="sim-stats" aria-label="Run statistics" data-testid="run-statistics">
      <table className="sim-stats-table">
        <thead>
          <tr>
            <th scope="col" aria-label="Counter" />
            <th scope="col">Since power-on</th>
            <th scope="col">Last run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, total, last]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td className="mono">{total}</td>
              <td className="mono">{last}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sim-activity">
        <label className="check-label" title="Count each net's changes from now on (costs speed)">
          <input
            type="checkbox"
            checked={debug.measuring}
            onChange={(e) => debug.measureActivity(e.target.checked)}
          />
          Most active nets
          {debug.measuring && (
            <span className="muted"> since {formatTime(debug.activityFrom)}</span>
          )}
        </label>
        {activity.length > 0 && (
          <table className="sim-stats-table" data-testid="net-activity">
            <tbody>
              {activity.map((a) => (
                <tr key={a.net}>
                  <th scope="row" className="mono">
                    {a.net}
                  </th>
                  <td className="mono">{formatCount(a.changes)}</td>
                  <td className="mono">{formatFrequency(a.frequency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}

/**
 * What the kernel and the parts reported while simulating: contention, floating inputs,
 * oscillation, timing violations. Click locates the part, or the wires of the net; double-click
 * zooms to it.
 */
function Diagnostics({ editor }: { readonly editor: Editor }) {
  const diagnostics = useStore(editor.simulation.diagnostics);
  const active = useStoreValue(editor.simulation.status, (s) => s.state !== 'stopped');
  if (!active) {
    return (
      <div className="messages-empty muted" data-testid="sim-diagnostics">
        <Play size={14} /> Run the simulation (F5) to see what happens while it runs.
      </div>
    );
  }
  if (diagnostics.length === 0) {
    return (
      <div className="messages-empty" data-testid="sim-diagnostics">
        <CircleCheck size={14} /> No problems while running.
      </div>
    );
  }
  const locate = (d: Diagnostic, zoom: boolean) => {
    if (d.component) editor.locate({ component: d.component }, { zoom });
    else if (d.net) editor.locateNet(d.net, { zoom });
  };
  return (
    <ul className="messages" data-testid="sim-diagnostics">
      {diagnostics.map((d) => {
        const severity = diagnosticSeverity(d);
        return (
          <li key={`${d.kind}|${d.net ?? ''}|${d.component ?? ''}|${d.pin ?? ''}`}>
            <button
              type="button"
              className={`message sim-message ${severity}`}
              onClick={() => locate(d, false)}
              onDoubleClick={() => locate(d, true)}
              title="Click to locate, double-click to zoom"
            >
              {severity === 'error' ? (
                <CircleX size={13} className="message-icon" />
              ) : (
                <TriangleExclamationPoint size={13} className="message-icon" />
              )}
              <span className="message-code mono">{d.kind}</span>
              <span className="message-text">{d.message}</span>
              <span className="message-when mono">{diagnosticWhen(d)}</span>
              <span className="message-where mono">{diagnosticLocation(d)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The Simulation tab's badges: errors and warnings reported while running. */
export function SimulationBadges({ editor }: { readonly editor: Editor }) {
  const diagnostics = useStore(editor.simulation.diagnostics);
  const errors = diagnostics.filter((d) => diagnosticSeverity(d) === 'error').length;
  const warnings = diagnostics.length - errors;
  return (
    <>
      {errors > 0 && <span className="tab-badge error">{errors}</span>}
      {warnings > 0 && <span className="tab-badge warning">{warnings}</span>}
    </>
  );
}

import { CircleCheck, CircleX, Play, TriangleExclamationPoint } from 'lucide-react';
import { type Diagnostic, formatTime, isTimingViolation, KernelDiagnosticKind } from '../core';
import type { Editor } from '../editor';
import { useStore, useStoreValue } from './hooks';

/**
 * Short circuits, oscillations and timing violations break the circuit (a violated set-up time
 * is an intermittent failure on a real board); the rest are warnings.
 */
export function diagnosticSeverity(d: Diagnostic): 'error' | 'warning' {
  return d.kind === KernelDiagnosticKind.CONTENTION ||
    d.kind === KernelDiagnosticKind.OSCILLATION ||
    isTimingViolation(d.kind)
    ? 'error'
    : 'warning';
}

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
 * What the kernel and the parts reported while simulating: contention, floating inputs,
 * oscillation, timing violations. Click locates the part, or the wires of the net; double-click
 * zooms to it.
 */
export function SimulationPanel({ editor }: { readonly editor: Editor }) {
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

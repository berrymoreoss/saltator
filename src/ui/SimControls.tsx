import { Gauge, TriangleExclamationPoint } from 'lucide-react';
import { formatTime } from '../core';
import { ALL_SPEEDS, formatRate, type SimStatus, type Simulation } from '../editor';
import { useStore } from './hooks';

/** The speed select on the toolbar: simulated time per wall second, or Max. */
export function SpeedSelect({ simulation }: { readonly simulation: Simulation }) {
  const { speed } = useStore(simulation.status);
  return (
    <label className="speed-select" title="Simulation speed: simulated time per second">
      <Gauge size={15} strokeWidth={1.75} aria-hidden />
      <select
        className="toolbar-select"
        aria-label="Simulation speed"
        value={speed.id}
        onChange={(e) => {
          const next = ALL_SPEEDS.find((s) => s.id === e.currentTarget.value);
          if (next) simulation.setSpeed(next);
          // Back to the canvas: keys typed into a select never reach the shortcuts.
          e.currentTarget.blur();
        }}
      >
        {ALL_SPEEDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const STATE_LABELS: Readonly<Record<SimStatus['state'], string>> = {
  stopped: 'Stopped',
  running: 'Running',
  paused: 'Paused',
  halted: 'Halted',
};

/** `Running · 1.25 s · actual 310 ms/s`: the simulation in one status-bar line. */
export function simulationSummary(status: SimStatus): string {
  if (status.error) return `Can't simulate: ${status.error}`;
  if (status.state === 'stopped') return 'Stopped';
  const parts = [STATE_LABELS[status.state], formatTime(status.time)];
  if (status.state === 'halted') parts.push('oscillation — Reset to restart');
  if (status.state === 'running' && status.goal) {
    parts.push(`${status.goal}…`); // a step runs at Max whatever the speed
    return parts.join(' · ');
  }
  const max = status.speed.perSecond === undefined;
  if (status.state === 'running' && (status.lagging || max)) {
    parts.push(`${max ? 'max' : 'actual'} ${formatRate(status.actual)}`);
  }
  if (status.state === 'paused' && status.reason) parts.push(status.reason);
  return parts.join(' · ');
}

/**
 * The status-bar cell of the simulation, with the number of problems reported while running;
 * a click shows them. Its own component: it refreshes ~10× per second.
 */
export function SimulationStatus({
  simulation,
  onClick,
}: {
  readonly simulation: Simulation;
  readonly onClick: () => void;
}) {
  const status = useStore(simulation.status);
  const problems = useStore(simulation.diagnostics).length;
  const warn = status.error !== undefined || status.state === 'halted' || status.lagging;
  return (
    <button
      type="button"
      className={`status-cell sim-status ${status.state}${warn ? ' warn' : ''}`}
      data-testid="sim-status"
      onClick={onClick}
      title={
        status.lagging
          ? `The simulation can't keep up with ${status.speed.label} — show Simulation`
          : 'Simulation: state and simulated time — show Simulation'
      }
    >
      <span className="sim-dot" aria-hidden />
      <span className="mono">{simulationSummary(status)}</span>
      {problems > 0 && (
        <span className="issue-count warning">
          <TriangleExclamationPoint size={12} /> {problems}
        </span>
      )}
    </button>
  );
}

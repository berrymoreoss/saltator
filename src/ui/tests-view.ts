/**
 * The Tests tab's model (R15b), pure: the results of the benches run in this session, by
 * circuit — what a run planned, which bench runs now, each result — whether a result is stale
 * (its circuit, a circuit inside it or its script changed since), the counts the tab shows,
 * the lines a result is shown as, and a starter script. Spec: docs/editor.md#tests.
 */
import {
  type BenchResult,
  type Circuit,
  type CircuitDocument,
  type CompileResult,
  circuitPorts,
  circuitsInside,
  type PlannedBench,
  type RunTarget,
  type TestScript,
} from '../circuit';
import {
  type ComponentRegistry,
  formatTime,
  type PropValue,
  resolveProps,
  symbolOf,
} from '../core';
import type { ScriptMark } from './script-editor';
import type { RunOutcome } from './test-runner';

/** Where a bench stands: waiting in a run, running, its result, or left out of a run. */
export type BenchState = 'queued' | 'running' | 'pass' | 'fail' | 'error' | 'not-run';

/** What a result was got from: each circuit the bench simulated, as it was then. */
export type Basis = ReadonlyMap<string, Circuit>;

export interface BenchRow {
  readonly name: string;
  /** The line of its `bench(…)` call. */
  readonly line?: number;
  readonly state: BenchState;
  readonly result?: BenchResult;
  readonly basis: Basis;
}

/** A circuit's benches as last run. */
export interface CircuitTests {
  readonly circuit: string;
  readonly benches: readonly BenchRow[];
  /** Its script didn't load in the last run. */
  readonly scriptError?: {
    readonly message: string;
    readonly line?: number;
    readonly basis: Basis;
  };
}

export interface TestsState {
  /** By circuit, in the order they were first run. */
  readonly circuits: readonly CircuitTests[];
  /** The run going on: how far it is. */
  readonly run?: { readonly total: number; readonly done: number; readonly current?: PlannedBench };
  /** Why the last run ended early: cancelled, the sandbox failed. */
  readonly notice?: string;
}

export const EMPTY_TESTS: TestsState = { circuits: [] };

/** What the circuit's benches simulate: it and every circuit inside it, as they are now. */
export function basisOf(document: CircuitDocument, circuit: string): Basis {
  const inside = circuitsInside(document, circuit);
  return new Map(document.circuits.filter((c) => inside.has(c.id)).map((c) => [c.id, c]));
}

/**
 * True when the document is no longer what a result was got from: a circuit gone, its parts or
 * wires changed, or the tested circuit's script (`tested`). Probes and names don't count.
 */
export function isStale(basis: Basis, document: CircuitDocument, tested: string): boolean {
  if (basis.size === 0) return true;
  for (const [id, then] of basis) {
    const now = document.circuits.find((c) => c.id === id);
    if (!now) return true;
    if (now.components !== then.components || now.wires !== then.wires) return true;
    if (id === tested && now.testScript !== then.testScript) return true;
  }
  // A circuit placed inside it since: its parts changed, so caught above.
  return false;
}

/** The state as a run of `targets` starts on `document`. */
export function runStarted(
  state: TestsState,
  document: CircuitDocument,
  targets: readonly RunTarget[],
): TestsState {
  let circuits = state.circuits;
  for (const target of targets) {
    const basis = basisOf(document, target.circuit);
    const old = circuits.find((c) => c.circuit === target.circuit);
    const kept = target.benches
      ? (old?.benches ?? []).map((row) =>
          target.benches!.includes(row.name) ? { ...row, state: 'queued' as const, basis } : row,
        )
      : [];
    const next: CircuitTests = { circuit: target.circuit, benches: kept };
    circuits = old ? circuits.map((c) => (c === old ? next : c)) : [...circuits, next];
  }
  return { circuits, run: { total: 0, done: 0 } };
}

/** The run's plan has come: its benches are queued (in the order the run runs them). */
export function runPlanned(
  state: TestsState,
  document: CircuitDocument,
  plan: readonly PlannedBench[],
): TestsState {
  const circuits = state.circuits.map((c) => {
    const planned = plan.filter((p) => p.circuit === c.circuit);
    if (planned.length === 0) return c;
    const basis = basisOf(document, c.circuit);
    const rows = [...c.benches];
    for (const p of planned) {
      const row: BenchRow = {
        name: p.bench,
        ...(p.line !== undefined && { line: p.line }),
        state: 'queued',
        basis,
      };
      const at = rows.findIndex((r) => r.name === p.bench);
      if (at >= 0) rows[at] = row;
      else rows.push(row);
    }
    return { ...c, benches: rows };
  });
  return { ...state, circuits, run: { total: plan.length, done: 0 } };
}

/** Bench `bench` of the plan runs now. */
export function benchStarted(state: TestsState, bench: PlannedBench): TestsState {
  return {
    ...state,
    circuits: updateRow(state.circuits, bench.circuit, bench.bench, (row) => ({
      ...row,
      state: 'running',
    })),
    ...(state.run && { run: { ...state.run, current: bench } }),
  };
}

/** A bench's result has come. */
export function benchFinished(state: TestsState, circuit: string, result: BenchResult): TestsState {
  const run = state.run && { total: state.run.total, done: state.run.done + 1 };
  return {
    ...state,
    circuits: updateRow(state.circuits, circuit, result.name, (row) => ({
      ...row,
      ...(result.line !== undefined && { line: result.line }),
      state: result.status,
      result,
    })),
    ...(run && { run }),
  };
}

/** A circuit's script didn't load: no benches of it ran. */
export function scriptFailed(
  state: TestsState,
  document: CircuitDocument,
  circuit: string,
  error: { readonly message: string; readonly line?: number },
): TestsState {
  const scriptError = { ...error, basis: basisOf(document, circuit) };
  const circuits = state.circuits.map((c) =>
    c.circuit === circuit ? { circuit, benches: [], scriptError } : c,
  );
  return { ...state, circuits };
}

/** The run has ended: what didn't run is marked so, and why it ended early is the notice. */
export function runEnded(state: TestsState, outcome: RunOutcome): TestsState {
  const waiting = (r: BenchRow) => r.state === 'queued' || r.state === 'running';
  let notRun = 0;
  const circuits = state.circuits.map((c) => {
    const left = c.benches.filter(waiting).length;
    if (left === 0) return c;
    notRun += left;
    return {
      ...c,
      benches: c.benches.map((r) => (waiting(r) ? { ...r, state: 'not-run' as const } : r)),
    };
  });
  const notice =
    outcome.status === 'failed'
      ? outcome.message
      : outcome.status === 'cancelled'
        ? `Cancelled${notRun > 0 ? `: ${plural(notRun, 'bench')} didn't run` : ''}`
        : undefined;
  return { circuits, ...(notice !== undefined && { notice }) };
}

/** Results of circuits no longer in the document are dropped. */
export function pruneTests(state: TestsState, document: CircuitDocument): TestsState {
  const ids = new Set(document.circuits.map((c) => c.id));
  const circuits = state.circuits.filter((c) => ids.has(c.circuit));
  return circuits.length === state.circuits.length ? state : { ...state, circuits };
}

/** What the tab's badge and header count, stale results included (they are marked so). */
export interface TestCounts {
  readonly passed: number;
  /** Failed or erred benches, and scripts that didn't load. */
  readonly failed: number;
  /** Results whose circuit changed since. */
  readonly stale: number;
}

/** Counts of the results, those of `circuit` only when given. */
export function testCounts(
  state: TestsState,
  document: CircuitDocument,
  circuit?: string,
): TestCounts {
  let passed = 0;
  let failed = 0;
  let stale = 0;
  for (const c of state.circuits) {
    if (circuit !== undefined && c.circuit !== circuit) continue;
    if (c.scriptError) {
      failed++;
      if (isStale(c.scriptError.basis, document, c.circuit)) stale++;
    }
    for (const row of c.benches) {
      if (row.state === 'pass') passed++;
      else if (row.state === 'fail' || row.state === 'error') failed++;
      else continue;
      if (isStale(row.basis, document, c.circuit)) stale++;
    }
  }
  return { passed, failed, stale };
}

/** The tab's badge: `✗ 2` when something failed, `✓ 9` when all passed; none before a run. */
export function testsBadge(counts: TestCounts): string | undefined {
  if (counts.failed > 0) return `✗ ${counts.failed}`;
  if (counts.passed > 0) return `✓ ${counts.passed}`;
  return undefined;
}

/** A line under a result: a failure, the error, a log, a warning, or how many more failed. */
export interface ResultLine {
  readonly kind: 'failure' | 'error' | 'log' | 'warning' | 'more';
  /** `line 7 at 1.25 µs: Q[0..3] is 0x5, expected 0x4`. */
  readonly text: string;
  /** The script line to go to. */
  readonly line?: number;
  /** The reference that failed, to show on the canvas. */
  readonly ref?: string;
}

/** A result's lines, as the CLI prints them: logs, failures, how many more, the error, warnings. */
export function resultLines(result: BenchResult): ResultLine[] {
  const lines: ResultLine[] = [];
  for (const log of result.logs) {
    lines.push({ kind: 'log', text: where(log.text, log.line, log.time), ...at(log.line) });
  }
  for (const f of result.failures) {
    lines.push({
      kind: 'failure',
      text: where(f.message, f.line, f.time),
      ...at(f.line),
      ...(f.ref !== undefined && { ref: f.ref }),
    });
  }
  const more = result.failureCount - result.failures.length;
  if (more > 0) lines.push({ kind: 'more', text: `… and ${more} more` });
  if (result.error) {
    lines.push({
      kind: 'error',
      text: where(result.error.message, result.error.line),
      ...at(result.error.line),
    });
  }
  for (const w of result.warnings) {
    const times = w.count > 1 ? ` (${w.count}×)` : '';
    lines.push({ kind: 'warning', text: `${where(w.message, undefined, w.time)}${times}` });
  }
  return lines;
}

/** `line 7 at 1.25 µs: …`, as much of it as is known. */
export function where(message: string, line?: number, time?: number): string {
  const place = [
    ...(line === undefined ? [] : [`line ${line}`]),
    ...(time === undefined ? [] : [`at ${formatTime(time)}`]),
  ].join(' ');
  return place === '' ? message : `${place}: ${message}`;
}

/** What a bench row says after its name: its simulated time, or where it stands. */
export function benchNote(row: BenchRow): string {
  switch (row.state) {
    case 'queued':
      return 'waiting';
    case 'running':
      return 'running…';
    case 'not-run':
      return 'not run';
    default: {
      const result = row.result;
      if (!result) return '';
      const failures = result.failureCount > 0 ? `${plural(result.failureCount, 'failure')}, ` : '';
      return `${failures}${formatTime(result.time)}`;
    }
  }
}

/**
 * A first script for a circuit: what it can drive and check named, and one bench to start
 * from. A subcircuit is driven through its ports; the top circuit through its switches,
 * buttons and manual clocks.
 */
export function starterScript(circuit: Circuit, registry: ComponentRegistry): string {
  const ports = circuitPorts(circuit, registry);
  const names = (direction: string) =>
    ports.filter((p) => p.direction === direction).map((p) => (p.bus ? `${p.name}[…]` : p.name));
  const inputs = [...names('in'), ...names('bidir')];
  const outputs = names('out');
  const controls = ports.length === 0 ? controlsOf(circuit, registry) : [];
  const lines = [
    `// Test benches for ${circuit.name}: bench(name, (b) => { … }), each on a fresh simulation.`,
    '// b.set, b.row, b.table, b.clock, b.wait, b.expect, b.memory — see docs/circuit.md.',
  ];
  if (inputs.length > 0) lines.push(`// Inputs: ${inputs.join(', ')}`);
  if (outputs.length > 0) lines.push(`// Outputs: ${outputs.join(', ')}`);
  if (controls.length > 0) lines.push(`// Switches, buttons and clocks: ${controls.join(', ')}`);
  if (ports.length === 0 && controls.length === 0) {
    lines.push('// No ports or switches yet: add ports (Place ▸ Port) to drive it as a module.');
  }
  const input = inputs[0]?.replace('[…]', '') ?? controls[0];
  const output = outputs[0]?.replace('[…]', '');
  lines.push('', "bench('does what it should', (b) => {");
  if (input !== undefined) lines.push(`  b.set({ '${input}': 0 });`);
  lines.push('  b.wait(us(1));');
  if (output !== undefined) lines.push(`  b.expect({ '${output}': 'X' }); // 'X': don't care yet`);
  lines.push('});', '');
  return lines.join('\n');
}

/** The interactive parts a bench operates (as the Interact tool does), by designator. */
function controlsOf(circuit: Circuit, registry: ComponentRegistry): string[] {
  const found: string[] = [];
  for (const instance of circuit.components) {
    const definition = registry.get(instance.type);
    if (!definition) continue;
    let props: Record<string, PropValue>;
    try {
      props = resolveProps(definition, instance.props, instance.id);
    } catch {
      continue;
    }
    const kind = symbolOf(definition, props)?.kind;
    const manual = kind !== 'clock' || props.mode === 'manual';
    if (
      (kind === 'switch' || kind === 'button' || kind === 'dip-switch' || kind === 'clock') &&
      manual
    ) {
      found.push(instance.id);
    }
  }
  return found;
}

/** The checker's list of a circuit's script: its benches, or why it doesn't load. */
export interface Listing {
  readonly circuit: string;
  /** The text it listed. */
  readonly source: string;
  readonly script: TestScript;
}

/**
 * The marks the editor shows for circuit `circuit` whose script is `source` now: the script's
 * error as listed while typing, else the results' — failures and errors at their lines — that
 * are not stale (their lines are of the text they ran).
 */
export function marksOf(
  state: TestsState,
  listing: Listing | undefined,
  document: CircuitDocument,
  circuit: string,
  source: string,
): ScriptMark[] {
  const marks: ScriptMark[] = [];
  const listed = listing?.circuit === circuit && listing.source === source ? listing : undefined;
  const error = listed?.script.error;
  if (error?.line !== undefined) {
    marks.push({ line: error.line, severity: 'error', message: error.message });
  }
  if (error) return marks;
  const tests = state.circuits.find((c) => c.circuit === circuit);
  if (!tests) return marks;
  const { scriptError } = tests;
  if (scriptError?.line !== undefined && !isStale(scriptError.basis, document, circuit)) {
    marks.push({ line: scriptError.line, severity: 'error', message: scriptError.message });
  }
  for (const row of tests.benches) {
    const result = row.result;
    if (!result || isStale(row.basis, document, circuit)) continue;
    for (const f of result.failures) {
      if (f.line === undefined) continue;
      marks.push({
        line: f.line,
        severity: 'error',
        message: `${row.name}: ${where(f.message, undefined, f.time)}`,
      });
    }
    if (result.error?.line !== undefined) {
      marks.push({
        line: result.error.line,
        severity: 'error',
        message: `${row.name}: ${result.error.message}`,
      });
    }
  }
  return marks;
}

/**
 * What a failing reference names in its circuit, to show on the canvas: an instance's, a
 * memory's or a pin's part (`A1/U3.Q0` → A1, `U5[1F]` → U5, `U1.Q0` → U1), or the wires of a
 * net or a bus by name (`CLK`, `D[0..7]`, `D3`).
 */
export function refItems(
  ref: string,
  circuit: Circuit,
  compiled: CompileResult | undefined,
): { readonly parts: readonly string[]; readonly wires: readonly string[] } {
  const ids = new Set(circuit.components.map((c) => c.id));
  const head = /^[^./[]+/.exec(ref)?.[0] ?? ref;
  if (ids.has(head)) return { parts: [head], wires: [] };
  const name = ref.replace(/\[.*$/, '');
  const wires = new Set<string>();
  // Nets joined by labels alone have no wires: their labels show where they are.
  const labels = new Set<string>();
  const add = (net: CompileResult['nets'][number]) => {
    for (const w of net.wires) wires.add(w.id);
    for (const pin of net.schematicPins) labels.add(pin.component);
  };
  for (const bus of compiled?.buses ?? []) {
    if (!bus.names.includes(name)) continue;
    for (const w of bus.wires) wires.add(w.id);
    for (const pin of bus.pins) labels.add(pin.component);
    for (const net of compiled?.nets ?? []) {
      if (net.names.some((n) => bus.members.includes(n))) add(net);
    }
  }
  // A range of bits by name (`D[0..7]` is D0…D7), one bit (`D[3]`), or a net's name.
  const names = new Set([ref, name]);
  const range = /^(.+)\[(\d+)(?:\.\.(\d+))?\]$/.exec(ref);
  if (range) {
    const [, base, from, to = from] = range as unknown as [string, string, string, string?];
    const [lo, hi] = [Number(from), Number(to)].sort((x, y) => x - y) as [number, number];
    for (let i = lo; i <= hi && i - lo < 256; i++) names.add(`${base}${i}`);
  }
  for (const net of compiled?.nets ?? []) {
    if (net.names.some((n) => names.has(n))) add(net);
  }
  return { parts: [...labels].filter((id) => ids.has(id)), wires: [...wires] };
}

function updateRow(
  circuits: readonly CircuitTests[],
  circuit: string,
  name: string,
  change: (row: BenchRow) => BenchRow,
): readonly CircuitTests[] {
  return circuits.map((c) =>
    c.circuit !== circuit
      ? c
      : { ...c, benches: c.benches.map((row) => (row.name === name ? change(row) : row)) },
  );
}

const at = (line: number | undefined) => (line === undefined ? {} : { line });

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;
}

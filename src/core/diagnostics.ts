import type { Time } from './time';

/** Diagnostics the kernel itself detects. Components may report any other kind. */
export const KernelDiagnosticKind = {
  CONTENTION: 'contention',
  FLOATING_INPUT: 'floating-input',
  OSCILLATION: 'oscillation',
} as const;

/**
 * Something worth telling the user about: a short circuit, a floating input, an oscillation, a
 * setup-time violation reported by a part, …
 */
export interface Diagnostic {
  /** When it first happened. */
  readonly time: Time;
  /** `contention`, `floating-input`, `oscillation`, or a component-defined kind. */
  readonly kind: string;
  readonly message: string;
  /** Net id, when the problem is about a net. */
  readonly net?: string;
  /** Component id, when the problem is about (or reported by) a component. */
  readonly component?: string;
  /** Pin name on `component`, when relevant. */
  readonly pin?: string;
  /** How many times it happened (repeats with the same kind/net/component/pin are merged). */
  readonly count: number;
  /** When it last happened. */
  readonly lastTime: Time;
}

/** What a component passes to `ctx.report()`; the kernel adds time and component id. */
export interface ComponentDiagnostic {
  /** E.g. `setup-violation`, `hold-violation`. */
  readonly kind: string;
  readonly message: string;
  /** Pin the problem is about (index into the instance's pins). */
  readonly pin?: number;
}

/** A new diagnostic before the log has counted it. */
export type DiagnosticInput = Omit<Diagnostic, 'count' | 'lastTime'>;

type Entry = { -readonly [K in keyof Diagnostic]: Diagnostic[K] };

/** What a `DiagnosticLog` held at a moment (`snapshot`): its entries and their counts. */
export interface DiagnosticLogSnapshot {
  /** The entries then (only `count` and `lastTime` of an entry ever change: see `counts`). */
  readonly entries: readonly Diagnostic[];
  readonly counts: Float64Array;
  readonly lastTimes: Float64Array;
  readonly dropped: number;
}

const keyOf = (d: DiagnosticInput) =>
  `${d.kind}|${d.net ?? ''}|${d.component ?? ''}|${d.pin ?? ''}`;

/** The same report (its first occurrence), whatever its count. */
function sameReport(a: Diagnostic, b: Diagnostic): boolean {
  return (
    a.kind === b.kind &&
    a.time === b.time &&
    a.message === b.message &&
    a.net === b.net &&
    a.component === b.component &&
    a.pin === b.pin
  );
}

/**
 * Collects diagnostics: merges repeats (same kind, net, component and pin → `count`, `lastTime`)
 * and keeps at most `max` distinct entries, counting the rest in `dropped`.
 */
export class DiagnosticLog {
  readonly max: number;
  private readonly list: Entry[] = [];
  private readonly byKey = new Map<string, Entry>();
  private readonly listeners: ((d: Diagnostic) => void)[] = [];
  private readonly occurrences: ((d: DiagnosticInput) => void)[] = [];
  private droppedCount = 0;

  constructor(max = 1000) {
    this.max = max;
  }

  /** Distinct diagnostics in order of first occurrence. */
  get entries(): readonly Diagnostic[] {
    return this.list;
  }

  /** Distinct diagnostics that did not fit under `max`. */
  get dropped(): number {
    return this.droppedCount;
  }

  add(input: DiagnosticInput): void {
    for (const listener of this.occurrences) listener(input);
    const key = keyOf(input);
    const existing = this.byKey.get(key);
    if (existing) {
      existing.count++;
      existing.lastTime = input.time;
      return;
    }
    if (this.list.length >= this.max) {
      this.droppedCount++;
      return;
    }
    const entry: Entry = { ...input, count: 1, lastTime: input.time };
    this.list.push(entry);
    this.byKey.set(key, entry);
    for (const listener of this.listeners) listener(entry);
  }

  /** The entries and their counts now, for `restore` (entries are shared, counts copied). */
  snapshot(): DiagnosticLogSnapshot {
    const list = this.list;
    return {
      entries: list.slice(),
      counts: Float64Array.from(list, (d) => d.count),
      lastTimes: Float64Array.from(list, (d) => d.lastTime),
      dropped: this.droppedCount,
    };
  }

  /**
   * Back to what a snapshot (of this log or another) held: later entries go, counts are reset.
   * An entry still here for the same report is kept as the same object (a "cleared" mark held
   * by the UI stays valid). Listeners are not called.
   */
  restore(snapshot: DiagnosticLogSnapshot): void {
    const list = this.list;
    snapshot.entries.forEach((saved, i) => {
      let entry = list[i];
      if (entry === undefined || !sameReport(entry, saved)) {
        entry = { ...saved };
        list[i] = entry;
      }
      entry.count = snapshot.counts[i]!;
      entry.lastTime = snapshot.lastTimes[i]!;
    });
    list.length = snapshot.entries.length;
    this.byKey.clear();
    for (const entry of list) this.byKey.set(keyOf(entry), entry);
    this.droppedCount = snapshot.dropped;
  }

  /**
   * Calls `listener` for every report, repeats of a merged entry and dropped ones included (a
   * debugger breaking on each). Returns an unsubscribe function.
   */
  onOccurrence(listener: (d: DiagnosticInput) => void): () => void {
    this.occurrences.push(listener);
    return () => {
      const i = this.occurrences.indexOf(listener);
      if (i >= 0) this.occurrences.splice(i, 1);
    };
  }

  /** Calls `listener` for each new distinct diagnostic. Returns an unsubscribe function. */
  subscribe(listener: (d: Diagnostic) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}

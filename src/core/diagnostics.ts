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

/**
 * Collects diagnostics: merges repeats (same kind, net, component and pin → `count`, `lastTime`)
 * and keeps at most `max` distinct entries, counting the rest in `dropped`.
 */
export class DiagnosticLog {
  readonly max: number;
  private readonly list: Entry[] = [];
  private readonly byKey = new Map<string, Entry>();
  private readonly listeners: ((d: Diagnostic) => void)[] = [];
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
    const key = `${input.kind}|${input.net ?? ''}|${input.component ?? ''}|${input.pin ?? ''}`;
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

  /** Calls `listener` for each new distinct diagnostic. Returns an unsubscribe function. */
  subscribe(listener: (d: Diagnostic) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}

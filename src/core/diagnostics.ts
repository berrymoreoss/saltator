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
}

/** What a component passes to `ctx.report()`; the kernel adds time and component id. */
export interface ComponentDiagnostic {
  /** E.g. `setup-violation`, `hold-violation`. */
  readonly kind: string;
  readonly message: string;
  /** Pin the problem is about (index into the instance's pins). */
  readonly pin?: number;
}

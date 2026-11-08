/**
 * The test benches of the document open (R15b): runs on the runner's sandbox with their
 * results in `state` (tests-view.ts), the open circuit's script listed by the checker as it is
 * typed (`listing`: its benches, or its error), kept for the session — results of a deleted
 * circuit dropped, all of it forgotten when another document is shown (`reset`). Spec:
 * docs/editor.md#tests.
 */
import type { RunTarget } from '../circuit';
import { type Editor, Store } from '../editor';
import type { TestRunner } from './test-runner';
import {
  benchFinished,
  benchStarted,
  EMPTY_TESTS,
  type Listing,
  pruneTests,
  runEnded,
  runPlanned,
  runStarted,
  scriptFailed,
  type TestsState,
} from './tests-view';

/** The two sandboxes: one lists scripts as they are typed, the other runs benches. */
export interface TestRunners {
  readonly checker: TestRunner;
  readonly runner: TestRunner;
}

export class TestSession {
  readonly state = new Store<TestsState>(EMPTY_TESTS);
  /** The checker's latest list of a script. */
  readonly listing = new Store<Listing | undefined>(undefined);
  readonly #editor: Editor;
  readonly #runners: TestRunners;
  /** Grows with each run and reset: what an older run tells is dropped. */
  #runs = 0;
  /** Grows with each reset: a list of the document before is dropped. */
  #documents = 0;
  readonly #unsubscribe: () => void;

  constructor(editor: Editor, runners: TestRunners) {
    this.#editor = editor;
    this.#runners = runners;
    this.#unsubscribe = editor.state.subscribe(() =>
      this.state.update((s) => pruneTests(s, editor.state.get().document)),
    );
  }

  get running(): boolean {
    return this.state.get().run !== undefined;
  }

  /** Runs benches of circuits of the document as it is now; a run going on is cancelled first. */
  async run(targets: readonly RunTarget[]): Promise<void> {
    if (targets.length === 0) return;
    if (this.running) {
      this.#runners.runner.cancel();
      this.state.update((s) => runEnded(s, { status: 'cancelled', notRun: [] }));
    }
    const run = ++this.#runs;
    const apply = (change: (state: TestsState) => TestsState) => {
      if (run === this.#runs) this.state.update(change);
    };
    const document = this.#editor.state.get().document;
    this.state.update((s) => runStarted(s, document, targets));
    const outcome = await this.#runners.runner.run(document, targets, {
      planned: (plan) => apply((s) => runPlanned(s, document, plan)),
      started: (_index, bench) => apply((s) => benchStarted(s, bench)),
      result: (circuit, result) => apply((s) => benchFinished(s, circuit, result)),
      scriptError: (circuit, error) => apply((s) => scriptFailed(s, document, circuit, error)),
    });
    apply((s) => runEnded(s, outcome));
  }

  /** Every bench of the circuit open. */
  runOpen(): Promise<void> {
    return this.run([{ circuit: this.#editor.state.get().circuit.id }]);
  }

  /** Every bench of every circuit with a script. */
  runAll(): Promise<void> {
    const { document } = this.#editor.state.get();
    return this.run(
      document.circuits.filter((c) => c.testScript.length > 0).map((c) => ({ circuit: c.id })),
    );
  }

  /** One bench. */
  runBench(circuit: string, bench: string): Promise<void> {
    return this.run([{ circuit, benches: [bench] }]);
  }

  cancel(): void {
    this.#runners.runner.cancel();
  }

  /** Lists circuit `circuit`'s script `source` (its top level runs in the checker's sandbox). */
  async check(circuit: string, source: string): Promise<void> {
    const document = this.#documents;
    const script = await this.#runners.checker.load(source);
    if (script && document === this.#documents) this.listing.set({ circuit, source, script });
  }

  /** Another document: runs cancelled, results and lists forgotten. */
  reset(): void {
    this.#runs++;
    this.#documents++;
    this.#runners.runner.cancel();
    this.state.set(EMPTY_TESTS);
    this.listing.set(undefined);
  }

  dispose(): void {
    this.reset();
    this.#unsubscribe();
  }
}

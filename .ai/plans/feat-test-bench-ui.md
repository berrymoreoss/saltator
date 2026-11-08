# Plan: feat/test-bench-ui

| Field      | Value                                                                          |
| ---------- | ------------------------------------------------------------------------------ |
| Branch     | `feat/test-bench-ui`                                                           |
| Roadmap    | R15b — Test benches in the app ([roadmap](../../docs/roadmap.md))              |
| Status     | in-progress                                                                    |
| Depends on | R15a (scripts, `runBench`, `functionScriptHost`), R12b (image files), R14, R11 |
| Created    | 2026-11-08                                                                     |

## Goal

**Test before fab, in the app**: a Tests tab where a circuit's test script is written with its
errors marked as one types, its benches run — off the UI thread, in a sandbox a document's code
can't get out of — with progress and Cancel, and the results show every failure with its line,
instant, signal, expected and actual value, a click away from the line. Insert Image… turns a
`.bin`/`.hex` file into a memory load in the script. With R15a's headless runs this closes M2
"Tools": a test bench with a memory setup passing in the app and in CI.

## Scope

**In scope**

- `editor`: editing a circuit's test script as a document edit (undo/redo, autosave, dirty
  mark), typing coalesced into one undo step, without restarting the simulation or its history.
- `circuit`: a pure **bench service** — the request/response protocol a runner speaks (load a
  script: its benches or its error; run benches: start, result, done), on any `ScriptHost`.
- The **browser sandbox** (per Q1): the runner bundled into one self-contained script, started
  in a Worker inside an opaque-origin iframe whose CSP allows no network; jobs, progress, a time
  limit per bench, Cancel. It never falls back to running a script in the page.
- `ui`: the **Tests tab** — the open circuit's script in a code editor (per Q3) with the
  script's error and the failures marked at their lines; Run (the open circuit), Run All (every
  circuit of the document), run one bench, Cancel; results grouped by circuit, failures,
  warnings and logs, stale after an edit; counts on the tab; commands and shortcuts.
- **Insert Image…**: a `.bin` or Intel HEX file becomes a `b.memory(…)` /
  `b.loadIntelHex(…)` call at the cursor, for a memory of the circuit picked in the dialog.
- Going from a failure to its line, and to its signal on the canvas (per Q4).
- e2e: the M2 acceptance in the app — RAM by Hand's bench (a memory loaded before power-on)
  passing in the Tests tab.
- Docs: editor.md (Tests tab), circuit.md (the browser host), architecture (the sandbox, the
  runner bundle), ADR-0026, README of `src/ui`, lessons, roadmap (R15b done, M2 closed).

**Out of scope** (and where it goes instead)

- Running benches automatically on every edit (a watch mode) → backlog; results go stale and
  say so.
- Rewriting a script's references when a part is renamed → backlog (the code editor's search
  and replace is the tool for now).
- JUnit/JSON reports, coverage → backlog (R15a's follow-ups).
- Line numbers from Firefox/Safari stacks → backlog (e2e runs Chromium; R15a's lesson).
- Waveforms of a bench's run (the bench's signals recorded in the sandbox and shown in the
  Waveforms tab) → backlog (Q4).

## Context

Read before starting:

- [docs/circuit.md#test-benches](../../docs/circuit.md#test-benches) — the script API, the
  report, `ScriptHost`, `functionScriptHost`.
- [ADR-0025](../../docs/adr/0025-test-benches.md) — "the app must sandbox (an opaque-origin
  iframe or worker) and probably ask before running a file's scripts".
- [docs/editor.md](../../docs/editor.md#shell) — the bottom dock tabs; the Debug tab's layout
  and commands as the pattern; [Image files](../../docs/editor.md#image-files) (R12b's Load
  dialog).
- `src/circuit/bench/script.ts` (`loadTestScript`, `runBench`), `function-host.ts`.
- `src/editor/editor.ts` (`editDocument`, `coalesce`), `src/editor/simulation.ts` (`sync`:
  same netlist structure, no rebuild).
- `src/ui/Workbench.tsx` (tabs, injected `imageFiles`), `src/ui/settings.ts` (`BottomTab`),
  `src/ui/workbench-commands.ts`, `src/ui/commands.ts` (`isTextField`), `src/ui/image-dialogs.ts`,
  `src/ui/browser-storage.ts` (file handles in IndexedDB — what a same-origin script could reach).
- `vite.config.ts`, `scripts/check-layers.ts`.

## Design

### Answered forks (2026-11-08)

- **Q1 Sandbox**: an opaque-origin iframe (`sandbox="allow-scripts"`) with a no-network CSP,
  the runner in a Worker started from a blob of its bundle (A).
- **Q2 Trust**: no prompt; scripts run only in the sandbox, never in the page (A).
- **Q3 Editor**: CodeMirror 6, lazy-loaded with the Tests tab; an ADR for the dependency (A).
- **Q4 Debugging**: a failure goes to its line and to its signal on the canvas; waveforms of a
  bench run → backlog (A).

### The threat, and the sandbox (Q1)

A document's script is code from whoever wrote the file. Run in the app's origin — the page or
a same-origin Worker — it can read the autosaved documents and Open Recent's file handles in
IndexedDB (and write through a handle whose permission was granted), and send what it finds
anywhere. A spike in Chromium (2026-11-08, scratchpad) confirmed the proposed sandbox holds:

```text
app page ── MessagePort ──────────────────────────────┐
  └ <iframe sandbox="allow-scripts" srcdoc=…>          │   origin "null"; CSP: default-src 'none';
      └ new Worker(blob: runner bundle) ◄──────────────┘   script-src 'unsafe-inline' blob:; worker-src blob:
```

In the worker: `self.origin` is `null`, `indexedDB.open` throws `SecurityError`, `fetch`,
`importScripts` and `import()` of any URL fail (CSP, inherited by the blob worker), stack
frames still carry the script's lines. `terminate()` ends a runaway loop.

- **A** (recommended): that — iframe + CSP + Worker. Isolation from the app's storage and the
  network, off the UI thread, Cancel. Cost: the runner must be one self-contained script
  (below).
- **B**: a Worker from a `data:` URL — opaque origin (no app storage), but the network stays
  open (a script could send the document out). Simpler: no iframe.
- **C**: a same-origin module Worker (Vite's usual `new Worker(new URL(…))`) with a prelude
  deleting `fetch`, `indexedDB`, … — simplest, but a deny-list is no boundary (nested workers,
  prototypes, the next API added); it would need Q2's prompt to be honest.

**The runner bundle**: a Vite plugin (`scripts/vite-bench-runner.ts`) serves a virtual module
`virtual:bench-runner` whose default export is the runner's code as a string — Vite's `build`
API bundling `src/app/bench-worker.ts` (circuit + library + `functionScriptHost` + the bench
service) into one minified IIFE (spike: 227 KB, 40 ms), the same in `pnpm dev` and
`pnpm build`, rebuilt when its files change. The app imports it lazily (`import()`) the first
time tests run, so the main bundle doesn't grow.

### Trust (Q2)

- **A** (recommended with sandbox A): no prompt. Scripts run only in the sandbox — listing a
  script's benches (its top level runs) when the Tests tab shows it, the benches on Run. The
  sandbox is the boundary; a prompt adds a click and no safety.
- **B**: ask once per document opened from a file or an example before its scripts run
  ("This document has test scripts. Run them in the sandbox?").

### The script editor (Q3)

- **A** (recommended): **CodeMirror 6** (`@codemirror/*` in `ui`, loaded lazily with the Tests
  tab, ≈ 130 KB gzipped): JavaScript highlighting, line numbers, the script's error and the
  failures as gutter marks and underlines (its lint extension), completion of `bench`, `b.…`
  and the circuit's references (ports, parts, nets, buses — fewer `no part U9` errors), search
  and replace (the stopgap for renames), bracket matching, its own undo while typing. An ADR:
  the first editor package.
- **B**: a `<textarea>` with a line-number gutter and the error line highlighted — no
  dependency, no highlighting or completion.
- Monaco was considered and rejected: megabytes, workers of its own, a heavier fit to a dense
  dock.

Undo: typing commits the script to the document as one coalesced step (`Edit Test Script`);
the code editor's own undo handles keystrokes while it has focus (the app's shortcuts stay out
of a text field: `isTextField` learns `contenteditable`); an undo from the menu or after
leaving the editor replaces its text from the document.

### Debugging a failure (Q4)

- **A** (recommended for R15b): a failure (or the script's error) is a click away from its
  line — the circuit opened, the editor at the line, the line marked — and from its signal: the
  net or part located on the canvas when the failing reference resolves in the circuit open.
  The waveforms of a bench's run → backlog.
- **B**: also record the bench's signals (what it drove and checked, and the circuit's probes)
  in the sandbox and show them in the Waveforms tab as a "bench record" with a cursor at the
  failure. Much more: the Waveforms tab learns to show a record that isn't the live
  simulation's.

### The bench service (pure, `circuit`)

```ts
type BenchRequest =
  | { kind: 'load'; job: number; source: string } // → loaded
  | { kind: 'run'; job: number; document: CircuitDocument; circuits: readonly RunTarget[] };
type RunTarget = { circuit: string; benches?: readonly string[] }; // all, or these
type BenchResponse =
  | { kind: 'loaded'; job: number; script: TestScript }
  | { kind: 'started'; job: number; circuit: string; bench: string; index: number; total: number }
  | { kind: 'result'; job: number; circuit: string; result: BenchResult }
  | { kind: 'script-error'; job: number; circuit: string; error: TestScript['error'] }
  | { kind: 'done'; job: number };
function benchService(
  library: ComponentRegistry,
  host: ScriptHost,
): (request: BenchRequest, reply: (response: BenchResponse) => void) => void;
```

Pure and synchronous: tested in Node with `functionScriptHost` on the R15a test circuits. The
worker entry (`src/app/bench-worker.ts`) is a few lines around it. The library in the worker is
`createDefaultRegistry()` (plus the dev fixtures in dev builds, as the app has them).

### The runner client (`ui`, `test-runner.ts`)

- Starts the sandbox on first use (the iframe, then the worker from the bundle's text, a
  `MessagePort` straight to the worker); one job at a time, newer requests replacing queued
  ones (a load per edit burst, debounced ~300 ms).
- **Time limit**: a bench that sends nothing for 60 s (as the Node host) — and a script's top
  level within 5 s — ends as an `error` ("didn't finish within 60 s"): the worker is terminated
  and started afresh for what comes next.
- **Cancel** terminates the worker the same way; benches not run are listed as not run.
- A sandbox that can't start (no Worker in an opaque origin, a CSP the browser lacks) is an
  error in the tab — never a run in the page.
- Syntax errors' lines: `new Function` gives none in V8's stack; the worker compiles the script
  as a blob (`importScripts`) first to get `lineno` from the error, or reports it without a line
  (to be settled in task 4).

### The Tests tab

```text
 ▶ Run  ▶▶ Run All  ■ Cancel │ Insert Image… │ Decade Counter · 3 benches          Running 2 of 9…
┌─────────────────────────────────────────────────────┬──────────────────────────────────────────┐
│  1  // Circuit: Decade Counter                       │ ▾ Decade Counter            ✓ 2 ✗ 1      │
│  2  const clear = (b) => {                           │   ✓ counts to 9, carries…  ▶   13 µs    │
│  3 ●  b.row({ '~{RST}': 0, EN: 1, CLK: 'C' }, …      │   ✗ holds while disabled   ▶   14 µs    │
│  4    b.set({ '~{RST}': 1 });                        │     line 3 at 1 µs: Q[0..3] is 0xX,      │
│  5  };                                               │       expected 0x0                       │
│  …                                                   │ ▸ Counter Digit             ✓ 1   stale  │
└─────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

- The seventh bottom-dock tab (`TestsPanel.tsx`, pure pieces in `tests-view.ts`): the open
  circuit's script on the left, results of every circuit run on the right (the open one first),
  a splitter between them. The tab's badge: `✗ 1` when something failed, else the passed count.
- **Results** per bench: status, name, run button, simulated time; under a failing or erring
  one its failures (`line N at t: …`, then "and 12 more"), the error, the warnings and logs.
  Kept for the session (not the file), per circuit; marked **stale** once that circuit — or a
  circuit it places — or its script changes; forgotten when another document loads.
- **Commands**: Run Tests (`Mod+Enter`: the open circuit), Run All Tests (`Mod+Shift+Enter`),
  Cancel Tests, Insert Image…, View ▸ Tests; a Test menu or the Simulate menu (whichever the
  menu bar's layout suits) holds them.
- A circuit without a script shows a starter: a commented template naming its ports, written on
  the first keystroke.

### Insert Image…

The R12b file reader (`.bin`, Intel HEX), then a small dialog: the memory (the open circuit's
memory parts — RAMs and ROMs, by designator), for a `.bin` the load address. Writes at the
cursor, one undo step:

```js
b.memory(
  'U1',
  0x000,
  `
  2A 55 FF 00 01 02 03 04 05 06 07 08 09 0A 0B 0C
  …
`,
); // program.bin, 1 024 bytes
b.loadIntelHex(
  'U2',
  `
:10000000…
:00000001FF
`,
); // decoder.hex
```

Sixteen bytes per line (the Memory tab's rows); an Intel HEX file's text as it is. The inserted
call must run: a unit test loads what it writes into a bench.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [ ] 1. `editor`: `Editor.setTestScript(circuitId, source)` — a document edit, coalesced while
  typing, no simulation restart and no history reset (tests at the host, R11b lesson).
- [ ] 2. `circuit`: the bench service and its protocol types; tests with `functionScriptHost`
  (load, run all / some benches, script errors, results in order, determinism).
- [ ] 3. The runner bundle: `src/app/bench-worker.ts`, the Vite plugin and `virtual:bench-runner`
  (types, dev and build, rebuilt on change), layer check aware of it; a test that the bundle
  builds and runs a bench (Node: evaluating the IIFE with a fake `self`).
- [ ] 4. `ui`: the sandbox client (`test-runner.ts`): iframe, CSP, blob worker, port, jobs,
  progress, time limits, Cancel, restart, start failures; syntax-error lines. Unit-tested over
  a fake transport; the real sandbox in e2e.
- [ ] 5. `ui`: `tests-view.ts` — results per circuit, stale tracking, badge counts, failure rows,
  the starter template; unit tests.
- [ ] 6. `ui`: the script editor (per Q3), lazy-loaded: highlighting, gutter marks, completion
  of the API and the circuit's references, document ↔ editor text, shortcuts kept inside it.
- [ ] 7. `ui`: the Tests tab and its commands, Workbench wiring, settings (`BottomTab`), the
  badge; going to a failure's line and signal (per Q4).
- [ ] 8. `ui`: Insert Image… — dialog, the text it writes (tested by running it in a bench).
- [ ] 9. e2e `tests/e2e/tests.spec.ts`: RAM by Hand passes in the app (M2); a broken expectation
  fails with its line and the click goes there; `while (true)` is cancelled and times out, the
  next run works; the sandbox can't reach `localStorage`, `indexedDB`, `fetch`; Insert Image…
  writes a load that passes; the script survives undo and save/load.
- [ ] 10. Docs: editor.md (Tests tab), circuit.md (browser host), architecture, ADR-0026,
  `src/ui/README.md`, glossary, lessons; roadmap (R15b done, M2 acceptance, R16a next).

## Acceptance criteria

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green; the Tests tab looked at in the browser.
- [ ] RAM by Hand's benches (a memory loaded before power-on) pass in the Tests tab, as they do
  in `pnpm test:circuits` (M2's "test bench with a memory setup passing in the app and headless
  in CI").
- [ ] A failing bench shows `line N at t: ref is …, expected …`; clicking it puts the editor at
  line N.
- [ ] A script with a syntax error or an exception at its top level shows the error at its line
  while typing, before any run.
- [ ] A `while (true)` bench is stopped by Cancel and by the time limit; the UI stays responsive
  meanwhile; the next run passes.
- [ ] A script in the app can't read `localStorage` or `indexedDB` or reach the network (e2e).
- [ ] Editing a script while the simulation runs neither restarts it nor drops its history; the
  edit is one undo step per burst of typing and survives save/load.
- [ ] Insert Image… from a `.bin` and a `.hex` file writes a call that loads those bytes in a
  bench.
- [ ] The main bundle doesn't carry the runner or the code editor (lazy chunks; `pnpm build`
  output).

## Open questions

- [x] Q1. The browser sandbox — _proposed:_ A, an opaque-origin iframe with a no-network CSP
  starting the runner in a blob Worker — **answer:** A.
- [x] Q2. Ask before running a file's scripts? — _proposed:_ A, no prompt; scripts run only in
  the sandbox — **answer:** A, no prompt.
- [x] Q3. The script editor — _proposed:_ A, CodeMirror 6, lazy-loaded — **answer:** A.
- [x] Q4. Debugging a failure — _proposed:_ A, to its line and its signal on the canvas;
  waveforms of a bench run → backlog — **answer:** A.

## Progress log

- 2026-11-08 — plan drafted; sandbox and bundling spiked in Chromium (scratchpad, not
  committed); Q1–Q4 answered as proposed.
- 2026-11-08 — plan approved; branch started (roadmap: R15b in-progress).

## Handoff

- **State:** plan approved, Q1–Q4 answered (all as proposed); no code yet.
- **Next step:** task 1 (`Editor.setTestScript`).
- **Watch out:** never run a document's script in the page; `functionScriptHost` has no
  isolation of its own.
- **Verify with:** `pnpm check`; `pnpm e2e`.

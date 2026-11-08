# 0026. Test benches in the app: an opaque-origin sandbox, no prompt, CodeMirror

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** R15b (feat/test-bench-ui)

## Context

R15a put JavaScript test scripts in the document and ran them headless, leaving the app's side
open: "the app must sandbox (an opaque-origin iframe or worker) and probably ask before running
a file's scripts" ([ADR-0025](0025-test-benches.md)). Forces:

- A document's script is code from whoever wrote the file. In the app's origin — the page or a
  same-origin Worker — it could read the autosaved documents and Open Recent's file handles in
  IndexedDB, write through a handle whose permission was granted, and send what it finds
  anywhere.
- Benches are synchronous (ADR-0025, Q7) and a script may never end (`while (true)`): they must
  run off the UI thread, with progress, Cancel and a time limit.
- A script's errors should show as it is typed, which means running its top level (to collect
  its `bench(…)` calls) on every pause in typing — automatically, before any Run.
- Scripts are written in the app: an editor that knows JavaScript, marks lines and completes the
  circuit's references makes them far easier to write than a plain text box.

## Decision

- **Sandbox** (Q1 of the plan): a hidden `<iframe sandbox="allow-scripts">` — an opaque origin
  (`null`: no cookies, storage or IndexedDB of the app's) — whose page carries a CSP of
  `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:`. Its
  inline bootstrap starts the runner in a **Worker from a blob** of the runner's text (the
  worker inherits the CSP: no `fetch`, XHR, `importScripts` or `import()` of any URL;
  `'unsafe-eval'` because the script host is `new Function`) and hands it a `MessagePort`
  straight from the app. Stopping removes the iframe, which ends the worker — Cancel and the time
  limits (5 s for a script's top level, 60 s a bench) work on any loop. A sandbox that can't
  start is an error; a script never runs in the page.
- **The runner bundle**: the worker can load nothing from the app's origin, so the runner
  (`src/app/bench-worker.ts`: `circuit`'s bench service, the library, `functionScriptHost`) is
  one self-contained script, its text served by a Vite plugin as `virtual:bench-runner`
  (scripts/vite-bench-runner.ts: Vite's own `build`, an IIFE, the same in dev, build and
  vitest), imported lazily (222 KB, its own chunk).
- **The protocol**: a pure bench service in `circuit` (`load` → the script's benches or its
  error; `run` → a plan, then each bench's start and result) — tested in Node — and a client in
  `ui` (`TestRunner`) with the queue, the limits and the restarts. Two runners: one lists the
  open script as it is typed, the other runs benches, so a long run doesn't hold the marks up.
- **Trust** (Q2): no prompt. The sandbox is the boundary; scripts run only in it — listed
  automatically, benches on Run.
- **Editor** (Q3): **CodeMirror 6** (`@codemirror/*`, `@lezer/highlight` in `ui`), loaded with
  the Tests tab (its own chunk): highlighting in the app's colors, line numbers, lint marks,
  completion of the bench API and the circuit's references, search and replace, its own undo
  while typing; the document stays the source of truth (one coalesced undo step per burst of
  typing; the document's text replaces the editor's without entering its history).
- **Debugging** (Q4): a failure is a click away from its line and its signal on the canvas;
  waveforms of a bench's run are left for later.

## Consequences

- Opening someone's file is as safe as before scripts existed: its benches can compute and
  report, nothing more. A determined script can still spin (stopped by the limits) or make its
  own benches pass.
- The runner is bundled twice (in the app and in its chunk): the cost of an isolated realm; it
  loads only when the Tests tab is used.
- Line numbers: V8 gives none for a syntax error from `new Function`; the worker finds it by
  parsing the script in a nested worker (`ErrorEvent.lineno`). Other engines give no lines until
  a host learns their stack format (as in R15a).
- The worker posts each answer at once (not in a microtask), or a bench that never ends would
  keep its own `started` from the app.
- The e2e test that the sandbox holds was checked by mutation: without the policy a script's XHR
  reads an answer (`xhr 200`).
- A first editor package: its keymap leaves `Mod+Enter` (Run Tests) to the app; its theme reads
  the app's tokens (`--code-*`).

## Alternatives considered

- **A Worker from a `data:` URL** — an opaque origin without an iframe, but the network stays
  open: a script could send the document anywhere.
- **A same-origin Worker with a prelude deleting `fetch`, `indexedDB`, …** — Vite's usual worker,
  simplest; a deny-list is no boundary (nested workers, prototypes, the next API), so it would
  need a prompt to be honest.
- **The iframe alone** — isolation, but not off the UI thread in every browser, and a loop in it
  can't be stopped.
- **Asking before running a file's scripts** — a click of no safety once the sandbox holds.
- **A `<textarea>` with a gutter** — no dependency, but no highlighting, completion or search.
- **Monaco** — megabytes and workers of its own for a box in a dock.
- **Recording the bench's signals for the Waveforms tab** (Q4 B) — the most useful view of a
  failure, but the Waveforms tab would have to show a record that isn't the live simulation's;
  later.

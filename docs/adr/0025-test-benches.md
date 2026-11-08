# 0025. Test benches: JavaScript scripts in the document, run in fixed steps by a script host

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** R15a (feat/test-benches)

## Context

"Test before fab" needs a circuit to prove itself: inputs applied, outputs checked over
simulated time, a pass/fail report, the same in the app and headless in CI. Until now the
examples' behavior was tested by hand-written TypeScript in `tests/scenarios/` — powerful, but
outside the document, unreadable to the app, and not something a user of the app writes. Forces:

- A bench must test one circuit **as a unit**: R16a's SAP-1 modules are subcircuits, each with
  its own benches, before they are put together (R16b).
- Real timing matters: set-up and hold times, propagation delays, free-running clocks. A bench
  that "settles" between rows hides them, and never ends with a clock running.
- Benches need tables of vectors (truth tables, counters) **and** logic around them: loops,
  computed values, memories loaded before power-on, waits for a slow clock.
- The kernel is deterministic and the pure layers have no DOM and no Node; running the user's
  text must not change that.
- Running code from a document is running someone's code.

## Decision

- **Where**: each circuit has a test script in the document (`Circuit.testScript`, its lines;
  schema v5), like probes (ADR-0019): it travels with the file, undo, copies of the circuit.
- **What** (Q3, Q7–Q9 of the plan): **JavaScript**, one script per circuit registering benches
  with `bench(name, fn)`, on a small **synchronous** API `b` — `set`, `press`, `clock`, `wait`,
  `row`, `expect`, `get`, `memory`, `loadIntelHex`, … — with test vectors as text tables inside
  the script (`` b.table`A B | Y …` ``). The text DSL proposed first was declined for JS's
  reach; a JSON grid and async benches were declined too.
- **How time passes** (Q4): in **fixed steps** (default 1 µs): inputs at a step's start, a clock
  pulse from ¼ to ¾ (LOW from the start), outputs checked at its end; `wait` lets time pass. A
  step too short for a part's set-up time fails on the violation.
- **What a bench drives**: the tested circuit compiled **as the top** with a test driver on
  every input and bidirectional port, and interactive parts operated by symbol kind as the
  Interact tool does; nothing else (no forcing nets).
- **What fails** (Q6): mismatches are soft failures (all reported, the first 100 kept);
  simulation errors fail at their instant; warnings are listed; exceptions and bad references
  end the bench as an error.
- **Memories** (Q5): bytes from the script — a RAM by `poke` at any time, a ROM's image in the
  bench's netlist before power-on.
- **Where code runs**: the bench and the runner are pure (`circuit`); the script's text becomes
  code only in a `ScriptHost` at the edge — a `node:vm` context in Node (only the bench's
  globals, no `Math.random`, `Date`, `console`; a time limit), `new Function` in a realm one
  trusts. Each bench loads the script afresh. The app's host is a browser sandbox (R15b).
- **Headless**: `pnpm test:circuits` for any documents (exit codes for CI); every example bench
  runs in `pnpm check`.

## Consequences

- Benches are as expressive as the language: helpers, loops, computed expectations, a 6502
  program's checks later (R19, R20) — and as dangerous: a document's script is code. The Node
  host is not a security boundary (CI runs one's own files); the app must sandbox (an
  opaque-origin iframe or worker) and probably ask before running a file's scripts (R15b).
- References in scripts are strings in code: a part rename doesn't rewrite them (probes'
  references are rewritten); the bench says `no part U9` instead.
- Determinism holds by construction: no clock, no unseeded randomness in the script's realm,
  a fresh simulation and script per bench. A determined script can still reach the host realm
  through the functions it is given — not a goal to prevent in Node.
- Failures name the script line from stack frames (V8: Node, Chromium); other engines give no
  lines until a host learns their stack format.
- The examples' TypeScript scenario tests can move to their documents' scripts over time; the
  SAP-1 modules (R16a) start there.

## Alternatives considered

- **A text DSL** (Digital-style header and rows plus `step`, `wait`, `for`, `memory`) — pure,
  safe and easy to edit, but every new need (functions, computed expectations) grows the
  language; the user chose JavaScript and the tables live on inside it.
- **Structured JSON tables edited in a grid** — no parser, but loops and setup become UI
  widgets and long tests are tedious.
- **TypeScript tests in the repository only** — powerful, but not part of the document and not
  runnable or writable in the app.
- **Settling between rows** (run until quiet, Digital-style) — hides timing and never ends
  with a free-running clock; explicit times on every row — long and error-prone.
- **Async benches** (`await b.clock()`), so a host could yield to the UI — a forgotten `await`
  silently reorders steps; the app runs scripts off the UI thread instead.
- **Separate `.bench` files** — clean diffs, but the browser has no path to a file beside the
  document.

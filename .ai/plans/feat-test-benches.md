# Plan: feat/test-benches

| Field      | Value                                                                                |
| ---------- | ------------------------------------------------------------------------------------ |
| Branch     | `feat/test-benches`                                                                  |
| Roadmap    | R15a — Test benches: scripts and headless runner ([roadmap](../../docs/roadmap.md))  |
| Status     | in-progress                                                                          |
| Depends on | R11a (`compileDesign` with `top`, ports, resolver paths), R12b (images, `poke`), R14 |
| Created    | 2026-11-08                                                                           |

## Goal

**Test before fab**: a circuit carries its own test script — benches written in JavaScript on a
small synchronous API (drive the inputs, pulse a clock, wait, check the outputs, load a memory,
and test vectors as text tables inside the script) — that runs headless in Node and CI and gives
a pass/fail report naming the line, the instant, the signal, what was expected and what was
there. A bench tests one circuit of the document as a unit: a subcircuit through its ports
(R16a's SAP-1 modules, each with its own benches), the top circuit through its switches,
buttons and clocks as a hand on the board would (R16b's SAP-1 with a program in its RAM). R15
was split at its start (Q1): this branch (R15a) is the script API, the runner, the document
field, the headless runs and the example benches; R15b (`feat/test-bench-ui`) is the Tests tab
in the app, which runs the same scripts in a sandbox.

## Scope

**In scope**

- `circuit`: a test script per circuit in the document (`Circuit.testScript`, its lines; schema
  v5 with a migration), kept by undo/redo, save/load and copy/paste of circuits.
- `circuit`: the **bench API** and **runner** — compile the bench's circuit as the top
  (`compileDesign(…, { top })`), a driver on every `in`/`bidir` port, references through the
  resolver (instance paths included), inputs (ports, switches, buttons, DIP switches, manual
  clocks, raw actions), time (`wait`, `clock`, `row` in fixed steps), checks (`expect`, `get`),
  text tables (`` b.table`…` ``), memories (`memory`, Intel HEX), diagnostics as failures, a
  report. Pure: the script's text becomes a function only in a **script host** at the edge.
- A Node script host (`node:vm` context: only the API's globals, no `Math.random`/`Date`, a
  time limit, lines from stack frames).
- Headless runs: a scenario test running every bench of every example (`pnpm check`, so CI) and
  a CLI for any document — `pnpm test:circuits [files…]`, one line per bench, every failure, a
  non-zero exit code on failure.
- Benches on examples: Half Adder (a truth table), Two-Digit Counter (Decade Counter and Counter
  Digit through their ports, Main through RESET and its free-running clock), RAM by Hand (a
  memory loaded before power-on, read back through the switches) — M2's "test bench with a
  memory setup".
- Docs: circuit.md (Test benches), simulation.md (points at it), architecture, glossary,
  ADR-0025, roadmap (the split), lessons.

**Out of scope** (and where it goes instead)

- The Tests tab: listing, editing and running benches in the app, the browser sandbox, results,
  Insert Image… → R15b.
- Rewriting references in a test script when a part is renamed: they are string literals in
  code, maybe computed; a renamed part makes the bench report `no part SW1` instead → backlog
  (R15b may offer a find-and-replace).
- Forcing arbitrary nets (an injector that wins over a chip's output) → backlog; a bench drives
  ports and interactive parts, as a connector and a hand would.
- `b.settle()` (run until quiet) — time passes in fixed steps and waits (Q4) → backlog if needed.
- JUnit/JSON reports for CI dashboards; coverage (which nets toggled) → backlog.
- Debugging a failing bench in the live simulation (replay it, pause at the failure) → R15b or
  backlog.

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md#test-bench) — core's part `Bench`,
  `functionTable` (data, clocks, transition `gap` apart; all failing rows reported together),
  run statuses, `action`, diagnostics.
- [docs/circuit.md](../../docs/circuit.md#resolver) — references, instance paths, memory cells
  (`U5[1F]`); [subcircuits](../../docs/circuit.md#subcircuits) (ports, `compileDesign`).
- [docs/components.md](../../docs/components.md#ports-net-port) — ports; memories, `poke`, ROM
  `image` props; io parts' actions (switch `set`, button `press`/`release`, DIP `set`, clock
  `step` in manual mode).
- [ADR-0019](../../docs/adr/0019-waveforms.md) — probes live in the document (the precedent);
  [ADR-0023](../../docs/adr/0023-subcircuits.md) — flattening, the top simulates.
- `src/core/testing/bench.ts` (`testDriver`), `src/core/image-files.ts` (Intel HEX reader).
- `src/circuit/design.ts`, `resolve.ts`, `subcircuit.ts` (`circuitPorts`), `document.ts`,
  `schema.ts`, `migrations.ts`, `serialize.ts`, `document-edit.ts` (fragments).
- `src/editor/editor.ts` / wherever `sameCircuit` lives (R13 lesson: every document field).
- `tests/scenarios/two-digit-counter.test.ts`, `example-circuits.test.ts` — benches written by
  hand in TypeScript today; `scripts/bench-resolve-hooks.ts` — Node imports of `src/`.

## Design

### Answered forks (2026-11-08)

- **Q1 Split**: R15a (this branch) + R15b `feat/test-bench-ui` (Tests tab, sandbox, e2e); M2
  closes after R15b.
- **Q2 Storage**: in the document, per circuit (schema v5), like probes.
- **Q3 Form**: JavaScript scripts (not the proposed text DSL) — with Q7 and Q8 below.
- **Q4 Time**: fixed steps — a row or a clock pulse lasts `step` (default 1 µs): inputs change
  at its start, the clock rises at ¼ and falls at ¾, outputs are checked at its end.
- **Q5 Memories**: bytes in the script (`b.memory`, `b.loadIntelHex`); R15b's Insert Image…
  writes such a call from a `.bin`/`.hex` file.
- **Q6 Diagnostics**: errors (contention, timing violations, oscillation) fail the bench at
  their instant; warnings are listed in the report.
- **Q7 API**: synchronous — no `await`; the app (R15b) runs scripts off the UI thread.
- **Q8 Structure**: one test script per circuit, like a test file: `bench('name', (b) => …)`
  calls and shared helpers.
- **Q9 Vectors**: `` b.table`…` `` text tables (each row one step) plus `b.row(inputs, outputs)`.

### In the document

```ts
interface Circuit {
  // … id, name, components, wires, probes
  /** The circuit's test script (R15), one string per line; empty: none. Never compiled. */
  readonly testScript: readonly string[];
}
```

Schema v5; the v4 → v5 migration adds `testScript: []`. `serializeDocument` writes one script
line per JSON line (diffs stay readable) and leaves an empty script out; `sameCircuit` compares
it. Circuits copied with their instances carry their scripts.

### A test script

```js
// Circuit: Decade Counter (ports CLK, EN, ~{RST} in; Q[0..3], CO out)
const clear = (b) => {
  b.set({ '~{RST}': 0, EN: 1, CLK: 0 });
  b.clock('CLK'); // synchronous clear on the edge
  b.set({ '~{RST}': 1 });
};

bench('counts and carries', (b) => {
  clear(b);
  b.expect({ 'Q[0..3]': 0, CO: 0 });
  for (let n = 1; n <= 9; n++) b.row({ CLK: 'C' }, { 'Q[0..3]': n, CO: n === 9 ? 1 : 0 });
  b.row({ CLK: 'C' }, { 'Q[0..3]': 0, CO: 0 }); // round again
});

bench('holds while disabled', (b) => {
  clear(b);
  b.table`
    EN CLK | Q[0..3] CO
    1  C   | 1       0
    0  C   | 1       0     # disabled: holds
    0  C   | 1       0
    1  C   | 2       0
  `;
});
```

```js
// Circuit: RAM by Hand — a program loaded before power-on, read back through the switches.
bench('reads what was loaded', (b) => {
  b.memory('U1', 0x000, [0x2a, 0x55, 0xff]);
  b.set({ SW1: 0 }); // PROGRAM off: the RAM drives the bus
  for (const [address, data] of [
    [0, 0x2a],
    [1, 0x55],
    [2, 0xff],
  ]) {
    b.row({ SW3: address }, { 'D[0..7]': data }); // SW3: the ADDRESS DIP switch
  }
});
```

Globals a script sees: `bench(name, fn)`, time helpers `ps`, `ns`, `us`, `ms`, `s` (numbers in
picoseconds, as core's), nothing else of the host (no `Math.random`, no `Date`, no I/O).
Running the script's top level registers its benches (names unique); each bench then runs on
its own fresh simulation.

### The bench API (`b`)

| Call                                  | Does                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `b.set({ ref: value, … })`            | Inputs now: a port's driver (`0`, `1`, `'X'`, `'Z'`, a number for a bus port), a switch (`0`/`1`), a button (`0`/`1` pressed), a DIP switch (a number, switch 1 = bit 0) |
| `b.press(ref)`, `b.release(ref)`      | A button                                                                                                                                                                 |
| `b.action(ref, payload)`              | Any part's action (`sim.action`), for parts the API doesn't know                                                                                                         |
| `b.clock(ref, count = 1)`             | `count` steps, each: rise at ¼, fall at ¾ (a port's driver, a button's press, a manual clock's `step`)                                                                   |
| `b.wait(time)`                        | Time passes, inputs held                                                                                                                                                 |
| `b.row(inputs, outputs)`              | One step: inputs at its start (`'C'` pulses ¼ → ¾), outputs checked at its end                                                                                           |
| `` b.table`…` ``                      | Rows of a text table, each one `b.row`                                                                                                                                   |
| `b.expect({ ref: value, … }, note?)`  | Check now: signals (net, pin, bus, instance path) and memory cells (`U5[1F]`)                                                                                            |
| `b.get(ref)`                          | A signal's or cell's value now: a number, or text with `X` (`'X'`, `'Z'`, `'0xX5'`)                                                                                      |
| `b.memory(ref, address, bytes)`       | Bytes into a memory (array or `'2A 55 FF'`); `b.loadIntelHex(ref, text)`                                                                                                 |
| `b.setStep(time)`, `b.now`            | The step's length (default `us(1)`); the simulated time                                                                                                                  |
| `b.random()`, `b.log(…)`, `b.fail(m)` | A seeded random number (from the bench's name), a line in the report, a failure that ends it                                                                             |

- **Expected values**: `0`, `1`, `'Z'`, numbers (or BigInt) for buses and cells, text with
  don't-care digits (`'0xX5'`, `'0b1X01'`), `'X'` don't care (as data sheets and Digital have
  it), `'unknown'` for "is `X`". A weakly pulled level counts as its value.
- **Failures are soft**: a mismatch is recorded and the bench goes on (all failing rows at once,
  as `functionTable` does), the first 100 kept; an exception, `b.fail`, a halted simulation or
  a bad reference ends the bench as an `error`.
- **Power-on**: what the script does before time first moves — `memory`, `set` — happens before
  the power-on instant (ROM images only then: they replace that instance's `image` in the
  flattened netlist; RAMs take `poke` at any time). Port drivers start released (`Z`) until set.
- **Time hygiene** (R14 lesson): every input change at the same instant as another is one
  instant for the chips; `row` and `clock` keep set-up and hold at a quarter step, which a
  data sheet's limits are checked against — a step too short fails on the violation.

### Tables

```text
  ~{RST} EN CLK | Q[0..3] CO
  0      1  C   | 0       0     # comment
  1      1  C   | ${n}    -
```

The first line is the header (inputs `|` outputs); cells are separated by spaces; `-` leaves an
input as it is or doesn't check an output; `C` pulses an input; numbers decimal, `0x2A`, `$2A`,
`0b101`; `X`, `Z`; `${…}` puts a script value in a cell. A table's errors (a cell count, an
unknown value) end the bench with the line in the script.

### The runner and the script host

```ts
interface ScriptHost {
  /** Runs a script's top level with these globals; throws a ScriptError with its line. */
  load(source: string, globals: Record<string, unknown>): void;
  /** Calls a function the script defined, within the host's limits (time). */
  call(fn: unknown, args: readonly unknown[]): unknown;
  /** The script line of the code running now (from a stack frame), if known. */
  line(): number | undefined;
}

const script = loadTestScript(document, circuitId, host); // { benches: [{ name, line }], error? }
const result = runBench(document, circuitId, script, 'counts and carries', library, host);
// { name, status: 'pass' | 'fail' | 'error', failures, warnings, logs, time, events }
```

- Pure (`circuit`): compile, drivers, references, the API, tables, values, the report. A
  driver is core's `testDriver`, moved from `core/testing` into core proper (a production part
  now).
- A failure: `{ line, time, message, ref?, expected?, actual? }`, written
  `line 7 at 7.25 µs: Q[0..3] is 0x5, expected 0x4` (bus values with `X` nibbles, as the
  waveforms write them).
- A bench function that returns a Promise is an error ("benches are synchronous").
- Deterministic: the same document and script give the same report.

### Hosts

- **Node** (`scripts/script-host.ts`): a `node:vm` context per script holding only the globals,
  `Math.random` and `Date` removed, every call through code run in the context with a `timeout`
  (default 60 s, so a `while (true)` ends as an error), lines from the stack frames of the
  script's file name. Values cross realms: the API checks arrays with `Array.isArray`, never
  `instanceof`. Not a security boundary — CI runs one's own files.
- **Browser** → R15b (a sandboxed iframe/worker, and asking before running a file's scripts).

### Headless

- `tests/scenarios/example-benches.test.ts`: every bench of every example passes — in
  `pnpm check`, so in CI.
- `pnpm test:circuits [files…]` (default: `examples/*.logic.json`):
  `node --import ./scripts/resolve-hooks.ts scripts/test-circuits.ts` (the bench hooks renamed
  now that two scripts share them). Exit 0 all passed, 1 a bench failed or erred, 2 a file
  didn't load.

```text
examples/two-digit-counter.logic.json
  ✓ Decade Counter › counts and carries      11 steps, 12 µs
  ✗ Main › counts to 99                      line 9 at 1.025 s: A1/A1/Q[0..3] is 6, expected 7
1 of 5 benches failed
```

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `circuit`: `Circuit.testScript`, schema v5 + migration, `serializeDocument`, schema
  validation, `sameCircuit`; copy/paste carries it.
- [x] 2. `core`: `testDriver` into core proper (`core/testing` re-exports it).
- [x] 3. `circuit`: bench values — expected and input values (numbers, BigInt, text with `X`
  digits, `'X'`, `'Z'`, `'unknown'`), comparison with levels, formatting the actual value.
- [x] 4. `circuit`: the bench context on local test parts — compile with `top`, drivers on
  ports, references, `set`/`press`/`release`/`action`, `wait`, `clock`, `row`, `expect`,
  `get`, soft failures, diagnostics policy, the report.
- [x] 5. `circuit`: `` b.table`…` `` — header, rows, `-`, `C`, interpolations, comments,
  errors with lines.
- [x] 6. `circuit`: memories — `b.memory`, `b.loadIntelHex`; RAM `poke`, ROM image before
  power-on; power-on ordering.
- [x] 7. `circuit`: `ScriptHost`, `loadTestScript`, `runBench` — registration, lines,
  `b.random`/`b.log`/`b.fail`, Promises refused.
- [ ] 8. Node host (`node:vm`, globals only, time limit, lines); scenarios on real parts — a
  74HC163 counter, a set-up violation failing the bench, a 6116 loaded before power-on,
  determinism, a runaway loop stopped.
- [ ] 9. Example test scripts: Half Adder, Two-Digit Counter (three circuits), RAM by Hand;
  `example-benches.test.ts`.
- [ ] 10. CLI `pnpm test:circuits`, `scripts/resolve-hooks.ts`; tests of the report and the exit
  codes.
- [ ] 11. Docs: circuit.md (Test benches), simulation.md, architecture, glossary, ADR-0025,
  lessons; roadmap (R15a done, R15b next).

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green.
- [ ] A test script in a document survives save, load, undo/redo and copy/paste of its circuit.
- [ ] A subcircuit's bench drives its ports and passes; breaking the circuit (a wire removed)
  makes it fail with the line, instant, signal, expected and actual value.
- [ ] A clock pulse that violates a 74HC part's set-up time fails the bench with the violation.
- [ ] The RAM by Hand bench loads its memory before power-on and passes headless in
  `pnpm check` and in `pnpm test:circuits` (exit 0); a document with a failing bench exits 1.
- [ ] Every example bench is deterministic (two runs, equal reports); a script can't reach
  `Math.random`, `Date` or the host; `while (true)` ends as an error after the time limit.

## Open questions

- [x] Q1. One branch or a split? — **answer:** split: R15a (this branch), R15b
  `feat/test-bench-ui`.
- [x] Q2. Where do benches live? — **answer:** in the document, per circuit (schema v5).
- [x] Q3. What form does a bench take? — _proposed:_ a text DSL — **answer:** JavaScript
  scripts.
- [x] Q4. How does time pass in a row? — **answer:** a fixed step: inputs at the start, `C`
  pulses ¼ → ¾, outputs checked at the end.
- [x] Q5. How does a bench load memories? — **answer:** bytes in the script; R15b's Insert
  Image… writes the call from a file (proposed, not asked separately after Q3).
- [x] Q6. What do diagnostics do? — **answer:** errors fail the bench, warnings are listed.
- [x] Q7. Sync or async API? — **answer:** synchronous.
- [x] Q8. Benches per circuit? — **answer:** one test script per circuit, `bench(name, fn)`.
- [x] Q9. Vectors in scripts? — **answer:** `` b.table`…` `` plus `b.row`.
- R15b, to ask at its start: the browser sandbox (an opaque-origin iframe/worker) and whether
  to ask before running a file's scripts; the editor (a textarea or a code editor package); how
  a failure is debugged (open in Waveforms at its instant).

## Progress log

- 2026-11-08 — plan drafted; Q1–Q9 answered (JavaScript scripts instead of the proposed DSL);
  R15 split into R15a/R15b.
- 2026-11-08 — plan approved; branch started (roadmap: R15a in-progress, R15b planned).

## Handoff

- **State:** plan approved; nothing implemented yet.
- **Next step:** task 1.
- **Watch out:** R13 lesson — a new document field must be in `sameCircuit`, the schema, the
  serializer and a migration; vm realms — no `instanceof Array` on script values.
- **Verify with:** `pnpm check`; `pnpm test:circuits`.

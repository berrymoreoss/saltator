# Plan: feat/engine-core

| Field      | Value                                                      |
| ---------- | ---------------------------------------------------------- |
| Branch     | `feat/engine-core`                                         |
| Roadmap    | R01 — Simulation kernel ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                |
| Depends on | R00                                                        |
| Created    | 2026-11-06                                                 |

## Goal

Build the headless simulation kernel in `src/core`: an event-driven, deterministic simulator with
real-time delays, 4-state levels with drive strengths, inertial delays, delta cycles, diagnostics,
a component runtime API and a test bench, plus the first abstract parts (`prim/*`) to exercise it.
Everything later (circuit compiler, editor, 74HC library, memories, CPUs) is built on this API, so
correctness, determinism and a clean API matter more than features.

## Scope

**In scope**

- `src/core`: time, logic (levels, drives, resolution, level operators), event queue, component
  API types, registry, netlist + builder, simulator, diagnostics, test bench utilities.
- `src/library/primitives`: `prim/buffer`, `prim/not`, `prim/and`, `prim/or`, `prim/nand`,
  `prim/nor`, `prim/xor`, `prim/xnor` (configurable input count), `prim/tristate-buffer`,
  `prim/constant`, `prim/pull`; `src/library/registry.ts` with `createDefaultRegistry()`.
- `tests/scenarios`: kernel scenarios using real primitives. `tests/bench`: kernel benchmark.
- Docs: bring `docs/simulation.md` and `docs/components.md` in line with the code; write
  `.ai/workflows/add-component.md`.

**Out of scope**

- Circuit document, geometric connectivity, design checks → R02.
- IO parts (switch, button, LED, clock, displays) → R03. (A test-only clock/driver inside the
  bench is fine.)
- Real-time pacing / simulator host, UI → R05.
- Setup/hold checks → R09. Snapshot/rewind → R14 (but the state model below must make it
  possible). Web Worker → backlog.

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md) — the spec this branch implements (draft).
- [docs/components.md](../../docs/components.md) — definition shape (draft).
- [docs/architecture.md](../../docs/architecture.md#layers) — layer rules; `core` imports nothing.
- [ADR-0003](../../docs/adr/0003-event-driven-simulation.md), [ADR-0005](../../docs/adr/0005-layered-architecture.md).
- `scripts/check-layers.ts`, `tsconfig.core.json` — how purity is enforced.
- `.ai/lessons.md` — TS 7 / erasable-syntax constraints.

## Design

### Module layout

```
src/core/
  index.ts            public API (explicit named exports)
  time.ts             Time (ps), ps/ns/us/ms, formatTime
  logic.ts            Level, Drive, Strength constants; resolve(); level ops (and/or/xor/not); helpers
  event-queue.ts      binary min-heap keyed by (time, seq); lazy cancellation
  component.ts        ComponentDefinition, PinDef, PropDef, TimingDef, Behavior, EvalContext, PinRef
  registry.ts         ComponentRegistry (register/get/has/list); the interface circuit will use
  netlist.ts          Netlist (serializable) + NetlistBuilder (union-find) + validation
  diagnostics.ts      Diagnostic types; collector with dedupe + cap
  simulator.ts        Simulator: compile netlist → runtime arrays; event loop; run API; observability
  testing/
    bench.ts          single-part test bench
    function-table.ts table-driven helper for datasheet function tables
    index.ts
src/library/
  primitives/*.ts     one file per part (or one gates.ts factory + per-part definitions)
  registry.ts         createDefaultRegistry()
tests/scenarios/      cross-layer scenario tests
tests/bench/          kernel benchmark
```

### Key decisions (follow docs/simulation.md unless noted)

- **Encodings**: levels and drives as small integers exported via `as const` objects + union types
  (no TS `enum` — `erasableSyntaxOnly`). Names to settle in task 1 (e.g. `Level.L0/L1/X/Z`,
  `Drive.Z/WEAK_0/…/STRONG_X`), plus allocation-free helpers `strong(level)`, `weak(level)`,
  `levelOf(drive)`.
- **Runtime layout**: index-based. Per net: resolved level in a `Uint8Array`; driver slots and
  reader components in CSR arrays (`start: Int32Array`, `items: Int32Array`). Per driver slot:
  current drive, pending event handle/generation, owning net. Per component: pin → net index,
  pin → driver slot (or −1).
- **Event queue**: struct-of-arrays heap (typed arrays for time/seq/payload, grown by doubling),
  no object per event. Two event kinds: driver change (slot, drive, generation) and timer wake
  (component, token).
- **One reused `EvalContext`**: the simulator points a single context object at the component
  being evaluated; no allocation per evaluation.
- **State model**: `create(props)` returns a per-instance `Behavior`; its closure may hold only
  **immutable** configuration derived from props (input count, delay). All mutable state lives in
  `ctx.state`, created by `behavior.createState?()`, and must be plain structured-clone-able data
  (objects, arrays, typed arrays). Why: R05 preserves state across recompiles (keyed by component
  id) and R14 needs snapshot/rewind; both are impossible if state hides in closures.
- **Edge detection**: per-net "changed in delta #k" stamp + previous level, so `ctx.changed/rose/
  fell/prev` are O(1) without allocating per evaluation. Semantics of edges involving `X`/`Z`: see
  Q5.
- **Inertial delay** exactly as in docs/simulation.md ("keep pending if same value, otherwise
  cancel; schedule only if different from current").
- **Ordering**: events by `(time, seq)`; dirty components evaluated in ascending index order per
  delta. A component with fired timers gets `wake(token)` per timer (in event order), then one
  `evaluate` if any net it reads changed in that delta. Determinism test hashes the full change
  trace.
- **Variable pins**: `pins` may be `PinDef[]` or `(props) => PinDef[]` (needed for N-input gates,
  DIP-switch banks, LED bars) — see Q4. A `PinRef` is the index into the instance's resolved pin
  list.
- **Diagnostics**: `floating-input` raised from `ctx.read` when the value is `Z` (dedupe per net
  until it changes); `contention` when a net starts resolving strong opposite known levels
  (re-armed once the conflict clears); collector capped (default 1000, counts dropped ones).
- **Props of type `time`** are stored in picoseconds (integers), like every other time value; the
  inspector converts for display (R04).
- **Primitive pin names**: gates `A`, `B`, … (up to `H`) → `Y`; buffer/not `A` → `Y`;
  tri-state buffer `A`, `EN` (active-high; `EN = X/Z` → strong `X` out) → `Y`; constant `Y`;
  pull `Y` with `direction: up | down`.
- **Bench**: wraps one part; each input/bidir pin gets a test driver (a core-internal
  `test/driver` definition in `src/core/testing`, so core never imports library) controlled
  through `sim.action`; outputs readable by pin name; `measure()` returns the delay between a
  stimulus and the next change of an output.
- **Function tables**: rows written with datasheet letters `H`/`L`, plus `Z` for outputs. Datasheet
  `X` means _don't care_ — **not** our `X` (unknown); the helper must expand or reject it
  explicitly, never pass it through as unknown.

### Deviations from the draft docs (applied to docs/ in task 11)

- `ComponentDefinition` has no `family` field: it is derived from the type id (`familyOf`).
- `timing` is `{ typical: { tpd, … }, max?, conditions?, source? }` (a typed record instead of
  mixing symbols and metadata at the top level).
- `Behavior.evaluate` is optional (constants and pulls have no inputs); `createState()` added.
- `defineComponent()` gives authors typed props/state and returns the erased form registries store.
- `resolveProps()` validates raw props (unknown key, type, integer, min/max, enum) and fills defaults.
- `symbol` is not defined yet (R03).
- **Power-on**: `out` pins start driving strong `X` (a push-pull output always drives something);
  `tristate`/`bidir` start at `Z`. `init` runs in the constructor; at t = 0 every component with
  `evaluate` is evaluated once, after the t = 0 events from `init`/actions were applied. Without
  this, an unconnected gate input would never be read (no `floating-input`), and gate outputs
  would sit at `Z` and trigger spurious floating diagnostics downstream.
- `settle()` returns `idle` with `now` = time of the last event (not the limit); `runUntil(t)`
  always ends at `now = t` unless `budget`/`halted`. Defaults: `maxTime` 1 ms, `maxEvents` 1M.
- Diagnostics carry `count` and `lastTime`; repeats with the same kind/net/component/pin merge.
  `floating-input` is reported once per net until the net changes (first reader wins).
- A zero-delay or delayed ring of inverters starting at `X` stays `X` forever (4-state
  pessimism) — scenario tests must start oscillators through a NAND with an enable.

## Tasks

- [x] 1. `time.ts`, `logic.ts`: constants, `resolve()` over driver lists, level ops with 4-state
  semantics (AND: any 0 → 0, all 1 → 1, else X; OR dual; XOR: any X/Z → X; NOT: X/Z → X).
  Exhaustive tests.
- [x] 2. `event-queue.ts`: heap with `(time, seq)` ordering and lazy cancellation. Tests incl. a
  seeded randomized comparison against a sorted reference.
- [x] 3. `component.ts`, `registry.ts`: types per docs/components.md (+ `pins` as function of
  props, `createState`). Registry tests (duplicate type → error).
- [x] 4. `netlist.ts`: `Netlist` type, `NetlistBuilder` (add component, connect pins, union-find
  merge, implicit nets for unconnected pins), validation with precise error messages
  (unknown type, unknown pin, duplicate id). Tests.
- [x] 5. `simulator.ts` core loop: compile, `init`, delta cycles, inertial `drive`, `wakeAfter`
  timers, `action`, `runUntil/runFor/settle` with statuses, levels snapshot, `onNetChange`,
  stats. Unit tests with tiny inline test components.
- [x] 6. `diagnostics.ts` + wiring: `contention`, `floating-input`, `oscillation` (halt,
  `maxDeltaCycles`), component-reported diagnostics; dedupe + cap. Tests.
- [x] 7. `src/core/testing`: bench + function-table helper. Tests of the bench itself.
- [x] 8. `src/library/primitives` + `createDefaultRegistry()`: all `prim/*` parts with props
  (`inputs`, `delay`, `value`, `direction`). Function-table tests incl. X/Z inputs and one
  timing test per part.
- [x] 9. `tests/scenarios`: ring oscillator (N odd inverters, delay d ⇒ period 2·N·d); zero-delay
  ring ⇒ `oscillation` + halt; inertial filtering (pulse < tpd swallowed, ≥ tpd passes); SR
  latch from two NANDs (X at power-on, set, reset, hold); tri-state bus + pull-down (idle →
  weak 0, one driver → its value, two opposite drivers → X + `contention`); floating input
  diagnostic; determinism (two runs ⇒ identical trace hash).
- [x] 10. `tests/bench/kernel.bench.ts`: long inverter chain toggled repeatedly; 1001-inverter
  ring for a fixed simulated time. Record events/s below.
- [x] 11. Docs: update docs/simulation.md + docs/components.md to the real API (drop "draft");
  write `.ai/workflows/add-component.md`; coverage threshold for `src/core` in `vite.config.ts`;
  lessons; ADR if a decision deviates from ADR-0003; roadmap status.

## Benchmark results

`pnpm bench`, 2026-11-06, Apple M3 Pro, Node 24.4.0 (native `import`, see below):

| Benchmark                                   | Events / iteration | Events / s |
| ------------------------------------------- | -----------------: | ---------: |
| Inverter chain ×1000, toggle input + settle |              1 001 |     ≈ 12 M |
| Ring oscillator ×1001, 100 µs simulated     |            100 000 |   ≈ 13.5 M |

Target ≥ 5M events/s: met. Under Vite's module runner (vitest's default) the same code measured
≈ 4.4 M events/s, because every imported binding becomes a getter call; `pnpm bench` therefore
runs with `--experimental.viteModuleRunner=false` plus `scripts/bench-resolve-hooks.ts`
(resolves extensionless/directory imports; Node strips the types).

## Acceptance criteria

Verified 2026-11-06 at the end of task 11.

- [x] `pnpm check` and `pnpm build` are green; `src/core` has no DOM/package imports (enforced).
- [x] `pnpm coverage`: `src/core` ≥ 90 % lines — 99.9 %; now enforced by a threshold in
  `vite.config.ts`.
- [x] All scenario tests from task 9 pass (6 files, 25 tests in `tests/scenarios`).
- [x] Every primitive has function-table tests (incl. X/Z inputs) and a timing test. Gates,
  buffer, NOT and tri-state buffer: `functionTable` + `truthTable` + `measure`; `prim/constant`
  and `prim/pull` have no inputs, so they are tested per prop value and for driving at t = 0.
- [x] Benchmark numbers recorded in this plan (≈ 12–13.5M events/s, target 5M).
- [x] docs/simulation.md and docs/components.md describe the implemented API;
  `.ai/workflows/add-component.md` exists and was followed for the primitives.

## Open questions

Asked at branch start (2026-11-06); all answered.

- [x] Q1. Default delay of abstract `prim/*` gates? — _proposed:_ 1 ns, editable per instance
  (0 allowed, for Logisim-like behavior). — **answer:** as proposed: 1 ns default, per-instance
  `delay` prop, 0 allowed.
- [x] Q2. Power-on state of sequential/feedback circuits? — _proposed:_ `X` until driven or reset
  (realistic; teaches resets). Random power-on as a later option. — **answer:** as proposed: `X`
  until set/reset; seeded random power-on may come later as an option.
- [x] Q3. Oscillation guard? — _proposed:_ `maxDeltaCycles = 1000` per timestamp, then halt with an
  `oscillation` diagnostic. — **answer:** as proposed: default 1000 (configurable), then halt +
  `oscillation`.
- [x] Q4. Prop-dependent pin lists (N-input gates)? — _proposed:_ yes, `pins` may be a function of
  props; `prim/*` gates support 2–8 inputs. — **answer:** as proposed: `pins` may be
  `(props) => PinDef[]`; gates take `inputs: 2–8`.
- [x] Q5. Edges involving `X`/`Z` (e.g. a clock going `X → 1` after power-on)? — _proposed:_
  `rose`/`fell` are strict (`0 → 1`, `1 → 0` only); `ctx.prev(pin)` exposes the previous level so
  edge-triggered parts (R09) can treat uncertain edges pessimistically (output `X`).
  Alternative: Verilog-style `posedge` (`0 → X`, `X → 1` count as rising). — **answer:** as
  proposed: strict `rose`/`fell` + `ctx.prev(pin)`; uncertain edges are the part's call
  (pessimistic `X` recommended in docs/components.md).

## Progress log

- 2026-11-06 — plan drafted during R00 (foundation).
- 2026-11-06 — branch created; plan refined: state model (plain-data `ctx.state`), event-queue
  layout, wake/evaluate ordering, primitive pin names, time props in ps, Q5 (edges with `X`).
- 2026-11-06 — Q1–Q5 answered (all as proposed); plan approved by the user; status in-progress.
- 2026-11-06 — tasks 1–6 done: time/logic, event queue, component types + registry, netlist +
  builder + resolution, simulator loop, diagnostics. Tasks 5 and 6 landed in one commit (the
  diagnostics are part of the loop). Core coverage ≈ 98 % lines.
- 2026-11-06 — tasks 7–11 done: test bench + function/truth tables + traces, `prim/*` parts and
  `createDefaultRegistry()`, scenario tests, benchmark (native imports; module runner ~3× slower),
  docs. Fixed `scripts/check-layers.ts` misclassifying directory imports (`'../../core'`) as the
  app layer. No decision deviates from ADR-0003, so no new ADR. Acceptance criteria verified.

## Handoff

- **State:** all 11 tasks done and committed; acceptance criteria verified; `pnpm check`,
  `pnpm build`, `pnpm coverage`, `pnpm bench` green. Roadmap still says R01 `in-progress`.
- **Next step:** run the finish-branch workflow (`/finish-branch`): set plan status `done`,
  roadmap R01 → `done`, R02 → `next`, commit `docs(plan): finish feat/engine-core`, then **ask the
  user** before merging to `main` (no remote: `git merge --no-ff`).
- **Watch out:** R02 builds on `NetlistBuilder`/`resolveNetlist`/`ComponentRegistry` from
  `src/core`; the builder's `net(name)` already joins same-named nets (net-label semantics).
  Benchmarks must run via `pnpm bench` (native imports), not plain `vitest bench`.
- **Verify with:** `pnpm check && pnpm build && pnpm coverage && pnpm bench`.

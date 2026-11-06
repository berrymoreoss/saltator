# Plan: feat/engine-core

| Field      | Value                                                               |
| ---------- | ------------------------------------------------------------------- |
| Branch     | `feat/engine-core`                                                  |
| Roadmap    | R01 — Simulation kernel ([roadmap](../../docs/roadmap.md))          |
| Status     | draft (pre-written in R00; refine and get approval at branch start) |
| Depends on | R00                                                                 |
| Created    | 2026-11-06                                                          |

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
- Setup/hold checks → R09. Snapshot/rewind → R14. Web Worker → backlog.

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
  `Drive.Z/WEAK_0/…/STRONG_X`).
- **Runtime layout**: index-based. Per net: resolved level in a `Uint8Array`; driver slots and
  reader components in CSR arrays (`start: Int32Array`, `items: Int32Array`). Per driver slot:
  current drive, pending event handle/generation, owning net. Per component: pin → net index,
  pin → driver slot (or −1).
- **Edge detection**: per-net "changed in delta #k" stamp + previous level, so `ctx.changed/rose/
  fell` are O(1) without allocating per evaluation.
- **Inertial delay** exactly as in docs/simulation.md ("keep pending if same value, otherwise
  cancel; schedule only if different from current").
- **Ordering**: events by `(time, seq)`; dirty components evaluated in ascending index order per
  delta. Determinism test hashes the full change trace.
- **Variable pins**: `pins` may be `PinDef[]` or `(props) => PinDef[]` (needed for N-input gates,
  DIP-switch banks, LED bars) — see Q4.
- **Floating-input diagnostic** raised from `ctx.read` when the value is `Z` (dedupe per net until
  it changes).
- **Bench**: wraps one part; each input/bidir pin gets a test driver controlled through
  `sim.action`; outputs readable by pin name; `measure()` returns the delay between a stimulus and
  the next change of an output.
- **Function tables**: rows written with datasheet letters `H`/`L`, plus `Z` for outputs. Datasheet
  `X` means _don't care_ — **not** our `X` (unknown); the helper must expand or reject it
  explicitly, never pass it through as unknown.

## Tasks

- [ ] 1. `time.ts`, `logic.ts`: constants, `resolve()` over driver lists, level ops with 4-state
  semantics (AND: any 0 → 0, all 1 → 1, else X; OR dual; XOR: any X/Z → X; NOT: X/Z → X).
  Exhaustive tests.
- [ ] 2. `event-queue.ts`: heap with `(time, seq)` ordering and lazy cancellation. Tests incl. a
  seeded randomized comparison against a sorted reference.
- [ ] 3. `component.ts`, `registry.ts`: types per docs/components.md (+ `pins` as function of
  props). Registry tests (duplicate type → error).
- [ ] 4. `netlist.ts`: `Netlist` type, `NetlistBuilder` (add component, connect pins, union-find
  merge, implicit nets for unconnected pins), validation with precise error messages
  (unknown type, unknown pin, duplicate id). Tests.
- [ ] 5. `simulator.ts` core loop: compile, `init`, delta cycles, inertial `drive`, `wakeAfter`
  timers, `action`, `runUntil/runFor/settle` with statuses, levels snapshot, `onNetChange`,
  stats. Unit tests with tiny inline test components.
- [ ] 6. `diagnostics.ts` + wiring: `contention`, `floating-input`, `oscillation` (halt,
  `maxDeltaCycles`), component-reported diagnostics; dedupe + cap. Tests.
- [ ] 7. `src/core/testing`: bench + function-table helper. Tests of the bench itself.
- [ ] 8. `src/library/primitives` + `createDefaultRegistry()`: all `prim/*` parts with props
  (`inputs`, `delay`, `value`, `direction`). Function-table tests incl. X/Z inputs and one
  timing test per part.
- [ ] 9. `tests/scenarios`: ring oscillator (N odd inverters, delay d ⇒ period 2·N·d); zero-delay
  ring ⇒ `oscillation` + halt; inertial filtering (pulse < tpd swallowed, ≥ tpd passes); SR
  latch from two NANDs (X at power-on, set, reset, hold); tri-state bus + pull-down (idle →
  weak 0, one driver → its value, two opposite drivers → X + `contention`); floating input
  diagnostic; determinism (two runs ⇒ identical trace hash).
- [ ] 10. `tests/bench/kernel.bench.ts`: long inverter chain toggled repeatedly; 1001-inverter
  ring for a fixed simulated time. Record events/s below.
- [ ] 11. Docs: update docs/simulation.md + docs/components.md to the real API (drop "draft");
  write `.ai/workflows/add-component.md`; lessons; ADR if a decision deviates from ADR-0003;
  roadmap status.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green; `src/core` has no DOM/package imports (enforced).
- [ ] `pnpm coverage`: `src/core` ≥ 90 % lines.
- [ ] All scenario tests from task 9 pass.
- [ ] Every primitive has function-table tests (incl. X/Z inputs) and a timing test.
- [ ] Benchmark numbers recorded in this plan (target ≥ 5M events/s; below target → profiling
  notes + backlog entry, not a blocker).
- [ ] docs/simulation.md and docs/components.md describe the implemented API;
  `.ai/workflows/add-component.md` exists and was followed for at least one primitive.

## Open questions

Ask the user at branch start; record answers here.

- [ ] Q1. Default delay of abstract `prim/*` gates? — _proposed:_ 1 ns, editable per instance
  (0 allowed, for Logisim-like behavior). — **answer:**
- [ ] Q2. Power-on state of sequential/feedback circuits? — _proposed:_ `X` until driven or reset
  (realistic; teaches resets). Random power-on as a later option. — **answer:**
- [ ] Q3. Oscillation guard? — _proposed:_ `maxDeltaCycles = 1000` per timestamp, then halt with an
  `oscillation` diagnostic. — **answer:**
- [ ] Q4. Prop-dependent pin lists (N-input gates)? — _proposed:_ yes, `pins` may be a function of
  props; `prim/*` gates support 2–8 inputs. — **answer:**

## Progress log

- 2026-11-06 — plan drafted during R00 (foundation).

## Handoff

- **State:** not started. Branch does not exist yet.
- **Next step:** run the start-branch workflow (`/start-branch`), ask Q1–Q4, get plan approval.
- **Watch out:** datasheet `X` = don't care ≠ simulator `X` = unknown. No TS enums. `core` may
  not import `library`; scenario tests that need parts go to `tests/scenarios`.
- **Verify with:** `pnpm check`.

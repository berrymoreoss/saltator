# Plan: feat/hdl-timing

| Field      | Value                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Branch     | `feat/hdl-timing`                                                                                                          |
| Roadmap    | — (no item: what an experiment needed of the engine; track [Programmable logic](../../docs/roadmap/programmable-logic.md)) |
| Status     | in-progress                                                                                                                |
| Depends on | HDL-2 (library parts in Verilog, `specify` timing), HDL-10 (fast evaluation)                                               |
| Created    | 2026-11-12                                                                                                                 |

## Goal

The engine changes an experiment — the W65C02S written in Verilog as a drop-in for the
hand-written `cpu/w65c02s` — needed and found, kept without the experiment: a cycle-time check,
an output `X` between a path's minimum and typical delay, hold violations worked out from the
edge they follow, 3-state outputs `X` from power-on, outputs that don't change not asking the
kernel, and the test benches' sandbox knowing the Verilog dev parts.

## Scope

**In scope** (Q3: everything of the engine)

- `cycle` checks: a `$hold` between one pin's same edges (Yosys reads no `$period`); schema v11.
- `X` from a path's minimum until its typical delay, where the minimum is below it.
- A hold violation redoes the edge it follows from the module's words saved at that edge.
- A module's 3-state outputs it may drive at power-up drive `X` at once.
- An output whose drive didn't change isn't asked of the kernel again.
- The bench worker registers the Verilog dev parts in dev builds, as the app does.

**Out of scope**

- The W65C02S in Verilog itself, its dev part, the pin-level SingleStepTests runner, its tests,
  scripts and benchmark (Q3: not kept; the track's ideas record what it showed).

## Context

- [ADR-0038](../../docs/adr/0038-specify-timing.md) (amended here), [ADR-0014](../../docs/adr/0014-timing-checks.md)
- `src/library/hdl/module-part.ts`, `path-delays.ts`, `module-checks.ts`, `specify.ts`, `timing.ts`
- `src/core/hdl-module.ts` (the IR's checks), `src/app/bench-worker.ts`

## The experiment (2026-11-12, not kept)

The user asked for the W65C02S in Verilog the way HDL-2 wrote the 74HC chips, run on the
hand-written part's tests and benchmarked. Built on branch `feat/hdl-w65c02s` (deleted):

- **The module** (≈ 1 375 lines, ≈ 1 200 cells after Yosys): RTL with everything at PHI2's
  falling edge; an `always @*` block choosing select codes (address source, write source, how
  PC, S and the address registers move, which registers the cycle's end writes), the ALU,
  read-modify-write and the address adders outside it once; the opcode table a ROM (an `initial`
  block, one `$memrd`); the data sheet's timing in `specify`. A dev part on `cpu/w65c02s`'s pins
  with a CPU view reading the module's registers by name.
- **Proof**: SingleStepTests at the pins (a runner feeding a preamble — `LDX #S-1; TXS; LDA; LDY;
  LDX; PLP; JMP PC` — through the bus to load the registers): all 2 540 000 cases (≈ 53 M bus
  cycles, ≈ 2.5 minutes on 10 processes). The hand-written part's 32 tests on both parts: 27 the
  same, 5 different by design (a module has no `cpu-lost` messages; a dev part isn't in the
  default registry). The 6502 computer's scenarios on both; in the browser, the user's
  `playground/6502-lcd-hello-world` with the Verilog CPU printed "Hello, World!".
- **Speed** (the 6502 computer at 1 MHz): 4.9 % of real time against the hand-written part's
  17.9 % (≈ 3.7×); at the pins alone 57 k against 300 k cycles a second. Half the time was the
  module's generated settle code (≈ 640 multiplexers).
- What the experiment found in the engine is this branch: the cycle check and the window (to
  match the hand-written part's tests), the hold rule (its LDA test: a late operand left A known
  and spoiled the next opcode), power-on (the RAM and the 74HC00 reported floating inputs at
  t = 0), skipping unchanged drives (a profile), the sandbox (looking in the browser).

## Decisions

- D1. **Hold violations redo the edge they follow** (ADR-0038 amended): HDL-2 computed "what if
  the pin were `X`" from the words after the edge — right for every chip tried (Q = D), wrong for
  a state machine. Words are saved at each edge of a hold check's clock. Regression fixture
  `spec_hold_fsm` (fails on main).
- D2. **3-state outputs `X` from power-on** where the enable isn't known 0 at power-up, as
  push-pull pins start and as the hand-written CPU's `init` does.
- D3. **Unchanged drives skip the kernel** (and their delay): equivalent under the inertial model.
- D4. **The sandbox registers the Verilog dev parts in dev builds** (`import.meta.env.DEV`; the
  production runner bundle is unchanged): a document with HDL-2's `dev/74hc00-verilog` showed its
  parts in a dev build and failed its benches with "unknown part type".
- D5. **The window is min → typ**: `(10:30:30, 10:30:30)` shows `X` from 10 to 30 ns; a release
  has no window; the 74HC sources write min = typ, so nothing changes for them.

D1–D5 were made while the user was away (they had answered Q1, Q2) and reported to them.

## Tasks

- [x] 1. Cycle checks: the IR's `cycle` kind (schema v11), the converter, the runtime, the Part
  tab's `tcyc(…)`; fixture `spec_cycle`.
- [x] 2. The min → typ window; the Part tab shows such minima; fixture `spec_window`.
- [x] 3. Holds redone from the edge's words; fixture `spec_hold_fsm`.
- [x] 4. Power-on `X` on 3-state outputs; unchanged drives skip the kernel.
- [x] 5. The bench worker's dev parts (test: the 6502 example with a Verilog 74HC00).
- [x] 6. Docs: components.md, simulation.md, circuit.md (v11), ADR-0038 amended, the track's
  ideas (`$period` done, "CPUs in Verilog", "Faster small modules"), lessons.

## Acceptance criteria

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] `pnpm bench` against main: nothing slower.
- [x] Each change has its test, the fixes a regression test that fails on main.

## Open questions

- [x] Q1. Where does the experiment live? — **answer (2026-11-12):** a branch without a roadmap
  item; the idea goes to the track's ideas.
- [x] Q2. The hand-written part does what the engine can't express (`X` from tAH to tADS, the
  cycle check, the `cpu-lost` message). — **answer:** close the cheap gaps in the engine.
- [x] Q3. Merge the experiment, only the engine, or neither? — **answer (2026-11-13):** only the
  engine's changes, all of them; the module isn't committed nor kept.

## Progress log

- 2026-11-12 — the experiment on `feat/hdl-w65c02s` (above); the engine changes and their tests
  there; benchmarks against main (alternately, twice): nothing slower, the Verilog 74HC00 chain
  3.2 → 3.45 M events/s, the 74HC574 pipeline 2.8 → 3.2 M, wide words +17 %, internal clocks
  +15 %, PicoRV32 230 → 241 k cycles/s.
- 2026-11-13 — Q3 answered: this branch from main with the engine's changes only; the
  experiment's branch deleted.

## Handoff

The engine's changes, their tests and docs, committed on `feat/hdl-timing`; then the
finish-branch workflow with the user's approval.

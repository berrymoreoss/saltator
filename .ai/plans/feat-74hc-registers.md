# Plan: feat/74hc-registers

| Field      | Value                                                                                |
| ---------- | ------------------------------------------------------------------------------------ |
| Branch     | `feat/74hc-registers`                                                                |
| Roadmap    | R09a — 74HC flip-flops, registers + timing checks ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                                          |
| Depends on | R06 (74xx specs, 3-state outputs), R08 (stateful chips, per-path delays)             |
| Created    | 2026-11-07                                                                           |

## Goal

The first edge-triggered chips and the timing checks that make them worth simulating: ten 74HC
flip-flops and registers from their Nexperia data sheets, and setup, hold, pulse-width and
recovery checks against the data sheets' guaranteed minima, so a design that only works by luck
on the bench shows up before it is built. Ben Eater's SAP-1 registers (two 74HC173 and a
74HC245 on a bus) can then be built and checked. R09 was split at its start (Q1): the counters
and shift registers follow in R09b (`feat/74hc-counters`) on the same machinery.

## Scope

**In scope**

- `core`: timing checks for edge-triggered parts (setup, hold, pulse width, recovery) reported
  through `ctx.report`, with the bits they make uncertain; `TimingDef.min` for the data sheet
  minima the checks use.
- `core/testing`: function tables of sequential parts (clock edges, outputs that keep or toggle
  the previous state).
- `library/74xx`: 74HC74, 107, 109, 112 (flip-flops), 173, 175, 273, 374, 377, 574 (registers)
  as `ChipSpec`s with HC timing (delays per path and the timing requirements), in
  `createDefaultRegistry()`.
- 74HC4511: setup, hold and pulse-width checks on LE (backlog item from R08).
- UI: the Part tab shows a chip's timing (delays and requirements, with the source); timing
  violations in the Simulation tab.
- Tests per chip (function table per unit through pin numbers, unknown and floating inputs,
  every delay path, every timing check just inside and just outside its limit); scenarios
  (shift chain without hold violations, ripple counter, a race caught by a setup check, two 173s
  and a 245 on a bus); carry-over property with the new chips; a benchmark of a register chain.
- Example: Ben Eater's A register (Q4), e2e.
- Docs: components.md, simulation.md, editor.md, ADR-0014 (timing checks), glossary, READMEs,
  the add-component recipe, lessons, roadmap.

**Out of scope** (and where it goes instead)

- Counters and shift registers (161, 163, 191, 193, 164, 165, 595, 4040), the Shift Register
  LEDs example → R09b `feat/74hc-counters`.
- `fmax` as a separate check: the clock pulse-width checks cover it (two `tW` ≈ 1 / `fmax`).
- The −40 °C to +85 °C minima of the requirements → a worst-case mode (backlog; it would pair
  them with the recorded `max` delays).
- Metastability as a random outcome or a resolution time → not modeled; an uncertain bit is `X`.
- Other families (74HCT, 74LS) → backlog, as before.
- A "report only" simulator setting that keeps violating bits known → backlog unless asked.

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md) — strict edges and uncertain edges (`X → 1`
  drives `X`), forced evaluation, inertial model, carry-over, diagnostics.
- [docs/components.md](../../docs/components.md#74xx-chips-74xx) — 74xx specs, families,
  delays with several paths, 4-state "as precise as cheap", the 4511 (first stateful chip).
- [ADR-0011](../../docs/adr/0011-real-chips.md) — Nexperia data sheets, 4.5 V / 50 pF,
  `ChipSpec` + `LogicFamily`; [ADR-0013](../../docs/adr/0013-behavioral-timer.md) — `X` until
  the first trigger.
- `src/library/74xx/` — `chip.ts`, `paths.ts`, `outcomes.ts`, `hc-timing.ts`,
  `seven-segment-decoder.ts` (state, latch edge), `buffers.ts` / `transceiver.ts` (`ten`,
  `tdis`).
- `src/core/diagnostics.ts`, `src/core/component.ts` (`TimingDef`, `ctx.report`),
  `src/core/function-table.ts`, `src/core/testing/function-table.ts`.
- `src/ui/PartInfoPanel.tsx`, `src/ui/part-info.ts`, `src/ui/SimulationPanel.tsx`.
- `tests/scenarios/carry-over.test.ts`, `symbol-drawing.test.ts`, `src/app/examples.ts`.
- `.ai/lessons.md` — R06 (forced evaluation, Nexperia downloads), R07/R08 (laying out examples
  with a throwaway generator), R08 (pdftotext drops overlines).

## Design

### Parts

All from the Nexperia data sheets (current for every one of them, found by web search; the user
downloads the PDFs, as in R06/R08). Names and pinouts below are from memory and get fixed in
task 3.

| Part    | Function                                                | Package | Shape                                                |
| ------- | ------------------------------------------------------- | ------- | ---------------------------------------------------- |
| 74HC74  | dual D-type flip-flop with set and reset; positive edge | DIP-14  | 2 units: nD, nCP, nSD̅, nRD̅ → nQ, nQ̅                  |
| 74HC107 | dual JK flip-flop with reset; negative edge             | DIP-14  | 2 units: nJ, nK, nCP, nR̅ → nQ, nQ̅                    |
| 74HC109 | dual JK̅ flip-flop with set and reset; positive edge     | DIP-16  | 2 units: nJ, nK̅, nCP, nSD̅, nRD̅ → nQ, nQ̅              |
| 74HC112 | dual JK flip-flop with set and reset; negative edge     | DIP-16  | 2 units: nJ, nK, nCP, nSD̅, nRD̅ → nQ, nQ̅              |
| 74HC173 | quad D-type flip-flop; positive edge; 3-state           | DIP-16  | D0–D3, CP, E̅1, E̅2 (data enable), MR (HIGH), OE̅1, OE̅2 |
| 74HC175 | quad D-type flip-flop with reset; positive edge         | DIP-16  | D0–D3, CP, MR̅ → Q0–Q3, Q̅0–Q̅3                         |
| 74HC273 | octal D-type flip-flop with reset; positive edge        | DIP-20  | D0–D7, CP, MR̅ → Q0–Q7                                |
| 74HC374 | octal D-type flip-flop; positive edge; 3-state          | DIP-20  | D0–D7, CP, OE̅ → Q0–Q7 (interleaved pinout)           |
| 74HC377 | octal D-type flip-flop with data enable; positive edge  | DIP-20  | D0–D7, CP, E̅ → Q0–Q7                                 |
| 74HC574 | octal D-type flip-flop; positive edge; 3-state          | DIP-20  | D0–D7, CP, OE̅ → Q0–Q7 (flow-through pinout)          |

- Flip-flop pairs have independent sections (`units`); registers share their controls and are
  one section (R08 rule).
- Complementary outputs follow the 151's `YN` precedent: `1Q` and `1QN` drawn `1Q̅`
  (`label`, `activeLow`).

### Behavior of edge-triggered chips

- **Power-on:** every stored bit is `X` until an asynchronous set/reset or a clean load (like
  the 4511 and the 555, ADR-0013).
- **Edges are strict** (`rose`/`fell`); the forced evaluation never clocks (nothing changed).
  An **uncertain edge** (`X`/`Z` ↔ 0/1 on the clock) makes `X` only the bits that could change
  (where the value they would load differs from the stored one).
- **Asynchronous set/reset** override the clock, after their own path delay. Both active
  (74, 109, 112): Q = Q̅ = H, as the function tables say; released at the same instant: `X`
  (the data sheets call that state unstable). An unknown set/reset drives `X` where it could
  matter.
- **3-state registers** (173, 374, 574): the enable only gates the outputs (`ten`/`tdis`, as
  the 244/245); loading works while disabled.
- **Delays** per data sheet path with `pathDelays` (`tpd(nCP to nQ)`, `tpd(nSD to nQ)`, …).
- Shared machinery in `library/74xx` (edge detection, async controls, the `X` policy, the
  checks), so R09b's counters and shift registers reuse it. No allocation in `evaluate`; state
  is plain data and typed arrays.

### Timing checks (`core`)

Generic, so memories (R12) and the CPU (R17) can use them too. A part declares its checks from
its pin list and timing; per instance the state holds the time of the last change of each
watched pin and of the last edges (`Float64Array`, absolute simulation times, so a carry-over
keeps them; the forced evaluation records nothing since nothing changed).

| Check       | Fires when                                                                  | Kind                    |
| ----------- | --------------------------------------------------------------------------- | ----------------------- |
| setup       | a data or enable input changed less than `tsu` before the active edge       | `setup-violation`       |
| hold        | it changed less than `th` after the active edge                             | `hold-violation`        |
| pulse width | a clock phase, or an async set/reset pulse, was shorter than `tW`           | `pulse-width-violation` |
| recovery    | the active edge came less than `trec` after an async set/reset was released | `recovery-violation`    |

- Data and clock changing at the same instant is a setup violation (only one diagnostic).
- **Limit (Q3):** the data sheet's **guaranteed minimum at 25 °C** in a new `TimingDef.min`
  (keys like `tsu(nD to nCP)`); the typical requirement goes into `typical` (shown in the Part
  tab, may be negative: `th` typ −2 ns). Delays stay typical at 25 °C. Conditions text: "typ
  and min at 25 °C, max at −40 °C to +85 °C".
- **On a violation (Q2):** a diagnostic **and** the bits the edge may have loaded become `X`
  until an async set/reset or a clean load — like a chip that may go metastable, and the same
  rule as an uncertain edge. Per check: setup → the violating bit (an enable: the bits where D ≠
  Q); hold → the bit loaded at that edge; a too-short clock phase → the bits the adjacent active
  edge changed or would change; a too-short reset pulse → the bits not yet at their reset value;
  recovery → the bits the edge would change.
- Messages name the pin, the measured time and the limit: `setup time: D3 changed 6 ns before
  CP rose (needs ≥ 15 ns)`. Repeats merge by kind, part and pin (`count`, `lastTime`).
- The Simulation tab shows timing violations as **errors** (red): on a board they are
  intermittent failures, not style warnings.

### Sequential function tables

Nexperia's tables use `↑`/`↓` for clock transitions, lowercase `h`/`l` for "one set-up time
before the edge", `q`/`q̅` for the previous state and text such as "no change". The format and
the checker (`functionTable`) learn: `↑`/`↓` inputs (every other input applied first, then the
edge), `h`/`l` inputs, and outputs that refer to the state before the row, checked from both
prior states (the test names how to load 0 and 1). The Part tab shows the cells as written.

### Part tab: timing

A Timing section under the function table: each key with its typical value and its max (delays)
or min (requirements), the conditions and the source — where a learner finds "how much setup
time do I need".

### Example (Q4): SAP-1 register

Ben Eater's A register: two 74HC173 load from an 8-bit bus (`LOAD` on E̅1/E̅2, `CLR` on MR,
outputs always enabled) and drive a 74HC245 onto the bus (`OUT` on its OE̅); a DIP switch drives
the bus through a second 74HC245 (`SW OUT`) as the stand-in for the other modules; pull-downs
and LEDs on the bus, LEDs on the register; `io/clock` with manual step. Built with a throwaway
`CircuitBuilder` generator that checks every net (R07/R08 lessons), saved as
`examples/sap-1-register.logic.json`, run by a scenario test.

### Data sheets

The user downloads from `https://assets.nexperia.com/documents/data-sheet/<name>.pdf` into
`~/Downloads/nexperia-74hc/`: `74HC_HCT74`, `74HC_HCT107`, `74HC_HCT109`, `74HC_HCT112`,
`74HC_HCT173`, `74HC_HCT175`, `74HC_HCT273`, `74HC_HCT374`, `74HC_HCT377`, `74HC_HCT574` (a name
that 404s: the product page's data sheet link). Pinning figures and function tables are rendered
with `pdftoppm` and looked at (overlines, arrows).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `core`: `TimingDef.min`; timing checks (setup, hold, pulse width, recovery) with
  diagnostic kinds and messages, returning the bits made uncertain; no allocation per call.
  Tests on a fixture flip-flop, including carry-over and the forced evaluation.
- [x] 2. `core`: sequential function tables (`↑`, `↓`, `h`, `l`, previous-state outputs) in
  the format, validation and `functionTable`; tests on the fixture.
- [ ] 3. Data sheets: the user downloads the PDFs; pinouts, pin descriptions, function tables,
  delays per path and requirements (typ and min at 25 °C, max delays at −40…+85 °C) for the
  ten chips, sources cited.
- [ ] 4. Shared edge-triggered machinery in `library/74xx` (uncertain edges, async controls,
  checks, the `X` policy) and the 74HC74, with tests (function table per unit, set+reset, each
  path, each check inside/outside its limit, unknown and floating inputs).
- [ ] 5. JK flip-flops 74HC107, 109, 112 with tests (toggle, hold, negative/positive edges,
  set/reset, checks).
- [ ] 6. Registers 74HC175, 273, 377 with tests (377's enable setup/hold, Q̅ of the 175).
- [ ] 7. 3-state registers 74HC173, 374, 574 with tests (`ten`/`tdis`, loading while
  disabled, the 173's data enables and active-HIGH MR).
- [ ] 8. 74HC4511 LE checks (setup, hold, LE pulse width) with tests.
- [ ] 9. Across parts: carry-over property over random networks with the new chips
  (mutation-checked); symbol-drawing scenario; scenarios (74 shift chain without hold
  violations, ripple counter with visible ripple delays, a race caught by a setup check, two
  173s and a 245 on a bus); benchmark of a register chain (cost of the checks).
- [ ] 10. UI: Part tab timing section; timing violations as errors in the Simulation tab;
  looked at in both themes.
- [ ] 11. Example: SAP-1 register per Q4, run by a scenario test, looked at in the browser;
  File ▸ New from Example lists it.
- [ ] 12. e2e: the SAP-1 register loads a value from the bus and drives it back; the Part tab
  of the 74HC74 shows its timing; a too-fast clock on a 74HC74 shows a timing violation.
- [ ] 13. Docs: components.md (sequential chips, timing checks, `timing.min`), simulation.md
  (timing checks replace "planned"), editor.md (Part tab timing, error severity), ADR-0014,
  ADR index, glossary (recovery time, metastability), `src/core/README.md`,
  `src/library/README.md`, add-component recipe, lessons, roadmap (R09a done, R09b next).

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] All ten chips are in `createDefaultRegistry()` under `74xx/74hc…` with data sheet pin
  numbers, names and descriptions, a function table, a data sheet URL, and timing for every
  delay path and requirement with source and conditions.
- [ ] Every chip has a test with its function table on every unit through pin numbers, unknown
  and floating inputs (including uncertain clock edges), a timing assertion for each distinct
  path, and each of its timing checks just inside (silent) and just outside (diagnostic +
  `X`) its limit.
- [ ] The 4511 reports LE setup, hold and pulse-width violations.
- [ ] The carry-over invariance property passes on random networks including the new chips.
- [ ] The Part tab shows a chip's timing; the Simulation tab shows timing violations as errors
  with click-to-locate.
- [ ] The SAP-1 register example opens from File ▸ New from Example, compiles with no design
  issues and loads and outputs values as intended (test and by hand in the browser).

## Open questions

- [x] Q1. R09 is 18 chips plus timing checks (≈ 1.6 × R08): split? — _proposed:_ R09a
  `feat/74hc-registers` (checks, flip-flops, registers, 4511 LE checks), R09b
  `feat/74hc-counters` (161, 163, 191, 193, 164, 165, 595, 4040). — **answer:** split as
  proposed.
- [x] Q2. What a failed timing check does — _proposed:_ a diagnostic and the bits the edge may
  have loaded become `X` until a reset or a clean load; alternative: report only. —
  **answer:** report and `X`.
- [x] Q3. Which limit the checks use — _proposed:_ the guaranteed minimum at 25 °C;
  alternatives: the typical requirement (near zero or negative, rarely fires), the −40…+85 °C
  minimum (strictest). — **answer:** guaranteed minimum at 25 °C.
- [x] Q4. Examples — options: SAP-1 register, timing-violation demo, decade counter on a
  display, shift register LEDs. — **answer:** SAP-1 register (R09a) and shift register LEDs
  (R09b, with the 595).

## Progress log

- 2026-11-07 — plan drafted. Web searches: Nexperia has current data sheets for all 18
  sequential chips of R09 (107, 109, 112, 173, 377, 4040, 193 checked explicitly). Q1–Q4
  answered; R09 split into R09a (this branch) and R09b.
- 2026-11-07 — plan approved; branch started. The user downloaded the ten Nexperia data sheets
  to `~/Downloads/nexperia-74hc/`.

## Handoff

- **State:** plan approved, branch started; data sheets in `~/Downloads/nexperia-74hc/`.
- **Next step:** task 1 (timing checks in `core`).
- **Watch out:** the forced evaluation must neither clock nor record change times; checks must
  stay idempotent for the carry-over property.
- **Verify with:** `pnpm check`.

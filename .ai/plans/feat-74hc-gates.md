# Plan: feat/74hc-gates

| Field      | Value                                                             |
| ---------- | ----------------------------------------------------------------- |
| Branch     | `feat/74hc-gates`                                                 |
| Roadmap    | R06 — 74HC gates & bus buffers ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                       |
| Depends on | R01, R02, R03, R04a, R05                                          |
| Created    | 2026-11-07                                                        |

## Goal

The first real chips. Eighteen 74HC gates and bus buffers with their datasheet pinout, function
and timing, drawn as DIP packages and simulated with real propagation, enable and disable delays,
each tested against its datasheet function table. A Part Info view shows what a learner needs
while wiring a chip — its pinout, what each pin does, its function table and the
datasheet. After this branch the M1 circuit (switch → 74HC00 → LED) can be built and run in the
browser; R07 saves it.

## Scope

**In scope**

- `core`: data the Part Info view needs on definitions (pin descriptions, function tables; Q3),
  validated by the registry.
- `library/74xx`: 74HC00, 02, 04, 08, 10, 11, 14, 20, 21, 27, 30, 32, 86 (gates), 125, 126
  (quad tri-state buffers), 240, 244 (octal buffers/line drivers), 245 (octal bus transceiver);
  in `createDefaultRegistry()`. Behavior shared per function, timing per logic family (HC now),
  so 74HCT/74LS/74AC variants are a timing table (and input model) away.
- Tests: function table + unknown/floating inputs + every distinct delay per chip; pinout
  invariants for every package part; the carry-over invariance property over random 74xx
  networks; scenarios (M1 circuit with a 74HC00, a shared bus with 244s and a 245).
- `editor`: DIP drawing checked at DIP-14/DIP-20 with real names (`1OE`, `1A0`, n.c. pins).
- `ui`: the Part Info view (Q2, Q3).
- `app`: Hello, LED built with a 74HC00 (unused inputs tied, per Q4); a 74HC row in the Symbol
  Gallery.
- Docs: components.md (74xx section), editor.md (Part Info), ADR-0011, glossary, READMEs,
  lessons, roadmap.

**Out of scope** (and where it goes instead)

- Combinational MSI (138, 157, 283, …) → R08; flip-flops, counters, registers and setup/hold
  checks → R09.
- Other logic families (74HCT, 74LS with TTL inputs that float high, 74AC) → backlog (the
  factory takes the family; only HC timing ships now).
- Schmitt-trigger hysteresis and slow input edges (74HC14 behaves as an inverter with its own
  delay; levels are digital) → not modeled.
- Open-drain and other gates not in the roadmap list (74HC03, 132, 133, 266, …) → backlog, added
  on demand with the same factory.
- Power-pin and fan-out design checks → backlog. Symbol view (`U1A`…) → backlog (units are
  recorded now).
- Worst-case timing mode (uses `timing.max`, recorded now) → backlog.

## Context

Read before starting:

- [docs/components.md](../../docs/components.md) — definition shape, packages and pin numbering,
  units, timing, behavior guidelines, testing a part.
- [.ai/workflows/add-component.md](../workflows/add-component.md) — the recipe per part.
- [docs/simulation.md](../../docs/simulation.md) — inertial delays (one pending drive per pin,
  per-call delays), power-on (tri-state pins start released), floating-input reporting, the
  "evaluate is idempotent" contract (carry-over).
- [ADR-0004](../../docs/adr/0004-chips-as-packages.md) — chips as packages, units as data, power
  pins not simulated.
- [docs/editor.md](../../docs/editor.md) — DIP drawing, Parts panel details, bottom dock tabs.
- `src/library/primitives/gates.ts`, `tristate-buffer.ts` — 4-state gate and enable semantics to
  reuse; `src/core/testing/` — `Bench`, `functionTable`, `truthTable`, `measure`.
- `src/ui/PartsPanel.tsx` (`PartDetails`: preview, title, pin chips, datasheet link — the seed of
  Part Info), `src/ui/Workbench.tsx` (bottom dock tabs), `src/editor/symbols/dip.ts`.
- `tests/scenarios/carry-over.test.ts`, `symbol-drawing.test.ts` — both must cover the new parts.

## Design

### Parts

All DIP-14 except the 24x (DIP-20). Pin names, numbers, function tables and timing from one
datasheet vendor (Q1).

| Part    | Function                                        | Units                |
| ------- | ----------------------------------------------- | -------------------- |
| 74HC00  | quad 2-input NAND                               | 4 × (nA, nB → nY)    |
| 74HC02  | quad 2-input NOR (output pin first: 1Y, 1A, 1B) | 4                    |
| 74HC04  | hex inverter                                    | 6 × (nA → nY)        |
| 74HC08  | quad 2-input AND                                | 4                    |
| 74HC10  | triple 3-input NAND                             | 3                    |
| 74HC11  | triple 3-input AND                              | 3                    |
| 74HC14  | hex inverting Schmitt trigger                   | 6                    |
| 74HC20  | dual 4-input NAND (2 n.c. pins)                 | 2                    |
| 74HC21  | dual 4-input AND (2 n.c. pins)                  | 2                    |
| 74HC27  | triple 3-input NOR                              | 3                    |
| 74HC30  | 8-input NAND (3 n.c. pins)                      | 1                    |
| 74HC32  | quad 2-input OR                                 | 4                    |
| 74HC86  | quad 2-input XOR                                | 4                    |
| 74HC125 | quad buffer, 3-state, OE active low             | 4 × (nOE, nA → nY)   |
| 74HC126 | quad buffer, 3-state, OE active high            | 4                    |
| 74HC240 | octal inverting buffer/line driver, 3-state     | 2 × (nOE, 4 × A → Y) |
| 74HC244 | octal buffer/line driver, 3-state               | 2                    |
| 74HC245 | octal bus transceiver, 3-state (DIR, OE)        | — (one section)      |

Type ids `74xx/74hc00` … (lowercase, never renamed), names `74HC00`, designator prefix `U`
(default). n.c. pins are `nc` pins named `NC<number>` (names must be unique); the DIP drawer
shows them as `NC`.

### Module layout (`src/library/74xx/`)

- `pinout.ts` — `pins('1A, 2A', '1, 4', 'in', 'data input')` rows written like the data
  sheet's pin description table (`n.c.` → `NC<number>`); `dipPins` orders them by number and
  rejects missing or repeated numbers.
- `chip.ts` — `ChipSpec` (function, pins, units, function table — shared by every family),
  `LogicFamily` (per chip: data sheet URL and `TimingDef`), `chipDefinition(spec, family,
  behavior)` → type `74xx/74hc00`, name `74HC00`, DIP package.
- `hc-timing.ts` — the HC family: per chip the Nexperia document, revision and `[typ, max]` per
  delay symbol (Q5: VCC = 4.5 V, CL = 50 pF, table 7).
- `gates.ts` (`GATE_SPECS`, op + invert + units), `buffers.ts` (`BUFFER_SPECS`, enable level,
  invert, buffers), `transceiver.ts` (245) with their behaviors; `index.ts` exports `chips74xx`
  for the registry. Tests: `pinout.test.ts`, `chips.test.ts` (invariants of every chip),
  `gates.test.ts`, `buffers.test.ts`, `transceiver.test.ts` — function tables checked through
  pin numbers read off the pinning figures (a second, independent transcription), every delay
  against a third table of the data sheet's numbers.

### Behavior

- **Every section on every call.** The closure precomputes pin indices (typed arrays);
  `evaluate` re-evaluates every gate/buffer/bit, re-driving unchanged outputs (which schedules
  nothing). _Changed in task 3:_ evaluating only sections with a changed input (all when none
  changed) was wrong — the forced evaluation at power-on and after a recompile can see some
  inputs changed in the same delta and silently skipped the others (a 74HC125 with one buffer
  used left the others released instead of `X`; regression test in `buffers.test.ts`).
- **Gates**: the 4-state operators from `core` (`and`, `or`, `xor`, `not`, `toInput`), output
  driven after `tpd` — the same semantics as `prim/*`: a 0 into a NAND gives 1 even with an `X`
  on the other input; a floating input reads as `X`.
- **Tri-state buffers (125, 126, 240, 244)**: enabled → `Y = A` (inverted for 240) after `tpd`;
  the enable just changed to active → after `ten` (tPZH/tPZL), to inactive → released after
  `tdis` (tPHZ/tPLZ); enable unknown or floating → strong `X` (it might be driving), as
  `prim/tristate-buffer`. The delay is chosen per call from `ctx.changed(OE)`, so no state.
- **74HC245**: `OE` high → both ports released (`tdis`). `OE` low: `DIR` high → B = A, A
  released; `DIR` low → A = B, B released; the side that starts driving uses `ten`, the side
  that stops `tdis`, data changes `tpd`. `DIR` or `OE` unknown → every port that might be an
  output drives `X`. A and B are `bidir` pins; the chip only reads the current input side, so a
  floating input bus is reported as such and an idle output bus is not.
- **74HC14**: an inverter with the Schmitt trigger's own delay; hysteresis is analog and not
  modeled (documented).

### Timing

One delay per datasheet symbol: `tpd` (symmetric in the chosen datasheets), `ten`, `tdis`.
Typical values at VCC = 5 V are what the simulator uses, as components.md prescribes; `max` is
recorded for later. Exact numbers are collected from the datasheets in task 2 and cited per chip.

### Part Info (Q2, Q3)

A **Part** tab in the bottom dock (next to Messages and Simulation) showing the part last picked
— a single part selected on the canvas or a part clicked in the Parts panel. Content (Q3): the
part drawn large by the existing drawers (DIP for chips), header with name, title, type and the
datasheet link (with the datasheet's name and revision), the pin table and the function table.
No timing table (Q3: timing stays in the definitions and docs).

```
┌ MESSAGES · SIMULATION · PART ─────────────────────────────────────────────────────────┐
│ 74HC00  Quad 2-input NAND gate   74xx/74hc00   Datasheet ↗ (Nexperia 74HC_HCT00 rev. …) │
│ ┌──────┐  No. Name Type  Description            │ Function (each gate)                  │
│ │ DIP  │  1   1A   in    data input             │  nA nB │ nY                           │
│ │ draw │  2   1B   in    data input             │  L  X  │ H                            │
│ │ ing  │  3   1Y   out   data output            │  X  L  │ H                            │
│ └──────┘  …                                     │  H  H  │ L                            │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Parts without descriptions or a function table (`prim/*`, `io/*`) show what they have: drawing,
pins with their type, props summary.

Data on the definition (Q3): `PinDef.description` (the datasheet's pin description) and
`ComponentDefinition.functionTable` (per unit, datasheet letters, with a note such as "each
gate"), validated by the registry (columns name real pins, letters valid). The tests use the
same tables through `functionTable(bench, …)` — the table is a transcription of the datasheet,
the behavior is independent code, so the test still checks one against the other — and add
rows the datasheet leaves implicit (every unit, unknown inputs). The existing Parts panel
details stay as they are (compact preview).

### Examples

- **Hello, LED**: the NAND becomes gate A of a 74HC00 (B tied to VCC: an inverter); the unused
  inputs are tied to GND as on a real board (Q4), so the example compiles with no issues.
- **Symbol Gallery**: a row with every 74HC chip. The `dev/dip-14`/`dev/dip-28` fixtures stay
  (they still draw a clock pin and a 28-pin package, which no shipped part has before R09/R12).

### Decision record

ADR-0011 — real chips: the datasheet vendor and its pin names (they become part of test benches
and diagnostics, so they are fixed now), function shared per chip number with timing per
family, function tables and pin descriptions as definition data shown to the user.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `core`: `PinDef.description`, `ComponentDefinition.functionTable` (shape, registry
  validation, tests); `functionTable` test helper accepts a definition's table per unit
  (Q3). Docs: components.md definition shape.
- [x] 2. Datasheets: collect pinouts, pin descriptions, function tables and HC timing for the
  18 chips from the chosen vendor (Q1) into `src/library/74xx/` data (`dip.ts` helpers,
  `hc-timing.ts` with sources); pinout invariant test for every package part.
- [x] 3. Gate factory + 74HC00, 02, 04, 08, 32, 86 (2-input and inverters) with tests:
  function table per unit, unknown/floating inputs, `tpd`, units independent.
- [x] 4. 74HC10, 11, 14, 20, 21, 27, 30 with tests (n.c. pins, 8-input table).
- [x] 5. Buffer factory + 74HC125, 126, 240, 244 with tests (enable polarity, `ten`/`tdis`/`tpd`,
  unknown enable, groups independent).
- [x] 6. 74HC245 with tests (both directions, isolation, direction switch, unknown DIR/OE,
  floating input side).
- [x] 7. Registry: `74xx` family in `createDefaultRegistry()`; carry-over property over random
  74xx networks (gates, buffers, 245 on shared nets); scenarios: M1 circuit with a 74HC00
  built as a document, a shared bus (two 244s → contention diagnostic when both enabled;
  245 between two buses). Circuit benchmark: a 74HC00 grid next to the `prim/nand` grid.
- [ ] 8. Editor: DIP drawing with real chips (`NC` names, `1OE`/`1A0` fit at DIP-20, active-low
  overlines), looked at in both themes and gate styles; Symbol Gallery 74HC row; Hello, LED
  with a 74HC00 (Q4).
- [ ] 9. UI: Part tab in the bottom dock (Q2, Q3) — drawing, pin table with descriptions,
  function table, datasheet link; follows the last picked part (canvas or Parts panel);
  unit tests for the pure parts (building the tables).
- [ ] 10. e2e: place a 74HC00 from the Parts panel, wire switch → gate → LED, run, the LED
  follows the switch; Part Info shows the pinout and datasheet of the selected chip.
- [ ] 11. Docs: components.md (74xx section, parts table, statuses), editor.md (Part Info,
  gallery), architecture.md, glossary, ADR-0011, `src/library/README.md`, lessons; roadmap
  status.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check` and `pnpm build` are green; `pnpm e2e` is green.
- [ ] All 18 chips are in `createDefaultRegistry()` under `74xx/74hc…` with datasheet pin
  numbers and names, a datasheet URL, timing with source and conditions, and units.
- [ ] Every chip has a test with its datasheet function table (every unit), unknown/floating
  inputs, and a timing assertion for each distinct delay it uses (`tpd`, `ten`, `tdis`).
- [ ] The carry-over invariance property passes on random networks of 74xx chips.
- [ ] A scenario shows two enabled 244 outputs on one bus reported as contention, and a 245
  passing data both ways between two buses.
- [ ] In the browser: a 74HC00 placed from the Parts panel, wired switch → gate → LED, runs and
  the LED follows the switch (e2e and looked at by hand).
- [ ] The Part tab shows the drawing, pin numbers, names and descriptions, the function table and
  the datasheet link for a 74HC chip, and degrades gracefully for parts without them.
- [ ] Hello, LED uses a 74HC00 and compiles with no design issues.

## Open questions

- [x] Q1. Datasheet vendor (pin names, function tables, timing) — _proposed:_ Nexperia: bus pins
  0-based like the computer's buses (`A0`–`A7`, `1A0`–`1A3`), typical delays given at
  VCC = 5 V, CL = 15 pF as components.md asks; TI (`A1`–`A8`, typical at 4.5 V, 50 pF) is
  the alternative. — **answer:** Nexperia.
- [x] Q2. Where Part Info lives — _proposed:_ a "Part" tab in the bottom dock following the
  last picked part (canvas or Parts panel), open while wiring; alternatives: a dialog
  (context menu / F1), or only richer details at the bottom of the Parts panel. —
  **answer:** a Part tab in the bottom dock.
- [x] Q3. What Part Info shows — _proposed:_ pin table with datasheet descriptions, function
  table, timing (typ/max, conditions, source), DIP drawing, datasheet link; the first two
  need new definition data (`PinDef.description`, `functionTable`). — **answer:** pin table
  with descriptions, function table, DIP drawing and datasheet link; **no timing table**
  (timing stays in the definitions and the docs).
- [x] Q4. Floating inputs of unused gates (a 74HC00 with one gate used has 6 floating inputs) —
  _proposed:_ keep warning per input, as on a real board (CMOS inputs must be tied), and tie
  them in examples; alternatives: one grouped warning per chip, or no warning for a section
  whose output is unconnected. — **answer:** warn per input (no new check); examples tie
  unused inputs.

- [x] Q5. Timing conditions (found in task 2: Nexperia gives typical `ten`/`tdis` only at
  2.0/4.5/6.0 V with CL = 50 pF, typical `tpd` also at 5 V with 15 pF) — _proposed:_ every
  delay at VCC = 4.5 V, CL = 50 pF (typical at 25 °C; max at −40 °C to +85 °C), one
  condition for all parts and symbols, matching the max columns; alternative: `tpd` at 5 V /
  15 pF and `ten`/`tdis` at 4.5 V. — **answer:** all at 4.5 V, 50 pF (components.md
  updated).

## Progress log

- 2026-11-07 — plan drafted; Q1–Q4 answered (Nexperia; Part tab in the bottom dock; pins,
  function table, drawing and datasheet — no timing; warn per floating input).
- 2026-11-07 — plan approved; branch started.
- 2026-11-07 — task 1: `FunctionTable` moved into `core` (`function-table.ts`: parse, validate),
  `PinDef.description`, `ComponentDefinition.functionTable` (registry validates it);
  `functionTable(bench, table, pins)` maps generic columns to a unit's pins. Text cells (`A=B`)
  are display-only. Nexperia's asset server answers 403 to automated downloads: datasheets have
  to be downloaded by the user (task 2).
- 2026-11-07 — tasks 2–6: the user downloaded the 18 Nexperia data sheets to
  `~/Downloads/nexperia-74hc/` (read with `pdftotext -layout`). Typical `ten`/`tdis` exist only
  at 4.5 V/50 pF → Q5. All 18 chips in `src/library/74xx/` and the default registry; per-section
  evaluation dropped (see Design ▸ Behavior). 930 tests green.
- 2026-11-07 — task 7: carry-over property over 30 random 74xx networks (gates, buffers, 245
  on shared nets); bus scenario (`tests/scenarios/bus-74hc.test.ts`: 244s taking turns on a bus
  fight for 1 ns at a handover, ten 13 < tdis 14 ns; contention; 245 both ways). The M1 circuit
  scenario moves to task 8 (it is Hello, LED). Benchmark (`pnpm bench`, Apple M3 Pro): inverter
  chain ×1000 13.2M events/s, 74HC04 chain ×1002 8.4M events/s (all six inverters re-evaluated
  per event), ring oscillator 13.4M events/s. Per-section evaluation would need a kernel flag
  for the forced evaluation → backlog if chips ever dominate.

## Handoff

- **State:** tasks 1–7 done: 18 chips registered and tested, carry-over property and bus
  scenarios green, benchmark recorded in the log.
- **Next step:** task 8 — DIP drawing check with real chips (`NC`, `1OE`/`1A0` at DIP-20),
  Symbol Gallery 74HC row, Hello, LED with a 74HC00 (unused inputs tied to GND) plus a scenario
  that runs it; update `tests/scenarios/editing.test.ts`, which redraws Hello, LED by gestures.
- **Watch out:** data sheets are outside the repo (`~/Downloads/nexperia-74hc/`). Text cells in
  function tables (`A=B`) are display-only.
- **Verify with:** `pnpm check`; `pnpm bench` for throughput.

# Plan: feat/74hc-msi

| Field      | Value                                                           |
| ---------- | --------------------------------------------------------------- |
| Branch     | `feat/74hc-msi`                                                 |
| Roadmap    | R08 — 74HC combinational MSI ([roadmap](../../docs/roadmap.md)) |
| Status     | done                                                            |
| Depends on | R06 (74xx specs, families, Part tab), R07 (examples)            |
| Created    | 2026-11-07                                                      |

## Goal

The building blocks between gates and registers: eleven 74HC MSI chips (decoders, multiplexers,
an adder, a comparator, priority encoders, a BCD → 7-segment decoder) from their data sheets,
and a behavioral NE555 timer, so Ben Eater's clock module (three 555s and three gate chips) and
his ALU's adder can be built and checked in the simulator. They are the first chips with several
delay paths, wide inputs and (4511, 555) internal state, which R09's flip-flops and counters
build on.

## Scope

**In scope**

- `library/74xx`: 74HC138, 139, 151, 153, 157, 158, 283, 85, 147, 148, 4511 as `ChipSpec`s with
  HC timing, in `createDefaultRegistry()`. Chip behaviors may keep state (4511 latch).
- Per-path delays (`tpd` from each input group to each output, as table 7 lists them) and the
  rule that picks one when several inputs change at once.
- A new family `timer` with `timer/ne555`: DIP-8 with the TI pinout, astable, monostable and
  bistable modes; the external R and C as props (Q1); SI-prefix entry for number props with a
  unit (`4.7k`, `100n`) in Properties.
- Tests: function table on every unit through pin numbers, unknown/floating inputs, every
  distinct delay path; exhaustive checks for 283, 85, 4511; cascading (two 85s, two 148s);
  555 timing against the data sheet formulas; carry-over property over random networks with
  the new chips; drawing scenario.
- Examples (Q3), a Symbol Gallery row, e2e.
- Docs: components.md (74xx MSI rows, behavior rules, `timer` family), ADR-0013 (behavioral
  analog timer), editor.md if Properties changes, glossary, READMEs, lessons, roadmap.

**Out of scope** (and where it goes instead)

- Flip-flops, counters, registers, setup/hold checks → R09.
- Resistors, capacitors and potentiometers as parts (drawn, not simulated; a 555 that reads its
  R and C from the schematic), turning a potentiometer with the Interact tool → backlog.
- Analog effects of the 555 (supply-dependent timing, CONT modulation, trigger pulse shape) →
  not modeled; CONT is drawn but not simulated.
- Internal glitches of decoders and adders (path skew inside the chip) → not modeled; glitches
  from input skew between chips happen naturally.
- Other families (74HCT, 74LS) → backlog, as for R06. CMOS 555s (TLC555, ICM7555) and the 556
  → added on demand with the same model.
- A read-only "resulting frequency" hint for the 555 in Properties → backlog unless cheap.

## Context

Read before starting:

- [docs/components.md](../../docs/components.md) — definition shape, function tables, 74xx
  section (specs, families, every section on every call).
- [ADR-0011](../../docs/adr/0011-real-chips.md) — Nexperia data sheets, 4.5 V / 50 pF timing,
  `ChipSpec` + `LogicFamily`.
- [docs/simulation.md](../../docs/simulation.md) — inertial model (a confirmed pending change
  is kept), timers (`wakeAfter` with tokens, no cancel), forced evaluation.
- `src/library/74xx/` — `chip.ts`, `pinout.ts`, `hc-timing.ts`, `gates.ts`, `transceiver.ts`
  and their tests; `src/library/io/clock.ts` (timer-driven part).
- `src/core/testing/function-table.ts` — `functionTable`, `truthTable`.
- `src/ui/prop-input.ts` — Properties text ↔ value.
- `tests/scenarios/carry-over.test.ts`, `symbol-drawing.test.ts`, `src/app/examples.ts`,
  `examples/`.
- `.ai/lessons.md` — R06 (forced evaluation, Nexperia downloads), R07 (laying out examples).

## Design

### Parts

All DIP-16, from the Nexperia data sheets (where Nexperia has none: Q2). Pin names as printed
there; the list below is from memory and gets fixed in task 2.

| Part     | Function                                     | Units / shape                                   |
| -------- | -------------------------------------------- | ----------------------------------------------- |
| 74HC138  | 3-to-8 line decoder/demultiplexer; inverting | A0–A2, E1, E2 (LOW), E3 → Y0–Y7 (LOW)           |
| 74HC139  | dual 2-to-4 line decoder/demultiplexer       | 2 × (nE, nA0, nA1 → nY0–nY3, LOW)               |
| 74HC151  | 8-input multiplexer                          | I0–I7, S0–S2, E (LOW) → Y, Y (inverted)         |
| 74HC153  | dual 4-input multiplexer                     | 2 × (nE, nI0–nI3 → nY), S0, S1 shared           |
| 74HC157  | quad 2-input multiplexer                     | 4 × (nI0, nI1 → nY), S, E shared                |
| 74HC158  | quad 2-input multiplexer; inverting          | as 157, Y inverted                              |
| 74HC283  | 4-bit binary full adder with fast carry      | A, B, CIN → S, COUT                             |
| 74HC85   | 4-bit magnitude comparator                   | A0–A3, B0–B3, cascade IA>B, IA=B, IA<B → 3 outs |
| 74HC147  | 10-to-4 line priority encoder                | 9 inputs (LOW) → 4 outputs (LOW), one n.c. pin  |
| 74HC148  | 8-to-3 line priority encoder                 | 8 inputs, EI → A0–A2, GS, EO (all LOW)          |
| 74HC4511 | BCD to 7-segment latch/decoder/driver        | D0–D3, LE, BI, LT → a–g                         |

Units with shared control pins (153, 157, 158) list the shared pins in every unit, in the
function table's column order, so `functionTable(bench, table, unit.pins)` works per unit.

### Delays with several paths

MSI data sheets give one `tpd` per path (138: An → Yn, E3 → Yn, E1/E2 → Yn; 283: An/Bn → Sn,
CIN → Sn, An/Bn → COUT, CIN → COUT; 4511: Dn, LE, BI, LT → segments). Timing keys name the path
with the data sheet's symbols: `tpd(An-Yn)`, `tpd(CIN-COUT)`; one-path chips keep `tpd`.

Rule, per output: the delay is the **longest** typical delay among the paths whose input changed
in this delta (the output settles after its slowest cause); with nothing changed (forced
evaluation at power-on or after a recompile) the longest path of that output. Safe for
carry-over: re-driving a pending value keeps it where it is (inertial model). Per-output path
tables are precomputed in the closure (typed arrays), so `evaluate` does not allocate.

### Behavior

- **Every output on every call** (ADR-0011); no section skipping.
- **4-state, as precise as cheap**: an unknown select or address bit gives `X` only where the
  candidates differ (157 with S = X and I0 = I1 = 1 → Y = 1); a decoder with an unknown address
  bit drives `X` on the outputs that could be selected and keeps the others inactive; an
  unknown enable drives `X` on outputs that would be active. The adder's sum bits below the
  first unknown input bit stay known; the rest and COUT are `X`. The comparator is `X` when an
  unknown bit could change the result. Floating inputs read as `X` (and are reported).
- **74HC4511**: LE low → transparent, LE high → holds the BCD code latched at the rising edge
  (state: four levels; `X` if latched while unknown); LT low → all segments on (overrides BI);
  BI low → all off; codes 10–15 blank, as the data sheet table shows. Drives a common-cathode
  `io/seven-segment` directly (no resistors modeled). Needs chip behaviors with state:
  `ChipBehavior` becomes generic over the state; the latch edge uses `rose`/`changed` so the
  forced evaluation never latches.
- **Priority encoders**: highest-numbered active input wins; 148 EI/EO/GS for cascading (two
  148s → 16-to-4 in a test).

### NE555 (`timer/ne555`)

Source: TI NE555 data sheet (SLFS022K, rev. March 2026) — the part in Ben Eater's clock module.
DIP-8: 1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CONT, 6 THRES, 7 DISCH, 8 VCC. The data sheet's
function table is digital once voltages are read as levels (TRIG L = below ⅓ VCC, THRES H =
above ⅔ VCC): RESET L → OUT L, DISCH on; TRIG L → OUT H, DISCH off; TRIG H and THRES H → OUT
L; TRIG H and THRES L → as before. RESET overrides TRIG, which overrides THRES.

- `mode` prop: `astable` (default), `monostable`, `bistable`. The capacitor is not simulated:
  the pins wired to the RC network are drawn and connectable but not simulated (`nc` in that
  mode, with a description saying why): astable TRIG, THRES, DISCH; monostable THRES, DISCH.
  The pin list is a function of the mode (pin numbers never change).
- Timing from the external parts as props (Q1): `RA`, `RB` (astable only), `C`. Astable: first
  high 1.1 × (RA + RB) × C (the capacitor charges from 0 V), then tH = 0.693 × (RA + RB) × C,
  tL = 0.693 × RB × C (data sheet equations 1–2); RESET low stops it with OUT low, and it
  restarts with a first cycle when RESET goes high. Monostable: TRIG falling starts a pulse of
  tw = 1.1 × RA × C; triggers during the pulse are ignored; if TRIG is still low at the end,
  OUT stays high until TRIG rises (data sheet: "the sequence ends only if TRIG is high"). RESET
  low ends it. Bistable: the function table on TRIG, THRES, RESET, DISCH an open-collector
  output (strong 0 or released).
- Output delay: the data sheet's typical output rise/fall time (100 ns) or the Figure 5-8
  `tPD`, whichever task 8 finds best supported; recorded in `timing` with its source.
- Power-on state (Q4): astable starts high (capacitor empty); monostable and bistable drive `X`
  until the first trigger or reset ("as previously established" is undefined at power-on).
- Timers via `wakeAfter` with a generation token in the state (RESET and retriggers make
  pending wakes stale; there is no cancel).
- SI-prefixed entry for `number` props with a unit (`4.7k` → 4700 Ω, `100n` → 1e−7 F, `µ`/`u`,
  `p`, `M`, `G`); Properties shows values with a prefix. `Hz` props get it too.
- ADR-0013: behavioral analog parts — the RC network as props, its pins not simulated.

### Data sheets

Nexperia's asset server refuses automated downloads (R06 lesson): the user downloads
`https://assets.nexperia.com/documents/data-sheet/<name>.pdf` for `74HC_HCT138`,
`74HC_HCT139`, `74HC_HCT151`, `74HC_HCT153`, `74HC_HCT157`, `74HC158`, `74HC_HCT283`,
`74HC_HCT85`, `74HC_HCT147`, `74HC_HCT4511` into `~/Downloads/nexperia-74hc/`. Web searches
found current Nexperia sheets for 85, 158 (`74HC158`, rev. 4), 4511 (rev. 4, March 2024); none
for **148** (TI SN74HC148, SCLS109H, is current) and possibly none for 147 and 283 (only
Philips/NXP-era copies found). TI data sheets download fine (NE555, SN74HC148 already fetched
to the scratchpad). Q2: a chip without a current Nexperia sheet follows the current TI data
sheet (pin names, function table, timing at 4.5 V / 50 pF), cited like the others.

### Examples (Q3)

- **Clock module** (Ben Eater): an astable 555 (the free-running clock), a monostable 555 (the
  debounced step button), a bistable 555 (the debounced auto/manual switch), 74HC04/08/32 for
  the select and HLT logic, an LED on the clock output.
- **BCD → 7-segment**: a DIP switch (4 bits) → 74HC4511 → common-cathode 7-segment display, LT
  and BI tied inactive, LE low (transparent).

Built with `CircuitBuilder` in a throwaway script that checks the nets, then saved as files
(R07 lesson); each runs in a test.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `library/74xx` groundwork: `ChipBehavior` generic over state; per-path delay tables
  (`tpd(An-Yn)` keys, longest changed path, precomputed); helpers for buses of pins. Tests on
  a small fixture chip.
- [x] 2. Data sheets: the user downloads the Nexperia PDFs; pinouts, pin descriptions, function
  tables and HC timing (every path) for the 11 chips, sources cited; fallback per Q2.
- [x] 3. Decoders 74HC138, 139 with tests (every output, enables, unknown address/enable, each
  path delay).
- [x] 4. Multiplexers 74HC151, 153, 157, 158 with tests (both 151 outputs, shared selects,
  unknown select with equal/different candidates, each path delay).
- [x] 5. 74HC283 and 74HC85 with tests: exhaustive against arithmetic; unknown bits; carry and
  cascade paths; two 85s cascaded to 8 bits.
- [x] 6. Priority encoders 74HC147, 148 with tests (priority, GS/EO, two 148s cascaded).
- [x] 7. 74HC4511 with tests (every code 0–15, LT/BI priority, latch: transparent, hold, no latch
  on the forced evaluation, unknown latched), driving an `io/seven-segment` in a scenario.
- [x] 8. `timer/ne555` (family `timer` in the default registry), SI-prefix prop entry, ADR-0013;
  tests: astable first cycle, tH, tL against the formulas, RESET stop/restart; monostable tw,
  ignored retrigger, held trigger; bistable function table and DISCH; power-on per Q4; prop
  entry parsing/formatting.
- [x] 9. Registry and properties across parts: carry-over property over random networks with
  the new chips (stateful 4511 and 555 included); symbol-drawing scenario covers DIP-16 and
  DIP-8; Symbol Gallery row; looked at in both themes (DIP-16 names such as `IA>B` fit).
- [x] 10. Examples per Q3, run by tests, looked at in the browser; File ▸ New from Example lists
  them.
- [x] 11. e2e: an example with a 555 runs (an LED toggles); Part tab of a DIP-16 chip.
- [x] 12. Docs: components.md (MSI rows, delays with several paths, `timer` family), ADR-0013,
  ADR index, glossary, `src/library/README.md`, editor.md (SI entry), lessons, backlog
  (passive parts, potentiometer), roadmap status.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [x] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [x] All 11 chips are in `createDefaultRegistry()` under `74xx/74hc…` with data sheet pin
  numbers, names and descriptions, a function table, a data sheet URL and timing for every
  path with source and conditions.
- [x] Every chip has a test with its function table on every unit through pin numbers, unknown
  and floating inputs, and a timing assertion for each distinct path; 283, 85 and 4511 are
  checked exhaustively.
- [x] `timer/ne555` runs astable, monostable and bistable with the data sheet formulas, tested.
- [x] The carry-over invariance property passes on random networks including the new chips.
- [x] The Q3 examples open from File ▸ New from Example, compile with no design issues and run
  as intended (tests and by hand in the browser).

## Open questions

- [x] Q1. How the 555's timing is set — _proposed:_ the external R and C values as props
  (`RA`, `RB`, `C`), the data sheet formulas giving tH, tL, tw, entered with SI prefixes; the
  schematic records the real BOM values. Alternative: times directly (high/low time, pulse
  width), like `io/clock`. — **answer:** R and C values as props.
- [x] Q2. Data sheet for chips Nexperia no longer documents (148 for sure; maybe 147, 283) —
  _proposed:_ the current TI data sheet (buyable in DIP, typical values at 4.5 V / 50 pF like
  ours), with TI's pin names. Alternative: the Philips/NXP-era sheets (Nexperia's lineage and
  naming, but old documents of discontinued parts). — **answer:** current TI data sheets.
- [x] Q3. Which examples ship — _proposed:_ Ben Eater's clock module (3 × NE555 + 74HC04/08/32,
  HLT) and BCD → 7-segment (DIP switch → 74HC4511 → display); also possible: 4-bit
  adder/subtractor (283 + 86), 3-to-8 decoder (138 → LED bar). — **answer:** clock module and
  BCD → 7-segment.
- [x] Q4. Power-on state of a monostable/bistable 555 (the data sheet: "as previously
  established", undefined at power-on) — _proposed:_ `X` until the first trigger or reset, like
  any latch in a 4-state simulator (Ben's bistable is set at once by its switch; the monostable
  shows `X` until the first press). Alternative: low (what most 555s do in practice; hides a
  missing reset). — **answer:** `X` until the first trigger or reset.

- [x] Q5. (found in task 2) 74HC151's complementary output has the same symbol as Y in the
  Nexperia sheet (Y with an overline) — _proposed:_ `W` (TI, KiCad); alternative: name `YN`
  plus a display label so it is drawn as Y with an overline. — **answer:** `YN`, drawn `Y`
  overlined: a new optional `PinDef.label` (display text; the name stays the unique id).
- [x] Q6. (found in task 2) TI's CD74HC147 and CD74HC283 (ex-Harris) give no typical delay at
  4.5 V / 50 pF (only maxima there, typical at 5 V / 15 pF); the Philips sheets (December 1990)
  do, with the same maxima — _proposed:_ TI pins, names and function, typical delays from
  Philips, maxima from TI. — **answer:** as proposed; both documents cited.

- [x] Q7. (found in task 10) Ben's bistable 555 is driven by an SPDT switch with its common on
  GND and its throws on TRIG and RESET; `io/switch` `spdt` has one output between the rails —
  _proposed:_ a changeover contact (`spdt-gnd`, `spdt-vcc`: throws `ON`, `OFF`, the open one
  released); alternatives: an inverter, two SPST switches. — **answer:** changeover contact.

## Progress log

- 2026-11-07 — plan drafted. Web searches: Nexperia has current sheets for 85, 158, 4511; none
  found for 148 (TI SN74HC148 current), 147 and 283 uncertain. TI PDFs download with curl
  (NE555 SLFS022K, SN74HC148 SCLS109H, CD74HC147, CD74HC283 in the scratchpad); Nexperia's
  answer 403 as before.
- 2026-11-07 — Q1–Q4 answered (R and C props; TI where Nexperia has no sheet; clock module and
  BCD → 7-segment examples; a monostable/bistable 555 starts at `X`).
- 2026-11-07 — plan approved; branch started. The user downloaded the Nexperia sheets for 138,
  139, 151, 153, 157, 158, 85, 4511 to `~/Downloads/nexperia-74hc/`; Nexperia has none for 147
  and 283, so 147, 148 and 283 follow TI (CD74HC147, SN74HC148, CD74HC283).
- 2026-11-07 — task 1 (`57b5770`): `ChipBehavior<State>`, `pinIndices`, `pathDelays`.
- 2026-11-07 — task 2 (data): every table read (`pdftotext -layout`; overlines are lost in the
  text, so the pinning and timing pages were rendered with `pdftoppm` and looked at). Found:
  151's two `Y` outputs (Q5); CD74HC147/283 without typical delays at 4.5 V (Q6); TI's
  CD74HC147 pin table names pin 9 an input `I0`, its pinning figure (and the classic pinout)
  say output `Y0` — the figure wins; TI has no 283 function table (the Philips example row is
  used); 4511 shows 6 and 9 without tails; 85's `QA>B` ignores `IA>B` (cascade rule).
- 2026-11-07 — tasks 3–7: decoders (138, 139), multiplexers (151, 153, 157, 158), 283 and
  85 (exhaustive), encoders (147, 148), 4511 (first stateful chip). Changes on the way: `units`
  only for independent sections (139), as KiCad does — chips with shared controls are one
  section; `PinDef.label` (Q5; the DIP drawer, the Part tab's pins and table headings use it);
  `functionTable()` skips output columns mapped to `null` (4511's Display); possible outcomes
  merged without allocating (`outcomes.ts`); the Part tab spaces `<`/`>` in cells and overlines
  columns named exactly like active-low pins. Scenarios: two 85s → 8 bits, two 148s → 16
  inputs, a 4511 driving a common-cathode display.
- 2026-11-07 — task 8: `timer/ne555` (family `timer`, Parts panel group "Timers"), tPD 225 ns
  read off TI Figure 5-8 (the table gives only rise/fall times); `PropDef.si` with
  `formatSi`/`parseSi` (exact: `100n` is 1e-7), also on `io/clock` frequency; `nc` pins draw
  their names unless named `NC<n>` (the Part tab calls them "not simulated"); ADR-0013.
- 2026-11-07 — task 9: carry-over property over 30 random networks of MSI chips and 555s in
  every mode (mutation-checked: a 555 restarting its timer on every evaluate fails it); Symbol
  Gallery row of 555s; looked at in Chromium, both themes (Playwright script from the
  scratchpad): DIP-16 names fit, 151's Y̅, 147/148 overlines. The NE555's vertical name ran
  into TRIG/DISCH/THRES in a 4-cell body: a DIP body is two cells wider when a row's two pin
  names exceed 7 characters together (only the NE555 today; docs/circuit.md).
- 2026-11-07 — task 10: changeover contacts for `io/switch` (Q7: `spdt-gnd`, `spdt-vcc`, throws
  `ON`/`OFF`); examples `bcd-7-segment` (DIP switch with pull-downs → 4511 → display) and
  `clock-module` (three 555s, 74HC04/08/32, STEP, MANUAL, HLT, a blue CLK LED), generated by a
  throwaway `CircuitBuilder` test that checked every net, then deleted; scenario tests for both
  (auto ≈ 1.5 Hz, manual: X until the first STEP, then one 110 ms pulse; HLT stops it). Looked
  at running in Chromium, both themes: no design issues, the unknown step output shows red.
- 2026-11-07 — task 11: `tests/e2e/msi.spec.ts` — an NE555 from the Parts panel blinks an LED
  (RB typed `47k` shows `47 kΩ`), the Part tab of the 74HC151 (`(YN)`) and the 555 ("not
  simulated"), the Clock Module example opens clean and runs. `pnpm e2e`: 45 passed.
- 2026-11-07 — task 12 and finish: docs (components.md, editor.md, circuit.md, glossary,
  architecture, ADR-0011 amendment, ADR-0013, README, recipe, lessons, roadmap). Acceptance
  checked one by one; found missing unknown/floating tests for 139, 148, 153, 4511 and added
  them. `pnpm check` (1170 tests), `pnpm build`, `pnpm e2e` (45) green; both examples looked at
  running in Chromium.
- **Summary:** 11 74HC MSI chips (Nexperia; TI for 147/148/283, Philips typical values for
  147/283) with one delay per data sheet path, exhaustive tests where it matters, the 4511 as
  the first stateful chip; a behavioral NE555 with its RC network as SI-prefixed props
  (ADR-0013); pin labels; changeover switch contacts; BCD to 7-Segment and Clock Module
  examples. Found on the way: TI ex-Harris sheets without typical 4.5 V values, overlines lost
  by pdftotext, a TI pin table error, crowded DIP-8 names (wider body).

## Handoff

- **State:** done; waiting for the user's approval to merge into `main` (no remote: local
  `--no-ff` merge).
- **Follow-ups:** R09 `feat/74hc-sequential` (next; also the 4511's LE setup/hold/pulse-width
  checks). Backlog: passive parts (R, C, potentiometer drawn, a 555 reading them, a
  potentiometer in the Interact tool, a frequency hint), CMOS 555s and the 556.

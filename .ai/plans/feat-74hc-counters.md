# Plan: feat/74hc-counters

| Field      | Value                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| Branch     | `feat/74hc-counters`                                                          |
| Roadmap    | R09b — 74HC counters & shift registers ([roadmap](../../docs/roadmap.md))     |
| Status     | in-progress                                                                   |
| Depends on | R09a (timing checks, edge-triggered helpers, sequential function tables), R08 |
| Created    | 2026-11-07                                                                    |

## Goal

The second half of R09: the 74HC counters and shift registers a homebrew computer is built
from — Ben Eater's program counter is a 161, a 595 drives LEDs or a display from three pins, a
4040 divides a clock — from their Nexperia data sheets, on R09a's timing checks and its `X`
policy. With them the remaining SAP-1 sequential modules can be built and checked, and the
classic counter traps (a ripple counter's decoding glitches, a 595 with its clocks tied
together) show up in the simulator as they would on the bench.

## Scope

**In scope**

- `library/74xx`: 74HC161, 163, 191, 193 (synchronous counters), 164, 165, 595 (shift
  registers), 4040 (12-stage ripple counter) as `ChipSpec`s with HC timing (delays per path,
  timing requirements), in `createDefaultRegistry()`.
- Shared helpers in `edge-triggered.ts`: 4-state increment/decrement, merging the outcomes of
  unknown or late control inputs.
- `core`: whatever the new chips' requirements need from `TimingChecks` (at least the 595's
  `tsu(SHCP to STCP)`, an edge-to-edge set-up; Q3).
- Tests per chip (function table per bit through pin numbers, counting/shifting sequences,
  unknown and floating inputs, every delay path, every timing check just inside and just
  outside its limit); scenarios (161 cascade through TC/CET, a 4040's ripple and a decoding
  glitch, two 595s cascaded through Q7S, 165 → 595 serial link); carry-over property with the
  new chips; a counter benchmark.
- Partial overline labels (`U/D̅`, `Q̅7`; the 175's `Q̅0` backlog nit) — Q4.
- Examples: Shift Register LEDs (self-running 595) and SAP-1 Program Counter (Q1, Q2); e2e.
- Docs: components.md, simulation.md (`TimingChecks` edge-to-edge set-up), editor.md
  (labels), glossary, READMEs, lessons, roadmap (backlog: partial overlines done).

**Out of scope** (and where it goes instead)

- Seeded random power-on state (a 4040 dividing a clock with MR tied LOW stays `X` until a
  reset, like every R09a chip) → backlog item, unchanged (R01 Q2 decided `X`).
- Other counters (4020, 4024, 4060, 390, 192 decade) → later, on the same engines, when needed.
- Worst-case timing mode, "report only" → backlog (R09a).
- 74HCT/74LS → backlog.

## Context

Read before starting:

- [docs/components.md](../../docs/components.md#edge-triggered-chips) — edge-triggered chips,
  the `X` policy table, timing checks; [docs/simulation.md](../../docs/simulation.md#timing-checks)
  — `TimingChecks` API, inertial model (confirming a pending value keeps it).
- [ADR-0014](../../docs/adr/0014-timing-checks.md) — minima at 25 °C, a violation makes the
  loaded bits `X`, checks armed only while the clock matters.
- `src/library/74xx/` — `edge-triggered.ts` (clock edges, `either`, `couldBe`), `registers.ts`
  (the `RegisterSpec` engine: async MR, data enables, 3-state, the `X` handling to copy),
  `flip-flops.ts`, `hc-timing.ts`, `paths.ts`, `pinout.ts`.
- `src/core/timing-checks.ts`, `src/core/function-table.ts`, `src/core/testing/function-table.ts`.
- `tests/scenarios/sequential-74hc.test.ts`, `carry-over.test.ts`, `examples.test.ts`;
  `examples/sap-1-register.logic.json`; `tests/e2e/registers.spec.ts`.
- `.ai/lessons.md` — R06 (Nexperia downloads, pdftotext), R08 (overlines lost, example
  generators), R09a (`ctx.rose` reads pins, checker ordering, `pnpm check` not just `test`,
  mutation checks, `wire()` helper).

## Design

### Parts

All from the Nexperia data sheets; pin names checked against the rendered pinning figures in
task 1 (the 161 and 191 are HC-only documents for SO16/TSSOP16; the DIP pinout is the same).

| Part     | Function                                                         | Package | Shape                                                           |
| -------- | ---------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| 74HC161  | presettable synchronous 4-bit binary counter; asynchronous reset | DIP-16  | MR̅, CP, D0–D3, CEP, CET, PE̅ → Q0–Q3, TC                         |
| 74HC163  | presettable synchronous 4-bit binary counter; synchronous reset  | DIP-16  | as the 161, MR̅ acts on the clock edge                           |
| 74HC191  | presettable synchronous 4-bit binary up/down counter             | DIP-16  | CP, CE̅, U̅/D (LOW: up), PL̅ (asynchronous), D0–D3 → Q0–Q3, TC, RC̅ |
| 74HC193  | presettable synchronous 4-bit binary up/down counter; two clocks | DIP-16  | CPU, CPD, PL̅ (asynchronous), MR (HIGH), D0–D3 → Q0–Q3, TC̅U, TC̅D |
| 74HC164  | 8-bit serial-in, parallel-out shift register                     | DIP-14  | DSA, DSB (ANDed), CP, MR̅ → Q0–Q7                                |
| 74HC165  | 8-bit parallel-in, serial-out shift register                     | DIP-16  | PL̅ (asynchronous), D0–D7, DS, CP, CE̅ → Q7, Q̅7                   |
| 74HC595  | 8-bit shift register with output latches; 3-state                | DIP-16  | DS, SHCP, MR̅, STCP, OE̅ → Q0–Q7 (3-state), Q7S                   |
| 74HC4040 | 12-stage binary ripple counter                                   | DIP-16  | CP̅ (falling edge), MR (HIGH) → Q0–Q11                           |

### Engines

No single engine fits eight chips this different; three files on shared helpers:

- `counters.ts`: one behavior for the synchronous counters, driven by a `CounterSpec` (count
  direction: up, or up/down by pin, or by two clocks; parallel load synchronous (161/163) or
  asynchronous and transparent (191/193); reset none/synchronous/asynchronous with its polarity;
  count enables; terminal count outputs and their logic). If 193's dual clocks make the spec
  awkward, 191/193 get their own behavior — decided while writing task 3.
- `shift-registers.ts`: 164, 165, 595 as separate behaviors sharing a shift helper.
- `ripple-counter.ts`: 4040 (and later 4020/4024/4060 by stage count).
- `edge-triggered.ts` grows: 4-state `increment`/`decrement` over a bit array (a ternary
  ripple carry: a bit is `X` only where the carry or the bit is unknown), and a helper that
  computes the next state for every value an unknown or late control could have and merges them
  bit by bit (`either`) — the R09a rule generalized from one enable to several controls (at
  most 3 unknown at once: ≤ 8 outcomes, no allocation).

### Behavior

- **Power-on and the `X` policy** as R09a: every stored bit `X` until a reset or a clean load;
  strict edges, never clocked by the forced evaluation; an uncertain edge makes `X` the bits the
  edge would change; a violation makes `X` the bits the edge may have loaded. Counting from an
  `X` state gives `X` where the carry reaches.
- **Priorities** per function table (161: MR̅ > PE̅ > count > hold; 163: the same, MR̅ on the
  edge; 191/193: MR > PL̅ > count).
- **Terminal counts** are combinational from the state and their inputs, with their own paths:
  161/163 `TC = CET·Q0·Q1·Q2·Q3`; 191 `TC` at 15 up / 0 down, `RC̅` LOW while CE̅ = L, TC = H
  and CP = L; 193 `TC̅U` LOW while CPU = L at 15, `TC̅D` LOW while CPD = L at 0. Cascading
  works the data sheet way (161 TC → next CET; 191 RC̅ → next CP or CE̅; 193 TC̅U/TC̅D → next
  CPU/CPD).
- **Asynchronous parallel load** (191, 193, 165): transparent while PL̅ is LOW (Q follows D,
  paths `tpd(Dn to Qn)` and `tpd(PL to Qn)`); D must meet set-up/hold to PL̅'s rising edge.
- **193 clocks**: counts on the rising edge of one clock while the other is HIGH. From the logic
  diagram (T flip-flops clocked when both clocks are HIGH again, the chains steered by the clock
  levels) and the text ("a clock LOW during and after a reset or load … its next LOW-to-HIGH
  transition will be counted"): a count happens when both clocks become HIGH, in the direction
  of the clock that rose — to be confirmed on the diagram at high resolution in task 4. The other
  clock must stay HIGH `th(CPU to CPD, CPD to CPU)` = 16 ns after the counting edge (Fig. 14).
- **165 clock**: the internal clock is `CP + CE̅` (the IEC symbol's ≥1; the function table
  shifts on CE̅ ↑ with CP L); a rising edge of either while the other is LOW shifts, with set-up
  and hold of each to the other (`tsu(CE to CP, CP to CE)` 16 ns).
- **191 usage rules** (data sheet text, no logic diagram in the HC-only sheet): "the LOW-to-HIGH
  CE̅ transition must occur only when the clock is HIGH" and "U̅/D should be changed only when
  either CE̅ or CP is HIGH". How a break of them is modelled: decided in task 4.
- **595**: two registers. SHCP shifts DS into the shift register (MR̅ clears it, asynchronous,
  not the storage register); STCP copies the shift register into the storage register; OE̅
  enables Q0–Q7 (`ten`/`tdis`, loading works while disabled); Q7S is the shift register's last
  bit (always driven, for cascading). With SHCP and STCP tied together the storage register
  takes the shift register's contents **before** the shift ("one clock pulse behind", as the
  data sheet says) — the order inside one `evaluate`. The check between the two clocks (Q3):
  STCP rising at the same instant as SHCP is that documented mode, no violation; rising
  0 < Δ < `tsu(SHCP to STCP)` after it is a set-up violation, and the storage bits where the
  old and new shift register contents differ become `X`.
- **4040 ripple**: the count is stored at the falling edge, but output `Qn` changes
  `tpd(CP to Q0) + n·tpd(Qn to Qn+1)` after it, so `0111 → 1000` passes through `0110`, `0100`,
  `0000` as on the chip; decoding the outputs with gates glitches (a scenario shows it). The
  inertial model keeps confirmed pending changes, so in-spec clocks never cancel a ripple.
- **Delays** per data sheet path with `pathDelays`; no allocation in `evaluate`.

### Timing checks

From the data sheets' requirement tables (task 1), against the minima at 25 °C (ADR-0014),
armed only while the clock matters. Expected beyond R09a's kinds of checks: count enables and
PE̅ / U̅/D / the 163's MR̅ set-up and hold to CP; D set-up/hold to PL̅'s release; PL̅ and MR
pulse widths and recovery to each clock (193: both clocks); 595 `tsu(SHCP to STCP)` (rising to
rising, Fig. 7); 165 `tsu`/`th(CE to CP, CP to CE)`; the 193's clock-to-clock hold.
`TimingChecks.setupHold` learns an edge-to-edge form for the 595 (Q3): only the data pin's
active transition counts, and the same instant can be declared allowed; and a hold-only form
(the 193 gives no set-up between its clocks). Messages and `X` follow
components.md#timing-checks; the late control's `X` covers the bits where the outcomes it
chooses between differ. Hold minima of 0 (161, 163, 191, 193 D to PL̅) never fire.

### Function tables

The data sheets' tables as written, with their text cells (`count up`, `shift`, footnoted TC)
kept for display; rows the checker can't run (text outputs) are covered by hand-written tests,
as R08/R09a did. Nexperia splits some tables (the 595 has one per register): merged into one
where they share columns, with a note.

### Partial overlines (Q4)

A pin label marks the overlined letters itself with a combining overline (U+0305, as the docs
already write them): the 191's `U̅/D`, and the 175's `Q̅0` becomes right (the 165's `Q̅7` is
overlined as a whole in its data sheet). A label with explicit
overlines isn't overlined as a whole; `activeLow` keeps its meaning. The schematic's DIP
drawing, the Part tab and pin descriptions draw it; the exact syntax is settled in task 8 after
reading the renderer (plain-text places — Messages, search — show the combining characters).

### Examples (Q1, Q2)

- **Shift Register LEDs** (`examples/shift-register-leds.logic.json`): a 74HC595 with SHCP and
  STCP tied to an `io/clock` (a few Hz), Q7S → a 74HC04 inverter → DS: an 8-bit Johnson
  counter, the LEDs fill and empty in 16 steps by themselves. LEDs on Q0–Q7 (the storage
  register, one pulse behind the shift register) and on Q7S; OE̅ LOW; MR̅ on a CLEAR push
  button with a pull-up — the shift register is `X` until cleared, said in the card (as the
  SAP-1 A register's "press CLR first").
- **SAP-1 Program Counter** (`examples/sap-1-program-counter.logic.json`): Ben Eater's PC — a
  74HC161 counting on the clock with CE (CEP, CET), J̅ (PE̅) loading bus bits 0–3, CLR̅ (MR̅),
  a 74HC245 driving Q0–Q3 onto the bus under CO̅; a DIP switch through a second 245 as the
  rest of the computer (as in the A register example); pull-downs and LEDs on the bus and the
  counter; manual clock. Layout and bus width decided in the generator.

Both from a throwaway `CircuitBuilder` generator that checks every net (R07/R08 lessons), saved
canonically, run by scenario tests.

### Data sheets

The user downloads from `https://assets.nexperia.com/documents/data-sheet/<name>.pdf` into
`~/Downloads/nexperia-74hc/`: `74HC161`, `74HC_HCT163`, `74HC191`, `74HC_HCT193`,
`74HC_HCT164`, `74HC_HCT165`, `74HC_HCT595`, `74HC_HCT4040` (a name that 404s: the product
page's data sheet link). Pinning figures, function tables and logic diagrams are rendered with
`pdftoppm` and looked at (overlines, arrows, the 193's clock logic).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. Data sheets: the user downloads the PDFs; delays per path and requirements (typ and min
  at 25 °C, max delays at −40…+85 °C) into `hc-timing.ts`, sources cited; findings (193 clock
  logic, 595 tied clocks, 165 clock gating, 4040 ripple) in the progress log. Pinouts and
  function tables land with each chip's behavior.
- [x] 2. `core`: `TimingChecks.setupHold` edge-to-edge form (the data pin's active transition
  only; same instant allowed — Q3) and hold-only form (193), with tests on a fixture.
- [x] 3. Counting helpers (`increment`/`decrement`, outcome merging over controls) and the
  74HC161, 163, with tests (function table, counting 0–15 and wrap, load, enables, TC and its
  paths, MR̅ asynchronous vs synchronous, unknown/floating/late controls, every check).
- [x] 4. 74HC191, 193 with tests (up/down, asynchronous load, TC/RC̅, TC̅U/TC̅D, cascading
  signals, the 193's clock rule, every check).
- [x] 5. 74HC4040 with tests (counting, MR, the ripple delay of every stage, transient states,
  uncertain edges, checks).
- [x] 6. 74HC164, 165 with tests (shifting, AND of DSA·DSB, asynchronous load, CP/CE̅
  interchangeable, Q̅7, checks).
- [x] 7. 74HC595 with tests (shift and storage registers, MR̅ clears only the shift register,
  tied clocks one pulse behind, `ten`/`tdis`, loading while disabled, Q7S, checks).
- [x] 8. Overlines (Q4, Q5): letters overlined by default, digits not; explicit U+0305 marks
  for the exceptions (175 `Q̅0̅`, 165 `Q̅7̅`, 191 `U̅/D`); DIP drawing, Part tab; looked at in
  both themes.
- [x] 9. Across parts: registry, carry-over property with the new chips (mutation-checked),
  symbol-drawing scenario, scenarios (8-bit 161 cascade, 4040 decoding glitch, two 595s via
  Q7S, 165 → 595), counter benchmark.
- [ ] 10. Examples: Shift Register LEDs and SAP-1 Program Counter (Q1, Q2) from a throwaway
  generator checking every net, run by scenario tests, looked at in the browser in both themes.
- [ ] 11. e2e: the examples open with no design issues and run with no diagnostics; a counter's
  Part tab.
- [ ] 12. Docs: components.md (counters and shift registers table and rules), simulation.md (if
  `TimingChecks` grew), glossary (synchronous counter, terminal count, shift register, storage
  register…), `src/library/README.md`, lessons, roadmap text.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] All eight chips are in `createDefaultRegistry()` under `74xx/74hc…` with data sheet pin
  numbers, names and descriptions, a function table, a data sheet URL, and timing for every
  delay path and requirement with source and conditions.
- [ ] Every chip has tests of its function table through pin numbers, its counting/shifting
  sequence, unknown and floating inputs (uncertain clock edges included), a timing assertion for
  each distinct path, and each timing check just inside (silent) and just outside (diagnostic +
  `X`) its limit.
- [ ] Pin labels are overlined as the data sheets draw them (letters, not digits: `1R̅D̅`, `E̅1`;
  marked exceptions `U̅/D`, `Q̅0̅`) on the schematic and in the Part tab.
- [ ] The 4040's outputs ripple stage by stage; a 595 with tied clocks shows the storage
  register one pulse behind.
- [ ] The carry-over invariance property passes on random networks including the new chips.
- [ ] Shift Register LEDs and SAP-1 Program Counter open from File ▸ New from Example, compile
  with no design issues and do what they are for (test and by hand in the browser).

## Open questions

- [x] Q1. Examples — the 595 LEDs example was decided in R09a (Q4); add Ben Eater's program
  counter (a 74HC161 + a 74HC245 onto the bus: CE, CO̅, J̅, CLR — an M2 module)? —
  _proposed:_ both. — **answer:** both.
- [x] Q2. How the 595 example is driven — _proposed:_ by hand (DATA switch, SHIFT and LATCH
  buttons, CLEAR, OE̅ → eight LEDs); alternative: a clock on both clocks and Q7S → an inverter
  → DS (a Johnson counter, LEDs fill and empty). — **answer:** self-running (the Johnson
  counter).
- [x] Q3. SHCP and STCP tied together (the 595 data sheet's "one clock pulse behind" mode) —
  _proposed:_ the same instant is the documented mode (no violation); STCP 0 < Δ <
  `tsu(SHCP to STCP)` after SHCP is a violation and `X` where old and new contents differ;
  alternatives: any Δ < tsu is a violation, no check. — **answer:** as proposed.
- [x] Q4. Partial overline labels (backlog: the 175's `Q̅0` is drawn `Q̅0̅`); this branch adds
  `U/D̅` (191), `Q̅7` (165) — _proposed:_ do it here; alternative: whole-label overlines, the
  191's pin plain `U/D`. — **answer:** do it here. (The 191's pin turned out to be `U̅/D`, and
  the 165's `Q̅7̅` is overlined whole.)
- [x] Q5. (Asked in task 8.) Nexperia overlines an active-LOW signal's letters, not its digits
  (`1O̅E̅`, `E̅1`, `Y̅0`, `1R̅D̅`, `1Q̅`), while we overlined whole labels; exceptions: the 175's
  and 165's `Q̅0̅`/`Q̅7̅` (whole) and the 191's `U̅/D` — _proposed:_ letters by default, U+0305
  marks for the exceptions; alternatives: whole by default with marks on every unit pin, or only
  the 191. — **answer:** letters by default.

## Progress log

- 2026-11-07 — plan drafted; `main` green (1431 tests). Q1–Q4 answered: both examples, the
  595 example self-running, tied 595 clocks allowed at the same instant, partial overlines here.
- 2026-11-07 — plan approved; branch started. The user downloaded the eight data sheets to
  `~/Downloads/nexperia-74hc/`; the 161 and 191 are HC-only documents (`74HC161`, `74HC191`),
  the rest `74HC_HCT…`.
- 2026-11-07 — task 1: HC timing of the eight chips in `hc-timing.ts` (every 25 °C minimum
  given). Findings: the 191's direction pin is **U̅/D** (LOW counts up; only U overlined — the
  partial overline of Q4 is needed exactly here), while the 165's Q̅7 is overlined whole; the
  191 sheet states two usage rules without a logic diagram (CE̅ rises only while CP is HIGH;
  U̅/D changes only while CE̅ or CP is HIGH); the 193 counts when both clocks are HIGH again
  (logic diagram; a clock that rose while the other was LOW is counted when the other rises —
  confirm in task 4) and requires the other clock to stay HIGH 16 ns after the counting edge
  (`th(CPU to CPD, CPD to CPU)`, hold-only); the 165's clock is `CP + CE̅` (IEC ≥1) with set-up
  and hold both ways; the 595's `tsu(SHCP to STCP)` is rising edge to rising edge (Fig. 7) and
  its function table's last row is the tied-clock mode; the 163's TC column says L in the load-H
  and first hold rows, against its own note [1] (TC = CET at 15) — written as the 161's; the 4040
  ripples `tpd(Qn to Qn+1)` = 10 ns per stage after `tpd(CP to Q0)` = 17 ns (Q11 at 127 ns). No
  data sheet path for the 191's TC/RC̅ after a parallel load, nor for the 193's TC̅U after a
  count down to 15 with CPU LOW: they borrow a given path in the spec.
- 2026-11-07 — task 2: `setupHold` takes `dataEdge` (edge-to-edge: only that transition of a
  data pin counts, measured from when it left the level before it; messages say `SH rose …`),
  `sameInstantAllowed` (a change at the same instant, in the same or an earlier delta, is no
  violation) and an optional `setup` (hold only; a check needs one of the two). Tests on a
  two-clock fixture (595- and 193-style), mutation-checked (5 mutations).
- 2026-11-07 — task 3: `countInto` (ternary ripple carry, up/down), `allAt`, `mergeInto` in
  `edge-triggered.ts`; `counters.ts` with `SyncCounterSpec` for the 161/163 (one behavior, the
  reset asynchronous or synchronous; the 191/193 will get their own); `checkableRows` in
  `core/testing` (the rows without data sheet text, for tables with `count` and footnotes).
  Every mode a control allows is merged (reset, load, count, hold) — a late control counts as
  unknown; hold minima are 0 (checks declared, never fire). Tests per chip
  (`counters.test.ts`, 44): function table per bit, counting and TC, load, hold, both resets, a
  163 modulo-10 counter, power-on, uncertain edge, unknown controls, floating CEP, every path,
  every check at its limit; mutation-checked (17 mutations; one survivor — reset and load
  merged under an unknown 163 MR — got its test). Started the components.md section.
- 2026-11-07 — task 4: `up-down-counters.ts` (own behaviors for the 191 and 193; shared
  asynchronous load). The 193's logic diagram at 220 dpi: FF1 toggles on CPU · CPD rising, the
  other stages on their up/down chains steered by the clock levels — a clock rising while the
  other is LOW toggles the upper stages on the up chain but not bit 0 (a partial count). Decided
  without a new question, under ADR-0014 (what the data sheet doesn't guarantee is reported and
  `X`): that edge is a hold violation of `th(CPU to CPD, CPD to CPU)` and merges counting and not;
  both clocks together merge up and down. The 191's two usage rules are set-up violations (CE̅
  rising while CP LOW may count; U̅/D changing while CE̅ and CP are LOW makes the next count's
  direction unknown). Recovery checks of the 193 are armed only when neither MR nor PL̅ holds it
  (found by its function table, run without gaps). Delays the sheets lack borrow a Qn path.
  37 tests, mutation-checked (19 mutations; two survivors — the 191's direction never forgotten,
  the 193 reading D during MR — got tests).
- 2026-11-07 — task 5: `ripple-counter.ts` (`RippleCounterSpec`, ready for 4020/4024/4060)
  with the 4040: Qn driven `17 + 10·n` ns after the falling edge; tests record every output's
  change time (2047 → 2048) and the intermediate counts `0110, 0100, 0000, 1000` seen by
  decoding gates; 4096 counts at the 32 ns minimum period without a diagnostic. The function
  table's ↑ row needs states that end with CP LOW (setting the level before ↑ is a falling edge,
  a count). 12 tests, mutation-checked (10 mutations).
- 2026-11-07 — task 6: `shift-registers.ts` with the 164 and 165 (own behaviors, shared shift
  and asynchronous clear/load helpers). The 165's internal clock is CP + CE̅; DS and each gate
  pin are checked against both pins, armed only when that pin's rise clocks (the other LOW).
  Core: `checkableRows(table, displayOnly)` ignores internal-stage columns; state letters may
  have digits (`q7`). The 164 has the first nonzero hold time of this branch (4 ns), tested. 26
  tests, mutation-checked (16 mutations; two survivors — the effect of a DS hold violation, CP
  checks while CE̅ is HIGH — got tests).
- 2026-11-07 — task 7: the 595 in `shift-registers.ts` (`StorageShiftRegisterState`): the
  storage register is evaluated before the shift, so tied clocks store the contents from before
  the shift; a `shiftedAt` time makes STCP in a later delta of the same instant behave the same
  (the bench reaches that with `run(0)`). The SHCP-to-STCP set-up uses `dataEdge` and
  `sameInstantAllowed` (task 2), armed only while MR̅ lets the shift register shift. A keyword
  `led` made the Parts search for "led" list the 595 (a UI test caught it): dropped. 17 tests,
  mutation-checked (11 mutations).
- 2026-11-07 — task 8: the pinning figures showed the backlog nit was wrong (the 175's sheet
  overlines `Q̅0̅` whole) and the real gap was elsewhere: Nexperia overlines letters, not digits
  (125, 138, 139, 173, 74, 109, 112), so Q5 was asked. `pinTextRuns` in core (marks, else
  letters of active-low pins), `overline` ranges in `TextStyle` (canvas bars per range),
  `columnRuns`/`NameView.runs`/`PinInfo.runs` in the Part tab. Found on the way: the 139's
  function table columns are `nY0` (unit number only), so they were never overlined — columns
  now also match unit-only generic names. Looked at in Chromium (Symbol Gallery: 74, 138, 175,
  191, 165 in both themes; the 191's Part tab). Mutation-checked (3 mutations). Backlog item
  removed.
- 2026-11-07 — task 9: carry-over property over 30 random networks of the eight chips
  (`carry-over.test.ts`), mutation-checked with two mutations only it catches (a 4040 counting on
  the forced evaluation; a 191 marking its direction unknown on evaluations with nothing
  changed). Scenarios (`counters-74hc.test.ts`): 8-bit counter from two 161s (0–255 and wrap;
  hold; a 50 ns clock beating the 25 ns carry gives one CET set-up violation and an `X` high
  count), the 4040 decoding glitch (a NOR of Q0–Q2 goes HIGH 28–38 ns on 3 → 4), two 595s via
  Q7S, a 165 → 595 serial link on one clock (no hold violation: Q7 moves 19 ns after the edge).
  The symbol-drawing scenario covers the new DIPs as is. Benchmark: 74HC595 chain ×100 at 6.39M
  events/s (903 events per cycle); inverter chain 13.9M, 74HC04 chain 8.65M, 574 pipeline
  5.68M, ring 13.8M (unchanged).

## Handoff

- **State:** tasks 1–9 done (timing data; `setupHold` variants; all eight chips in the
  registry; overlines as the data sheets draw them).
- **Next step:** task 10 (examples: Shift Register LEDs, SAP-1 Program Counter, from a
  throwaway generator).
- **Watch out:** pinouts and names in the Parts table are from memory.
- **Verify with:** `pnpm check`.

# Workflow: add a component (part)

Input: a part to add (e.g. `74HC08`, `prim/nand`). Spec of the definition shape:
[docs/components.md](../../docs/components.md); runtime contract:
[docs/simulation.md](../../docs/simulation.md#components-at-runtime).

## 1. Identify it

- **Type id** `family/part`, lowercase (`74xx/74hc08`, `prim/tristate-buffer`). Saved documents
  store it: never rename one later.
- Real parts: get the **datasheet** (manufacturer PDF; prefer Nexperia/TI for 74HC). Note the
  document, revision and the table numbers you use — they go into `datasheet` and
  `timing.source`.
- Abstract parts (`prim/*`) have no datasheet; their behavior is the textbook truth table.

## 2. Write the definition

File: `src/library/<family>/<part>.ts` (one part per file, or one factory file for a family of
near-identical parts such as gates). Use `defineComponent<Props, State>({ … })` from `core`.

- **Pins** in datasheet order with datasheet names (`1A`, `1Y`, `OE`, `VCC`); with a `package`,
  every pin has its physical `number`. Directions: `in`, `out`, `tristate`, `bidir`, `power`,
  `nc`. Mark `activeLow` / `clock` pins. Prop-dependent pin lists: `pins: (props) => [...]`.
- **Designator prefix** (`designatorPrefix`) when it isn't `U`: `R`, `SW`, `D`, `DS`, `X`, `TP`,
  `PWR` (docs/components.md#definition-shape).
- **Props** (`props`) for user-editable settings, with defaults and min/max. Time props are
  integer picoseconds (`ns(1)`).
- **Drawing**: real chips set `package` (drawn as a DIP from the pin numbers). Other parts set
  `symbol` — `kind`, body size, every pin's side and offset (a function of props if the shape
  depends on them); see docs/components.md#symbols-non-package-parts.
- **Pin flags**: `sense` on inputs that only observe (indicators), `constant` on outputs tied to a
  rail, `weak` on pull resistors.
- **Timing** (`timing.typical`, optional `max`, `conditions`, `source`): for 74HC, typical at
  VCC = 4.5 V, CL = 50 pF and max at −40 °C to +85 °C (docs/components.md#timing). Never zero
  for real chips.
  Several delay paths (MSI): one key per path in the data sheet's wording (`tpd(An to Yn)`) and
  `pathDelays` in `src/library/74xx/paths.ts`. Nexperia first; else the current TI sheet (check
  it gives typical values at 4.5 V / 50 pF; ex-Harris CD74HC sheets don't).
- **Data sheet traps**: check which temperature columns the dynamic table has (the 74HC74 rev. 9
  has no 25 °C minima); `pdftotext` drops overlines — look at the pinning figure (`pdftoppm -png`)
  for active-low pins; a pin table can disagree with the figure (TI CD74HC147 pin 9); two pins
  with the same symbol get distinct names and a `label`.
- **Datasheet data** (real chips): `description` on every pin (the datasheet's pin description)
  and `functionTable` with the datasheet's generic columns (`nA nB | nY`) — Part Info shows them
  and the test checks the behavior against the table (docs/components.md#function-tables).
  `units` list each section's pins inputs first, in the table's column order.
- **Behavior** (`create(props)`):
  - Precompute pin indices and constants from props in the closure (immutable only).
  - Mutable state only in `createState()` → plain data (objects, arrays, typed arrays).
  - Read with `ctx.read`; combine with the 4-state operators (`and`, `or`, `xor`, `not`,
    `toInput`) so `X`/`Z` inputs propagate conservatively (an AND with a 0 input is 0).
  - Drive with `ctx.drive(pin, strong(level) | Drive.Z, delay)`; per-transition delays
    (tPLH ≠ tPHL) by choosing the delay per call.
  - Edge-triggered logic: `ctx.rose(clk)` / `ctx.fell(clk)` are strict 0↔1; check `ctx.prev(clk)`
    for edges from `X`/`Z` and go `X` pessimistically (`clockEdge` in `74xx/edge-triggered.ts`).
    For 74xx flip-flops and registers, write a `FlipFlopSpec` (`flip-flops.ts`) or a
    `RegisterSpec` (`registers.ts`) rather than a new behavior.
  - Timing requirements (edge-triggered parts): the data sheet's set-up, hold, pulse width and
    recovery as `[min, typ]` in the family's timing (`requirements` in `hc-timing.ts`: the
    guaranteed minimum at 25 °C → `timing.min`); declare them with `TimingChecks` from core,
    keep `checks.createTimes()` in the state, run the checks first in `evaluate` with `armed`
    false while the part ignores its clock, make the bits a violation may have loaded `X`
    (docs/components.md#timing-checks), and call `checks.track(ctx, times)` last.
  - `ctx.rose`/`ctx.fell` read the pin (a floating net gets reported): to observe a pin, use
    `ctx.changed` and `ctx.prev`.
  - No allocations in `evaluate`, no module-level mutable variables, no randomness, no clocks.
  - Memories (`src/library/mem`): data sheets give limits only — `typical: {}`, maxima in `max`,
    output and requirement minima in `min`; an `SramSpec` (or the EEPROM specs) per part,
    timing per speed grade with a `speed` prop where the data sheet sells several; the shared
    `ReadPath` (the `X` window) and `WritePath` (level-sensitive writes and their checks)
    rather than new behaviors (docs/components.md#memories-mem, ADR-0017).
  - Parts with a controller (`src/library/periph`, ADR-0022): keep the controller a pure state
    machine beside the bus code (testable without a bench); work out uncertainty by running
    every outcome exactly and merging them, and cap what you enumerate (≤ 3 unknown bits);
    read an enable only when it changes (a 3-state output off at power-on isn't floating); keep
    an uncertain transfer open until its strobe is known again (acting on every `X` can ring);
    a look that changes with time alone (a blink) is `animation`, not a timer event.

## 3. Register it

Add it to the family's `index.ts` list and make sure `createDefaultRegistry()`
(`src/library/registry.ts`) includes the family.

## 4. Test it

File: `<part>.test.ts` next to the definition, using `Bench` and the helpers from
`src/core/testing`:

1. **Function table** — `functionTable(bench, definition.functionTable, unit.pins)` for every
   unit (or a table written in the test), with the datasheet's letters: `H`, `L`, `X` (= don't
   care, expanded), `Z` (outputs only).
2. **Unknown / floating inputs** — `truthTable(bench, inputs, outputs, rows)` with simulator
   values `0`, `1`, `'X'`, `'Z'`.
3. **Timing** — `bench.measure({ A: 1 }, 'Y')` equals the datasheet `tpd` (each distinct delay).
4. **Edge cases** — tri-state enable/disable, reset, prop limits.
5. **Sequential parts** — the data sheet's sequential table (`↑`, `↓`, `h`, `l`, `q` through a
   `state` map; "no change" written `qn`) with `functionTable(…, { states })`; uncertain clock
   edges; every timing check just inside its minimum (silent) and just outside (diagnostic +
   `X`). Mark clock pins `clock: true` so the checker sets them after the data. Rows with data
   sheet text in their outputs (`count`, a footnote `[1]`) go through
   `checkableRows(table, displayOnly)` (internal-stage columns as `displayOnly`, mapped to
   `null`) and get hand-written tests; state letters may have digits (`q7`). A `↑` row on a
   falling-edge part: the states must leave the clock LOW (setting the level before `↑` would
   otherwise be an active edge). Usage rules a data sheet states in prose ("CE̅ may rise only
   while CP is HIGH") are checked like timing requirements: reported, `X` where it matters.
6. **Pin names as drawn** — render the pinning figure: Nexperia overlines an active-LOW pin's
   letters, not its digits (`1R̅D̅`, `E̅1`), which is the default; where a sheet differs (the
   175's `Q̅0̅`, the 191's `U̅/D`) the `label` marks the overlined characters with U+0305.

Then `pnpm check`. New family → add it to the families table in docs/components.md.

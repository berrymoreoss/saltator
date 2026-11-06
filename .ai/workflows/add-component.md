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
- **Props** (`props`) for user-editable settings, with defaults and min/max. Time props are
  integer picoseconds (`ns(1)`).
- **Timing** (`timing.typical`, optional `max`, `conditions`, `source`): typical values at
  VCC = 5 V unless the part says otherwise. Never zero for real chips.
- **Behavior** (`create(props)`):
  - Precompute pin indices and constants from props in the closure (immutable only).
  - Mutable state only in `createState()` → plain data (objects, arrays, typed arrays).
  - Read with `ctx.read`; combine with the 4-state operators (`and`, `or`, `xor`, `not`,
    `toInput`) so `X`/`Z` inputs propagate conservatively (an AND with a 0 input is 0).
  - Drive with `ctx.drive(pin, strong(level) | Drive.Z, delay)`; per-transition delays
    (tPLH ≠ tPHL) by choosing the delay per call.
  - Edge-triggered logic: `ctx.rose(clk)` / `ctx.fell(clk)` are strict 0↔1; check `ctx.prev(clk)`
    for edges from `X`/`Z` and go `X` pessimistically.
  - No allocations in `evaluate`, no module-level mutable variables, no randomness, no clocks.

## 3. Register it

Add it to the family's `index.ts` list and make sure `createDefaultRegistry()`
(`src/library/registry.ts`) includes the family.

## 4. Test it

File: `<part>.test.ts` next to the definition, using `Bench` and the helpers from
`src/core/testing`:

1. **Function table** — `functionTable(bench, { inputs, outputs, rows })` with the datasheet's
   letters: `H`, `L`, `X` (= don't care, expanded), `Z` (outputs only).
2. **Unknown / floating inputs** — `truthTable(bench, inputs, outputs, rows)` with simulator
   values `0`, `1`, `'X'`, `'Z'`.
3. **Timing** — `bench.measure({ A: 1 }, 'Y')` equals the datasheet `tpd` (each distinct delay).
4. **Edge cases** — tri-state enable/disable, reset, prop limits.

Then `pnpm check`. New family → add it to the families table in docs/components.md.

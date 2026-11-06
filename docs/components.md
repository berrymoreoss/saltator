# Components

How parts are described in `src/library`. Rationale for modeling chips as packages:
[ADR-0004](adr/0004-chips-as-packages.md). Runtime contract (behaviors, context, delays):
[simulation.md](simulation.md#components-at-runtime). Step-by-step recipe for adding a part:
[.ai/workflows/add-component.md](../.ai/workflows/add-component.md).

> Status: the definition shape is implemented (R01); `symbol`, the `sense`/`constant` pin flags
> and the `io/*` parts landed in R03. 74xx parts (R06) are the first to use `package` and
> `units`.

## Families and type ids

A part is identified by a stable **type id** `family/part` (lowercase letters, digits, dashes),
stored in saved documents. Never rename a type id; add a migration if you must. The family is
the part before the slash (`familyOf(type)`).

| Family   | Examples                                                           | Notes                                                                                                  |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `prim`   | `prim/nand`, `prim/tristate-buffer`, `prim/pull`                   | Abstract building blocks (Logisim-style), configurable inputs and delay. For prototyping and learning. |
| `io`     | `io/switch`, `io/button`, `io/led`, `io/clock`, `io/seven-segment` | Interaction and indication: rails, switches, LEDs, displays, clock, probe ([below](#io-parts-io)).     |
| `74xx`   | `74xx/74hc00`, `74xx/74hc245`, `74xx/74ls189`                      | Real logic chips. Behavior shared per function; timing per logic family (HC first) _(planned, R06)_.   |
| `mem`    | `mem/at28c256`, `mem/62256`                                        | ROM/EEPROM/SRAM with inspectors _(planned, R12)_.                                                      |
| `cpu`    | `cpu/w65c02s`                                                      | Processors (pin-level) _(planned, R17)_. Later: Z80, AVR, PIC.                                         |
| `periph` | `periph/w65c22`, `periph/hd44780`                                  | Peripherals _(planned, R18)_.                                                                          |
| `test`   | `test/driver`                                                      | Test-only parts from `src/core/testing`; not in the default registry.                                  |

## Definition shape

```ts
interface ComponentDefinition<Props, State> {
  type: string; // '74xx/74hc00'
  name: string; // '74HC00' (shown on the part)
  title: string; // 'Quad 2-input NAND gate'
  keywords?: string[]; // palette search: ['nand', 'gate']
  designatorPrefix?: string; // 'SW' → new instances are SW1, SW2, …; default 'U'
  datasheet?: string; // URL of the datasheet used for pins, function table, timing

  pins: PinDef[] | ((props: Props) => PinDef[]); // order defines PinRef indices
  package?: PackageDef; // { kind: 'dip', pins: 14 }; absent for abstract parts
  units?: UnitDef[]; // gate sections, for the future symbol view
  props?: PropDef[]; // user-editable properties (inspector)
  timing?: TimingDef; // datasheet numbers + source/conditions
  symbol?: SymbolDef | ((props: Props) => SymbolDef); // geometry when drawn as a symbol

  create(props: Props): Behavior<State>; // see docs/simulation.md
}

interface PinDef {
  name: string; // datasheet name: '1A', '1Y', 'OE', 'VCC' (unique within the part)
  number?: number; // physical pin number (required when `package` is set)
  dir: 'in' | 'out' | 'tristate' | 'bidir' | 'power' | 'nc';
  activeLow?: boolean; // drawn with a bubble/overline: OE, CE, WE
  clock?: boolean; // drawn with a clock triangle
  weak?: boolean; // only ever drives weakly (pull resistors); driver pins only
  sense?: boolean; // only observes the net (LEDs, displays, probes); `in` pins only
  constant?: 0 | 1; // output tied to this level (rails, constants); strong `out` pins only
}
```

Write definitions with `defineComponent<Props, State>({ … })`: it type-checks `create`, `pins`
and the behavior against your props and state types, and returns the erased
`AnyComponentDefinition` that registries store. A `Registry` rejects malformed or duplicate type
ids and designator prefixes, and validates pins (and the symbol) with the default props:
duplicate pin names, flags on the wrong kind of pin, a symbol that doesn't place every pin.

`designatorPrefix` (uppercase letters) is what the editor numbers new instances with, by
KiCad/IEEE convention: `U` for chips, gates and other logic (the default), `R` resistors, `SW`
switches and buttons, `D` LEDs, `DS` displays, `X` clocks and oscillators, `TP` probes, `PWR`
power symbols.

`pins` may be a function of the (resolved) props, for parts whose pin count is configurable
(N-input gates, DIP-switch banks, LED bars). `pinsOf(definition, props)` returns an instance's
pins and `pinIndex(pins, name)` finds a `PinRef`.

Pin directions:

| `dir`      | Reads net | Drives net      | Power-on       | Typical                              |
| ---------- | --------- | --------------- | -------------- | ------------------------------------ |
| `in`       | yes       | no              | —              | gate inputs, control pins            |
| `out`      | no        | strong 0/1      | strong `X`     | push-pull outputs                    |
| `tristate` | no        | strong 0/1 or Z | released (`Z`) | 74HC245/173/374 outputs              |
| `bidir`    | yes       | strong 0/1 or Z | released (`Z`) | data buses of RAM, CPUs, 74HC245 A/B |
| `power`    | —         | —               | —              | VCC, GND (not simulated in the MVP)  |
| `nc`       | —         | —               | —              | not connected                        |

A driver pin marked `weak` (pull resistors) only ever drives weak levels. The kernel doesn't need
the flag — strength comes from the drive values — but static design checks do: two strong `out`
pins on one net are a short, an `out` and a pull resistor are not.

An `in` pin marked `sense` only observes its net, like an LED or a probe: a floating net there is
no mistake (it is simply dark), so the kernel never reports `floating-input` for reads through it
and the `undriven-input` check skips it. The part is still evaluated when the net changes.

An `out` pin marked `constant: 0 | 1` is tied to that level for good (`io/vcc`, `io/gnd`,
`prim/constant` with 0/1). The `shorted-outputs` check counts outputs tied to the same level as
one source: two VCC symbols wired together are fine, VCC to GND or VCC to a gate output is a
short.

## Packages and pin numbering

- DIP pin numbering follows the datasheet: with the notch up, pin 1 is top-left, pins go down the
  left side and back up the right side (for DIP-14: left 1–7, right 8–14 bottom to top).
- The editor draws DIP parts generically from `package` + `pins`, so a 74xx definition needs no
  drawing code. Pin positions come from `partLayout` in `src/circuit`
  ([circuit.md](circuit.md#part-layouts)): vertical, notch up, pin pitch one cell, body 4 cells
  wide up to 20 pins and 6 above. The drawing — notch, pin numbers outside, pin names inside
  (overlined when `activeLow`, a clock triangle for `clock`), part name down the middle — is in
  [editor.md](editor.md#symbol-drawing).
- `VCC` and `GND` are present in the definition and drawn, but the MVP treats every chip as
  powered. A later design check will flag unconnected power pins.

## Units (gate sections)

Multi-gate chips list their sections so a future Proteus/KiCad-style symbol view can draw
`U1A`…`U1D` separately:

```ts
units: [
  { name: 'A', pins: ['1A', '1B', '1Y'] },
  { name: 'B', pins: ['2A', '2B', '2Y'] },
  // …
];
```

Optional; recommended for every multi-gate chip from the start (cheap now, saves a migration
later).

## Properties

```ts
interface PropDef {
  key: string; // 'color', 'frequency', 'inputs', 'delay'
  label: string;
  type: 'number' | 'integer' | 'boolean' | 'enum' | 'color' | 'string' | 'time';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[]; // for 'enum'
  unit?: string; // display unit: 'Hz'
}
```

- `time` props are integer **picoseconds**, like every time in the kernel; the inspector
  converts for display.
- Props are part of the saved document; changing one recompiles the netlist.
- `resolveProps(definition, raw)` (used by the netlist resolver) fills in defaults and rejects
  unknown keys, wrong types, non-integers for `integer`/`time`, out-of-range values and unknown
  `enum` options, with a message naming the component and prop.

## Timing

```ts
timing: {
  typical: { tpd: ns(7) },       // values the behavior uses (typical)
  max: { tpd: ns(15) },          // optional, for a future worst-case mode
  conditions: 'VCC = 5 V, CL = 15 pF, Tamb = 25 °C',
  source: 'Nexperia 74HC00 datasheet, rev. 9, table 8',
}
```

Use the datasheet's typical value at 5 V when available, keyed by the datasheet symbol (`tpd`,
`tPLH`, `tPHL`, `tPZH`, `tPHZ`, `tsu`, `th`, …). Record where the numbers came from. Abstract
`prim/*` parts have no `timing`; they take a `delay` prop instead.

## Behavior guidelines

- Read inputs with `ctx.read` and combine them with the 4-state operators (`and`, `or`, `xor`,
  `not`, `toInput`): an AND with a 0 input is 0 even if another input is `X`; otherwise `X`.
- Drive outputs with the datasheet delay: `ctx.drive(pin, strong(level), delay)`, `Drive.Z` to
  release. Never use zero delay for real chips.
- Keep mutable state in `ctx.state` (from `createState()`, plain data); closures may hold only
  immutable configuration. No module-level mutable variables (multiple instances!).
- Edge-triggered logic uses `ctx.rose(clk)` / `ctx.fell(clk)`, which are strict 0↔1. If
  `ctx.changed(clk)` but the edge involves `X`/`Z` (`ctx.prev(clk)`), go `X` pessimistically.
- No randomness or wall-clock time; no allocations in `evaluate` for hot parts.

## Testing a part

Every part ships with `<part>.test.ts` next to it, using `src/core/testing`:

1. **Function table**: transcribe the datasheet function table with `functionTable(bench, …)`
   (letters `H`, `L`, `X` = don't care, `Z`).
2. **Unknown / floating inputs**: `truthTable(bench, …)` with `0`, `1`, `'X'`, `'Z'`.
3. **Timing**: at least one assertion that an output changes exactly `tpd` after the input
   (`bench.measure`).
4. **Edge cases**: tri-state enable/disable, reset behavior, prop limits.

## Primitives (`prim/*`)

Abstract parts in `src/library/primitives`, all in `createDefaultRegistry()`. Every one with an
input has a `delay` prop (`time`, default **1 ns**, 0 allowed for Logisim-like behavior).

| Type                    | Pins                       | Props                                 | Behavior                                                  |
| ----------------------- | -------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `prim/buffer`           | `A` → `Y`                  | `delay`                               | Y = A (`X`/`Z` → `X`)                                     |
| `prim/not`              | `A` → `Y`                  | `delay`                               | Y = ¬A                                                    |
| `prim/and`, `prim/or`   | `A`, `B`, … `H` → `Y`      | `inputs` (2–8, default 2), `delay`    | 4-state AND / OR                                          |
| `prim/nand`, `prim/nor` | `A`, `B`, … `H` → `Y`      | `inputs`, `delay`                     | inverted AND / OR                                         |
| `prim/xor`, `prim/xnor` | `A`, `B`, … `H` → `Y`      | `inputs`, `delay`                     | odd / even parity; any `X`/`Z` input → `X`                |
| `prim/tristate-buffer`  | `A`, `EN` → `Y` (tristate) | `delay`                               | EN = 1 → Y = A; EN = 0 → `Z`; EN unknown → `X`            |
| `prim/constant`         | `Y`                        | `value`: `'0'`, `'1'`, `'X'` (def. 1) | drives the value strongly from t = 0                      |
| `prim/pull`             | `Y` (weak)                 | `direction`: `up` (default), `down`   | drives weak 1 / weak 0 from t = 0; any strong driver wins |

`prim/pull` is also the schematic's pull-up/pull-down resistor (the resistance is implied).

Symbols (R03): N-input gates `gate-and`, `gate-or`, `gate-nand`, `gate-nor`, `gate-xor`,
`gate-xnor` — a 4-cell-wide body, inputs one cell apart down the left side, skipping the middle
row for an even count so the output sits on the grid (2 inputs: rows 1 and 3, output row 2);
`buffer`, `not` (A left, Y right); `tristate-buffer` (EN from below); `constant`; `pull-up` /
`pull-down` (a resistor to its rail, the pin below / above it).

## Symbols (non-package parts)

Parts without a `package` describe their drawing as data in `symbol` (a function of props where
the shape depends on them, like LED bars or N-input gates). The library never draws; the editor
maps `kind` to a drawing function and falls back to a box for kinds it doesn't know.

```ts
interface SymbolDef {
  kind: string; // drawing function: 'led', 'switch', 'gate-and', …
  width: number; // body size in grid cells, pin stubs excluded
  height: number;
  pins: Record<string, { side: PinSide; offset: number }>; // every pin, power and nc too
}
type PinSide = 'left' | 'top' | 'right' | 'bottom';
```

- A pin sits on a side of the body, `offset` cells from its top (left/right sides) or left
  (top/bottom sides) edge, 0 … height or 0 … width; its stub sticks out one cell and connects at
  the tip. No two pins on the same point.
- `partLayout` in `src/circuit` turns the symbol into connection points
  ([circuit.md](circuit.md#part-layouts)). A `package` wins over a `symbol` (chips are drawn as
  packages, ADR-0004); parts with neither get the generic box (none of the built-in parts).
- The editor draws each `kind` with its own drawer (ANSI or IEC gate style) and places the
  designator and label outside the part ([editor.md](editor.md#symbol-drawing)). A new symbol
  kind needs a drawer in `src/editor/symbols/`; `tests/scenarios/symbol-drawing.test.ts` fails
  for a shipped part whose kind has none.

## IO parts (`io/*`)

Interaction and indication, in `src/library/io`. Electrical model:
[ADR-0007](adr/0007-io-electrical-model.md). IO parts have no datasheet timing: switches and
rails change with zero delay, the clock's edges are exact.

| Type               | Pins                         | Props (default)                                                                    | Behavior                                                              |
| ------------------ | ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `io/vcc`, `io/gnd` | `Y` (out, constant 1 / 0)    | —                                                                                  | strong 1 / 0 from t = 0                                               |
| `io/switch`        | `Y`                          | `contact` (`spdt`), `on` (false): position at power-on                             | toggle switch; actions `toggle`, `set`                                |
| `io/button`        | `Y`                          | `contact` (`spst-vcc`)                                                             | momentary; released at power-on; actions `press`, `release`           |
| `io/dip-switch`    | `S1`…`Sn`                    | `count` 1–12 (8), `contact` (`spst-vcc`), `on` (0): power-on bitmask, bit 0 = `S1` | actions `toggle`, `set` with `index` (0 = `S1`)                       |
| `io/clock`         | `Y` (out)                    | `frequency` 0.001 Hz–1 GHz (1), `duty` 1–99 % (50), `mode` (`auto`)                | starts low; `auto` runs freely; `manual`: action `step` → one pulse   |
| `io/led`           | `A`, `K` (sense)             | `color` (red)                                                                      | lit while A = 1 and K = 0                                             |
| `io/led-bar`       | `A1`…`An`, `K1`…`Kn` (sense) | `count` 1–12 (10), `color`                                                         | n separate LEDs                                                       |
| `io/seven-segment` | `a`…`g`, `dp`, `COM` (sense) | `common` (`cathode`), `color`                                                      | each segment an LED to `COM`; pins placed as on the real single digit |
| `io/hex-display`   | `D0`…`D3` (sense)            | `color`                                                                            | shows 0–F; any `X`/`Z` input → unknown (`hexDigit(levels)`)           |
| `io/probe`         | `A` (sense)                  | —                                                                                  | shows the level of its net: 0, 1, X or Z                              |

- **Contacts** (`contact`): `spdt` — drives strong 1 when on, strong 0 when off (pin `out`);
  `spst-vcc` — strong 1 when closed, released (`Z`) when open (pin `tristate`), needs a pull-down;
  `spst-gnd` — strong 0 when closed, released when open, needs a pull-up. Contact bounce is not
  modelled.
- **LEDs**: on with forward bias (A = 1, K = 0); off if A is 0 or `Z`, or K is 1 or `Z` (a
  floating side carries no current); unknown otherwise. 7-segment, common cathode: segment = A,
  `COM` = K; common anode: `COM` = A, segment = K. Colors are an `enum` of real LED colors (red,
  green, yellow, orange, blue, white).
- **Clock**: period = round(10¹² / frequency) ps, high time = round(period × duty / 100) ps
  (`clockPhases`); the first rising edge comes after the low time. `step` is ignored in `auto`
  mode and while a pulse is under way.
- **Actions** are objects with a `type` (`{ type: 'toggle' }`, `{ type: 'set', index: 2, on:
  true }`, …), sent with `sim.action(id, action)`; unknown ones throw (a host bug). Types:
  `SwitchAction`, `ButtonAction`, `DipSwitchAction`, `ClockAction`.
- **State** (`sim.stateOf(id)`) is the renderer's contract: `{ on }` (switch), `{ pressed }`
  (button), `{ on: boolean[] }` (DIP switch), `{ high }` (clock). LEDs, LED bars and 7-segment
  displays keep `LightsState`: per light (segments in `SEGMENTS` order) what it shows
  (`Light.OFF`/`ON`/`UNKNOWN`), since when, and its accumulated on-time. `onTimeAt(state, i,
  now)` gives the total on-time up to `now`, so the average brightness over a frame is the
  difference of two samples divided by the frame's duration — a multiplexed display or an LED on
  a fast clock shows its real brightness instead of random frames. Hex display and probe are
  stateless: the renderer reads their pin levels.

# Components

How parts are described in `src/library`. Rationale for modeling chips as packages:
[ADR-0004](adr/0004-chips-as-packages.md). Runtime contract (behaviors, context, delays):
[simulation.md](simulation.md#components-at-runtime). Step-by-step recipe for adding a part:
[.ai/workflows/add-component.md](../.ai/workflows/add-component.md).

> Status: the definition shape is implemented (R01); `symbol`, the `sense`/`constant` pin flags
> and the `io/*` parts landed in R03; the 74HC gates and bus buffers (R06) are the first to use
> `package`, `units`, pin `description`s and `functionTable`; R08 added MSI chips with delays per
> path, pin `label`s, `si` props and the `timer` family (NE555).

## Families and type ids

A part is identified by a stable **type id** `family/part` (lowercase letters, digits, dashes),
stored in saved documents. Never rename a type id; add a migration if you must. The family is
the part before the slash (`familyOf(type)`).

| Family   | Examples                                                           | Notes                                                                                                  |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `prim`   | `prim/nand`, `prim/tristate-buffer`, `prim/pull`                   | Abstract building blocks (Logisim-style), configurable inputs and delay. For prototyping and learning. |
| `io`     | `io/switch`, `io/button`, `io/led`, `io/clock`, `io/seven-segment` | Interaction and indication: rails, switches, LEDs, displays, clock, probe ([below](#io-parts-io)).     |
| `74xx`   | `74xx/74hc00`, `74xx/74hc245`, `74xx/74ls189`                      | Real logic chips ([below](#74xx-chips-74xx)). Behavior shared per function; timing per logic family.   |
| `timer`  | `timer/ne555`                                                      | Analog timers, behavioral: the RC network as props ([below](#timers-timer)).                           |
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
  functionTable?: FunctionTable; // datasheet function table (one unit's), shown in Part Info
  symbol?: SymbolDef | ((props: Props) => SymbolDef); // geometry when drawn as a symbol

  create(props: Props): Behavior<State>; // see docs/simulation.md
}

interface PinDef {
  name: string; // datasheet name: '1A', '1Y', 'OE', 'VCC' (unique within the part)
  label?: string; // drawn instead of the name where the datasheet symbol isn't unique: 151's 'YN' → 'Y'
  description?: string; // datasheet pin description: 'output enable input (active LOW)'
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
  si?: boolean; // 'number' entered and shown with SI prefixes: '4.7 kΩ', '100 nF'
}
```

- `time` props are integer **picoseconds**, like every time in the kernel; the inspector
  converts for display.
- `number` props with `si` hold base units (ohms, farads, hertz) and are typed and shown with SI
  prefixes (`4.7k`, `100n`, `1u`; shown `4.7 kΩ`), as resistor and capacitor values are.
- Props are part of the saved document; changing one recompiles the netlist.
- `resolveProps(definition, raw)` (used by the netlist resolver) fills in defaults and rejects
  unknown keys, wrong types, non-integers for `integer`/`time`, out-of-range values and unknown
  `enum` options, with a message naming the component and prop.

## Timing

```ts
timing: {
  typical: { tpd: ns(9) },       // values the behavior uses (typical)
  max: { tpd: ns(23) },          // optional, for a future worst-case mode
  conditions: 'VCC = 4.5 V, CL = 50 pF; typ at 25 °C, max at −40 °C to +85 °C',
  source: 'Nexperia 74HC_HCT00 product data sheet, rev. 11 (29 April 2025), table 7',
}
```

Keyed by the datasheet symbol (`tpd`, `ten`, `tdis`, `tPLH`, `tPHL`, `tsu`, `th`, …); record
where the numbers came from. **74HC parts use VCC = 4.5 V, CL = 50 pF** for every delay: the
typical value at 25 °C drives the simulation, the maximum at −40 °C to +85 °C is recorded for a
future worst-case mode. It is the one condition at which Nexperia gives every delay (typical
`ten`/`tdis` exist only at 2.0, 4.5 and 6.0 V) and the maxima, and a breadboard's load is closer
to 50 pF than to 15 pF (R06, Q5). Other families state their own conditions. Abstract `prim/*`
parts have no `timing`; they take a `delay` prop instead.

**Delays with several paths.** MSI data sheets give one delay per path (74HC138: `An to Yn`,
`E3 to Yn`, `En to Yn`). Each is a timing key in the data sheet's wording, `tpd(An to Yn)`; a
chip lists its paths (`DelayPath`: inputs → outputs → key) and drives each output with
`pathDelays(…).delay(ctx, output)`: the **longest** typical delay among the paths whose input
changed in this delta (the output settles after its slowest cause), or the output's longest path
when nothing changed (the forced evaluation; re-driving a pending value keeps it where it is).
Delays inside a chip (path skew, glitches) are not modeled; skew between chips is.

## Function tables

A real chip carries its datasheet function table as data: Part Info shows it, and the part's test
checks the behavior against it (`functionTable(bench, table, pins)` in `core/testing`).

```ts
functionTable: {
  inputs: ['nA', 'nB'],     // the datasheet's generic column names
  outputs: ['nY'],
  rows: ['L X | H', 'X L | H', 'H H | L'],
  note: 'each gate (n = 1 to 4)',
}
```

- One table describes every unit; the test maps the columns to each unit's pins
  (`for (const unit of units) functionTable(bench, table, unit.pins)`), so list a unit's pins
  inputs first, in the table's column order.
- Letters as in the datasheet: `H`, `L`, `X` (**don't care**, inputs), `Z` (outputs). Any other
  cell is datasheet text kept for display (`A=B`, `input`); such rows can't be checked by the
  helper, so the test covers them by hand.
- Text cells have no spaces (`A3>B3`, `blank`); Part Info spaces `=`, `<`, `>` out. A display-only
  output column (the 4511's `Display`) is mapped to `null` in the test:
  `functionTable(bench, table, [...pins, null])`.
- The registry rejects tables without input or output columns, with duplicate column names, no
  rows, or rows with the wrong number of cells.

## Behavior guidelines

- Read inputs with `ctx.read` and combine them with the 4-state operators (`and`, `or`, `xor`,
  `not`, `toInput`): an AND with a 0 input is 0 even if another input is `X`; otherwise `X`.
- Drive outputs with the datasheet delay: `ctx.drive(pin, strong(level), delay)`, `Drive.Z` to
  release. Never use zero delay for real chips.
- Keep mutable state in `ctx.state` (from `createState()`, plain data); closures may hold only
  immutable configuration. No module-level mutable variables (multiple instances!).
- Edge-triggered logic uses `ctx.rose(clk)` / `ctx.fell(clk)`, which are strict 0↔1. If
  `ctx.changed(clk)` but the edge involves `X`/`Z` (`ctx.prev(clk)`), go `X` pessimistically.
- `evaluate` may run when none of its inputs changed (once at power-on, once after every
  recompile while running): then it must only re-drive what its inputs imply, never count or
  toggle. Edge logic uses `rose`/`fell`, which are false then. This is what lets an edit carry a
  running simulation over without changing it ([simulation.md](simulation.md#editing-while-running-carry-over)).
- No randomness or wall-clock time; no allocations in `evaluate` for hot parts.

## Testing a part

Every part ships with `<part>.test.ts` next to it, using `src/core/testing`:

1. **Function table**: check the definition's `functionTable` (or a transcription in the test)
   with `functionTable(bench, table, pins)` for every unit (letters `H`, `L`, `X` = don't care,
   `Z`).
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
| `io/switch`        | `Y` (`ON`, `OFF` changeover) | `contact` (`spdt`), `on` (false): position at power-on                             | toggle switch; actions `toggle`, `set`                                |
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
  `spst-gnd` — strong 0 when closed, released when open, needs a pull-up. `io/switch` also has
  changeovers with the common on a rail, `spdt-gnd` and `spdt-vcc` (R08): two `tristate` throws,
  `ON` (closed in the on position) and `OFF`, the closed one at the rail, the open one released
  (pull both up or down) — Ben Eater's bistable 555 debounce. Contact bounce is not modelled.
- **LEDs**: on with forward bias (A = 1, K = 0); off if A is 0 or `Z`, or K is 1 or `Z` (a
  floating side carries no current); unknown otherwise. 7-segment, common cathode: segment = A,
  `COM` = K; common anode: `COM` = A, segment = K. Colors are an `enum` of real LED colors (red,
  green, yellow, orange, blue, white).
- **Clock**: period = round(10¹² / frequency) ps, high time = round(period × duty / 100) ps
  (`clockPhases`); the first rising edge comes after the low time. `step` is ignored in `auto`
  mode and while a pulse is under way.
- **Actions** are objects with a `type` (`{ type: 'toggle' }`, `{ type: 'set', index: 2, on:
  true }`, …), sent with `sim.action(id, action)`; unknown ones throw (a host bug). Types:
  `SwitchAction`, `ButtonAction`, `DipSwitchAction`, `ClockAction`. In the editor the Interact
  tool sends them (`INTERACTIONS` in `src/editor/symbols/interact.ts`, keyed by symbol kind;
  [editor.md](editor.md#interacting-with-parts)); a new interactive part adds a row there.
- **State** (`sim.stateOf(id)`) is the renderer's contract: `{ on }` (switch), `{ pressed }`
  (button), `{ on: boolean[] }` (DIP switch), `{ high }` (clock). LEDs, LED bars and 7-segment
  displays keep `LightsState`: per light (segments in `SEGMENTS` order) what it shows
  (`Light.OFF`/`ON`/`UNKNOWN`), since when, and its accumulated on-time. `onTimeAt(state, i,
  now)` gives the total on-time up to `now`, so the average brightness over a frame is the
  difference of two samples divided by the frame's duration — a multiplexed display or an LED on
  a fast clock shows its real brightness instead of random frames. Hex display and probe are
  stateless: the renderer reads their pin levels.

## 74xx chips (`74xx/*`)

Real logic chips as DIP packages ([ADR-0004](adr/0004-chips-as-packages.md)) in
`src/library/74xx`, the 74HC family from the Nexperia product data sheets
([ADR-0011](adr/0011-real-chips.md)). R06 ships the gates and bus buffers:

| Type           | Function                                            | Package | Typical delays             |
| -------------- | --------------------------------------------------- | ------- | -------------------------- |
| `74xx/74hc00`  | quad 2-input NAND                                   | DIP-14  | tpd 9 ns                   |
| `74xx/74hc02`  | quad 2-input NOR (outputs on pins 1, 4, 10, 13)     | DIP-14  | tpd 9 ns                   |
| `74xx/74hc04`  | hex inverter                                        | DIP-14  | tpd 9 ns                   |
| `74xx/74hc08`  | quad 2-input AND                                    | DIP-14  | tpd 9 ns                   |
| `74xx/74hc10`  | triple 3-input NAND                                 | DIP-14  | tpd 11 ns                  |
| `74xx/74hc11`  | triple 3-input AND                                  | DIP-14  | tpd 12 ns                  |
| `74xx/74hc14`  | hex inverting Schmitt trigger                       | DIP-14  | tpd 15 ns                  |
| `74xx/74hc20`  | dual 4-input NAND (n.c. pins 3, 11)                 | DIP-14  | tpd 10 ns                  |
| `74xx/74hc21`  | dual 4-input AND (n.c. pins 3, 11)                  | DIP-14  | tpd 12 ns                  |
| `74xx/74hc27`  | triple 3-input NOR                                  | DIP-14  | tpd 10 ns                  |
| `74xx/74hc30`  | 8-input NAND (n.c. pins 9, 10, 13)                  | DIP-14  | tpd 15 ns                  |
| `74xx/74hc32`  | quad 2-input OR                                     | DIP-14  | tpd 8 ns                   |
| `74xx/74hc86`  | quad 2-input XOR                                    | DIP-14  | tpd 14 ns                  |
| `74xx/74hc125` | quad buffer, 3-state, `nOE` active LOW              | DIP-14  | tpd 11, ten 15, tdis 15 ns |
| `74xx/74hc126` | quad buffer, 3-state, `nOE` active HIGH             | DIP-14  | tpd 11, ten 15, tdis 15 ns |
| `74xx/74hc240` | octal inverting buffer/line driver, 3-state         | DIP-20  | tpd 11, ten 14, tdis 15 ns |
| `74xx/74hc244` | octal buffer/line driver, 3-state (two groups of 4) | DIP-20  | tpd 11, ten 13, tdis 14 ns |
| `74xx/74hc245` | octal bus transceiver, 3-state (`DIR`, `OE`)        | DIP-20  | tpd 9, ten 11, tdis 15 ns  |

R08 adds the combinational MSI chips, all DIP-16 (typical delays per path, longest listed):

| Type            | Function                                     | Typical delays (ns)                                     |
| --------------- | -------------------------------------------- | ------------------------------------------------------- |
| `74xx/74hc85`   | 4-bit magnitude comparator, cascadable       | An, Bn → QA>B, QA<B 23; → QA=B 21; expansion 18, 14     |
| `74xx/74hc138`  | 3-to-8 line decoder/demultiplexer; inverting | An → Yn 15; E3 → Yn 17; E1, E2 → Yn 17                  |
| `74xx/74hc139`  | dual 2-to-4 line decoder/demultiplexer       | nAn → nYn 14; nE → nYn 12                               |
| `74xx/74hc147`  | 10-to-4 line priority encoder (TI)           | 18                                                      |
| `74xx/74hc148`  | 8-to-3 line priority encoder, EI/EO/GS (TI)  | 1–7 → A0–A2 23; 0–7 → GS 25, EO 20; EI → 26, 19, 22     |
| `74xx/74hc151`  | 8-input multiplexer, Y and Y̅ (`YN`)          | In → Y 19, → Y̅ 21; Sn → 22; E → Y 15, → Y̅ 17            |
| `74xx/74hc153`  | dual 4-input multiplexer, shared selects     | nIn → nY 17; Sn → nY 18; nE → nY 12                     |
| `74xx/74hc157`  | quad 2-input multiplexer                     | nI → nY 13; S → nY 15; E → nY 14                        |
| `74xx/74hc158`  | quad 2-input multiplexer; inverting          | nI → nY 15; S → nY 17; E → nY 17                        |
| `74xx/74hc283`  | 4-bit binary full adder with fast carry (TI) | CIN → S0 … S3 19, 21, 23, 27; An, Bn → Sn 25; → COUT 23 |
| `74xx/74hc4511` | BCD to 7-segment latch/decoder/driver        | A–D → a–g 28; LE 27; BI 22; LT 15                       |

Delays at VCC = 4.5 V, CL = 50 pF, 25 °C ([Timing](#timing)); each chip's `timing.max` holds the
−40 °C to +85 °C maxima and `timing.source` the document, revision and table.

- **Sources.** Nexperia documents every chip but the 147, 148 and 283: those follow the current
  TI data sheets (SN74HC148, CD74HC147, CD74HC283) — TI's pin names (`I1`–`I9`, `0`–`7`,
  `A0`–`A3`/`S0`–`S3`, `CIN`, `COUT`), pinouts, function tables and maxima. TI's ex-Harris CD74HC
  sheets have no typical delay at 4.5 V / 50 pF, so the 147's and 283's typical values come from
  the Philips 74HC/HCT147 and 283 sheets (December 1990; same maxima), cited in `timing.source`
  (R08, Q6); the 283's function table is the Philips example row in TI's names (TI has none).
  TI's CD74HC147 pin table calls pin 9 an input; its pinning figure, like every 74147, has
  output `Y0` there.
- **Pin labels.** The 74HC151's two outputs are both `Y` in the data sheet, one overlined: pin 6
  is named `YN` and drawn `Y̅` (`label: 'Y'`, `activeLow`).
- **Sections.** Only chips with independent sections list `units` (the 139's two decoders, as
  KiCad does); chips whose sections share controls (153, 157, 158) are one section, and their
  tests map the function table to each multiplexer's pins themselves.
- **4-state, as precise as cheap.** Decoders drive `X` only on the outputs an unknown address
  bit could select; multiplexers give the value the possible inputs agree on (`X` if they
  differ); the adder ripples 4-state full adders (sum bits below an unknown input stay known,
  1 + 1 + X carries 1); the comparator decides bit by bit from bit 3; encoders and the 4511 merge
  every outcome their inputs allow and drive `X` only on the bits those disagree on
  (`outcomes.ts`, no allocation).
- **Cascading.** The 85's expansion inputs follow its function table (`QA>B` ignores `IA>B`); two
  85s compare 8-bit words and two 148s make a 16-to-4 encoder (`tests/scenarios/cascade-74hc.test.ts`).
- **74HC4511** — the first 74xx chip with state (`ChipBehavior<State>`): LE low is transparent,
  LE high holds the code it had when LE rose (a code arriving at that instant is not taken); LT
  low lights every segment, else BI low blanks, else codes 0–9 decode (6 and 9 without tails)
  and 10–15 blank. Nothing latched at power-on: `X` until LE goes low. Drives a common-cathode
  `io/seven-segment` directly (resistors are not modeled).

- **One function, many families.** A chip's function — pinout with the data sheet's pin
  descriptions, units, function table, behavior — is a `ChipSpec` (`GATE_SPECS`,
  `BUFFER_SPECS`, `TRANSCEIVER_SPEC`); its data sheet and timing come from a `LogicFamily` (`HC`
  in `hc-timing.ts`). `chipDefinition(spec, family, behavior)` makes type `74xx/74hc00`, name
  `74HC00`. A 74HCT or 74AC is another timing table; a 74LS also needs TTL inputs (a floating
  input reads high) — backlog.
- **Pinouts** are written like the data sheet's pin description table:
  `pins('1A, 2A, 3A, 4A', '1, 4, 9, 12', 'in', 'data input')`. Pins are listed in pin-number
  order; n.c. pins are `nc` pins named `NC<number>` (drawn `NC`). Bus pins are 0-based as in the
  Nexperia data sheets (`A0`–`A7`, `1A0`–`1A3`).
- **Gates** combine their inputs with the 4-state operators, like `prim/*`: a 0 into a NAND gives
  1 whatever the other inputs; a floating input reads as `X`.
- **3-state buffers**: enabled, `Y = A` (inverted for the 240) after `tpd`, or after `ten` when
  the enable has just become active; disabled, released after `tdis`; an unknown or floating
  enable drives `X` (it might be driving). Two 244s handing a bus over at the same instant fight
  for `tdis − ten` = 1 ns, as on a real board (`tests/scenarios/bus-74hc.test.ts`).
- **74HC245**: `OE` high isolates both ports (`tdis`). `OE` low: `DIR` high drives B from A and
  releases A, `DIR` low drives A from B and releases B; the port that starts driving uses `ten`,
  data changes `tpd`. `OE` or `DIR` unknown: every port that might be an output drives `X`. Only
  the input port is read, so a floating input bus is reported and an idle one is not.
- **74HC14**: an inverter with the Schmitt trigger's delay; hysteresis is analog and not modeled.
- **Every section, every call.** `evaluate` re-evaluates every gate, buffer or bit (re-driving
  an unchanged output schedules nothing). Skipping sections whose inputs didn't change is wrong:
  the forced evaluation at power-on and after a recompile can see some inputs changed and must
  still evaluate the rest. Cost: a 74HC04 chain runs at ≈ 8.4M events/s against ≈ 13.2M for
  `prim/not` (R06, `pnpm bench`).
- **Unused inputs** float as on a real board: the `undriven-input` check warns about each one and
  the kernel reports a `floating-input` when the chip reads it. Tie them to GND or VCC, as
  Hello, LED does. **Power pins** are drawn but not simulated (ADR-0004).
- **Tests** (`src/library/74xx/*.test.ts`): every function table checked on every unit through
  pin numbers read off the data sheet's pinning figure, every delay against the data sheet's
  numbers, unknown and floating inputs, enable timing, the 245 turning round; `chips.test.ts`
  checks every chip's package, pin descriptions, timing source and units. The carry-over
  property runs random networks of them.

## Timers (`timer/*`)

Analog timer chips, behavioral ([ADR-0013](adr/0013-behavioral-timer.md)): the external RC
network is props, the pins it occupies are drawn but not simulated.

| Type          | Pins (DIP-8, TI)                                            | Props (default)                                                                                          |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `timer/ne555` | GND, TRIG, OUT, RESET (active LOW), CONT, THRES, DISCH, VCC | `mode` (`astable`), `ra` (1 kΩ), `rb` (100 kΩ, astable), `c` (1 µF): SI-prefixed, 1 Ω–10 MΩ, 1 pF–100 µF |

From the TI NE555 data sheet (SLFS022K): its function table read as levels (TRIG L = below ⅓
VCC, THRES H = above ⅔ VCC) — RESET low resets, TRIG low sets, THRES high resets, else hold;
RESET overrides TRIG, which overrides THRES.

- **Astable** — RESET high runs it: high for the first charge from 0 V, 1.1 (RA + RB) C, then
  tH = 0.693 (RA + RB) C and tL = 0.693 RB C (equations 1–2); RESET low stops it low, and it
  restarts with a first charge. TRIG, THRES, DISCH are the RC network: not simulated.
- **Monostable** — TRIG low (RESET high) starts a pulse of tw = 1.1 RA C; triggers during it are
  ignored; at its end OUT stays high while TRIG is still low; RESET low ends it. THRES, DISCH not
  simulated.
- **Bistable** — the function table on TRIG, THRES and RESET; DISCH an open-collector output
  (strong 0 while reset, released while set, `X` while unknown).
- **Power-on**: astable starts high (the capacitor is empty); monostable and bistable drive `X`
  until the first trigger or reset ("as previously established", R08 Q4). An unknown RESET or
  TRIG gives `X` where it could matter.
- **Timing**: every output edge `tPD` = 225 ns after its cause (TI Figure 5-8, 25 °C, trigger to
  0 V); timers use `wakeAfter` with a generation token in the state (RESET and new pulses make a
  pending wake stale). CONT is never simulated. Changing `rb` while running acts like turning a
  potentiometer: the next phase uses it (carry-over).

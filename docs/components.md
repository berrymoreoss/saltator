# Components

How parts are described in `src/library`. Rationale for modeling chips as packages:
[ADR-0004](adr/0004-chips-as-packages.md). Runtime contract (behaviors, context, delays):
[simulation.md](simulation.md#components-at-runtime). Step-by-step recipe for adding a part:
[.ai/workflows/add-component.md](../.ai/workflows/add-component.md).

> Status: the definition shape is implemented (R01); `symbol`, the `sense`/`constant` pin flags
> and the `io/*` parts landed in R03; the 74HC gates and bus buffers (R06) are the first to use
> `package`, `units`, pin `description`s and `functionTable`; R08 added MSI chips with delays per
> path, pin `label`s, `si` props and the `timer` family (NE555); R09a added edge-triggered chips,
> `timing.min` with timing checks, sequential function tables and the pin `clock` flag on
> packages; R10a added the `net` family (net labels), the `net` pin field, `schematicOnly`,
> `nextProps`, prop `pattern`s and `centered` symbols; R10b bus labels, bus entries and the
> `bus` pin field; R12a the `mem` family, `image` props, `memory` definitions and timing as a
> function of props (speed grades); the LCD branch (off the roadmap) the `periph` family with
> the HD44780 character LCD, cycle-time checks and `animation`; R17a the `cpu` family with the
> W65C02S and `cpu` definitions; HDL-1 the `hdl` family: a document's Verilog modules, made from
> their IR by the library's interpreter ([below](#verilog-modules-hdl)).

## Families and type ids

A part is identified by a stable **type id** `family/part` (lowercase letters, digits, dashes),
stored in saved documents. Never rename a type id; add a migration if you must. The family is
the part before the slash (`familyOf(type)`).

| Family   | Examples                                                           | Notes                                                                                                     |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `prim`   | `prim/nand`, `prim/tristate-buffer`, `prim/pull`                   | Abstract building blocks (Logisim-style), configurable inputs and delay. For prototyping and learning.    |
| `io`     | `io/switch`, `io/button`, `io/led`, `io/clock`, `io/seven-segment` | Interaction and indication: rails, switches, LEDs, displays, clock, probe ([below](#io-parts-io)).        |
| `net`    | `net/label`, `net/bus-entry`, `net/port`                           | Schematic-only connections: net and bus labels, bus entries, ports ([below](#net-labels-net)).            |
| `74xx`   | `74xx/74hc00`, `74xx/74hc245`, `74xx/74hc574`                      | Real logic chips ([below](#74xx-chips-74xx)). Behavior shared per function; timing per logic family.      |
| `timer`  | `timer/ne555`                                                      | Analog timers, behavioral: the RC network as props ([below](#timers-timer)).                              |
| `mem`    | `mem/at28c16`, `mem/6116`                                          | EEPROMs (read as ROMs) and SRAMs ([below](#memories-mem)); shown in the Memory tab (R12b).                |
| `cpu`    | `cpu/w65c02s`                                                      | Processors, pin-level and cycle-accurate ([below](#cpus-cpu)). Later: Z80, AVR, PIC.                      |
| `periph` | `periph/hd44780`, `periph/w65c22`                                  | Peripherals: the HD44780 character LCD ([below](#peripherals-periph)); the VIA, ACIA _(planned, R18)_.    |
| `draw`   | `draw/text`                                                        | Graphics: drawn only, no pins, never simulated ([below](#graphics-draw)).                                 |
| `hdl`    | `hdl/address-decoder`                                              | A document's Verilog module, run by the interpreter; never placed itself ([below](#verilog-modules-hdl)). |
| `test`   | `test/driver`                                                      | Test-only parts from `src/core/testing`; not in the default registry.                                     |

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
  timing?: TimingDef | ((props: Props) => TimingDef); // datasheet numbers + source/conditions
  functionTable?: FunctionTable; // datasheet function table (one unit's), shown in Part Info
  symbol?: SymbolDef | ((props: Props) => SymbolDef); // geometry when drawn as a symbol
  schematicOnly?: boolean; // drawn and connected, never simulated: left out of the netlist
  nextProps?: (props: Props) => Props; // props of the next instance placed after this one
  memory?: MemoryDef<State>; // a memory's size and a view of its cells (inspectors, test benches)
  memories?: MemoryDef<State>[]; // a Verilog module's named memories (HDL-6; ADR-0036)
  cpu?: CpuDef<State>; // a CPU's registers and a view of its state (R17a; docs/simulation.md)
  animation?: (state: State, props: Props) => Time | undefined; // look changes with time alone

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
  net?: string; // joins the circuit-wide net of this name (net labels, VCC/GND symbols)
  bus?: boolean; // connects on the bus layer (bus entries' bus ends, bus labels); nc only
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
power symbols, `NL` net labels and `BE` bus entries (never drawn).

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

A pin with `net: 'NAME'` joins the circuit-wide net of that name wherever it sits: every pin of
one name is on one net, without a wire between them, and the net is called by the name
([circuit.md](circuit.md#connectivity)). The VCC and GND symbols have `net: 'VCC'` / `'GND'`; a
net label's pin has its `name` prop (its pins are a function of props).

A pin with `bus: true` connects on the bus layer: to bus lines and other bus pins only, never
to wires or other pins ([circuit.md](circuit.md#connectivity)) — a bus entry's bus end, a bus
label's pin. Only `nc` pins can be bus pins.

`animation` is for a part whose look changes as simulated time passes without an event — an
LCD's blinking cursor: it returns how long one look lasts for an instance's state (undefined
while it stays as it is), and the editor redraws whenever the time crosses into the next one
([editor.md](editor.md#pacing)). The canvas otherwise redraws only on events and light changes.

A `schematicOnly` part is drawn and connects but is never simulated: the compiler leaves it out
of the netlist and keeps its pins apart from the simulated ones, so adding, moving or renaming
one only changes which pins share a net (net labels). `nextProps` gives the editor the props of
the next instance placed after one was placed or edited — a net label continues `D0` with
`D1` ([editor.md](editor.md#placing-parts)).

## Packages and pin numbering

- DIP pin numbering follows the datasheet: with the notch up, pin 1 is top-left, pins go down the
  left side and back up the right side (for DIP-14: left 1–7, right 8–14 bottom to top).
- The editor draws DIP parts generically from `package` + `pins`, so a 74xx definition needs no
  drawing code. Pin positions come from `partLayout` in `src/circuit`
  ([circuit.md](circuit.md#part-layouts)): vertical, notch up, pin pitch one cell, body 4 cells
  wide up to 20 pins and 6 above. The drawing — notch, pin numbers outside, pin names inside,
  a clock triangle for `clock`, part name down the middle — is in
  [editor.md](editor.md#symbol-drawing).
- **Overlines** (`pinTextRuns` in core): an active-low pin's letters are overlined, not its
  digits — `1R̅D̅`, `1Q̅`, `E̅1`, `Y̅0`, as the Nexperia data sheets draw them. A `label` that
  marks its overlined characters itself (U+0305 after each) is drawn as marked: the 191's
  `U̅/D` (bar over U only), the 175's `Q̅0̅` and the 165's `Q̅7̅` (their sheets overline the
  digit too).
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
  type: 'number' | 'integer' | 'boolean' | 'enum' | 'color' | 'string' | 'time' | 'image';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[]; // for 'enum'
  unit?: string; // display unit: 'Hz'
  si?: boolean; // 'number' entered and shown with SI prefixes: '4.7 kΩ', '100 nF'
  pattern?: { regex: RegExp; hint: string }; // what a 'string' allows; hint ends "must be …"
  multiline?: boolean; // a 'string' that may hold line breaks (a text's text)
}
```

- `time` props are integer **picoseconds**, like every time in the kernel; the inspector
  converts for display.
- `number` props with `si` hold base units (ohms, farads, hertz) and are typed and shown with SI
  prefixes (`4.7k`, `100n`, `1u`; shown `4.7 kΩ`), as resistor and capacitor values are.
- `image` props hold a memory's contents as text, sparse hex runs (`0000:A9FF8D 7FFC:0080`:
  an address, a colon, the bytes; unlisted bytes erased, `0xFF`); `max` is the size in bytes
  (`parseImage`, `formatImage` in core; [Memories](#contents-in-the-document)). Properties
  shows them as a summary (`214 of 2048 bytes programmed`).
- `string` props with `multiline` may hold line breaks (`\n`): a schematic text's text
  ([Graphics](#graphics-draw)); Properties edits them in a text area.
- Props are part of the saved document; changing one recompiles the netlist.
- `resolveProps(definition, raw)` (used by the netlist resolver) fills in defaults and rejects
  unknown keys, wrong types, non-integers for `integer`/`time`, out-of-range values and unknown
  `enum` options and `string`s that don't match their `pattern`, with a message naming the
  component and prop (`NL1: prop "name" must be letters, digits, … , got "A B"`).

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

**Timing requirements** (R09a). Edge-triggered chips also record what they require of the
circuit — set-up `tsu`, hold `th`, pulse width `tW`, recovery `trec` — keyed like delays
(`tsu(nD to nCP)`, `tW(nSD, nRD)`): the data sheet's **guaranteed minimum** in `timing.min`,
which the timing checks use ([below](#timing-checks)), and its typical value in `timing.typical`
(for reference; it may be negative: the 74HC74's `th` is typ −2 ns, min 3 ns). The minima are at
25 °C, the temperature of the typical delays (conditions: `…, min at 25 °C`); the 74HC74's data
sheet (rev. 9) gives them only for −40 °C to +85 °C, used as given (`min at −40 °C to +85 °C`).
The Part tab shows every delay and requirement with its source.

**Limits only** (R12a). Memory data sheets give no typical values, only guaranteed limits:
memories keep `typical` empty, the maxima of what they drive (`tACC`, `tDF`) in `max` and the
minima of their outputs (`tOH`, `tCLZ`) and of their requirements in `min` — a key may have
both (`tOE`, min 10 / max 70 ns on the AT28C16). **Speed grades**: a part sold in several grades
takes a `speed` prop and gives `timing` as a function of props (`timingOf(definition, props)`);
the Part tab shows the picked instance's.

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
- **Sequential tables** (R09a) use the data sheets' letters too: `↑` / `↓` (inputs) is a
  LOW-to-HIGH / HIGH-to-LOW transition; `h` / `l` the level one set-up time before it; an output
  cell named in the table's `state` map (`state: { q: 'nQ' }`) is the state before the row — that
  column's previous level, complemented with an overline (`q̅`, toggle). The data sheets' "no
  change" is written `qn` (as the 173's sheet does). `functionTable` then applies a row's data
  inputs, its clock inputs (pins marked `clock`) a microsecond later, and the transition a
  microsecond after that, so the part's own timing checks are met; previous-state rows are
  checked after each of `options.states` (steps that load 0 and 1). A data sheet with two tables
  (the 74's asynchronous and clocked ones, the 173's register and output ones) gets them merged
  into one, said in the `note`.

## Behavior guidelines

- Read inputs with `ctx.read` and combine them with the 4-state operators (`and`, `or`, `xor`,
  `not`, `toInput`): an AND with a 0 input is 0 even if another input is `X`; otherwise `X`.
- Drive outputs with the datasheet delay: `ctx.drive(pin, strong(level), delay)`, `Drive.Z` to
  release. Never use zero delay for real chips.
- Keep mutable state in `ctx.state` (from `createState()`, plain data); closures may hold only
  immutable configuration. No module-level mutable variables (multiple instances!).
- Edge-triggered logic uses `ctx.rose(clk)` / `ctx.fell(clk)`, which are strict 0↔1. If
  `ctx.changed(clk)` but the edge involves `X`/`Z` (`ctx.prev(clk)`), go `X` pessimistically —
  only where the edge could change something (`clockEdge` in `74xx/edge-triggered.ts`).
- `ctx.rose`/`ctx.fell` **read** the pin: on a floating net they record a `floating-input`, as
  `ctx.read` does. Code that only observes a pin (timing checks) uses `ctx.changed` and
  `ctx.prev`.
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
5. **Timing checks** (edge-triggered parts): each requirement just inside its minimum (silent)
   and just outside (the diagnostic, and `X` on what the edge may have loaded).

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
  centered?: boolean; // the body sits half a cell higher (net labels): left/right pins only
  raise?: number; // the body and pins sit this many whole cells higher (a part that grows up)
}
type PinSide = 'left' | 'top' | 'right' | 'bottom';
```

- A pin sits on a side of the body, `offset` cells from its top (left/right sides) or left
  (top/bottom sides) edge, 0 … height or 0 … width; its stub sticks out one cell and connects at
  the tip. No two pins on the same point.
- A `centered` symbol's body is raised by half a cell, so a one-cell-high body sits centered on
  the row of its pins at offset 0, and such parts stack on adjacent pins at a one-cell pitch
  (net labels on a chip's data pins). Its bounding box then reaches half a cell above the
  origin.
- A symbol that grows taller with a prop sets `raise` to what it grew: its body and pins move
  up by that many cells, so the pins on its bottom side stay on the same points and the wires
  on them stay connected when the prop changes (an LCD module's 4-line sizes rise by 3).
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
| `io/vcc`, `io/gnd` | `Y` (out, constant 1 / 0)    | —                                                                                  | strong 1 / 0 from t = 0; every symbol on the net `VCC` / `GND`        |
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
  mode and while a pulse is under way. Each edge is scheduled on the output a phase ahead (a
  pending change, with a timer at the edge that schedules the next one), so the kernel sees the
  next edge coming (`stopBefore`, [simulation.md](simulation.md#running); R14) — a part whose
  edges a debugger should step by schedules them as delayed drives too, not as zero-delay
  drives from a timer.
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

## Net labels (`net/*`)

`net/label` (`src/library/net`): a flag with a name and one connection point. Every label of
one name — and every VCC or GND symbol for the names `VCC`, `GND` — is one net, so distant parts
connect without a wire between them (KiCad's net label, Logisim's tunnel). Schematic-only: it
is drawn and connects, never simulated. Scope: its circuit; in a subcircuit's instances the
power names stay global (R11a, [circuit.md](circuit.md#subcircuits)).

| Pins       | Props           | Notes                                                                   |
| ---------- | --------------- | ----------------------------------------------------------------------- |
| `N` (`nc`) | `name` (`NET1`) | `net: name`; designator `NL`, not drawn; symbol `net-label`, `centered` |

- **Names** (`NET_NAME` in core): letters, digits, `_ + - / #`, and `~{…}` for an overline as in
  KiCad (`~{CLR}` → C̅L̅R̅, `~{CS}1` → C̅S̅1, `netNameRuns` in core), at most 32 characters,
  case-sensitive. No whitespace, no `.` (netlists address pins as `U1.Y`), no `[` `]` (they make
  bus names). A name's identity is its text: `~{CLR}` and `CLR` are different nets.
- **Bus labels**: a label named like a bus (`BUS_NAME`: a net name, then a range of indices
  0…99 either way round, `D[0..7]`, `A[15..0]`, at most 32 characters) is a bus label: its pin
  is a bus pin with `net: name`, so it sits on a bus line, names that bus and joins every bus
  of that name ([circuit.md](circuit.md#buses)). One Net Label tool for both, as in KiCad; the
  outline is drawn in the bus color, and while simulating a tag after it shows the bus value
  (`0x3F`; a nibble whose bits all float `Z`, any other unknown `X` — `busValueText`).
- **Drawing**: an outlined tag pointing at its connection point (one cell out, like every pin
  stub), the name inside in a monospaced font; the body is as wide as the name
  (`netLabelWidth`) and one cell high, `centered` on the pin's row, so labels stack on adjacent
  DIP pins.
- **Next name** (`nextNetName`, through `nextProps`): the trailing number incremented, keeping
  its width (`D0` → `D1`, `A09` → `A10`); a name without one stays (`CLK`, `D[0..7]`).

`net/bus-entry` (`src/library/net`): one bit leaving a bus, KiCad's 45° bus entry carrying its
member's name. Its bit end joins the net of its name like a net label; its bus end sits on a
bus line. Schematic-only.

| Pins                          | Props         | Notes                                                     |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| `N` (`nc`), `B` (`nc`, `bus`) | `name` (`D0`) | `N`: `net: name`; designator `BE`, not drawn; `bus-entry` |

- **Drawing**: body 1 × 1 with `N` on the left at offset 0 and `B` on the right at offset 1: the
  bit end at (0, 0), the bus end at (3, 1) — a stub, a diagonal across the body, a heavy bus
  stub; its name in small text above the bus stub, upright.
- **Placing**: by its bit end (schematic-only parts are placed by their first pin), each named
  after the last (`D0` → `D1`): clicking down a chip's adjacent data pins puts `D0`…`D7` on
  them without wires, their bus ends in one column for a single bus line through them; `F`
  before placing for a chip's left side. Gaps (the 28C16's GND between D2 and D3) need nothing
  special.
- Names are net names, not bus names. An entry on a named bus whose name isn't a member is a
  `bus-entry-member` warning.

### Ports (`net/port`)

`net/port` (`src/library/net`, R11a): a subcircuit's interface pin, KiCad's hierarchical
label. Like a net label it joins the net — named like a bus, the bus — of its name in its
circuit; an instance of that circuit then has a pin of that name, which joins whatever the outer
circuit connects to it ([circuit.md](circuit.md#subcircuits)). Electrically every port is a plain
connection, as a board's connector is; its direction shapes the flag, says where `auto` puts the
pin and feeds the design checks. Schematic-only; declared through `ComponentDefinition.port`.

| Pins       | Props                                                                    | Notes                                                             |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `N` (`nc`) | `name` (`PORT1`), `direction` (`in`, `out`, `bidir`), `side` (`auto`, …) | `net: name`; designator `P`, not drawn; symbol `port`, `centered` |

- **Names**: net or bus names, as a net label's. A port named like a bus is a **bus port**: its
  pin is a bus pin, and the instance's pin of that name a bus pin whose bits join the outer bus
  bit by bit.
- **Side**: where the instance symbol puts the pin — `left`, `right`, `top`, `bottom`, or
  `auto` (inputs left, outputs and bidirectional ports right).
- **Drawing**: a flag one cell high, `centered` on the pin's row, wide enough for a point at both
  ends (`portWidth`), so changing the direction moves nothing: an input points into the circuit
  (at its connection point), an output away from it, a bidirectional port both ways; a heavier
  outline than a label's (a bus port's in the bus color) and the name in bold; a bus port shows
  the bus value while simulating.
- **Placing**: Place ▸ Port (`Shift+L`), by its connection point; each named after the last
  (`D0` → `D1`) with the same direction and side.
- **Checks** ([circuit.md](circuit.md#design-checks)): two ports giving one name (`CLK` twice,
  `D3` beside `D[0..7]`) are a `duplicate-port` error; an input or bidirectional port counts as
  a driver of its nets, so inputs fed by ports aren't `undriven-input`; a name a port gives is
  never a `single-net-label`.

## Graphics (`draw/*`)

Parts that are only drawn: schematic-only and without pins, so the compiler leaves them out of
the netlist and the design checks never see them, while placing, moving, rotating, copying,
undo and saving work as for any part ([ADR-0029](adr/0029-schematic-graphics.md)). Their
designators are never drawn. Hit-testing tries them last, so they never take a click from a part
or a wire under them ([editor.md](editor.md#hit-testing-and-selection)).

`draw/text` (`src/library/draw`): a block of free text — a title, a description, a program
listing ([editor.md](editor.md#schematic-text)).

| Pins | Props                                                                                               | Notes                                      |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| —    | `text` (`Text`, `multiline`), `size` (`small`, `normal`, `large`, `title`), `font` (`sans`, `mono`) | designator `TXT`, not drawn; symbol `text` |

- **Size**: the font size in cells (`TEXT_SIZES`: 0.5, 0.7, 1, 1.5); lines are 1.25 font
  sizes apart (`TEXT_LINE_HEIGHT`), 0.2 cells in from the box's left edge (`TEXT_PADDING`).
- **Box** (`textBlockSize`): whole cells, at least 1 × 1 — the lines' height and the widest
  line plus the padding on both sides. The pure layers have no font metrics, so widths are
  estimated (`lineWidth`): 0.6 font sizes a character in the monospaced font (exact), a table
  of character classes for the sans-serif one, following the system UI font at 10 px and
  rounding up (wider than drawn at larger sizes, up to ~5 % narrower at 7 px). Lines split at
  `\n` (`\r\n` too), tabs stop every four columns (`textLines`).
- **Drawing**: the lines from the box's top-left corner, in the part text color, without an
  outline (`SymbolGraphics.textBlock`): upright whatever the placement, the lines in order.

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

### Edge-triggered chips

R09a adds the flip-flops and registers, from the Nexperia data sheets (typical delays at 4.5 V /
50 pF; the guaranteed minima the timing checks use):

| Type           | Function                                          | Package | Delays (ns)                     | Minima (ns)                               |
| -------------- | ------------------------------------------------- | ------- | ------------------------------- | ----------------------------------------- |
| `74xx/74hc74`  | dual D flip-flop, set and reset; rising edge      | DIP-14  | CP 17, SD 18, RD 19             | tsu 15, th 3, tW 20, trec 8               |
| `74xx/74hc107` | dual JK flip-flop, reset; falling edge            | DIP-14  | CP 19, R 19                     | tsu 20, th 3, tW 16, trec 12              |
| `74xx/74hc109` | dual JK̅ flip-flop, set and reset; rising edge     | DIP-16  | CP 18; SD 11/15, RD 15/14 (Q/Q̅) | tsu 14, th 5, tW 16, trec 14              |
| `74xx/74hc112` | dual JK flip-flop, set and reset; falling edge    | DIP-16  | CP 20, RD 21, SD 18             | tsu 16, th 0, tW 16, trec 16              |
| `74xx/74hc173` | quad D register, data enables, MR (HIGH), 3-state | DIP-16  | CP 20, MR 16, ten 19, tdis 19   | tsu 12 (E 20), th 1 (E 0), tW 16, trec 12 |
| `74xx/74hc175` | quad D register, Q and Q̅, MR                      | DIP-16  | CP 20, MR 18                    | tsu 16, th 5, tW 16, trec 5               |
| `74xx/74hc273` | octal D register, MR                              | DIP-20  | CP 15, MR 16                    | tsu 12, th 3, tW 16 (MR 12), trec 10      |
| `74xx/74hc374` | octal D register, 3-state                         | DIP-20  | CP 18, ten 15, tdis 18          | tsu 12, th 5, tW 16                       |
| `74xx/74hc377` | octal D register, data enable                     | DIP-20  | CP 16                           | tsu 12 (E 12), th 3 (E 4), tW 16          |
| `74xx/74hc574` | octal D register, 3-state, flow-through pinout    | DIP-20  | CP 17, ten 16, tdis 14          | tsu 12, th 5, tW 16                       |

- **Two engines** in `src/library/74xx`: `flip-flops.ts` (`FlipFlopSpec`: dual flip-flops with
  their edge, D/JK/JK̅ next state and asynchronous inputs) and `registers.ts` (`RegisterSpec`:
  a common clock with an optional MR of either polarity, data enables, complement outputs and
  3-state outputs). Helpers in `edge-triggered.ts` (strict/uncertain edges, merging outcomes,
  `jkNext`; R09b: `countInto`, `allAt`, `mergeInto`) serve the counters and shift registers
  too.
- **Power-on**: every stored bit is `X` until a set/reset or a clean load (like the 4511 and the
  555: "your register has no reset").
- **Uncertain edges** (`0 → X`, `X → 1`, `Z` on the clock) make `X` only the bits a load would
  change; an unknown data enable loads `X` where D differs from the stored bit; an unknown
  set/reset merges both outcomes.
- **Set and reset together** give what the data sheet says (74, 109: Q = Q̅ = H; 112: Q = H,
  Q̅ = L — its logic diagram derives both from one node); the stored bit is `X` meanwhile, so
  releasing both at once leaves it unknown, as the data sheets warn.
- **3-state registers** load while their outputs are disabled; outputs follow the enables after
  `ten`/`tdis`, an unknown enable drives `X` (it might be driving).
- **Pins**: complement outputs are named `…N` and drawn overlined (`1QN` shown `1Q̅`, the 151's
  rule); falling-edge clocks are drawn overlined (`clock` + `activeLow`, their description says
  HIGH-to-LOW); clock pins carry the `clock` flag, so the DIP drawing gives them a triangle.
- **Function tables** are the data sheets' sequential tables (`↑`, `h`, `q̅`, …, above), checked
  on every unit and every bit through pin numbers.
- **Scenarios** (`tests/scenarios/sequential-74hc.test.ts`): a 74 shift chain (Q changes 17 ns
  after the edge, so the next stage's 3 ns hold is met; at 30 MHz every clock reports its pulse
  width), a 107 ripple counter (15 → 0 ripples through 19, 38, 57, 76 ns), a race between data
  and clock through one 74HC08 caught by the set-up check, Ben Eater's A register on a bus.

### Timing checks

Edge-triggered chips check the circuit against their data sheet's minima (`TimingChecks` in
`core`, [simulation.md](simulation.md#timing-checks)) and report `setup-violation`,
`hold-violation`, `pulse-width-violation`, `recovery-violation` and (the LCD's `tcycE`)
`cycle-violation` diagnostics on the pin at fault: `1D changed 9 ns before 1CP rose (setup time
≥ 15 ns)`. They are **errors** in the Simulation tab: on a board they are intermittent failures.
So is every other `*-violation` a part reports (the LCD's `busy-violation`,
`power-on-violation`): `diagnosticSeverity` makes the suffix the rule.

A violation also makes the bits the edge may have loaded **`X`**, until a set/reset or a clean
load — a chip that may go metastable, and the same rule as an uncertain edge
([ADR-0014](adr/0014-timing-checks.md)):

| Violation                             | Becomes `X`                                        |
| ------------------------------------- | -------------------------------------------------- |
| data set-up (changed within `tsu`)    | that bit                                           |
| data hold (changed within `th` after) | that bit, if the new data would load another value |
| enable set-up or hold                 | the bits where loading or not differ               |
| short inactive clock phase, recovery  | the bits the edge would change                     |
| short active clock phase              | the bits the edge before it changed                |
| short set/reset pulse                 | the bits the pulse changed                         |

The clock's checks are **armed** only while the clock matters: not while a set/reset holds the
chip, and the data's not while loading is disabled — a clock running under a held reset is no
fault. The 74HC4511 checks its LE the same way (code set-up 12 ns, LE LOW width 16 ns).

### Counters and shift registers

R09b adds the counters and shift registers, from the Nexperia data sheets, on R09a's timing
checks and `X` policy:

| Type            | Function                                                      | Package | Delays (ns)                                        | Minima (ns)                                            |
| --------------- | ------------------------------------------------------------- | ------- | -------------------------------------------------- | ------------------------------------------------------ |
| `74xx/74hc161`  | 4-bit binary counter, synchronous load, asynchronous MR̅       | DIP-16  | CP→Q 22, CP→TC 25, CET→TC 12, MR 23                | tsu D 16, PE̅ 20, CEP/CET 34; th 0; tW 16; trec 20      |
| `74xx/74hc163`  | 4-bit binary counter, synchronous load and MR̅                 | DIP-16  | CP→Q 20, CP→TC 25, CET→TC 13                       | tsu D/MR̅ 16, PE̅ 16, CEP/CET 35; th 0; tW 16            |
| `74xx/74hc191`  | 4-bit up/down counter, CE̅, U̅/D, asynchronous load PL̅          | DIP-16  | CP→Q 26, CP→TC 30, CP→RC̅ 17, PL̅/D→Q 22             | tsu U̅/D 41, CE̅ 28, D→PL̅ 20; th 0; tW 25, PL̅ 20; trec 7 |
| `74xx/74hc193`  | 4-bit up/down counter, two clocks, MR, asynchronous load PL̅   | DIP-16  | CPU/CPD→Q 23, →TC̅U/TC̅D 14, PL̅ 25, MR 21            | tsu D→PL̅ 16; th other clock 16; tW 20; trec 10         |
| `74xx/74hc4040` | 12-stage binary ripple counter, falling edge, MR (HIGH)       | DIP-16  | CP̅→Q0 17, then 10 per stage (Q11 127), MR 22       | tW 16, MR 16; trec 10                                  |
| `74xx/74hc164`  | 8-bit serial-in, parallel-out shift register, DSA · DSB, MR̅   | DIP-14  | CP→Q 15, MR̅ 14                                     | tsu 12, th 4; tW 16, MR̅ 12; trec 12                    |
| `74xx/74hc165`  | 8-bit parallel-in (asynchronous PL̅), serial-out, CP + CE̅      | DIP-16  | CP/CE̅→Q7 19, PL̅ 18, D7 13                          | tsu DS 16, CE̅↔CP 16, D→PL̅ 16; th 5; tW 16; trec 20     |
| `74xx/74hc595`  | 8-bit shift register + storage register, 3-state outputs, Q7S | DIP-16  | SHCP→Q7S 19, STCP→Q 20, MR̅→Q7S 17, ten 17, tdis 15 | tsu DS 10, SHCP→STCP 15; th 3; tW 15; trec 10          |

- **Synchronous counters** (`counters.ts`, `SyncCounterSpec`): on the rising clock edge the
  163's MR̅ clears, else PE̅ LOW loads D0–D3, else CEP · CET counts; TC = CET · (count = 15),
  for cascading (TC → the next counter's CET). The 161's MR̅ clears at once and holds the
  clock's checks disarmed.
- **Up/down counters** (`up-down-counters.ts`): PL̅ LOW loads D asynchronously (Q follows D;
  a bit changed within `tsu(Dn to PL)` before PL̅ rises is `X`). The 191 counts on CP while CE̅
  is LOW, up with U̅/D LOW (only U is overlined: LOW counts up); TC is HIGH at 15 up / 0 down,
  RC̅ LOW while TC is HIGH and CE̅ and CP are LOW (to clock the next stage). The 193 counts up
  on a rising CPU while CPD is HIGH, down on a rising CPD while CPU is HIGH; MR (HIGH) clears
  over PL̅; TC̅U is LOW while CPU is LOW at 15, TC̅D while CPD is LOW at 0.
- **Usage rules as timing checks**: the 191's data sheet says CE̅ may rise only while CP is
  HIGH and U̅/D may change only while CE̅ or CP is HIGH (a set-up violation; the gated clock may
  count, or the next count's direction is unknown: `X` where the outcomes differ). The 193's
  other clock must be HIGH at the counting edge and stay HIGH 16 ns after it
  (`th(CPU to CPD, CPD to CPU)`): a clock rising while the other is LOW is a hold violation
  (its logic diagram then counts partially: `X` where counting or not differ), both rising
  together where up and down differ. A clock held by MR or PL̅ checks nothing.
- **Ripple counter** (`ripple-counter.ts`, `RippleCounterSpec`): the 4040 stores the count at
  the falling edge, but output Qn changes `tpd(CP to Q0) + n · tpd(Qn to Qn+1)` after it, so
  `0111 → 1000` passes through `0110`, `0100`, `0000` as on the chip — gates decoding the
  outputs glitch. A divider with MR tied LOW stays `X` until a reset, like every counter here.
- **Shift registers** (`shift-registers.ts`): the 164 shifts DSA · DSB into Q0 (either input
  gates the other; a late one shifts in `X` only where it could change the AND). The 165's
  internal clock is CP + CE̅ (the data sheet's ≥1: the pins are interchangeable), so CE̅ rising
  while CP is LOW shifts; each must be LOW around the other's edge (`tsu`/`th(CE to CP, CP to
  CE)`). PL̅ loads all eight stages asynchronously; only Q7 and Q̅7 come out. Function tables
  name internal stages as display-only columns (`Q1–Q6`); `checkableRows(table, displayOnly)`
  skips their text, and state letters may have digits (`q7`).
- **74HC595**: SHCP shifts DS into the shift register (MR̅ clears it, not the storage
  register), STCP copies it into the storage register, which drives Q0–Q7 while OE̅ is LOW
  (storing goes on while they float); Q7S is the shift register's last stage, always driven,
  for cascading. With SHCP and STCP tied together the storage register takes the contents from
  before the shift — the data sheet's "one clock pulse behind" (Q3 of R09b), also when STCP
  rises in a later delta of the same instant. STCP rising later but within
  `tsu(SHCP to STCP)` = 15 ns is a set-up violation (`SHCP rose 14 ns before STCP rose …`) and
  stores `X` where the old and new contents differ.
- **Scenarios** (`tests/scenarios/counters-74hc.test.ts`): two 161s cascaded TC → CET count
  0 to 255 (a 50 ns clock beats the 25 ns carry: CET set-up reported, the high count `X`); a
  NOR decoding a 4040's Q0–Q2 sees count 0 for 10 ns on the way from 3 to 4; two 595s cascaded
  through Q7S; a 165 sending a byte into a 595 on one clock. The carry-over property runs random
  networks of all eight chips. Benchmark: a chain of 100 595s runs at ≈ 6.4M events/s.
- **Examples**: Shift Register LEDs (a 74HC595 with SHCP and STCP tied to a 2 Hz clock and
  Q7S inverted by a 74HC04 into DS — a Johnson counter; the LED bar is the storage register,
  one step behind the Q7S LED; CLEAR first) and SAP-1 Program Counter (Ben Eater's 74HC161 and
  74HC245 on a 4-bit bus with a DATA switch stand-in: CLR, CE, J, CO). Both were laid out by a
  throwaway `CircuitBuilder` generator that checked every net.
- **Delays the data sheets lack** borrow a given path: the 191's TC and RC̅ after a parallel
  load use `tpd(PL to Qn)` / `tpd(Dn to Qn)`; the 193's terminal count changed by the other
  clock uses `tpd(CPU, CPD to Qn)`.
- **Unknown or late controls** merge every mode they allow (reset, load, count, hold): only the
  bits where those outcomes differ become `X` (PE̅ unknown at 5 with D = 6: load and count agree,
  nothing is lost). Counting from an `X` count gives `X` where the carry reaches
  (`countInto`).
- **Function tables** keep the data sheets' text (`count`, the footnote `[1]` of TC);
  `checkableRows` gives the checker the rows it can run, the tests do the rest by hand. The
  163's data sheet has TC L in rows where its own note says TC = CET at 15: written as the
  161's.

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

## Memories (`mem/*`)

R12a: memory chips as their data sheets describe them ([ADR-0017](adr/0017-memories.md)), in
`src/library/mem`. Data sheets: Atmel/Microchip for the EEPROMs, Renesas (IDT) for the 6116,
Alliance Memory for the 62256.

| Type           | Part               | Organization   | Package | Read (max)                     | Notes                                            |
| -------------- | ------------------ | -------------- | ------- | ------------------------------ | ------------------------------------------------ |
| `mem/at28c16`  | AT28C16-15         | 2K × 8 EEPROM  | DIP-24  | tACC 150, tCE 150, tOE 70 ns   | read as a ROM; `contents` image                  |
| `mem/at28c64b` | AT28C64B-15        | 8K × 8 EEPROM  | DIP-28  | tACC 150, tCE 150, tOE 70 ns   | the current part (the plain AT28C64 is not made) |
| `mem/at28c256` | AT28C256-15        | 32K × 8 EEPROM | DIP-28  | tACC 150, tCE 150, tOE 70 ns   | the -20/-25/-35 grades are military only         |
| `mem/6116`     | 6116SA/LA 15/20/25 | 2K × 8 SRAM    | DIP-24  | tAA 15/19/25, tACS 15/20/25 ns | `speed` (25 ns by default), `powerOn`            |
| `mem/62256`    | AS6C62256-55       | 32K × 8 SRAM   | DIP-28  | tAA 55, tACE 55, tOE 30 ns     | `powerOn`; Alliance's names `DQ0`…`DQ7`, `VSS`   |

- **Pins**: data sheet names, the data pins named `IO0`…`IO7` and drawn `I/O0`… (no `/` in pin
  names: instance paths use it), `DQ0`…`DQ7` on the AS6C62256; `CE̅`/`CS̅`, `OE̅`, `WE̅` active LOW, data pins `bidir`.
  The mode tables are `functionTable`s with text cells (`Dout`, `Din`), checked by hand.
- **Reads** (`ReadPath` in `memory.ts`), with the outputs driving while `CE̅` and `OE̅` are LOW
  (and, for a RAM, `WE̅` HIGH):
  - after an address change the old data for `tOH`, then `X`, the new data `tACC`/`tAA` after
    the change;
  - after `CE̅` or `OE̅` falls, floating until `tCLZ`/`tOLZ` (0 when the data sheet gives none:
    the EEPROMs), then `X`; the data is valid at the latest of the address, chip enable and
    output enable deadlines (so `OE̅` may come `tACC − tOE` after the address for free);
  - after a disable (`CE̅`/`OE̅` rising, a RAM's `WE̅` falling) the outputs keep driving what they
    drove until the maximum release time (`tDF`, `tCHZ`, `tOHZ`, `tWHZ`; from the first control
    that turned them off), then float: a driver turning on sooner fights them (contention);
  - unknown address bits merge the cells they could select (each bit known where the cells
    agree; more than 8 unknown bits: all `X`); an unknown enable that might drive drives `X`.
  - The address is read only while the outputs drive: a deselected chip on a floating bus
    reports nothing.
- **RAM writes** (`WritePath` in `write.ts`): under way while `CS̅` and `WE̅` are LOW; the cell
  takes the data present when the first rises. Changes at the same instant as a write's start
  count as before it, at the same instant as its end as after it (`tAS`, `tWR`, `tDH` of 0 are
  met by them). The data sheet's requirements, as timing violations on the pin at fault:

  | Requirement                         | Violated when                                        | Becomes `X`                          |
  | ----------------------------------- | ---------------------------------------------------- | ------------------------------------ |
  | `tAS` address set-up                | the address changed less than `tAS` before the start | the cells at the old and new address |
  | address stable during the write     | the address changes while the write is under way     | the cells at the old and new address |
  | `tAW` address valid to end of write | the address changed less than `tAW` before the end   | the cells at the old and new address |
  | `tWR` write recovery                | the address changes less than `tWR` after the end    | the cells at the old and new address |
  | `tWP` write pulse (CS̅ and WE̅ LOW)   | the write lasted less                                | the written cell                     |
  | `tCW` chip select to end of write   | `CS̅` was LOW for less when the write ended           | the written cell                     |
  | `tDW` data set-up                   | a data bit changed less than `tDW` before the end    | that bit                             |
  | `tDH` data hold                     | a data bit changes less than `tDH` after the end     | that bit, where it differs           |

  A real chip may also write the addresses an address change passes through; only the old and
  new address are marked. The 6116's note 7 (with `OE̅` LOW the pulse must last `tWHZ + tDW`)
  needs no check of its own: the outputs drive the cell's data until `tWHZ`, so the bits that
  differ change late and miss `tDW`. Floating data is reported when the write ends, not while
  the bus turns round. An unknown `CS̅` or `WE̅` that might write merges the data into the cell
  (unknown where they differ); unknown address bits do so for every cell they could select;
  unknown data bits are stored `X`. Before `CS̅` and `WE̅` were first known after power-on, an
  unknown write is no write (every gate output starts `X` for its first delay).
- **EEPROMs** read as ROMs: their contents come from the `contents` image (erased: `0xFF`). A
  write the circuit attempts — `WE̅` (or `CE̅`) falling while the other is LOW and `OE̅` HIGH, the
  data sheet's byte write — is reported (`write-ignored`, a warning: "EEPROM writes are not
  simulated: the write to 0x005 was ignored") and changes nothing; the data sheet's write
  inhibit (`OE̅` LOW, `CE̅` or `WE̅` HIGH) is no attempt. Write cycles are backlog.
- **Power-on** (`powerOn`, RAMs): `x` (default: every bit unknown until written), `zeros`,
  `random` (`SeededRandom` seeded from the designator's hash: the same bytes in every run,
  different ones in two RAMs). The state's cells are typed arrays (`data`, `unknown` with a set
  bit per unknown bit), moved by the carry-over.
- **Debug write**: a RAM takes the action `{ type: 'poke', address, data: number[] }` at the
  current instant: the cells change at once, outputs reading them follow through the read path
  (`X`, then the data after `tAA`). ROM contents change through the image (a document edit). A
  Verilog module's memory takes the same with its `memory` name (HDL-6; `pokeOf`).
- **Inspection**: `memory: { words, width, volatile, addressPins, view(state) }` on the
  definition (the registry checks that `2 ** addressPins.length` is `words` and that they are
  input pins). A Verilog module lists named `memories` instead (HDL-6,
  [ADR-0036](adr/0036-memories-in-modules.md)): words of up to 32 bits (`data` and `unknown` a
  `Uint32Array`), a first address (`offset`), no address pins, and `powerUp` contents a stopped
  inspector shows; `memoriesOf(definition)` gives either. The view is the instance's cells (`data`, `unknown`) and their **access stamps**
  (`readAt`, `writtenAt`: the simulated time each cell was last read and written, `-Infinity`
  never), read without copying. A read is stamped when the outputs drive a cell's data for one
  known address (merged unknown addresses stamp nothing); a write when a write of the circuit
  stores a cell or makes it `X` (a maybe-write, a violation, data held too short) and on a
  `poke`. One store per access: the memory benchmark lost ≈ 1 % (R12b). The Memory tab lights
  up the cells touched since its last frame ([editor.md](editor.md#memory-inspector)).
- **Tests** (`src/library/mem/*.test.ts`): pinouts by number from the data sheets' figures, every
  read path's limits measured (`changes` lists a pin's changes with their times), the window,
  unknowns, each write requirement just inside (silent, stored) and just outside (reported,
  `X`), with a test part for the requirements the 6116 has as 0; mutation-checked. Scenarios
  (`tests/scenarios/memory.test.ts`): a 6116 written and read back through a 74HC245 (with `OE̅`
  following WRITE the RAM fights the 245 for 5 ns), an AT28C16 decoding hex for a 7-segment
  display, a 74HC574 clocked before `tAA` latching `X`; the carry-over property runs random
  networks of memories. Benchmark: a 74HC4040 sweeping sixteen 6116s, ≈ 7.5M events/s.
- **Examples**: EEPROM 7-Segment Decoder (an AT28C16 lighting the hex digit of four switches)
  and RAM by Hand (a 6116 written from switches through a 74HC245 in PROGRAM mode and read back
  onto LEDs).

### Image files

`src/core/image-files.ts` (R12b): memory images as EEPROM programmers and assemblers write them,
read into chunks of bytes at their addresses and placed into a memory. Pure, so the Memory tab,
test benches (`b.loadIntelHex`, R15a) and the toolchain (R19) share it.

- **Binary** (`.bin`, `.rom`): every byte from address 0. An empty file is refused.
- **Intel HEX** (`.hex`, `.ihx`, `.ihex`, `.mcs`): records 00 (data), 01 (end of file), 02
  (extended segment address, ×16), 04 (extended linear address, ×65536), 03 and 05 (start
  address: kept as `start`, not used). Every record's checksum is checked; a record's data wraps
  within its 64 KB segment, as the format says; blank lines are skipped and anything after the
  end record ignored. A bad file is refused with its line: `line 1: checksum 0xBE, expected
  0xBD`, `line 2: overlaps the data of line 1 at 0x0011`, `no end-of-file record`.
- **Detection** (`detectImageFormat`): Intel HEX by extension, else when the first line is a hex
  record; binary otherwise.
- **Summary** (`summarizeImage`): the lowest and highest address, the byte count and the 16-bit
  sum of the bytes (the checksum programmer software shows).
- **Placing** (`placeImage(file, words, { at, eraseRest })`): the file's lowest address lands at
  `at` and the rest keeps its layout; with `eraseRest` the result is the whole memory with the
  file's bytes on erased (`0xFF`) ground; a file that doesn't fit is refused with the reason.
  `suggestedLoadAddress` is the lowest address modulo the memory's size — a chip whose upper
  address lines aren't connected sees it there (a BE6502 ROM assembled for 0x8000 lands at 0 in
  an AT28C256). The writes go into a ROM's image (`applyImageWrites`) or are poked into a RAM.
- **Writing**: `writeIntelHex(bytes, { base, omitErased })` — 16 data bytes per record aligned to
  16, an 04 record whenever the upper address bits change (none below 64 KB), uppercase, `\n`
  line ends, optionally leaving out records of `0xFF`; `memoryBytes(data, unknown)` gives a
  memory's bytes with unknown bits as 0 and counts the bytes that had any.
- **Tests** (`image-files.test.ts`): Wikipedia's Intel HEX example read and written back, every
  record type, wrapping, errors with their lines, placing and refusing, and a round trip of
  random sparse images up to 64 KB through Intel HEX (with a base and erased records left out)
  and binary; mutation-checked.

## CPUs (`cpu/*`)

Processors as their data sheets describe them, in `src/library/cpu`; their registers through
`cpu` definitions (`CpuDef`, [simulation.md](simulation.md#observability)). Decision:
[ADR-0028](adr/0028-cpu-model.md).

### W65C02S

`cpu/w65c02s` (R17a): the WDC W65C02S, DIP-40, the 5 V column (14 MHz). Data sheet: WDC W65C02S,
April 8, 2022 (§3 pin functions, Figure 3-1 pinout, Table 5-2 opcode matrix, Table 6-3 AC
characteristics, Figure 6-3 timing, Table 7-1 differences from the NMOS 6502).

**Pins** (Figure 3-1, names as WDC writes them: a `B` suffix is active LOW):

| No.         | Pin          | Dir      | What                                                                |
| ----------- | ------------ | -------- | ------------------------------------------------------------------- |
| 9–20, 22–25 | A0–A15       | tristate | address bus; released while BE is LOW                               |
| 33–26       | D0–D7        | bidir    | data bus                                                            |
| 34          | RWB          | tristate | HIGH read, LOW write; released while BE is LOW                      |
| 37          | PHI2         | in       | the clock                                                           |
| 3, 39       | PHI1O, PHI2O | out      | PHI2 inverted / in phase, 10 ns later (an estimate: no data sheet)  |
| 7           | SYNC         | out      | HIGH during opcode fetches                                          |
| 1           | VPB          | out      | LOW while a vector is read                                          |
| 5           | MLB          | out      | LOW during a read-modify-write's modify and write cycles            |
| 2           | RDY          | bidir    | LOW halts the CPU (reads and writes); `WAI` drives it LOW           |
| 4, 6        | IRQB, NMIB   | in       | interrupt request (level, masked by I), non-maskable (falling edge) |
| 40          | RESB         | in       | reset: LOW for at least two cycles, then a seven-cycle sequence     |
| 36, 38      | BE, SOB      | in       | bus enable (asynchronous); set overflow (a falling edge sets V)     |
| 8, 21, 35   | VDD, VSS, NC | power/nc | not simulated                                                       |

**Timing** (Table 6-3, limits only as for memories): outputs valid `tADS` ≤ 30 ns after PHI2
falls and held `tAH` ≥ 10 ns; write data valid `tMDS` ≤ 25 ns after PHI2 rises, held `tDHW` ≥
10 ns after it falls; read data set-up `tDSR` and hold `tDHR` ≥ 10 ns; IRQB, NMIB, RDY, RESB,
SOB set-up `tPCS` and hold `tPCH` ≥ 10 ns; PHI2 `tPWH`, `tPWL` ≥ 35 ns, `tCYC` ≥ 70 ns (no
maximum: a static design); BE to valid or released data `tBVD` ≤ 25 ns.

**A bus cycle on the pins**: PHI2 falling ends a cycle — the data bus (in a read) and the control
inputs are sampled, set-up and hold checked; the core moves on `tDHR` later; outputs that change
keep their level until `tAH`, are `X` until `tADS`, then show the new cycle (lines that keep
their level don't move). PHI2 rising starts a write's data: `X`, the data at `tMDS`, released
`tDHW` after PHI2 falls. SOB is sampled when PHI2 rises.

**Instructions**: all 256 opcodes (`w65c02s-opcodes.ts`: Table 5-2's 212 and Table 7-1's
reserved NOPs) with the bus cycles of the chip — dummy reads, the last instruction byte re-read
when indexing crosses a page, read-modify-write's two reads, `JMP (a)` reading its pointer's high
byte without the carry and then with it, `INC`/`DEC a,x` always seven cycles, decimal mode's
extra cycle with valid N, Z. Checked against SingleStepTests 65x02 `wdc65c02` (all 2.54M cases,
every cycle; `pnpm test:65c02`), except where the data sheet says otherwise: `5C` is 8 cycles
(Table 7-1); the decimal-mode cycle of `ADC #`/`SBC #` reads at PC.

**Control**: RESB LOW for at least two cycles (shorter: `pulse-width-violation`, the CPU lost),
then two reads at PC, three stack reads (where an interrupt would push), `$FFFC`/`$FFFD` with
VPB LOW; D = 0, I = 1, the other registers as before. IRQB and NMIB start the interrupt sequence
after the current instruction (an IRQ waiting during `CLI` or `PLP` comes one instruction
later); `BRK` pushes B set. `WAI` waits with RDY driven LOW (tied straight to VCC: contention —
use a pull-up) until IRQB or NMIB (with I set it goes on without the interrupt); `STP` stops
until RESB. RDY LOW at PHI2 falling halts the CPU in the cycle, address and data held.

**Unknowns** (ADR-0028): registers keep unknown-bit masks; logic is exact per bit, sums unknown
from the lowest unknown bit up; unknown data is stored and driven as `X`. When the next step
depends on unknown bits — an opcode, a branch, the program counter, a page crossing, D in
`ADC`/`SBC`, an interrupt that may be taken, an unknown RDY, RESB or PHI2 — the CPU is lost: `X`
on its outputs (the data bus while PHI2 is HIGH), a `cpu-lost` error ("U1 fetched an opcode with
unknown bits at 0x0300: its state is unknown until RESB"), back only with RESB. Power-on is lost
without a report until the first reset.

**Inspection**: `cpu` — registers `A`, `X`, `Y`, `S`, `PC`, `P` (`NV-BDIZC`), the mode and the
instruction under way.

**Tests** (`src/library/cpu/*.test.ts`): the opcode table against Tables 4-1, 5-2, 7-1; the core
on a committed SingleStepTests sample (8 cases per opcode) and by hand (decimal boundaries,
`JMP ($xxFF)`, MLB, VPB, reset, interrupts, `WAI`/`STP`, unknowns); the part on a bench (pinout,
every window measured, each requirement 1 ns inside and outside, RDY, BE, NMIB, SOB, a lost CPU
and its reset); mutation-checked. Scenarios (`tests/scenarios/cpu-6502.test.ts`,
`computer-6502.ts`): a W65C02S with an AT28C256, a 62256 and a 74HC00 running a program at 1
and 4 MHz without a diagnostic, lost in uninitialized RAM; the carry-over property on a running
CPU. Benchmark (`tests/bench/cpu.bench.ts`): ≈ 43 events a cycle, 8M events/s, 18 % of real
time at 1 MHz (M3 Pro). Examples: 6502 NOP Sled, 6502 ROM and RAM.

## Peripherals (`periph/*`)

Parts with a controller inside, in `src/library/periph`: the HD44780 character LCD and the
ST7789 TFT. The VIA and the ACIA follow in R18.

### HD44780

`periph/hd44780` (off the roadmap, ahead of R18): a character LCD module with the Hitachi
HD44780U controller — one part for every size, drawn as the module ([ADR-0022](adr/0022-character-lcd.md)).
Data sheets: Hitachi HD44780U, ADE-207-272(Z) Rev. 0.0 (controller, Table 4 fonts, Table 6
instructions, 5 V bus timing); Newhaven NHD-0216K1Z-FL-YBW rev. 13 (module pinout, Clear
display time).

**Pins** — the module's 16-pin header, along the bottom of the symbol at offsets 1–16 whatever
the size (resizing never moves a wire):

| No.   | Pin      | Dir       | What                                                                     |
| ----- | -------- | --------- | ------------------------------------------------------------------------ |
| 1–2   | VSS, VDD | power     | not simulated                                                            |
| 3     | V0       | in, sense | contrast: the characters show only while it is LOW (the drawer reads it) |
| 4     | RS       | in        | register select (0 instruction/busy flag, 1 data); pulled up inside      |
| 5     | RW (R/W̅) | in        | 0 write, 1 read; pulled up inside (floating = read: the module drives)   |
| 6     | E        | in        | a read while HIGH, a write when it falls; no pull-up                     |
| 7–14  | DB0–DB7  | bidir     | data bus, weak 1 while not driving (pull-ups); DB0–DB3 unused in 4-bit   |
| 15–16 | A, K     | in, sense | backlight LED: lit while A = 1 and K = 0                                 |

**Props**:

| Prop         | Default        | Values                                                                                                       |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `size`       | `16x2`         | `8x1`, `8x2`, `16x1`, `16x1-8x2`, `16x2`, `16x4`, `20x1`, `20x2`, `20x4`, `24x1`, `24x2`, `40x1`, `40x2`     |
| `backlight`  | `yellow-green` | `yellow-green`, `blue`, `white`, `black`, `amber`, `red` (dark or light dots, as the glass type has them)    |
| `rom`        | `A00`          | `A00` (Japanese standard: ASCII with ¥ → ←, katakana, Greek), `A02` (European: Latin-1, Greek, Cyrillic)     |
| `oscillator` | 270 kHz        | 190–350 kHz (the data sheet's Rf oscillator min/typ/max): execution times and the blink scale by 270 kHz / f |
| `powerOn`    | `reset`        | `reset` (the internal reset worked), `unknown` (it didn't: initialize by instruction)                        |

**Glass** (`hd44780-modules.ts`): the controller drives two lines of 40 characters; a module
wires each glass character to a line and a segment column. With 2 lines (`N = 1`) a character
shows DDRAM `(shift + column) mod 40` from 0x00 or 0x40; with 1 line (`N = 0`) line 1 is 80
characters from 0x00 and line 2 of the glass stays blank (a 16 × 2 left in the power-on 1-line
mode shows only its top line). 4-line modules continue lines 1 and 2: a 20 × 4's rows start at
0x00, 0x40, 0x14, 0x54, a 16 × 4's at 0x00, 0x40, 0x10, 0x50. `16x1-8x2` is the 16 × 1 wired
as 8 × 2 (0x00–0x07, then 0x40–0x47: it needs `N = 1`). DDRAM address `a` is cell `a` in 1-line
mode and `0x40 + k` is cell `40 + k` in 2-line mode.

**Controller** (`hd44780-controller.ts`, pure): DDRAM (80 bytes), CGRAM (64), the address
counter, display shift, `DL N F D C B I/D S`, the data register.

- Table 6's instructions take effect when the transfer completes, `tAH` = `tH` = 10 ns after E
  falls; BF stays 1 for the execution time — 37 µs, Return home and Clear display 1.52 ms (the
  data sheet leaves Clear's blank; module data sheets give 1.52 ms) — scaled by 270 kHz / f.
  Clear writes spaces, sets address 0, unshifts and sets I/D = 1 (S unchanged).
- After a data write or read the address counter moves; a busy-flag read shows the old address
  until `tADD` after BF clears (Figure 10's 1.5 / f, 5.6 µs at 270 kHz; Table 6 says 4 µs).
- Reads: the busy flag and address (RS 0, allowed while busy), or the data register (RS 1),
  loaded by an address set or cursor shift and after each data read; a read after a data write
  without one is invalid (`invalid-read`, a warning, the bus `X`).
- 2-line addresses wrap 0x27 → 0x40 → … → 0x67 → 0x00, 1-line 0x4F → 0x00, CGRAM 6 bits; a DDRAM
  address the mode lacks is reported (`invalid-address`) and stores nothing visible. `F = 1`
  with `N = 0` (5 × 10 dots) is accepted with a warning (`unsupported-font`): the glass has 5 × 8
  dots, so the top 8 rows show.
- 4-bit (`DL = 0`): two transfers on DB7–DB4, high nibble first, writes and reads alike; the
  nibble phase is state, so a CPU reset mid-byte leaves the module out of step until the
  program resynchronizes (0x3 three times, 0x2).
- Power-on `reset`: the internal reset — spaces, 8-bit, 1 line, 5 × 8, display off, increment,
  no shift — busy for 10 ms; CGRAM unknown (RAM). `unknown`: every register and cell unknown,
  the interface any of 8-bit / 4-bit high / 4-bit low; the data sheet's initialization by
  instruction (Figures 23, 24) resolves it after the third 0x3.

**Bus** (`hd44780.ts`) — the 5 V Bus Timing Characteristics as timing checks, and the LCD's own
requirements; every violation is an error:

| Requirement                  | Check                                                   | On violation                                           |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `tcycE` ≥ 500 ns             | E rise to rise (`cycle-violation`)                      | the transfer's byte unknown                            |
| `PWEH` ≥ 230 ns              | E HIGH (`pulse-width-violation`)                        | the byte unknown                                       |
| `tAS` ≥ 40 ns                | RS, R/W̅ before E rises (`setup-violation`)              | instruction or data, read or write: uncertain          |
| `tAH` ≥ 10 ns                | RS, R/W̅ after E falls, or changing while E HIGH         | uncertain (`hold-violation`)                           |
| `tDSW` ≥ 80 ns, `tH` ≥ 10 ns | DB before/after E falls, writes only (DB4–DB7 in 4-bit) | those bits unknown                                     |
| busy                         | a write or data read while BF = 1                       | `busy-violation`: not accepted (a read: `X`)           |
| power-on                     | a write or data read before 15 ms                       | `power-on-violation`; still ignored while busy (10 ms) |

Reads drive `X` from E rising until `tDDR` (160 ns), then the data, held `tDHR` (5 ns) after E
falls, then the pull-ups. E is read only when it changes (a 3-state output still off at
power-on is no floating E); an E changing to or from `X`/`Z` once it was known is reported
(`uncertain-enable`, a warning) and leaves the transfer open, uncertain, until E is known LOW.

**Unknowns** (ADR-0014: `X` where the outcome differs): every possible outcome of a transfer —
R/W̅ and RS when uncertain, the interface modes it may be in, accepted or not while it may be
busy, happened or not — runs exactly and the outcomes merge: registers that differ become
unknown, cell bits `X`; busy is certain until the earliest deadline, possible until the latest.
An instruction with up to 3 unknown bits runs once per value; with more, any instruction may
have run (every register, the cells a Clear would blank, the interface 8-bit or awaiting a high
nibble, maybe busy 1.52 ms).

**Glass and text** (`hd44780-frame.ts`): `hd44780Frame(controller, size, rom, blink)` gives each
glass character's 8 rows of 5 dots — ROM patterns, CGRAM for codes 0x00–0x0F (0x08–0x0F mirror
0x00–0x07; 5 × 10 mode: 4 characters 16 rows apart), the cursor in row 8, the blinking
character all on in its on phase (409.6 ms a phase at 250 kHz, scaled) — and which are unknown
(a code or CGRAM row with unknown bits; every character when D, N, F or the shift is unknown;
the cursor's when C or B is). `hd44780Text` gives the lines as text (ASCII, A00's ¥ → ← and
katakana; `·` for CGRAM and other codes, `?` unknown) for tests. The blink needs no kernel
event: the part's `animation` gives the phase length while B is on.

**Character ROMs** (`hd44780-font.ts`, generated): A00 and A02 read off Table 4 of the data
sheet by `scripts/extract-hd44780-font.ts` (`pdftoppm -r 400 -gray`, then dots on a lattice per
column — A00's columns A and B sit a third of a pitch right). A00's 0xE0–0xFF are 5 × 10 (in
5 × 8 mode their top 8 rows show, descenders cut); A02 uses the top row (accents, capitals from
row 1).

**Tests** (`src/library/periph/*.test.ts`): ROM spot checks against the rendered table; every
instruction, every size's addresses with shift, 4-bit transfers and the nibble phase, reads and
their window, the oscillator; each bus requirement at its limit and 1 ns past it, busy,
power-on, unknown bits and E; both power-on modes through Figures 23 and 24; mutation-checked.
Scenarios: a 74HC574 on the bus (a late latch, a read fighting it, 4-bit with DB0–DB3 open), a
data pin on E's own net (holds `X`, no ring), the carry-over property over random LCD networks,
both examples headless (`lcd-examples.test.ts`, the program in `lcd-program.ts`), and in the
browser (`tests/e2e/lcd.spec.ts`).

### ST7789

`periph/st7789` (LIB-2): a color TFT module with the Sitronix ST7789V controller on its 4-line
serial interface, one part for every panel, drawn as the module
([ADR-0031](adr/0031-tft-modules.md)). Data sheets: Sitronix ST7789V V1.3 (2014/03: Table 6,
Table 9, §8.4, §8.8, §8.12, §8.14, §9.1–9.2), the ST7789VW V1.0 for comparison (the same
commands plus BCh, BDh); the LCDWiki modules MSP2008 (2.0"), MSP1308 (1.3", 7 pins) and
MSP1141 (1.14"), with their panel specs (QDTFT2009, TFT1301, TFT1141), schematics and vendor
programs; DisplayModule DM-TFT114-397.

**Pins**: the 8-pin breakout header, along the bottom of the symbol at offsets 1–8 whatever the
panel. The ST7789V is a 3.3 V part and its inputs are not 5 V tolerant; the simulator has no
voltages, so only the Part tab says so.

| No. | Pin      | Dir       | What                                                                    |
| --- | -------- | --------- | ----------------------------------------------------------------------- |
| 1–2 | GND, VCC | power     | not simulated                                                           |
| 3   | SCL      | in        | serial clock: SDA is sampled on its rising edge while CS is LOW         |
| 4   | SDA      | in        | serial data, MSB first (reads are not simulated: SDA is input only)     |
| 5   | RES      | in        | RESX: a LOW pulse of 10 µs resets; under 5 µs is rejected as a spike    |
| 6   | DC       | in        | D/CX, sampled on the 8th rising edge: 0 command, 1 parameter or data    |
| 7   | CS       | in        | CSX: LOW enables the interface, HIGH restarts the byte (7-pin: tie LOW) |
| 8   | BLK      | in, sense | backlight: lit while HIGH or open (the board's 10 kΩ pull-up), dark LOW |

**Props**: `panel` — `240x320` (default, 2.0"), `240x240` (1.3", 1.54"), `135x240` (1.14"). Each
panel is its glass and window in the 240 × 320 frame memory (`st7789-panels.ts`): 0–239 ×
0–319, 0–239 × 0–239 and 52–186 × 40–279; the vendor programs' offsets for four orientations
each are the tests. All three are normally black IPS: the glass shows the memory's colors
inverted unless `INVON` was sent (every vendor initialization sends it).

**Controller** (`st7789-controller.ts`, pure):

- Every command of §9.1–9.2 with the parameter count its table shows; the ones with no visible
  effect (porch, gate, power, VCOM, gamma, CABC, NVM) are accepted and their parameters
  counted. A code the data sheet lacks is a warning (`unknown-command`; the MSP1141 program
  sends `D6h`) and is ignored with its data; a read (`04h`, `09h`, `0Ah`–`0Fh`, `2Eh`, `3Eh`,
  `45h`, `52h`…, `DAh`–`DCh`) is a warning (`read-not-simulated`), its bytes ignored until the
  next command; data no command takes is a warning (`stray-data`).
- Parameters are stored as they arrive (§8.5: the sent ones stand when a command is cut short).
- Memory writes (`RAMWR` from the window's start, `WRMEMC` where it stopped) follow §8.12's
  counter table: the column runs XS..XE, then the row; past YE back to YS; a window starting
  past its end wraps after every pixel (`bad-window`, a warning). Logical (column, row) →
  memory: MV exchanges them (the column counter runs down the rows), then MX mirrors the
  memory's columns and MY its rows whatever MV is (the reading that matches all eight vendor
  offsets). Pixels past the memory are ignored but counted ("out of range… ignored").
- COLMOD `x3` 12-bit (3 bytes, 2 pixels; each 4-bit channel's two MSBs repeat into the low
  bits — the data sheet draws a look-up table but never gives it), `x5` 16-bit (R0 and B0 from
  RAMCTRL's EPF: 00 → 0, 01 → 1, 10 → each channel's MSB, 11 (default) → G0), `x6` 18-bit and
  `x7` (16M truncated: the top 6 bits of 3 bytes); any other format makes the window's pixels
  unknown (`bad-format`).
- H/W reset and power-on: sleep in, display off, normal mode, inversion and idle off, COLMOD
  06h, MADCTL 00h, window 0–239 × 0–319, scroll 0/320/0 from 0, RAMCTRL 00h/F0h. `SWRESET`
  keeps COLMOD and MADCTL ("No change") and its window ends follow MV. The memory is "set
  randomly" at power-on (unknown) and "not cleared" by either reset.

**Timing** (`st7789.ts`) — Table 6 (write) as timing checks, Table 9, and the commands' waits;
every violation is an error:

| Requirement                           | Check                                                                                                                                                       | On violation                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `tSDS`, `tSDH` ≥ 10 ns                | SDA around SCL rising                                                                                                                                       | the bit unknown                       |
| `tDCS`, `tDCH` ≥ 10 ns                | D/CX around the 8th rising edge only                                                                                                                        | the byte command or data: lost        |
| `tSHW`, `tSLW` ≥ 15 ns, `tSCYCW` ≥ 66 | SCL HIGH, LOW, rise to rise                                                                                                                                 | the bit phase lost                    |
| `tCSS` ≥ 15 ns, `tCHW` ≥ 40 ns        | CS falling to SCL, CS HIGH                                                                                                                                  | the bit phase lost                    |
| `tCSH` ≥ 15 ns                        | the last SCL rise to CS rising                                                                                                                              | reported; the byte stands             |
| `tRW` ≥ 10 µs                         | RESX LOW                                                                                                                                                    | 5–9 µs: a reset may or may not happen |
| waits (`wait-violation`)              | a command within 5 ms of RESX↑, `SWRESET`, `SLPOUT`, `SLPIN`; `SLPOUT` within 120 ms of RESX↑ (or of `SWRESET` in sleep); `SLPIN` within 120 ms of `SLPOUT` | the command's effect uncertain        |

A byte completes 10 ns after its 8th edge, so hold violations reach it. Power-on counts as a
reset released at time 0. `SLPOUT` and `SLPIN` start their waits only when they change the mode
("no effect when already…"). The waits: the data sheet says "it will be necessary to wait" but
not what happens otherwise, and vendor code that skips the `SLPOUT` waits works on the bench —
so a command sent too early runs uncertainly rather than being lost (LIB-2 Q5).

**Unknowns — the veil**: a command whose effect is uncertain sets what it sets, as the outcome
shown, and marks it unknown where the outcomes differ (`Controller.unknown`); pixels it writes
are `PIXEL_UNCERTAIN`; the glass shows them under a hatch of the `X` color, and a later command
sent in time makes them known again. `X` (noise) is kept for data never known: the power-on
memory and pixels written with unknown bits. A command byte with up to 3 unknown bits whose
values are all commands without parameters runs each uncertainly; anything less placeable — an
unknown D/CX, an SCL edge while CS is unknown, a CS glitch in the middle of a byte, a clock
check failing, RESX unknown — leaves the interface lost: every register unknown, the memory
veiled, data ignored until the next command (D/CX = 0 marks every command; a lost bit phase
recovers at CS↑ or a reset). A CS or SCL never known yet (the logic driving it not reset after
power-on) is no activity, and a CS glitch between bytes (an EEPROM's output window at a byte
boundary) is harmless.

**Glass** (`st7789-frame.ts`): `st7789Frame(controller, panel)` gives the glass's pixels as
`0xRRGGBB` plus `FRAME_UNKNOWN` / `FRAME_UNCERTAIN`: the blank page (black) asleep or with the
display off; the panel's window of the memory through vertical scrolling (always applied: the
defaults map every line to its row; TFA + VSA + BFA ≠ 320 or a start in a fixed area is
uncertain; ML exchanges the fixed areas); partial mode blanks the lines outside PTLAR (a start
past the end wraps); idle keeps each channel's top bit; MADCTL's RGB bit swaps red and blue at
display time; the panel's inversion. The drawer turns it into an image (`tft`,
[editor.md](editor.md#symbol-drawing)).

**Tests** (`src/library/periph/st7789*.test.ts`): pins and symbol; the command table's counts;
framing, recovery (§8.5 Figures 20–21), defaults; every memory-write rule, the eight MADCTL
orientations of Figure 33, the vendor offsets landing on each panel's glass, every color format
and EPF; the frame's modes, scroll, partial, panels; each Table 6 requirement and the reset
pulse just inside and outside; every wait; the MSP2008 vendor initialization under the veil;
unknown SDA, D/CX, SCL, CS and RES. Scenarios: the TFT Color Bars program through the
controller (`tft.test.ts`, `tft-program.ts`), the example headless (`tft-examples.test.ts`),
the carry-over property over random TFT networks, an SPI bus benchmark, and the browser
(`tests/e2e/tft.spec.ts`).

## Verilog modules (`hdl/*`)

HDL-1 ([ADR-0030](adr/0030-hdl-modules.md)): logic written in Verilog runs as a part; HDL-8 put
it on a bus (tri-state outputs, `inout` ports); HDL-9 runs the rest of synthesizable Verilog
(every cell `proc` and `opt` leave, signed and of any width, clocks and asynchronous controls
made inside a module, combinational loops, power-up values), and makes races `X`. The user
synthesizes their `.v` with Yosys on their own computer, the app takes Yosys's JSON netlist
and keeps its IR in the document as a circuit written in Verilog
([circuit.md](circuit.md#verilog-modules)); the library's interpreter runs that IR. The app
never runs Yosys. Code: `src/core/hdl-module.ts` (the IR), `src/library/hdl/` (the command, the
converter, the analysis, the interpreter).

**The command** (`yosysScript`, `yosysCommand` in `src/library/hdl/command.ts`):

```sh
yosys -q -p 'read_verilog decoder.v; hierarchy -auto-top; proc -norom; flatten; tribuf -logic; opt -keepdc; memory_collect; check; write_json decoder.json'
```

`hierarchy -auto-top` marks the top module — `hierarchy -top soc` names it where the sources hold
other modules nobody instantiates (HDL-7: `picorv32.v` with its bus adapters, where `-auto-top`
picks `picorv32_wb`; the repo's scripts take a top, `yosysScript(sources, output, top)`), `proc
-norom` turns processes into cells but keeps a
`case` as logic, as a GAL gets it (plain `proc` makes a decoder's table a ROM), `flatten` inlines
the hierarchy, `tribuf -logic` (HDL-8) turns tri-states
(`oe ? q : 8'bz`, also from an `always` block) into `$tribuf` cells — it merges the drivers of
one net into one buffer fed by a `$pmux` and makes those that reach no port logic —, `opt
-keepdc` optimizes without dropping don't-care bits (so `X` behaves as written), `memory_collect`
(HDL-6) makes each memory one `$mem_v2` cell with its size, its contents (`initial`, `$readmemh`
— read by Yosys, relative to the `.v`) and its ports, reads asynchronous (a registered read
stays a flip-flop: the command runs no `memory_dff`). Several files,
`` `include ``, SystemVerilog (`read_verilog -sv`) are the user's command line. For every
tri-state `read_verilog` says "Yosys has only limited support for tri-state logic at the
moment": harmless here, where only buffers on the ports are left.

**The IR** (`HdlModule`, format 1): the top's name, Yosys's `creator`, `bitCount` signal bits
numbered from 0, the ports in declaration order (`name`, `dir` — `in`, `out`, `inout` —, `lsb` —
the Verilog index of bit 0 —, `bits` least significant first, `init`, `src`), named signals
(Yosys's netnames that aren't ports or hidden, kept while all their bits are: what probes,
watches and benches read inside the module, HDL-4) and the cells: each its Yosys type, its first source location (`decoder.v:12.3-12.20`),
its ports' bits (a signal bit or the constants `'0'`, `'1'`, `'x'`) and parameters (polarities
0/1, the operands' signedness `A_SIGNED`/`B_SIGNED` — kept only where 1, absent meaning
unsigned —, reset values as bits). An output's or inout's bits may also be `'z'`: never driven.
**Memories** (HDL-6, [ADR-0036](adr/0036-memories-in-modules.md), schema v9): `name` (`buf`, a
flattened submodule's `u_fifo.mem`), `width`, `size`, `offset` — the Verilog address of word 0
(`m[16:25]`: 16) — and `init`, the power-up contents Yosys read from `initial` blocks and
`$readmemh`: runs `ADDR:WORDS` in hex at Verilog addresses, each word as many digits as its width
needs, `x` digits unknown (a digit with any unknown bit; `readHdlMemoryInit`,
`formatHdlMemoryInit` in `src/core/hdl-memory.ts`); words no run gives start `X`. Their ports are
cells naming the memory by index (`MEMORY`). `hdlModuleProblems` checks the shape (documents are
loaded with it); widths come from the connections.

**The cells** (`HDL_CELLS`): `$not` `$pos` `$neg`, the reductions (`$reduce_and`, `_or`,
`_xor`, `_xnor`, `_bool`), `$logic_not` `$logic_and` `$logic_or`, `$and` `$or` `$xor` `$xnor`,
the arithmetic (`$add` `$sub` `$mul` `$div` `$mod` `$divfloor` `$modfloor` `$pow`), the
comparisons (`$eq` `$ne` `$eqx` `$nex` `$lt` `$le` `$gt` `$ge`), the shifts (`$shl` `$shr`
`$sshl` `$sshr`, `$shift` and `$shiftx` — `v[i]`, `v[i +: 2]`), the multiplexers (`$mux`
`$pmux`, and `$bmux` `$demux` `$bwmux`, which other front ends' RTLIL holds), the flip-flops
`$dff` `$dffe` `$adff` `$adffe` `$sdff` `$sdffe` `$sdffce` `$dffsr` `$dffsre` (per-bit
asynchronous `SET`/`CLR`) `$aldff` `$aldffe` (an asynchronous load of `AD`), the latches
`$dlatch` `$adlatch` `$dlatchsr`, `$sr`, the tri-state buffer `$tribuf` (HDL-8: `A`, `EN` →
`Y`), and a memory's ports (HDL-6): `$memrd` (`ADDR` → `DATA`, asynchronous) and `$memwr` (`CLK`
with `CLK_POLARITY`, `EN` per bit, `ADDR`, `DATA`, no output; `PRIORITY`: a bit per earlier write
port of its memory, set where this one wins on a bit both write at one edge). Every width; signed operands as Yosys's cell library (`simlib.v`) reads them: an operand
extended by its sign bit, an operation of two operands signed only when both are (`$pow`: each
on its own), a shift extending `A` to the wider of A and Y by its signedness (`$shiftx` selects
from `A` as it is). HDL-1 ran unsigned operands up to 32 bits.

**Memories** (HDL-6): the converter makes each `$mem_v2` a memory and a `$memrd` per read port
and a `$memwr` per write port, in Yosys's order, `WR_PRIORITY_MASK` as each port's `PRIORITY`. A
wide port's words come as ports of their own with constant low address bits, so they need
nothing more. `proc` gives a write's address and data an `x` default where the process doesn't
write (`we ? rd : x`): the converter takes a `$memwr`'s `ADDR` and `DATA` through such
multiplexers (`proc`'s `$procmux$…` with one input all `x`) to the other input, so an unknown
enable makes `X` only the word it addresses, as a board's RAM would. Arrays written without a
clock (`always @*`) are latches already (Yosys's `mem2reg`), as are arrays read or written only at
constant indices; a `case` table is logic (`proc -norom`) — made by plain `proc`, its ROM runs as
a memory.

**The converter** (`fromYosys`) refuses, with the reason and the source location: a memory whose
ports are separate cells (`$memrd_v2`, `$memwr_v2`, `$meminit_v2`: it asks for the command's
`memory_collect`), one with a synchronous read port (`memory_dff`, `memory -nomap`: it asks for
the command), one written without a clock, one with negative addresses, the old `$mem`; a
multiplexer with `z` inputs (a
tri-state the command's `tribuf` didn't see: it asks for the command), cells of synthesis passes
the command doesn't run (`$alu`, `$macc`, `$lut`, `$sop`, `$fsm`, …: it asks for the command),
formal verification cells (`$ff` on the global clock, `$anyseq`, `$initstate`, …), a
module that places others (not flattened), gate-level cells (`$_AND_`, … from `synth`), an
ascending vector port (`[0:3]`: its value would read reversed against the app's buses: declare
it `[3:0]`), port names that aren't plain identifiers (no `$`, ≤ 32 characters, indices 0–99).
It drops `$scopeinfo` silently and `$print` (`$display`) and assertions with a warning; bits
nothing drives become `x` with a warning. A `$pow` (`a ** b`, a power not of 2 — `2 ** n` is a
shift) runs, with a warning: Yosys's `synth` makes no logic of it, so a board's flow can't build
it. A constant `z` read by a cell becomes `x` with a
warning: Yosys makes the reads of an inout assigned `z` (`assign io = 1'bz`) a constant, not the
pin, so an inout to be read is left unassigned. The **analysis** (`analyzeHdlModule`) finds who
drives each bit — an input's pin, an inout's pin where no logic drives the bit (a `$tribuf`
driving an inout drives its pin, and the module reads the bit back from it), a cell — and
refuses a bit driven twice and two inout ports joined inside the module (a wire between two
pins); it warns about inferred latches and **combinational loops** (HDL-9: the strongly
connected components of the combinational cells, found by Tarjan's algorithm, each named by a
signal on it), orders the combinational cells (Kahn's order over the components, a loop's cells
together) and gives each cell its **cone**: the pins its value can come from with no flip-flop
between (a loop's cells the whole loop's), and each flip-flop its data cone (`D`, `EN`, `SRST`:
what an edge samples) and its asynchronous cone (`ARST`, `SET`, `CLR`, `ALOAD`, `AD`). Clocks
and asynchronous controls may come from pins or from logic (HDL-9).

**The part** (`hdlPart(type, name, module)`, the `hdlPart` hook of the library's registry):
type `hdl/<circuit id>`, a pin per port bit (`addr12`…`addr15` for `addr[15:12]`, a one-bit
port by its name) in declaration order — an input's `in`, an inout's `bidir`, an output's
`tristate` where a `$tribuf` drives it or it is `z`, else `out` (core's `hdlPinDirs`) —, one
property `delay` (`hdlDelayProp`, default 15 ns, an ATF22V10C-15's tPD) for every output, taking
and releasing the bus too until HDL-2's per-path timing, and a **`signals` view** (HDL-4,
[ADR-0035](adr/0035-inner-signals.md)): the IR's named signals (`state`, a flattened submodule's
`u_core.count`), each bit read from the words — a register's or latch's state is its `Q` bits —
so probes, watches, breakpoints and test benches name them (`A1/state`,
[circuit.md](circuit.md#resolver)), and a **`memories` view** (HDL-6): each memory up to 32 bits
wide as a `MemoryDef` with its `name`, `words`, `width`, `offset`, `volatile` and `powerUp` (the
IR's contents), its cells read in place from the instance's state, and pokes by name (a
`PokeAction` with `memory`: known words written now, the logic settled and the outputs driven
after their delay) — so the Memory tab, the debugger's watches and benches show and load them
(`A1/rom`, `A1/rom[1F]`). Wider memories run but aren't shown. No definition while the module
has errors.

**The interpreter** (`module-part.ts`; since HDL-10 the IR compiled once per module into
JavaScript, [ADR-0037](adr/0037-hdl-generated-code.md)): state is two planes of 32-bit words over
the bits — values (0 where unknown) and unknowns (`layout.ts`: each cell's output in words of its
own, a port's pin bits in theirs, the constants in one word) — plus the value each flip-flop last
saw of its clock, the floating pins, and each memory's words (`memory-cells.ts`, HDL-6: values
and unknown bits in 32-bit limbs, ADR-0018's access stamps; up to 256K words and 8 Mbit a
memory), plain data for snapshots (unchanged pages shared), rewind and replicas. The common cells
run as generated word operations (`codegen.ts`; the 4-state rules as word algebra, arithmetic on
numbers when no operand bit is unknown), the flip-flops' next states and loads one generated
function per clock pin and edge (`flip-flops.ts`), the shifts as closures over limbs
(`limb-cells.ts`), the uncommon cells (divisions, powers, `$bmux`, `$demux`, `$sr`, `$dlatchsr`,
arithmetic and orders past 32 bits) through an adapter to their plain steps (`cells.ts`,
`word-cells.ts`, `words.ts`), which the generated code is tested against. The generated source is
made from templates and integers alone — no text of a document ever enters it. **Activity**
(`settle.ts`): each combinational cell (a loop's cells together) is a step with a mark; it runs
only when marked and marks the steps reading its output when that changed; a pin that changed, a
flip-flop's load, an asynchronous control, a memory write or a poke marks the readers of what it
changed — so the words are always the settled function of the pins, the flip-flops and the
memories, and a falling clock edge in a design clocked on rising edges runs nothing. **Power-up**: the bits with an `init` (`reg q = 0`) start at it, as an FPGA's
bitstream loads them — the rest `X` — memories hold their `init` contents, and the logic settles
from them, pins unknown, so a clock
made from an initialized register (`~div`) is known before anything happens; the kernel's
evaluation at t = 0 drives them after `delay`. Each `evaluate` runs, in phases, only what the
module needs (a decoder: steps 2, 3 and 6):

1. Flip-flops whose pin clock had an edge (`clockEdge`, strict: `0 → 1` for a rising edge)
   compute their next state **from the words as they were before this delta** — D, EN, SRST —
   then all load at once, so a shift chain shifts by one. An uncertain edge (`0 → X`, `X → 1`,
   `Z`) makes `X` only the bits a load would change, as the library's chips do (`0 → X → 1` is
   two such edges). **A race** (HDL-9): when a pin of a flip-flop's data cone changed in the
   same delta as its clock, no flip-flop loads yet; after step 3 its next state is computed again
   from the pins after the change and merged with the first — the bits that differ load `X` —
   and the module reports a `setup-violation` on that pin ("d0 changed at the clock edge of q"),
   as the library's chips do for the same input. A memory's **write port** (HDL-6) is
   edge-triggered the same way: its edge samples `EN`, `ADDR` and `DATA` from before the delta
   and stores with the flip-flops' loads, raced the same way ("wd0 changed at the clock edge of
   memory regs's write: it writes X where that matters").
2. The input pins and the inouts' pins read back are read into the words (`Z` reads `X`), a
   word at a time; one that changed marks the cells reading it.
3. **Settle**: the combinational cells, the latches (`Q = EN ? D : Q`, merged while EN is
   unknown; `$dlatchsr` and `$sr` clear, then set, per bit) and the tri-state buffers downstream
   of a change run in order — no events inside a module, zero delay; a buffer gives `EN ? A : X` inside the module
   (a released net reads `X`). A **combinational loop** runs as one step, over and over until no
   bit of it changes (an SR latch of NANDs sets, resets, holds; one that starts `X` stays `X`);
   past twice its cells and two passes the bits still changing go `X` until that settles, and
   the module reports `oscillation` ("the combinational loop through r3 doesn't settle: X") —
   the simulation goes on, unlike a loop of parts with no delay, which the kernel halts. Then the
   asynchronous controls apply while active, from pins or from logic (reset to `ARST_VALUE`, load
   `AD`, per bit clear then set; merged while unknown), and the logic settles again while they
   change a flip-flop.
   A memory's **read port** (HDL-6) is a step there too, after its address: the word at a known
   address, `X` outside the memory (`m[16:25]` read at 3), and with unknown address bits the
   words they could select merged — the bits they agree on known — up to 8 such bits, all `X`
   beyond (the chips' rule). The contents are state, like a flip-flop's `Q`: a read port is in
   no loop with its memory's writes.
4. **Rounds** (HDL-9): every flip-flop clocked by logic (a divider, a ripple stage, a gated
   `clk & en`) compares its clock with the value it last saw; those with an edge compute their
   next states from the words as they are, all load at once, the logic settles (step 3), and
   another round looks — a ripple chain of n stages takes n rounds. Inside one evaluation
   everything is one instant, so a flip-flop on a clock made by logic whose data changed in it
   (since the evaluation began) **races** its clock: its next state is merged with the one from
   the evaluation's start, `X` where they differ, and the module reports a `race-violation`
   ("gated is clocked by logic, and its data changed at the same instant: … use a clock
   enable"): a gated clock sampling a register of its own source clock, a divided clock sampling
   the faster domain. On a board the winner depends on gating and routing delays — the reason
   FPGA tools warn about gated clocks; Verilog simulators and Yosys's `sim` pick one. Data that
   changes only at the clock's own edges (a divider's counter, a ripple stage's `~q`, a shift
   chain on one derived clock) is certain. A flip-flop clocked twice in one evaluation is a
   glitching clock: its second load races its first. An uncertain edge already merges and isn't
   checked. Past twice the internal flip-flops and four rounds, those still clocking go `X`
   with an `oscillation`. Write ports on clocks made by logic take part in the rounds as
   flip-flops do.
5. With floating pins, the floating rule below.
6. Every output bit is driven with `delay` (inertial: an unchanged output costs nothing, and a
   bit released and taken again within the delay never floats). A buffer's pin drives `A`
   while `EN` is 1, is released while 0 and drives `X` while unknown — it might be driving, as
   the library's 3-state buffers do. A `z` bit is never driven; `tristate` and `bidir` pins
   start released. An inout drives what logic gives it (`assign w = a`) push-pull; another
   driver on its net is the kernel's `contention`, and the module then reads `X` back.

**Writes** (HDL-6): a write stores the bits it enables at its address; ports of one memory store
in Yosys's order. Where a write may happen — an uncertain clock edge, an unknown `EN` bit — or
may hit several words — unknown address bits: every word they could select (any number) — each
bit it could write becomes `X` where it differs from what it holds. A write outside the memory
changes nothing (`simlib.v`). Two ports writing one bit at one edge: the one with priority (a
later statement of one `always`) wins; without priority (two `always` blocks, two clocks) it is
`X` where they differ — a dual-port RAM's collision; Yosys's `sim` takes the later port. A read
port stamps the word it reads when it moves to another word or that word was written since —
never for a mere re-run of the steps — and a write stamps the words it may have written.

**Floating pins** (HDL-8): a module reads its pins with `ctx.level`, which reports nothing, and
reports a floating one (`ctx.reportFloating`) only where its `X` is used, as the library's chips
read their pins only where it matters: an output driven `X` (not released), a flip-flop loading
an `X` at its edge (from the pins as they were before it), a memory write storing an `X`
(HDL-6), an open latch holding `X`, an
asynchronous control at `X` or loading `X` (HDL-9: reset, set, clear, load) — each checked
against its cone, so an idle bus a module doesn't use reports
nothing, a register still `X` from power-on names no pin, and a write that samples a floating
bus does. Clock pins are read by `clockEdge` and reported as any read. A bus handed over at one
instant floats for the module's delay: an output that passes the bus on (`assign r = d`)
reports it. Two drivers of one inout inside a module are merged by `tribuf -logic`: both
enabled drive `X` without a `contention` (one driver to the kernel).

`X` is pessimistic only where it must be: bitwise cells per bit (`0 & X = 0`, `1 | X = 1`),
reductions and logic operators known when the known bits decide, comparisons sure when every
value the unknown bits allow agrees (`0X0X < 0110`; signed ones in signed order), sums and
products unknown from the lowest unknown bit up (a product's bit depends only on the bits at and
below it), a shift by an unknown amount all `X`, `$mux` with an unknown select the bits both
inputs agree on, `$pmux` likewise between "no case" and the one case that could be selected (`X`
when two could), `$bmux` merging the words an unknown select could pick (all `X` past 256 of
them), `$demux` merging `A` with 0 where it could go. A constant `x` in a comparison makes it
unknown, as Verilog's `==` does — and `===` too (HDL-9): Verilog compares an `x` literally, but a
board has no `x` to compare, so `$eqx` and `$nex` are `$eq` and `$ne`. A division, a remainder or
a power with an unknown operand, a division by zero and `0 ** −n` are all `X` (Verilog's and
Yosys's `x`; a board's value would depend on the synthesis). Division truncates (`$div`,
`$mod`) or floors (`$divfloor`, `$modfloor`) at the widest of A, B and Y; a power follows
Verilog for a negative exponent (`1 ** −n` is 1, `−1 ** −n` ±1, any other base 0).

**Speed** (`tests/bench/hdl.bench.ts`, Apple M3 Pro): about 10 M combinational cells a second —
every cell on every evaluation; a 1 000-cell module clocks at ≈ 6 kHz per second of wall time
(HDL-8 and HDL-9 left it the same: the floating rule costs nothing while no pin floats, rounds
and loops nothing in a module without them). An I/O port written and read through its bus:
≈ 0.96 M evaluations a second. HDL-9's: a 64-bit counter with a 32 × 32 multiplier and 72-bit
words, new operands every cycle, ≈ 73 k evaluations a second (words read bit by bit from the
planes); a divider, a ripple chain and a reset by logic ≈ 0.64 M. HDL-6's: a register file
(8 × 8, a write and two reads a cycle) ≈ 0.74 M evaluations a second; a 4K × 32 RAM, a write
and a read at new addresses every cycle, ≈ 0.40 M (≈ 130 k cycles a second); HDL-1's numbers
unchanged. HDL-7's: PicoRV32 (RV32I with the barrel shifter, 558 cells, 4 KB of RAM) running
its program ≈ 10.6 k cycles a second, alone and on its board (≈ 3 k instructions; ≈ 14–16 k in
Chromium); the full core (C, MUL, DIV, IRQ, counters: 1 180 cells) about half that. Half the
time went to `$mux` and `$pmux` evaluated bit by bit, and every evaluation ran every cell, the
falling clock edge's too. **HDL-10** (words, generated code, activity): PicoRV32 ≈ 230–250 k
cycles a second in `pnpm bench` (≈ 280–290 k measured directly; ≈ 23×; the target, 1 M, not
reached: ≈ 145 of its 456 steps run a cycle, ≈ 7 ns each, and the edges' phases and the kernel's
pins take the rest), ≈ 180–200 k in Chromium at Max, so the example runs at 100 kHz in real time;
a decoder ≈ 2.2 M evaluations a second, the counter ≈ 3.0–3.5 M, the 1 024-cell synthetic module
(now with power-up values, so it changes at every edge) ≈ 1.5 M against 11 k, clocks made by
logic ≈ 1.2–1.35 M, the wide words ≈ 74–81 k, the register file ≈ 0.78 M, the RAM ≈ 0.40 M, the
I/O port ≈ 0.95 M (its time is the kernel's).

**Tests**: the converter on fixtures Yosys made of `src/library/hdl/fixtures/*.v` (`pnpm
hdl:fixtures`, the system `yosys`; `pnpm check` never runs Yosys), every cell against
JavaScript (`BigInt`) on seeded values of 1 to 128 bits, signed and unsigned, and with `X`, the
decoder's function table and delay, the counter, the traffic light, every flip-flop flavour,
latches, a shift chain, power-up values, clocks made inside a module, races, loops, snapshots,
every tri-state shape Yosys makes (an I/O port, a 74HC574, merged drivers, an open drain, inouts
read, driven and clocking) and the floating rule (`src/library/hdl/*.test.ts`). The generated
code (HDL-10) against the cells' plain steps and the flip-flops' bit-by-bit model, cell by cell:
every cell of every fixture and differential design and 40–60 random shapes of every type, on
random 4-state words (`codegen.test.ts`, `flip-flops.test.ts`); the layout's operands, the
settle's activity (a few words changed come out as a full settle; nothing marked runs nothing)
and the memory ports on words (`layout.test.ts`, `settle.test.ts`, `memory-words.test.ts`);
the source refuses anything but integers. While HDL-10 was built, every module of the tests and
the examples ran on both engines under the same seeded stimulus — pins, reports, inner signals
and memories equal at every step — before the old one was removed. **Differential
tests** (HDL-9): `pnpm hdl:differential` (the system `yosys`) synthesizes seeded random
expressions over every word cell (half of the modules all signed), the sequential designs of
`src/library/hdl/differential/*.v` and `examples/verilog/*.v`, drives each with seeded vectors
in Yosys's own `sim` (a witness replayed, its VCD read back; a clock never changes with data) and
commits the IR, the vectors and every output; `differential.test.ts` checks every output bit
Yosys knows — about 128 k bits over 23 designs, memories among them (HDL-6: a register file, a
FIFO, ROMs from `$readmemh`, `initial` loops and `m[16:25]`, byte lanes, two clocks and a divided
one). Where `sim` differs on purpose they stay out,
and unit tests cover them: `===` of an `x`, `$aldff` while ALOAD is active (`sim` loads AD a step
late; the interpreter follows AD, as the set/clear logic Yosys maps it to does), a power of mixed
signedness (`sim` reads it unsigned, Verilog and `simlib.v` don't), and an asynchronous control
made from its own flip-flop (it loops `sim` forever), and two write ports writing one bit at one
edge (`sim` loops on it too; the designs keep their ports on different words). Across the layers
`tests/scenarios/verilog-modules.test.ts`, `verilog-bus.test.ts` (an I/O port's bench, two
modules and a 74HC244 on one bus) and `verilog-memories.test.ts` (memories loaded and checked by
benches, a module's own and through an instance), the examples' benches — among them a whole
RISC-V core, the Verilog PicoRV32 (`verilog-picorv32.test.ts`: its RAM holds the program built,
and a changed instruction fails its benches) —, the rewind property, and the browser
(`tests/e2e/hdl.spec.ts`).

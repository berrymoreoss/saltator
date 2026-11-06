# Components

How parts are described in `src/library`. Rationale for modeling chips as packages:
[ADR-0004](adr/0004-chips-as-packages.md).

> Status: **draft**. The definition shape below is the target for R01 (primitives) and R03 (IO);
> those branches finalize names and types and update this document. The step-by-step recipe for
> adding a part will live in `.ai/workflows/add-component.md` (written in R01).

## Families and type ids

A part is identified by a stable **type id** `family/part`, stored in saved documents. Never
rename a type id; add a migration if you must.

| Family   | Examples                                                           | Notes                                                                                                  |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `prim`   | `prim/nand`, `prim/tristate-buffer`, `prim/pull`                   | Abstract building blocks (Logisim-style), configurable inputs and delay. For prototyping and learning. |
| `io`     | `io/switch`, `io/button`, `io/led`, `io/clock`, `io/seven-segment` | Interaction and indication.                                                                            |
| `74xx`   | `74xx/74hc00`, `74xx/74hc245`, `74xx/74ls189`                      | Real logic chips. Behavior shared per function; timing per logic family (HC first).                    |
| `mem`    | `mem/at28c256`, `mem/62256`                                        | ROM/EEPROM/SRAM with inspectors.                                                                       |
| `cpu`    | `cpu/w65c02s`                                                      | Processors (pin-level). Later: Z80, AVR, PIC.                                                          |
| `periph` | `periph/w65c22`, `periph/hd44780`                                  | Peripherals.                                                                                           |

## Definition shape

```ts
interface ComponentDefinition<Props, State> {
  type: string; // '74xx/74hc00'
  name: string; // '74HC00' (shown on the part)
  title: string; // 'Quad 2-input NAND gate'
  family: string; // '74xx'
  keywords?: string[]; // palette search: ['nand', 'gate']
  datasheet?: string; // URL of the datasheet used for pins, function table, timing

  pins: PinDef[]; // order defines pin indices
  package?: PackageDef; // e.g. { kind: 'dip', pins: 14 }; absent for abstract parts
  units?: UnitDef[]; // gate sections, for the future symbol view
  props?: PropDef[]; // user-editable properties (inspector)
  timing?: TimingDef; // datasheet numbers + source/conditions
  symbol?: SymbolDef; // geometry for non-package rendering (data only)

  create(props: Props): Behavior<State>; // see docs/simulation.md
}

interface PinDef {
  name: string; // datasheet name: '1A', '1Y', 'OE', 'VCC'
  number?: number; // physical pin number (required when `package` is set)
  dir: 'in' | 'out' | 'tristate' | 'bidir' | 'power' | 'nc';
  activeLow?: boolean; // drawn with a bubble/overline: OE, CE, WE
  clock?: boolean; // drawn with a clock triangle
}
```

Pin directions:

| `dir`      | Reads net | Drives net      | Typical                              |
| ---------- | --------- | --------------- | ------------------------------------ |
| `in`       | yes       | no              | gate inputs, control pins            |
| `out`      | no        | strong 0/1      | push-pull outputs                    |
| `tristate` | no        | strong 0/1 or Z | 74HC245/173/374 outputs              |
| `bidir`    | yes       | strong 0/1 or Z | data buses of RAM, CPUs, 74HC245 A/B |
| `power`    | —         | —               | VCC, GND (not simulated in the MVP)  |
| `nc`       | —         | —               | not connected                        |

## Packages and pin numbering

- DIP pin numbering follows the datasheet: with the notch up, pin 1 is top-left, pins go down the
  left side and back up the right side (for DIP-14: left 1–7, right 8–14 bottom to top).
- The editor draws DIP parts generically from `package` + `pins`, so a 74xx definition needs no
  drawing code. Visual orientation and labels are decided in R04.
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

Optional in R01–R06; recommended for every multi-gate chip from the start (cheap now, saves a
migration later).

## Properties

```ts
interface PropDef {
  key: string; // 'color', 'frequency', 'inputs', 'delay'
  label: string;
  type: 'number' | 'integer' | 'boolean' | 'enum' | 'color' | 'string' | 'time';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[]; // for 'enum'
  unit?: string; // 'Hz', 'ns'
}
```

Props are part of the saved document; changing one recompiles the netlist.

## Timing

```ts
timing: {
  tpd: ns(7),                   // value the behavior uses (typical)
  max: { tpd: ns(15) },         // optional, for a future worst-case mode
  conditions: 'VCC = 5 V, CL = 15 pF, Tamb = 25 °C',
  source: 'Nexperia 74HC00 datasheet, rev. 9, table 8',
}
```

Use the datasheet's typical value at 5 V when available. Record where the number came from.
Separate rise/fall (`tPLH`, `tPHL`), enable/disable (`tPZH`, `tPHZ`…) and setup/hold values are
added when a part needs them.

## Behavior guidelines

- Read inputs with `ctx.read`; treat `X`/`Z` inputs conservatively (an AND with a 0 input is 0 even
  if the other input is `X`; otherwise `X`).
- Drive outputs with the datasheet delay. Never use zero delay for real chips.
- Keep state in `ctx.state`; no module-level mutable variables (multiple instances!).
- Edge-triggered logic uses `ctx.rose(clk)` / `ctx.fell(clk)`.
- No randomness or wall-clock time; no allocations in `evaluate` for hot parts.

## Testing a part

Every part ships with `<part>.test.ts` next to it:

1. **Function table**: transcribe the datasheet function table into a table-driven test using the
   core test bench.
2. **Timing**: at least one assertion that an output changes exactly `tpd` after the input.
3. **Edge cases**: `X`/`Z` handling on inputs, tri-state enable/disable, reset behavior.

## Symbols (non-package parts)

`symbol` describes geometry in grid units: bounding box, pin positions (side + offset), label
anchors. The editor maps `symbol.kind` to a drawing function (`led`, `switch`, `seven-segment`,
`gate-and`, …). The library never draws.

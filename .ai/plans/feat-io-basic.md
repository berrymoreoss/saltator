# Plan: feat/io-basic

| Field      | Value                                                              |
| ---------- | ------------------------------------------------------------------ |
| Branch     | `feat/io-basic`                                                    |
| Roadmap    | R03 — Basic IO parts (headless) ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                        |
| Depends on | R01, R02                                                           |
| Created    | 2026-11-06                                                         |

## Goal

Add the parts a learner needs to poke at a circuit and see what it does — power rails, switches,
buttons, DIP switches, pull resistors, LEDs, LED bars, a clock generator, 7-segment and hex
displays, a logic probe — as headless definitions in `src/library/io` with behavior, tests and
symbol geometry. Introduce `symbol` (pin placement as data) so these parts get real shapes
instead of R02's generic box, and decide whether `prim/*` gates get gate shapes. After this
branch the M1 circuits (switch → gate → LED, clock → LED) build and run headlessly; R04 draws
them and R05 makes them interactive.

## Scope

**In scope**

- `core`: `SymbolDef` (body size + pin side/offset, a `kind` for the editor's drawing function)
  and `ComponentDefinition.symbol`, validated like pins; two pin flags needed by IO parts:
  `sense` (observes a net without loading it) and `constant` (output tied to a fixed level).
- `circuit`: symbol layouts in `partLayout`; design checks aware of the new flags.
- `library/io`: the parts listed below, each with tests, symbol and documented state/actions
  (the contract R05 uses to draw and click them).
- Indicator on-time accounting (for persistence of vision: multiplexed displays, LEDs on fast
  clocks) as part state, with a pure helper for the renderer.
- Symbols for `prim/*` parts (Q3).
- Headless scenarios (M1 circuits built as documents and simulated) and docs (components,
  circuit, ADR-0007).

**Out of scope** (and where it goes instead)

- Drawing symbols, label placement on symbols → R04 (the editor maps `symbol.kind` to drawing).
- Clicking parts while running, lighting LEDs on canvas, brightness from on-time → R05.
- Contact bounce for buttons/switches (deterministic pattern) → backlog idea.
- Bussed resistor network (SIP-9, 8 pull resistors in one part) → backlog idea.
- VCC/GND symbols joining one global net by name → R10 (net labels); here each rail symbol is
  its own source, wiring two of the same kind together is fine.
- NE555 (Ben Eater's clock module) → R08. Bus/hex probes for multi-bit values → R10/R13.
- Real display parts (TIL311 latched hex display) → when an example needs them.

## Context

Read before starting:

- [docs/components.md](../../docs/components.md) — definition shape, props, behavior guidelines,
  _Symbols_ section (planned here).
- [docs/circuit.md#part-layouts](../../docs/circuit.md#part-layouts) — DIP and box layouts,
  placement; design checks.
- [docs/simulation.md](../../docs/simulation.md) — drives/strengths, floating inputs, actions,
  `wakeAfter`, power-on.
- [ADR-0004](../../docs/adr/0004-chips-as-packages.md) (DIP first, symbol view later),
  [ADR-0006](../../docs/adr/0006-circuit-document-and-connectivity.md) (layouts shared by
  compiler and editor).
- `src/core/component.ts`, `src/core/simulator.ts` (`readPin`, floating reports),
  `src/circuit/layout.ts`, `src/circuit/checks.ts`, `src/library/primitives/*`.
- `.ai/workflows/add-component.md`, `.ai/lessons.md`.

## Design

### Symbols (core)

```ts
type PinSide = 'left' | 'top' | 'right' | 'bottom'; // circuit's `Side` becomes an alias

interface SymbolDef {
  kind: string; // drawing function in the editor: 'led', 'switch', 'gate-and', …
  width: number; // body size in grid cells, pin stubs excluded
  height: number;
  pins: Record<string, { side: PinSide; offset: number }>; // offset along the side, from the
  //                                                          top/left corner of the body
}

// ComponentDefinition gains:
symbol?: SymbolDef | ((props: Props) => SymbolDef); // like `pins`: LED bars, N-input gates
```

- `symbolOf(definition, props)`; `validateSymbol(symbol, pins, where)`: positive integer size,
  every pin placed exactly once (power/nc too), no unknown names, offset within its side
  (0…height or 0…width), no two pins on the same point. The registry validates static symbols;
  prop-dependent ones are validated by `partLayout` (a library bug throws) and by a library-wide
  test over default and boundary props.
- Label anchors (where the designator/label text goes) are left to R04: no consumer yet.
- `kind` is an open string; the editor falls back to a box for kinds it doesn't know.

### Symbol layout (circuit)

`partLayout` precedence: `package` → DIP (ADR-0004: chips are drawn as packages; a symbol view
for chips stays in the backlog) → `symbol` → generic box. Fixes circuit.md, which says the
symbol overrides both. Symbol layout keeps R02's convention (origin at the top-left of the
bounding box, stubs included, one-cell stubs): a margin of one cell on each side that has pins;
pin tips at `left (0, top+o)`, `right (left+w+1, top+o)`, `top (left+o, 0)`,
`bottom (left+o, top+h+1)`.

### New pin flags (core) and checks (circuit)

- `PinDef.sense` (on `in` pins only): the pin observes its net without loading it — an LED,
  display or probe on a floating net is simply dark, not a floating CMOS input. The kernel still
  evaluates the part on changes but never reports `floating-input` for reads through a sense
  pin; the `undriven-input` check skips them.
- `PinDef.constant: 0 | 1` (on `out` pins only): the output is tied to that level forever (rails,
  `prim/constant` with 0/1). `shorted-outputs` counts all outputs tied to the same level as one
  source: VCC wired to VCC is fine; VCC to GND, or VCC to a gate output, is still a short.

### IO parts (`src/library/io`, family `io`)

Electrical model per Q1/Q2: real contacts, two-terminal LEDs. Type ids are permanent.

| Type               | Pins                         | Props (default)                                                      | Behavior / actions                                                      |
| ------------------ | ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `io/vcc`, `io/gnd` | `Y` (out, constant 1 / 0)    | —                                                                    | strong 1 / 0 from t = 0                                                 |
| `io/switch`        | `Y`                          | `contact` (`spdt`), `on` (false): power-on position                  | `toggle`, `set`; change at action time (no delay)                       |
| `io/button`        | `Y`                          | `contact` (`spst-vcc`)                                               | `press`, `release` (momentary)                                          |
| `io/dip-switch`    | `S1`…`Sn`                    | `count` 1–12 (8), `contact` (`spst-vcc`), `on` (0): power-on bitmask | `toggle`/`set` one switch                                               |
| `prim/pull`        | unchanged                    | unchanged                                                            | gets a resistor-to-rail symbol (the roadmap's "pull-up/down resistor")  |
| `io/led`           | `A`, `K` (sense)             | `color` (red)                                                        | lit iff A = 1 and K = 0; on-time accounting                             |
| `io/led-bar`       | `A1`…`An`, `K1`…`Kn` (sense) | `count` 1–12 (10), `color`                                           | n LEDs as above                                                         |
| `io/clock`         | `Y` (out)                    | `frequency` Hz (1), `duty` % (50), `mode` (`auto`)                   | starts low; auto: periodic; manual: `step` → one pulse of the high time |
| `io/seven-segment` | `a`…`g`, `dp`, `COM` (sense) | `common` (`cathode`), `color`                                        | segment = LED (CC: A = seg, K = COM; CA: A = COM, K = seg); on-time     |
| `io/hex-display`   | `D0`…`D3` (sense)            | `color`                                                              | shows 0–F from the levels; any X/Z → unknown (renderer reads levels)    |
| `io/probe`         | `A` (sense)                  | —                                                                    | shows 0/1/X/Z of its net (renderer reads levels)                        |

- **Contacts** (`contact` prop on switch, button, DIP switch): `spdt` changeover — drives strong
  1 when on, strong 0 when off (pin `out`); `spst-vcc` — strong 1 when closed, released (`Z`)
  when open (pin `tristate`, needs a pull-down, like on a breadboard); `spst-gnd` — strong 0 when
  closed, released when open (needs a pull-up). A floating net then shows up where it matters:
  as a `floating-input` diagnostic on the CMOS input that reads it.
- **LED states**: on iff A = 1 and K = 0; off if A ∈ {0, Z} or K ∈ {1, Z}; otherwise unknown
  (drawn as such in R05).
- **Colors**: `enum` (red, green, yellow, blue, white, orange) rather than free CSS strings: real
  LED colors, validated, meaningful for a future BOM.
- **Clock**: period = round(10¹² / f) ps, high = round(period × duty / 100) clamped to
  [1, period − 1]; low phase first, so the first rising edge is at t = low time. Implemented with
  `wakeAfter` (two wakes per period). `step` in auto mode is ignored. Range 0.001 Hz – 1 GHz.
- **State and actions are the renderer's contract** (documented in components.md): switch/DIP/
  button state holds the positions; lights state holds per-light `level` (off/on/unknown),
  `since` and accumulated `onTime` (typed arrays); `onTimeAt(state, i, now)` lets R05 compute
  brightness over a frame window. Action payloads are typed objects (`{ type: 'toggle' }`, …);
  malformed payloads throw (a host bug).
- **Timing**: IO parts have no datasheet; switches and rails change with zero delay, the clock's
  edges are exact. Tests assert the times (action time, period, duty) to the picosecond.

### Symbols for `prim/*` (Q3)

Gate shapes — `gate-and`, `gate-or`, `gate-xor` (+ inverted variants), `buffer`,
`not`, `tristate-buffer`, `constant`, `pull` (direction-dependent: rail on top for pull-up).
Geometry only; ANSI vs IEC drawing is an R04 style choice on the same geometry. N-input gates:
inputs one cell apart, skipping the centre row for even counts so the output sits on the grid
(2 inputs: offsets 1 and 3, output 2). Pin positions of `prim/*` change; tests and the bench
that use fixed coordinates are updated (harmless before R07: no saved files).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. core: `PinSide`, `SymbolDef`, `ComponentDefinition.symbol`, `symbolOf`,
  `validateSymbol`; registry validates static symbols.
- [x] 2. core: `PinDef.sense` (no `floating-input` through sense pins) and `PinDef.constant`
  (validated: sense only on `in`, constant only on `out`).
- [x] 3. circuit: symbol layouts in `partLayout` (package → symbol → box); `undriven-input`
  skips sense pins; `shorted-outputs` merges outputs tied to the same level.
- [x] 4. library: `io/` family skeleton in the default registry; `io/vcc`, `io/gnd`;
  `prim/constant` marks its pin `constant`; library-wide test: every part's layout resolves
  for default and boundary props.
- [x] 5. library: contacts — `io/switch`, `io/button`, `io/dip-switch` (actions, power-on
  positions, all three contact kinds).
- [x] 6. library: lights state + `onTimeAt`; `io/led`, `io/led-bar`.
- [x] 7. library: `io/seven-segment` (CA/CC), `io/hex-display`, `io/probe`.
- [x] 8. library: `io/clock` (auto/manual, period/duty exact, frequency/duty limits).
- [ ] 9. library: symbols for `prim/*` (incl. `prim/pull` resistor); update scenarios/bench that
  rely on box positions.
- [ ] 10. scenarios: headless M1 circuits as documents (switch → NAND → LED; clock → LED; button
  with/without pull-down; DIP switch → hex display; multiplexed 4-digit 7-segment duty).
- [ ] 11. Docs: components.md (io family, symbols, flags, state/actions), circuit.md (symbol
  layouts, checks), architecture.md, ADR-0007 (IO electrical model), glossary, library
  README, roadmap backlog (bounce, resistor network), lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check` and `pnpm build` are green.
- [ ] Every `io/*` part has a test from its function table (LED/segment lit table, contact
  table), X/Z cases, and a time assertion (action time, clock period and duty to the ps).
- [ ] Every registered part has a `package` or a `symbol`; `partLayout` succeeds for default and
  boundary props with no two pins on one point.
- [ ] Reads through sense pins never report `floating-input`; sense pins never get
  `undriven-input`; VCC wired to VCC compiles clean, VCC to GND is `shorted-outputs`.
- [ ] Headless M1: a document switch → NAND → LED simulates with the LED following the switch;
  clock → LED blinks with the configured period and duty; a button without a pull-down gives
  a `floating-input` on the gate input when released, with a pull-down it doesn't.
- [ ] A 4-digit 7-segment display multiplexed at 1 kHz reports 25 % on-time per lit segment.
- [ ] components.md, circuit.md, ADR-0007 describe the implemented parts and model.

## Open questions

Asked at branch start (2026-11-06); all answered.

- [x] Q1. Electrical model of switches, buttons and DIP switches? — _proposed:_ real contacts
  (`contact`: SPDT drives 0/1; SPST to VCC/GND releases when open and needs a pull
  resistor); defaults follow the real part: toggle switch SPDT, button and DIP switch SPST to
  VCC. Alternative: logic sources that always drive 0/1 (Logisim). — **answer:** real
  contacts, as proposed.
- [x] Q2. LED pins? — _proposed:_ anode + cathode (`A`, `K`): sink and source wiring,
  multiplexing, matches the breadboard; LED bar likewise. Alternative: one input, lit on 1
  (Logisim). — **answer:** anode + cathode, as proposed (LED bar too).
- [x] Q3. Do `prim/*` parts get symbols (gate shapes)? — _proposed:_ yes, gate-shaped geometry
  for all `prim/*` (pin positions change, fine before R07). Alternative: keep the generic
  box. — **answer:** yes, gate-shaped symbols for all `prim/*`, as proposed.

## Progress log

- 2026-11-06 — branch created; plan drafted.
- 2026-11-06 — Q1–Q3 answered (all as proposed); plan approved by the user; status in-progress.

## Handoff

- **State:** plan approved; implementation starting with task 1.
- **Next step:** task 1 (core: `SymbolDef`, `symbol`, `symbolOf`, `validateSymbol`).
- **Watch out:** —
- **Verify with:** `pnpm check`

# Plan: feat/net-labels

| Field      | Value                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| Branch     | `feat/net-labels`                                                               |
| Roadmap    | R10a — Net labels ([roadmap](../../docs/roadmap.md)), first half of R10 (Q1)    |
| Status     | done                                                                            |
| Depends on | R02 (connectivity, compiler), R03 (rails), R04b (place tool, menus), R05 (live) |
| Created    | 2026-11-07                                                                      |

## Goal

Net labels: a flag with a name and one connection point, placed on a wire end or a pin tip. All
labels with the same name are one net, so a circuit can be laid out in blocks without wires
running across it (switches `A`, `B` → labels `A`, `B` in one place; labels `A`, `B` → the
74HC00 inputs in another). VCC and GND symbols join by name the same way, which ADR-0007 left to
R10. Nets take their label's name wherever a net is named (Properties, Messages, the Simulation
tab, later the analyzer). This is the half of R10 that 8-bit schematics need first; buses follow
in R10b and will build on the names (`D0`…`D7`).

## Scope

**In scope**

- `core`: `PinDef.net` (the pin joins the circuit-wide net of that name), `ComponentDefinition
  .schematicOnly` (drawn and connected, never simulated), `PropDef.pattern` (string props
  validated by `resolveProps`).
- `circuit`: pins with the same `net` name join; schematic-only parts stay out of the netlist;
  net ids from names; design checks `single-net-label` and `multiple-net-names`.
- `library`: the `net/label` part (a `name` prop); VCC and GND symbols join the nets `VCC` and
  `GND`.
- `editor`: the label drawing (Q2), names with overlines (Q3), upright text at any rotation,
  designator hidden, its outline in the net's level color while simulating; labels stack on
  adjacent DIP pins (1-cell pitch) without overlapping; placing with the next name
  (`D0` → `D1`).
- `ui`: the Parts panel entry, the name field in Properties with the syntax message; the Place
  submenu and Place menu with `L` for Net Label (Q4).
- Example **Net Labels** (the roadmap's switches → labels → 74HC00 circuit); browser test.
- Docs: circuit.md, components.md, editor.md, glossary, architecture, ADR-0015, roadmap (R10
  split, backlog), lessons.

**Out of scope** (and where it goes instead)

- Buses, bus rippers, bus labels (`D[0..7]`), hex bus values → R10b `feat/buses`.
- Local vs global labels, ports, hierarchical labels → R11.
- Highlighting a whole net when one of its wires or labels is selected or hovered → backlog.
- Implicit power pins (chips' VCC/GND joined without wires) → backlog (symbol view, hidden
  power pins).
- Junction dots: derived and drawn since R02/R04a; nothing left to do (roadmap text updated).

## Context

Read before starting:

- [docs/roadmap.md](../../docs/roadmap.md) — R10's net-label notes, the Place submenu backlog
  item.
- [docs/circuit.md](../../docs/circuit.md) — connectivity, compiler, net ids, design checks.
- [ADR-0006](../../docs/adr/0006-circuit-document-and-connectivity.md) — geometric connectivity,
  designator ids; [ADR-0007](../../docs/adr/0007-io-electrical-model.md) — rails as tied
  outputs, joining by name deferred to R10.
- [docs/editor.md](../../docs/editor.md) — symbol drawing, text, placing, menus, live drawing.
- `src/circuit/connectivity.ts`, `compile.ts`, `checks.ts` — where names join and nets get ids.
- `src/library/io/rails.ts`, `src/editor/symbols/power.ts`, `src/editor/text-placement.ts`.
- `src/ui/workbench-commands.ts` (menus), `src/editor/editor.ts` (place tool).

## Design

### Joining by name (core, circuit)

- `PinDef.net?: string` — the pin joins the circuit-wide net of this name wherever it sits. The
  VCC symbol's pin has `net: 'VCC'`, GND's `net: 'GND'`; a label's one pin has `net: name`
  (its pins are a function of props).
- `ComponentDefinition.schematicOnly?: true` — the part is drawn and connects but isn't
  simulated: the compiler leaves it out of the netlist. So placing, moving or renaming a label
  that changes no pin connections keeps the netlist's structure, and a running simulation goes
  on untouched (`sameNetlistStructure`; net ids don't matter there). Rails stay simulated: they
  drive their level.
- `connect(pins, wires, names?)` unions the nodes of pins that carry the same name before nets
  are numbered. Joining by name adds no junction dots (it isn't geometric).
- Label pins belong to their `CircuitNet` (the editor colors a label by its net) but are kept
  apart from simulated pins (`CircuitNet.schematicPins`): no netlist pins, not counted by
  `undriven-input` or `shorted-outputs`.
- An open pin is one that touches nothing at its point (`Connectivity.openPins`,
  `CompileResult.openPins`): with nets joined by name, "the only pin on its net" no longer
  means unconnected (a lone VCC symbol is on the VCC net with every other one).

### Net ids

- A named net takes one of its names: names from simulated pins (rails) first, then label
  names, each group in code-point order (so VCC tied to GND is called `GND`) — deterministic,
  independent of document order. More than one distinct name
  on a net is a `multiple-net-names` warning ("net has the names CLK, CLOCK; it is called CLK"),
  as in KiCad. A label `VCC` on a GND wire still makes `shorted-outputs` (rails tied together).
- Unnamed nets keep today's ids (first driver pin, first pin, first wire). Pin-based ids contain
  a dot and names can't; a wire-based id equal to a label name gets `#2` (as
  `resolveNetlist`'s implicit nets do).

### Names

- Letters, digits and `_ + - / #`, plus `~{…}` for an overline (Q3); at most 32 characters;
  case-sensitive. No whitespace, no `.` (netlists address pins as `U1.Y`), no `[` `]` (reserved
  for bus ranges, R10b). `PropDef.pattern` (a regex and a hint) makes `resolveProps` reject other
  names, so a bad name is an `invalid-props` error and Properties shows the hint.
- A name's identity is its text: `~{CLR}` and `CLR` are different nets. Drawings overline the
  marked part (C̅L̅R̅); text panels show it with U+0305 overlines, like pin labels.

### The part

- `net/label` in a new Parts family **Nets** (R10b's bus parts and R11's ports join it; VCC and
  GND keep their `io/` types, which never change), keywords `net label tunnel name signal`.
  Designator prefix `NL`, never drawn: the label shows its name only.
- Symbol `kind: 'net-label'`, its width from the name's length (monospaced, 0.6 cell font),
  one pin `N` (`nc`: never read or driven). Labels stack on adjacent DIP pins (D0…D7 on a 245)
  without overlapping: `SymbolDef.centered` raises a one-cell body by half a cell, so it sits
  centered on its pin's row (body y −0.5…0.5, pin tip at the origin); the tag is ±0.4 cell.
- Text upright at any rotation (`uprightText`); a flipped or 180°-rotated label points the other
  way but its name never reads backwards.
- While simulating, the outline takes its net's level color (wires' `SignalStyle`).

### Placing

- From the Parts panel and from **Place ▸ Net Label** (`L`) (Q4), placed with its connection
  point under the pointer (other parts are centered), so a click on a pin tip attaches it. The
  ghost and each placed label get the next name: the last label name placed or set in
  Properties with its trailing number incremented (`D0` → `D1`, `A7` → `A8`), the same name
  when it has no number (`CLK` again), `NET1` for the first label of a session. Generic:
  `ComponentDefinition.nextProps`, which the editor applies to the props of the last part of
  that type placed or edited. Eight clicks put D0…D7 on a bus port.
- Renamed in Properties (**Name**, checked against the pattern as it is typed; spaces at the
  ends dropped); undo says `Change Name` like any prop. The free-text Label row is hidden for
  schematic-only parts (it would never be drawn).

### Place submenu (Q4)

The backlog's design, now built: right click on empty canvas ▸ **Place** ▸ Power (VCC),
Ground (GND), Pull-up, Pull-down (the pull part with its direction preset), Wire, Net Label,
then Part… (Search Parts); the menu bar's Place menu shows the same list. A part item arms the
sticky place tool like a click in the Parts panel (`PlaceTool.props` carries a preset, the
pull's direction). The items aren't checkable: a command with `checked` is a
`menuitemcheckbox`. Port arrives with R11.

### ADR-0015

"Net labels are schematic-only parts; VCC and GND join by name": labels as library parts vs a
new document object (KiCad's model; needs schema v2 and a third selectable kind everywhere),
`PinDef.net` vs the compiler knowing part types, naming priority, circuit-wide scope until R11.

## Tasks

- [x] 1. `core`: `PinDef.net` (non-empty, validated), `ComponentDefinition.schematicOnly`,
  `PropDef.pattern` checked by `resolveProps`; tests.
- [x] 2. `circuit`: `connect` joins named pins; the compiler leaves schematic-only parts out of
  the netlist, names nets (priority, `#2` on collision), keeps label pins apart; tests with
  `test-parts.ts` (circuit tests can't import `library`).
- [x] 3. `circuit`: design checks `single-net-label` (a label name no other label or rail uses)
  and `multiple-net-names`; tests.
- [x] 4. `library`: rails get `net`; the `net/label` part with the name pattern; tests; scenarios
  (two VCC symbols are one net `VCC`, labels join distant parts and the LED follows the switch,
  renaming a label while running keeps the simulator); fix tests that expected rail net ids
  like `PWR1.Y`.
- [x] 5. `editor`: the `net-label` drawer (Q2), overline runs (Q3), upright text, width from the
  name, hidden designator, live outline color; hit area for 1-cell stacking; Symbol Gallery
  entries; symbol and scene tests.
- [x] 6. `editor`/`ui`: the place tool with props from the next name; the Nets family in the
  Parts panel; the Properties name field with the pattern's hint; tests.
- [x] 7. `ui`: the Place submenu and Place menu, `L`; commands tests (Q4).
- [x] 8. Example **Net Labels** (`examples/net-labels.logic.json`, gallery entry); e2e: place
  labels from the Place menu, rename, see them connect (Properties shows the net name), run.
- [x] 9. Docs: circuit.md, components.md, editor.md, glossary, architecture, READMEs,
  ADR-0015; roadmap (R10 split into R10a/R10b, R10a done, R10b next; backlog: Place submenu
  built); lessons.

## Acceptance criteria

- [x] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [x] Two labels with the same name in different places are one net: switch → label `A`, label
  `A` → a 74HC00 input; running, the LED follows the switch (scenario test and e2e).
- [x] All VCC symbols are one net called `VCC`, all GND symbols `GND`; every example still
  compiles without design issues and runs as before.
- [x] A net with a label is called by it in Properties, Messages and the Simulation tab.
- [x] A label name used once gives `single-net-label`; two names on one net give
  `multiple-net-names`; an invalid name is refused in Properties with the hint.
- [x] Labels are placed from the Parts panel and from Place ▸ Net Label (`L`, context menu and
  menu bar); after `D0` the next label is `D1`.
- [x] Placing, moving or renaming a label that changes no pin connections while running keeps
  the simulator (no carry-over).
- [x] Labels rotate, flip, move with their wires, copy/paste and undo like parts; their text
  never reads upside down or mirrored; eight labels on adjacent DIP pins don't overlap.
- [x] Looked at in the browser in both themes, stopped and running.

## Open questions

- [x] Q1. One branch for R10 or two — _proposed:_ split, as R04 and R09 were: R10a
  `feat/net-labels` (this plan), R10b `feat/buses` (buses, rippers, hex values; its bus model
  asked when it starts) — **answer:** split (2026-11-07).
- [x] Q2. What a label looks like — _proposed:_ an outlined tag pointing at its connection point,
  the name inside (Logisim's tunnel, Altium's port) — **answer:** the outlined tag; stacked on
  adjacent DIP pins (2026-11-07).
- [x] Q3. How to write active-low names — _proposed:_ KiCad's `~{…}` (`~{CLR}` → C̅L̅R̅, partial
  overlines possible, the syntax a KiCad export would need) — **answer:** KiCad's `~{…}`
  (2026-11-07).
- [x] Q4. Build the Place submenu here — _proposed:_ yes, the backlog's list with Net Label and
  `L` as its shortcut — **answer:** yes, with `L` for Net Label (2026-11-07).

## Progress log

- 2026-11-07 — plan drafted; `main` green (1631 tests). Q1–Q4 answered as proposed: R10 split
  (this branch is R10a), outlined tag, `~{…}` overlines, Place submenu with `L`.
- 2026-11-07 — plan approved; branch started. Roadmap: R10 split into R10a (in progress) and
  R10b `feat/buses` (planned).
- 2026-11-07 — tasks 1–8 done: core fields (`PinDef.net`, `schematicOnly`, `PropDef.pattern`,
  `SymbolDef.centered`, `nextProps`), name joining and net ids in the compiler, the two checks,
  `net/label` and rails by name, the tag drawer (outline in the net color while running, via
  the signal map's label points), geometric open pins, placing by the point with the next name,
  Place menu/submenu with `L`, the Net Labels example (labels named GND tie the 74HC00's unused
  inputs), e2e. 1699 unit tests, 54 e2e green. Looked at in both themes, stopped and running.
- 2026-11-07 — finished: docs (circuit, components, editor, glossary, architecture, READMEs),
  ADR-0015, lessons; a host test that a label joining nothing new keeps the running simulator.
  Acceptance criteria checked: `pnpm check` (1700 tests), `pnpm build`, `pnpm e2e` (54) green;
  labels join distant pins (scenario + e2e); every VCC/GND symbol on `VCC`/`GND` and the examples
  compile clean and run; named nets in Properties, Messages and netlist ids (the Simulation
  tab's); both checks and the name hint (unit + e2e); Parts panel, Place menu, context submenu
  and `L`, `D0` → `D1`; no carry-over for labels that join nothing; rotations and stacking seen in
  the browser, both themes, stopped and running. Roadmap: R10a done, R10b next; follow-ups in the
  backlog (net highlighting, rails placed by their pin).

## Handoff

- **State:** done; waiting for the user's approval to merge into `main`.
- **Next step:** merge (`git merge --no-ff`), then R10b `feat/buses` (its bus model is asked at
  its start: KiCad-style member names or Logisim-style rippers).
- **Watch out:** the layer check covers tests: `src/circuit/*.test.ts` use `test-parts.ts`, not
  `library`. Gate commits on `pnpm check`'s exit code (lessons, R03/R09b).
- **Verify with:** `pnpm check`.

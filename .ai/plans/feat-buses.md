# Plan: feat/buses

| Field      | Value                                                                             |
| ---------- | --------------------------------------------------------------------------------- |
| Branch     | `feat/buses`                                                                      |
| Roadmap    | R10b — Buses, rippers, bus values ([roadmap](../../docs/roadmap.md))              |
| Status     | in-progress                                                                       |
| Depends on | R10a (net names, schematic-only parts, `nextProps`), R04b (wire tool, moves), R05 |
| Created    | 2026-11-07                                                                        |

## Goal

Buses as an 8-bit computer's schematic draws them: a thick bus line named `D[0..7]`, bus entries
leaving it towards the chips' data pins, and the bus value in hex on its labels while the
circuit runs. The model is KiCad's (Q1): a bus is a group of ordinary nets named by its members
(`D0`…`D7`), so the kernel and the netlist don't change, and R10a's names, R13's bus decoding and
a future KiCad export all speak the same language. The SAP-1 (R16) and the 6502 build (R20) need
this to stay readable.

## Scope

**In scope**

- `core`: bus names (`D[0..7]`: stem and an index range) and their members; `PinDef.bus` (the pin
  connects on the bus layer); the bus value as text from member levels.
- `circuit`: `Wire.bus` (a bus line) in schema v2 with a migration; connectivity per layer (wires
  with pins, buses with bus pins) in the compiler: `CompileResult.buses`, bus junctions, dangling
  bus ends; `normalizeWires` and `addWires` per layer; the builder draws buses; design checks
  `bus-entry-member`, `multiple-net-names` on buses, `single-net-label` for entries too.
- `library`: `net/label` takes a bus name and then is a bus label (its pin on the bus layer);
  `net/bus-entry` (one bit, named, `D0` → `D1`).
- `editor`: thick bus lines, bus junction dots, the bus-entry drawing, bus colors and bus values
  while simulating; the Bus tool (`B`) and buses dragged out of bus pins and bus ends; moves,
  rotations and normalization keep the layers apart; schematic-only parts placed by their first
  pin.
- `ui`: Place menu entries (Bus `B`, Bus Entry `Z`), the Nets family in the Parts panel, a bus's
  members, levels and value in Properties (bus line, bus label).
- Example **Data Bus** (Q5) and a browser test.
- Docs: circuit.md, components.md, editor.md, glossary, architecture, ADR-0016, roadmap,
  lessons.

**Out of scope** (and where it goes instead)

- A multi-bit ripper (one part fanning a bus out to N adjacent pins) → backlog (Q2: single
  entries handle gaps in a chip's data pins, and stacked entries are as quick).
- KiCad group buses (`{A B C}`), bus aliases → backlog if ever needed.
- Buses through hierarchy (bus ports on subcircuits) → R11.
- Bus decoding in waveforms → R13; bus conditions for breakpoints → R14.
- A radix setting for bus values (decimal, binary on the canvas) → backlog.
- Reworking the SAP-1 examples onto buses → R16, where the whole build is laid out.

## Context

Read before starting:

- [docs/circuit.md](../../docs/circuit.md) — document, connectivity, compiler, net ids, checks,
  editing operations (`normalizeWires`).
- [ADR-0015](../../docs/adr/0015-net-labels.md) — labels as schematic-only parts, joining by
  name; [ADR-0006](../../docs/adr/0006-circuit-document-and-connectivity.md) — geometric
  connectivity; [ADR-0012](../../docs/adr/0012-files-and-sessions.md) — files, autosave.
- [docs/components.md](../../docs/components.md#net-labels-net) — `net/label`, names.
- [docs/editor.md](../../docs/editor.md) — scene, rendering, wire tool, moving, Properties, live
  drawing.
- `src/circuit/connectivity.ts`, `compile.ts`, `checks.ts`, `edit.ts` (`normalizeWires`),
  `schema.ts`, `serialize.ts`, `migrations.ts`.
- `src/library/net/label.ts`, `src/editor/symbols/net.ts`, `src/editor/move.ts`,
  `src/editor/wire-route.ts`, `src/editor/simulation.ts` (`signalMap`), `src/editor/renderer.ts`,
  `src/ui/PropertiesPanel.tsx`, `src/ui/workbench-commands.ts`.

## Design

### The model (Q1: KiCad, by names)

- A **bus** is a group of nets named by its members. A **bus name** is a stem and an index range,
  KiCad's vector bus: `D[0..7]` has the members `D0`…`D7`, `A[15..0]` the members `A0`…`A15`.
  The stem is a net name (overlines allowed: `~{D}[0..3]`), each member must be a valid net name
  (≤ 32 characters), at most 64 members. Member `STEMi` is bit `i − min` of the bus value,
  whichever way the range is written.
- The netlist doesn't know buses: members are ordinary nets joined by name (R10a). A bus line
  only gathers bus labels and bus entries; editing buses never changes the netlist unless an
  entry's bit connection changes (then the usual carry-over).

### Two layers (Q3: a Bus tool, buses connect only to buses)

- `Wire.bus?: true` marks a bus line (document schema v2; `MIGRATIONS[1]` is the identity, v1
  files have no buses; `"bus": true` serialized only on buses). The example files are re-saved
  as v2.
- `PinDef.bus?: true`: the pin connects on the bus layer (a bus entry's bus end, a bus label's
  pin); only `nc` pins.
- The compiler runs `connect` once per layer: plain wires with non-bus pins (nets, as today),
  bus wires with bus pins (buses). Bus pins with a `net` name (bus labels) join every bus of that
  name, as labels join nets. So a plain wire touching a bus connects to nothing there (its end
  is dangling, and the `dangling-wire` message says "a wire doesn't connect to a bus: use a bus
  entry"); a net label on a bus line, or a bus label on a wire, is an open pin.
- `CompileResult` gains `buses: CircuitBus[]` (`id`, `names`, `members`, `pins` — the bus pins
  on it — and `wires`), `wireBuses` (bus wire id → bus id) and `busJunctions`; `danglingEnds`
  and `openPins` cover both layers. A bus is called by its first name (code-point order), else
  by its first bus pin (`BE1.B`), else its first wire; bus ids are their own namespace (only the
  editor uses them). `members` come from its first name; an unnamed bus has none (it connects,
  but shows no value).
- `normalizeWires` normalizes each layer on its own (a bus and a wire never merge, and a bus
  passing a wire's corner doesn't split it); `addWires` takes a `bus` flag; the property test
  (normalization never changes connectivity) runs with buses mixed in.

### Bus labels and bus entries (Q2: single entries)

- **Bus label**: a `net/label` whose name is a bus name (`D[0..7]`) — one Net Label tool, the
  name decides, as in KiCad. Its pin is a bus pin with `net: name`. Same tag drawing, a thicker
  outline; while simulating, the bus value next to the tag (Q4). Not counted by
  `single-net-label`: one label naming a bus line is the normal case.
- **Bus entry** (`net/bus-entry`, designator `BE`, never drawn): KiCad's 45° bus entry carrying
  its member's name. Prop `name` (a net name, default `D0`, `nextProps` → `D1`). Pins: `N` (the
  bit end, `nc`, `net: name`) and `B` (the bus end, `nc`, `bus: true`). Symbol `bus-entry`:
  body 1 × 1 with `N` on the left at offset 0 and `B` on the right at offset 1, so the bit end is
  at (0, 0) and the bus end at (3, 1): a stub, a diagonal across the body, a bus-thick stub. Its
  name in small text by the bit end, upright. Placed by its bit end (schematic-only parts are
  placed by their first pin): clicking down a chip's adjacent data pins puts `D0`…`D7` there
  without wires, their bus ends in one column for a single bus line through them; `F` before
  placing for a chip's left side. Gaps (the 28C16's GND between D2 and D3) need nothing special.
- Checks: `bus-entry-member` (warning) — an entry on a named bus whose name isn't a member ("BE9
  is D9, not a member of bus D[0..7]"); `multiple-net-names` also for a bus with two names;
  `single-net-label` covers entries (a bit name nothing else uses joins nothing).

### Drawing and simulation (Q4: values on bus labels)

- Bus lines 0.3 cell thick (wires 0.125) in the theme's bus color; bus junction dots larger;
  dangling bus ends and open bus pins marked like wires and pins.
- While simulating, the signal map resolves each bus's members to simulator nets by name (a
  member nothing is named after reads `Z`). A bus line is drawn in the `X` color when a member
  is unknown or in contention, the `Z` color when every member floats, else the bus color (a
  bus carries no single level).
- **Bus value**: `0x3F` from its members, one hex digit per nibble, most significant first; a
  nibble with every bit floating shows `Z`, one with any other unknown bit `X` (`0xZZ`,
  `0x3X`); weak levels count as their value. Shown in a value tag after each bus label while
  simulating (`DrawContext.busValue`; the label's layout doesn't change).
- **Properties**: a selected bus line or bus label shows the bus — name, members with their live
  levels, the value in hex, binary and decimal (when fully known); a bus entry shows its name
  field and its bit net's level, like a label.

### Editing

- Tools: `Tool` gains `'bus'` (Place ▸ Bus, `B`): draws bus lines like the wire tool; a bus
  finishes on bus things (bus ends, bus lines, bus pins). In the select tool, dragging out of a
  bus pin or a dangling bus end draws a bus, out of anything else a wire. Undo label `Bus`.
- Moves, rotations, flips: rubber-banding stays geometric, but a wire follows only moving points
  of its own layer, and rule 3's new wires take the layer of the pin or line they continue (an
  entry dragged off a bus line gets a bus stub).
- Copy/paste, delete, undo: buses are wires with a flag; nothing new.
- Place menu: Power, Ground, Pull-up, Pull-down │ Wire `W`, Bus `B`, Net Label `L`, Bus Entry `Z`
  (KiCad's keys) │ Find Part….

### ADR-0016

"Buses are named groups of nets on their own layer": KiCad's named model vs Logisim's
width-indexed wires; bus lines as a flagged wire vs inferred from what they touch vs a separate
document array; entries carrying their member's name vs deriving it from the bus and an index;
single entries vs a multi-bit ripper.

## Tasks

- [x] 1. `core`: bus names (`parseBusName`, `busMembers`), the bus value text from member
  levels, `PinDef.bus` (validated: `nc` only); tests.
- [x] 2. `circuit`: `Wire.bus`, schema v2 with the migration, load/serialize; example files
  re-saved as v2; tests.
- [x] 3. `circuit`: the compiler's bus layer (`buses`, `wireBuses`, `busJunctions`, dangling bus
  ends, open bus pins, bus ids and members), the dangling-wire hint; `addWires` and
  `normalizeWires` per layer, the builder's buses; tests (with `test-parts.ts`), the
  normalization property test with buses.
- [x] 4. `circuit`: checks `bus-entry-member`, `multiple-net-names` on buses, `single-net-label`
  with entries and without bus labels; tests.
- [x] 5. `library`: bus labels (the name pattern, the bus pin), `net/bus-entry`; tests;
  scenarios (two 74HC245s joined over a bus by entries, a member missing reads `Z`, adding a bus
  line or label while running keeps the simulator).
- [x] 6. `editor`: scene and renderer for buses (thick lines, bus dots, marks), the bus-entry
  drawer, bus label outline; live bus colors and the value tag (signal map members); Symbol
  Gallery entries; tests.
- [x] 7. `editor`: the Bus tool, buses dragged out of bus pins and ends, layer-aware routing and
  moves, schematic-only parts placed by their first pin; gesture tests.
- [x] 8. `ui`: Place menu and shortcuts (`B`, `Z`), Parts panel, Properties for buses (members,
  levels, value), the label name hint with bus names; tests.
- [x] 9. Example **Data Bus** (Q5), gallery entry; e2e: draw a bus, place entries `D0`…`D7` on a
  chip, label the bus, run, see the value.
- [x] 10. Docs: circuit.md, components.md, editor.md, glossary, architecture, READMEs,
  ADR-0016; roadmap (R10b done, R11 next; backlog: multi-bit ripper, radix); lessons.

## Acceptance criteria

- [x] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [x] A bus labeled `D[0..7]` with entries `D0`…`D7` on two chips joins their pins bit by bit;
  running, a value driven by one chip arrives at the other (scenario and e2e).
- [x] A plain wire touching a bus line doesn't connect to it and is reported dangling with the
  bus hint; a net label on a bus line and a bus label on a wire are open pins.
- [x] While simulating, every bus label shows its value (`0x3F`, `Z`/`X` nibbles); bus lines
  show unknown and floating members; Properties lists the members' levels and the value.
- [x] An entry whose name isn't a member of its bus gives `bus-entry-member`; two names on one
  bus give `multiple-net-names`.
- [x] Buses are drawn with Place ▸ Bus (`B`) and out of bus pins; entries placed with Place ▸ Bus
  Entry (`Z`) continue `D0` → `D1`; moves, rotations, copy/paste and undo keep buses buses.
- [x] v1 files (every example, an autosaved session) open unchanged; saved files are v2.
- [x] Adding, moving or relabeling a bus line while running keeps the simulator.
- [x] Looked at in the browser in both themes, stopped and running.

## Open questions

- [x] Q1. Bus model — _proposed:_ KiCad's, joined by member names — **answer:** by names, as
  KiCad (2026-11-07).
- [x] Q2. How bits leave a bus — _proposed:_ single bus entries carrying their member's name —
  **answer:** single entries (2026-11-07).
- [x] Q3. Bus lines — _proposed:_ a Bus tool; bus lines connect only to buses, bus entries and
  bus labels; `Wire.bus` in schema v2 — **answer:** a separate Bus tool (2026-11-07).
- [x] Q4. Where the bus value shows — _proposed:_ next to each bus label while simulating, the
  bits in Properties — **answer:** on the bus labels (2026-11-07).
- [x] Q5. The example — _proposed:_ a new small **Data Bus** example (an 8-way DIP switch with
  pull-downs through a 74HC245 onto `D[0..7]`, a 74HC574 loading it on a button, eight LEDs; bus
  labels at both ends); the SAP-1 examples stay as they are until R16 — **answer:** a new Data
  Bus example (2026-11-07).

## Progress log

- 2026-11-07 — plan drafted; `main` green (1700 tests). Q1–Q4 answered as proposed: buses by
  member names (KiCad), single entries, a Bus tool with buses on their own layer, values on the
  bus labels.
- 2026-11-07 — Q5 answered (a new Data Bus example); plan approved, branch started. Roadmap:
  R10b in progress.
- 2026-11-07 — tasks 1–5 done: net/bus name grammar moved to core (`NET_NAME`, `BUS_NAME`,
  `LABEL_NAME`, indices 0…99, ≤ 32 characters — expressible as a regex, so `PropDef.pattern`
  stays a regex), `busMembers`, `busValueText`, `PinDef.bus`; `Wire.bus` with schema v2 (identity
  migration, examples re-saved); the compiler's bus layer (`buses`, `wireBuses`, `busJunctions`),
  layer-aware `addWires`/`normalizeWires` (property test with buses), `CircuitBuilder.bus`;
  checks `bus-entry-member`, `multiple-net-names` on buses, `single-net-label` for entries; bus
  labels and `net/bus-entry` with a first drawer; scenario `tests/scenarios/buses.test.ts`.
  1764 tests.
- 2026-11-07 — tasks 6–8 done: bus lines and bus stubs drawn heavy in a bus color (`theme.bus`,
  `SignalStyle.BUS`), bus junction dots only where bus lines meet (dots at every entry looked
  cluttered in the browser), entry designators hidden; the signal map resolves members by name;
  bus label value tag; the Bus tool (`B`), buses dragged out of bus pins/ends, per-layer routing
  index and rubber-banding (`transformLayer`), schematic-only parts placed by their first pin;
  Place ▸ Bus, Bus Entry (`Z`), toolbar icon; Properties' Bus section (value hex/binary/decimal,
  bits MSB first) for bus lines, bus labels and entries. Looked at in the browser, both themes,
  stopped and running. 1774 tests.
- 2026-11-07 — tasks 9–10 done: the Data Bus example (generated with `CircuitBuilder`, every
  net checked, laid out in the browser: the LOAD button and a GND label moved clear of the LED
  bar and the D7 entry), e2e `tests/e2e/buses.spec.ts` (entries with `Z`, Place ▸ Bus, a bus
  label renamed `D[0..1]`, the value following the switches; a wire never finishes on a bus;
  the example runs clean). Docs: circuit.md (buses, layers, schema v2, checks), components.md,
  editor.md, glossary, architecture, READMEs, ADR-0016; roadmap (R10b done, R11 next, bus
  follow-ups in the backlog); lessons. `pnpm check` (1777), `pnpm build`, `pnpm e2e` (57) green.
- 2026-11-07 — finished. Acceptance criteria checked one by one: `pnpm check` (1781 tests),
  `pnpm build`, `pnpm e2e` (57) green; two 74HC245s joined bit by bit over `D[0..7]` (scenario),
  and in the browser the Data Bus example's LOAD latches 0x2A from the bus into the 74HC574 (e2e
  reads its Q pins); a wire ending on a bus is dangling with the hint, labels on the wrong layer
  are open pins (compile tests), and the Wire tool doesn't finish on a bus (e2e); bus values on
  labels (drawer test, screenshots), bus styles X/Z (signal view tests), Properties' value and
  bits (e2e: 0x0 → 0x2 → 0x3, `11 = 3`); `bus-entry-member` and `multiple-net-names` on buses
  (compile and scenario tests); Bus from Place ▸ Bus and `B`, entries with `Z` continuing D0 → D1,
  buses dragged out of bus pins, moves, duplicate, rotate and undo keep bus lines (gesture tests);
  v1 documents and an autosaved v1 session open unchanged, files are written as v2; adding,
  moving and relabeling bus lines keeps the simulator; looked at in both themes, stopped and
  running. Follow-ups in the roadmap backlog (multi-bit ripper, radix setting, group buses).

## Handoff

- **State:** done; waiting for the user's approval to merge into `main`.
- **Next step:** merge (`git merge --no-ff`), then R11 `feat/subcircuits` (bus ports on
  subcircuits belong there).
- **Watch out:** the layer check covers tests (`src/circuit/*.test.ts` use `test-parts.ts`,
  library tests can't import `circuit`). 74HC245 pins are 0-based (A0…A7). Gate commits on
  `pnpm check`'s exit code.
- **Verify with:** `pnpm check`.

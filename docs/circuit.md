# Circuit model

Specification of `src/circuit` (implemented in R02): the circuit document a user draws and saves,
how drawn wires become nets, the compiler to the kernel's [netlist](simulation.md#netlist),
design checks, and a code-first builder. Rationale:
[ADR-0006](adr/0006-circuit-document-and-connectivity.md).

## Document

A document is plain JSON-compatible data. In memory it is immutable (`readonly` types); edits
produce new values.

```ts
interface CircuitDocument {
  schemaVersion: 2;
  circuits: Circuit[]; // at least one; the first is used (R11 gives the others a meaning)
}

interface Circuit {
  id: string; // 'main'
  name: string;
  components: ComponentInstance[];
  wires: Wire[];
}

interface ComponentInstance {
  id: string; // the designator: 'U1', 'SW1', 'D3'
  type: string; // part type id: 'prim/nand', '74xx/74hc00'
  x: number; // grid position of the part's local origin
  y: number;
  rotation: 0 | 90 | 180 | 270; // clockwise, around the local origin
  flip: boolean; // mirror horizontally, applied before the rotation
  props: Record<string, number | boolean | string>;
  label?: string; // free display text: 'RESET', 'CARRY'
}

interface Wire {
  id: string; // 'w1'
  from: [x: number, y: number];
  to: [x: number, y: number];
  bus?: true; // a bus line (R10b): connects only to bus lines and bus pins
}
```

- **Coordinates** are integer grid cells within ±1 000 000; x grows to the right, y downwards
  (as on a canvas), so a clockwise rotation looks clockwise on screen.
- **A wire is one straight horizontal or vertical segment** of non-zero length. An L-shaped
  connection is two wires sharing an end; the editor merges collinear segments into straight runs
  ([Editing](#editing)). A wire with `bus: true` is a **bus line**: drawn heavy, on a layer of
  its own ([Connectivity](#connectivity)); plain wires carry no `bus` field.
- **Ids**: a letter or `_`, then letters, digits, `_` or `-` (`ID_PATTERN`). No dots, because
  netlists address pins as `U1.Y`. Component and wire ids are unique together within a circuit.
- **A component's id is its designator** (`U1`, `SW1`): it is what netlists, diagnostics, the
  simulator API and test benches use, so it must be readable. Renaming a part changes its id
  (an editor command). `label` is free text for display and identifies nothing.
- **Props** are stored as set by the user; the compiler fills defaults (`resolveProps`). The
  editor writes all props at placement, so a file doesn't change meaning when a default changes.

## Loading, versioning, saving

- `parseDocument(text)` / `loadDocument(value)` build a document from JSON. They migrate older
  schema versions, validate the structure and fill defaults (`rotation: 0`, `flip: false`,
  `props: {}`). A `DocumentError` lists **every** problem with its JSON path:

  ```
  circuits[0].components[3].x: expected an integer within ±1000000, got 1.5
  circuits[0].wires[0]: a wire must be horizontal or vertical with non-zero length
  circuits[0].wires[2].id: duplicate id "U1"
  ```

  Unknown fields are rejected. Unknown part types and invalid props are **not** load errors — a
  file must open even if a part is missing; the compiler reports them.
- **Versioning**: `schemaVersion` is required. `MIGRATIONS[n]` upgrades raw version-n JSON to
  n + 1; `migrate()` runs the steps in order and sets `schemaVersion` after each, before
  validation. A file from a newer version is rejected with "this file was saved by a newer
  version of the app". Never edit a released migration; bump `SCHEMA_VERSION` and add one. Schema
  v1 is the first version; v2 (R10b) added bus lines (`"bus": true` on a wire), so its
  migration from v1 changes nothing.
- `serializeDocument(doc)` writes stable JSON: fixed key order, defaults omitted, one line per
  component and per wire, so a saved file diffs well in git. Round trip is lossless:
  `parseDocument(serializeDocument(doc))` equals `doc`.

```text
{
  "schemaVersion": 2,
  "circuits": [
    {
      "id": "main",
      "name": "Main",
      "components": [
        { "id": "U1", "type": "prim/nand", "x": 10, "y": 0 },
        { "id": "U2", "type": "prim/not", "x": 20, "y": 0, "rotation": 90, "props": { "delay": 2000 } }
      ],
      "wires": [
        { "id": "w1", "from": [16, 2], "to": [19, 2] },
        { "id": "w2", "from": [19, 2], "to": [19, 0] }
      ]
    }
  ]
}
```

## Part layouts

Where a part's pins connect is derived from its definition by `partLayout(definition, props)`:
a DIP drawing for parts with a `package`, the part's `symbol` otherwise, and a generic box for
parts with neither. The compiler (connectivity) and the editor (drawing, hit-testing) share it,
so they always agree. A layout has its local origin at the top-left of its bounding box (pin stubs included);
each pin sticks out of the body by one cell and connects at the tip. A layout lists every pin,
power pins included (DIP parts draw them; the kernel ignores them).

**DIP** (definitions with `package`): vertical, notch up, pin pitch one cell, numbered as in the
datasheet drawing — pins 1…N/2 down the left side, N/2+1…N up the right side. Body width 4 cells
up to 20 pins (0.3" packages), 6 above (0.6"), two more when a row's two pin names have more than
7 characters together (the NE555's `RESET` and `CONT`), to leave room for the part name.
A 74HC00 at (0, 0):

```
 x: 0 1  2  3  4 5 6
y=0   ┌──╮  ╭──┐
y=1 ──┤1A    VCC├──   pin 1 at (0, 1), pin 14 at (6, 1)
y=2 ──┤1B     4B├──
y=3 ──┤1Y     4A├──
y=4 ──┤2A     4Y├──
y=5 ──┤2B     3B├──
y=6 ──┤2Y     3A├──
y=7 ──┤GND    3Y├──   pin 7 at (0, 7), pin 8 at (6, 7)
y=8   └─────────┘
```

**Symbol** (no package, `symbol` set — every built-in non-chip part): the body from
`symbol.width` × `symbol.height`, with a one-cell margin for the stubs on each side that has pins;
each pin at its side and offset ([components.md](components.md#symbols-non-package-parts)). A
2-input `prim/nand` at (0, 0) — body 4 × 4, inputs on rows 1 and 3, output on row 2: `A` (0, 1),
`B` (0, 3), `Y` (6, 2). An `io/led`: `A` (0, 1), `K` (4, 1).

**Generic box** (neither package nor symbol; a fallback, no built-in part uses it): `in` pins
down the left side, `out`/`tristate`/`bidir` down the right, `power`/`nc` along the bottom; the
shorter side is centered where the grid allows. Body width 3 cells (more if many bottom pins).
A 2-input gate at (0, 0): `A` (0, 1), `B` (0, 2), `Y` (5, 1).

**Placement**: instance pin position = mirror x (if `flip`) → rotate clockwise around the local
origin → translate by `(x, y)` (`placementOf`, `placePins`, `transformPoint`). Pin sides
(`left`, `top`, …) are transformed the same way, for drawing stubs. `inverseTransformPoint` maps
a grid point back into the part's local cells (which DIP switch a click hit).

## Connectivity

Everything that touches connects (Logisim-like), except wires that merely cross:

| Situation                                            | Connected? |
| ---------------------------------------------------- | ---------- |
| wire end on a pin                                    | yes        |
| two pins on the same point                           | yes        |
| wire end on another wire's end (chain, corner)       | yes        |
| wire end on another wire's interior (T-junction)     | yes        |
| pin on a wire's interior (a wire running over a pin) | yes        |
| collinear overlapping wires                          | yes        |
| two wire interiors crossing                          | **no**     |
| pins of one name (`PinDef.net`), anywhere            | yes        |
| a wire and a bus line, or a pin and a bus pin        | **no**     |

Consequence: a wire that runs along a column of pins (say, past a rotated part) connects to each
pin it passes over. Route around pins.

- **Junction dots** are derived, never stored: a dot is drawn where three or more things meet —
  wire ends and pins count once, a wire passing through counts twice. So a T-junction and a pin on
  a wire's middle get a dot; a corner, an end-to-end joint or a wire ending on a pin don't.
- **Dangling ends**: a wire end that touches nothing else. **Open pins**: a pin that touches
  nothing at its point — geometric, so a lone VCC symbol or a net label away from any wire is
  open though its name puts it on a net with others.
- **Joining by name**: pins with the same `net` name (net labels, the VCC and GND symbols) are
  one net wherever they are, across the whole circuit (local and global names come with R11).
  It adds no junction dots: it isn't a connection on the drawing.
- **Two layers** (R10b): bus lines (`Wire.bus`) and bus pins (`PinDef.bus`: a bus entry's bus
  end, a bus label's pin) connect only among themselves, by the same rules; wires and the other
  pins only among themselves. A wire ending on a bus line touches nothing there (it is
  dangling), a net label on a bus line or a bus label on a wire is an open pin. Bus pins of one
  name (bus labels) join every bus of that name. Bus junction dots are drawn only where bus lines
  meet each other: the entries along a bus would each get one.

`connect(pinPoints, wires, names?)` implements this with union-find over the points where
something ends (wire ends, pins), plus a union of the pins of each name; points inside wires are
found through rows/columns of those points sorted by coordinate, O((P + W) log P). Nets are
numbered by first appearance, pins first. The compiler calls it once per layer.

### Buses

A **bus** is a group of ordinary nets named by its members, as in KiCad
([ADR-0016](adr/0016-buses.md)): a bus named `D[0..7]` has the members `D0`…`D7`, which are nets
joined by name like any other. The bus line itself carries no level and never reaches the
netlist; it gathers the bus labels and bus entries on it. Bus names (`BUS_NAME` in core): a net
name as the stem and a range of indices 0…99 either way round, at most 32 characters
(`D[0..7]`, `A[15..0]`); `busMembers` lists the members least significant first.

## Compiler

```ts
const result = compileCircuit(circuit, registry); // or compileDocument(document, registry)
const sim = new Simulator(result.netlist, registry);
```

```ts
interface CompileResult {
  netlist: Netlist; // components (id, type, props as given) + one net per connected group
  nets: CircuitNet[]; // each net with its placed pins and wires, in netlist order
  wireNets: ReadonlyMap<string, string>; // plain wire id → net id (coloring wires by level)
  buses: CircuitBus[]; // each bus with its names, members, bus pins and bus lines
  wireBuses: ReadonlyMap<string, string>; // bus line id → bus id
  junctions: Point[]; // junction dots, sorted by x, then y
  busJunctions: Point[]; // where bus lines meet
  openPins: ReadonlySet<string>; // 'U1.A' for pins that touch nothing at their point
  issues: DesignIssue[]; // errors first, then warnings
  ok: boolean; // no error-severity issues
}
```

- **Net ids** are deterministic and readable. A named net is called by its first name: names
  from simulated pins (the VCC and GND symbols) before names from net labels, each group in
  code-point order (`CircuitNet.names`). Other nets: the first driver pin (`out`/`tristate`/
  `bidir`, in component then pin order), else the first pin, else (a net made only of wires and
  labels) the first wire's id. Pin names contain a dot and names and ids don't, so they never
  collide; a wire id that is also a net's name gets `#2`. Every net is in the netlist, including
  single unconnected pins and wire-only nets (which read `Z`), so the editor can color every
  wire.
- **Buses** (`CircuitBus`) are called by their first name (bus labels, code-point order), else
  by their first bus pin (`BE1.B`), else their first bus line; bus ids are only compared with
  each other. `members` come from the first name; an unnamed bus has none (it connects, but has
  no value).
- **Schematic-only parts** (`schematicOnly`: net labels) connect but are left out of the
  netlist; their pins are in `CircuitNet.schematicPins`, apart from the simulated `pins`, and no
  design check counts them as inputs or outputs. Adding, moving or renaming a label that
  changes no pin connections keeps the netlist's structure (`sameNetlistStructure`).
- **Never throws on user mistakes.** Components with errors (unknown type, invalid props) are
  left out of the netlist and reported; the rest compiles. Whether to simulate with errors is the
  host's decision: it simulates anyway, without them (R05). Only library bugs throw (an inconsistent package definition).

## Design checks

`DesignIssue = { severity: 'error' | 'warning', code, message, component?, pin?, wire?, net?,
at? }` — enough to locate the issue on the canvas.

| Code                 | Severity | When                                                                                                                                                                                                        |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown-type`       | error    | the part type isn't in the registry                                                                                                                                                                         |
| `invalid-props`      | error    | `resolveProps` rejects the props (message names the prop)                                                                                                                                                   |
| `shorted-outputs`    | error    | two or more strong push-pull (`out`, not `weak`) pins on one net; outputs tied to the same level (`constant`, e.g. two VCC symbols) count as one                                                            |
| `undriven-input`     | warning  | an `in` pin (not `sense`) on a net with no possible driver: unconnected, or only inputs and wires                                                                                                           |
| `dangling-wire`      | warning  | a wire or bus line end that touches nothing (often: one cell short of a pin); a wire ending on a bus line says "use a bus entry"                                                                            |
| `multiple-net-names` | warning  | a net with more than one name (labels `CLK` and `CLOCK` on one wire, a label on a VCC wire), or a bus with more than one; it is called by its first name, the issue sits at the first pin giving the second |
| `single-net-label`   | warning  | a net label or bus entry whose name no other label, entry or VCC/GND symbol uses: it joins nothing by name (a typo?); bus labels never                                                                      |
| `bus-entry-member`   | warning  | a bus entry on a named bus whose name isn't one of the bus's members (`D9` on `D[0..7]`)                                                                                                                    |

An `out` pin with a pull resistor (`weak` pin) or with tri-state outputs is legal; conflicts
between drivers that can actually disagree at run time are the kernel's `contention` diagnostic.

## Builder

`CircuitBuilder` writes documents in code (tests, examples). It throws on programming mistakes
(unknown part, bad props, unknown pin, diagonal segment) immediately.

```ts
const document = new CircuitBuilder(registry)
  .add('S', 'test/driver', { at: [0, 0] })
  .add('U1', 'prim/nand', { at: [10, 0] })
  .add('U2', 'prim/not', { at: [20, 0], rotation: 90, props: { delay: ns(2) }, label: 'OUT' })
  .connect('S.Y', 'U1.A') // straight: (5, 1) → (10, 1)
  .wire([7, 1], [7, 3], 'U1.B') // polyline through points and pins; T-junction at (7, 1)
  .connect('U1.Y', 'U2.A', [19, 2]) // via points; L-shaped where not aligned, horizontal first
  .bus('BE1.B', [12, 9], [20, 9]) // a bus line through points and bus pins
  .document(); // or .build() for the Circuit
builder.pin('U1.Y'); // → [16, 2]
```

Wire ids are generated (`w1`, `w2`, … skipping ids in use). The builder doesn't check what a
route runs over: like in the editor, a route over another pin connects to it.

## Editing

`src/circuit/edit.ts` holds the document operations the editor is built from (R04b) — pure
`Circuit → Circuit` functions that keep unchanged components and wires (so undo snapshots share
them) and return the same circuit when nothing changes.

- **Ids**: `IdAllocator` / `nextDesignator(circuit, prefix)` hand out the lowest unused number
  (`U1, U3` → `U2`); designators and wire ids share one namespace. The prefix comes from the part
  definition (`designatorPrefix`, [components.md](components.md#definition-shape)); generated
  wire ids are `w<n>`.
- **Parts**: `addComponents`, `removeItems` (wires attached to removed parts stay, dangling),
  `updateComponent` (position, rotation, flip, props, label), `renameComponent` with
  `designatorError` for the UI's message, `translateCircuit`.
- **Wires**: `addWires` (generated ids; zero-length segments skipped; bus lines with `bus`) and
  `normalizeWires`, which
  the editor applies after every edit: zero-length wires go, and collinear wires that overlap or
  meet end to end become one straight run — except at a point where perpendicular wires pass
  through (one wire's interior, or two that meet there and merge as well). Wires ending there
  connect to them, a run through the point would only cross, so the run stays split there. The
  result's wire ends are always input wire ends covering the same points, so normalization never
  changes connectivity (a property test checks this on random circuits, bus lines mixed in). A
  merged run keeps the id and position of its first wire. Bus lines and wires are normalized
  apart: they never merge, and one never splits the other.
- **Fragments**: `copyFragment(circuit, items)` is a standalone circuit with the selected parts
  and wires (the clipboard holds it as a one-circuit document); `pasteFragment(circuit, fragment,
  offset, registry)` adds it moved by `offset`, keeping designators that are free, renumbering
  taken ones with their part's prefix, giving wires fresh ids and keeping labels.

## Performance

Measured by `pnpm bench` (`tests/bench/circuit.bench.ts`): a 3 600-part, 10 620-wire schematic
compiles in ≈ 8 ms, serializes in ≈ 10 ms and parses in ≈ 5 ms (Apple M3 Pro, R03; R02 measured
≈ 9 ms with box layouts). Layouts are computed once per part type and props, so symbol
validation costs nothing per instance. Recompiling on every edit is affordable.

## Planned extensions

- Several circuits per document with subcircuit instances _(R11)_.
- Unconnected power-pin and fan-out checks _(backlog)_.

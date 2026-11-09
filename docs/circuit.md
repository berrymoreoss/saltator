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
  schemaVersion: 7;
  circuits: Circuit[]; // at least one; the first is the top circuit (R11a)
}

interface Circuit {
  id: string; // a slug: 'main', 'decade-counter'
  name: string; // display text: 'Decade Counter'
  components: ComponentInstance[];
  wires: Wire[];
  probes: Probe[]; // the Waveforms tab's signals, in its order (R13); left out of files when empty
  testScript: string[]; // the circuit's test script, one line each (R15a); left out when empty
  verilog?: { module?: HdlModule }; // a circuit written in Verilog (HDL-1), below
}

type Probe =
  | { ref: string; name?: string; radix?: ProbeRadix } // 'CLK', 'U1.Y', 'D[0..7]'
  | { name: string; members: string[]; radix?: ProbeRadix }; // a group, bit 0 first
type ProbeRadix = 'hex' | 'dec' | 'bin' | 'ascii';

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
- **Circuits** (R11a): the first circuit of a document is the **top** circuit — the one that
  simulates and opens at load; the others are subcircuits, placed in it or in each other, in the
  order the Circuits list shows them. A circuit's id is a slug (`CIRCUIT_ID`: lowercase letters
  and digits in runs joined by `-`), unique in the document, made from its name when it is
  added (`circuitIdFor`: `Decade Counter` → `decade-counter`, `-2` if taken); while nothing
  places it, renaming it makes a new id from the new name, once placed the id stays (its
  instances' type names it); `name` is display text.
- **Ids**: a letter or `_`, then letters, digits, `_` or `-` (`ID_PATTERN`). No dots, because
  netlists address pins as `U1.Y`. Component and wire ids are unique together within a circuit.
- **A component's id is its designator** (`U1`, `SW1`): it is what netlists, diagnostics, the
  simulator API and test benches use, so it must be readable. Renaming a part changes its id
  (an editor command). `label` is free text for display and identifies nothing.
- **Props** are stored as set by the user; the compiler fills defaults (`resolveProps`). The
  editor writes all props at placement, so a file doesn't change meaning when a default changes.
  A memory's contents are a string prop of type `image` in sparse hex runs (`"contents":
  "0000:3F065B4F 07FC:0080"`; [components.md](components.md#properties)), so a ROM's program is
  saved with the circuit.
- **Probes** (R13, [ADR-0019](adr/0019-waveforms.md)) are the signals the Waveforms tab shows
  ([editor.md](editor.md#waveforms)), saved with the circuit so a file opens with its signals
  ready: a resolver reference ([Resolver](#resolver)) — a net by name (`CLK`), a pin (`U1.Y`,
  also how an unnamed net is probed, since its id changes with the wiring), a bus (`D[0..7]`) —
  or a **group** of 1-bit references read as one value (`{ "name": "PC", "members": ["U3.Q0",
  …] }`), with an optional display name and radix. They are no part of the netlist (a probe
  edit keeps a running simulator as it is), aren't checked when loading (a probe that names
  nothing is shown greyed with the resolver's reason), are rewritten when a part is renamed
  (`renameComponent`: `U5.A0` → `U7.A0`) and are left out of copies (`copyFragment`).

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
  v1 is the first version; v2 (R10b) added bus lines (`"bus": true` on a wire), v3 (R13) probes
  (`"probes"` on a circuit), so both migrations change nothing; v4 (R11a) gave the circuits after
  the first a meaning (subcircuits) and made circuit ids slugs: its migration turns other ids
  into slugs (only `main` was ever written). The bump makes an older app refuse a document whose
  subcircuits it would ignore. v5 (R15a) added test scripts (`"testScript"` on a circuit, its
  lines; a line break inside one is a load error); its migration changes nothing. v6 (HDL-1)
  added Verilog modules (`"verilog"` on a circuit, [below](#verilog-modules)): its IR is checked
  whole with `hdlModuleProblems` (problems with their path,
  `circuits[1].verilog.module.cells[3].type: …`), and a module with parts or wires is a load
  error; its migration changes nothing. v7 (HDL-8) let a module's IR hold tri-states (`inout`
  ports, `z` port bits, `$tribuf` cells), so an older app refuses such a document as newer
  instead of as broken; its migration changes nothing.
- `serializeDocument(doc)` writes stable JSON: fixed key order, defaults omitted, one line per
  component, per wire, per probe and per line of the test script (no `probes` or `testScript`
  key without any) — a Verilog module instead of its (empty) `components` and `wires` its
  `verilog`: `{}`, or its IR with one line per port, signal and cell — so a saved file diffs
  well in git. Round trip is lossless:
  `parseDocument(serializeDocument(doc))` equals `doc`.

```text
{
  "schemaVersion": 5,
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
      ],
      "probes": [
        { "ref": "U1.Y" },
        { "name": "PC", "members": ["U3.Q0", "U3.Q1", "U3.Q2", "U3.Q3"], "radix": "dec" }
      ],
      "testScript": [
        "bench('inverts', (b) => {",
        "  b.row({ SW1: 1 }, { 'U2.Y': 0 });",
        "});"
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
`B` (0, 3), `Y` (6, 2). An `io/led`: `A` (0, 1), `K` (4, 1). A raised symbol (`raise`) has
its body and pins that many cells higher, above the origin: an LCD module's pins are at y = 7
for every size, a 20 × 4's body spans y = −3 … 6.

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
- **Joining by name**: pins with the same `net` name (net labels, ports, the VCC and GND
  symbols) are one net wherever they are, across the whole circuit; across circuits only the
  power names are ([Flattening](#flattening)).
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

## Subcircuits

R11a (`src/circuit/subcircuit.ts`). A circuit's **ports** ([components.md](components.md#ports-net-port))
are its interface: each joins the net or bus of its name inside, like a net label. Net and bus
labels join only within their circuit; the power names (`VCC`, `GND`) are the same net
everywhere. The kernel never sees the hierarchy: the top circuit is flattened into one netlist
with instance paths (`A1/U3`, [below](#flattening)).

- **Instances**: a circuit placed in another is an ordinary component of type
  `sub/<circuit id>` (`subcircuitType`; the `sub` family is reserved), with no props and the
  designator prefix `A` (IEEE 315's assembly: a board, a module).
- **Document registry**: `documentRegistry(document, library)` is a `ComponentRegistry` with the
  library's parts and a generated definition per circuit of the document, so layouts, scenes,
  drawing and the editor's panels treat an instance like any part. Built from the previous one
  (`documentRegistry(document, library, previous)`), it keeps each definition whose circuit's
  name and ports didn't change, so layouts and scenes built on it stay; the editor caches
  layouts by definition object, not by type. `circuitOf(type)` is the circuit an instance
  places. A generated definition has no behavior: creating one throws (instances are
  flattened).
- **Pins**: one per port (`circuitPorts`), named after it; `in`, `out`, `bidir` as the port's
  direction, a bus port a bus pin (`nc`, `bus`); an overlined name (`~{CLR}`) has a marked
  `label` (C̅L̅R̅). A port giving a name an earlier port gives already is left out (it is a
  `duplicate-port` error).
- **Symbol** (`kind: 'subcircuit'`): a box with the circuit's name in bold on its title row, each
  port's name inside next to its pin. Pins sit on their port's side (`auto`: inputs left, the
  others right) **in the order the ports are drawn**: left and right by y then x, top and bottom
  by x then y — so moving ports in a circuit reorders its instances' pins. Side pins are one
  cell apart below the title; top and bottom pins are one cell apart, centered, their names
  reading across the edge, with rows kept for them (`subcircuitRoom`). Width from the names
  and the title, at least 4 cells. A change of ports moves the pins of every instance: wires
  there may come loose, and the design checks say so.
- **In the outer circuit** an instance's pins connect like any pins but stay out of that
  circuit's netlist (`CircuitNet.instancePins`): an instance output or bidirectional pin is a
  possible driver of its net, never a push-pull output (`shorted-outputs` doesn't count it,
  what drives it is inside); an instance input on a net nothing drives is `undriven-input`. A
  bus at an instance's bus pin: its members are names labels and bus entries may rely on (no
  `single-net-label`), and at an output or bidirectional bus port they may be driven from inside
  (no `undriven-input`; `DocumentRegistry.portsOf` gives the ports' directions).

### Flattening

`src/circuit/design.ts`. The **design** is a document's top circuit (its first, or another
given as `top`) with every instance expanded, for the simulator and the tools:

```ts
const design = compileDesign(document, library, { cache }); // cache: a CompileCache, optional
new Simulator(design.netlist, design.registry);
design.circuits.get('decade-counter'); // that circuit compiled on its own (its scene, its checks)
design.instances; // [{ path: 'A1', designator: 'A1', parent: '', circuit: 'digit' }, { path: 'A1/A1', … }]
design.netOf('A1/A1', 'CLK'); // the flat net of a circuit's local net in an instance
design.circuitAt('A1/A1'); // 'decade-counter'
design.issues; // every circuit's issues with their `circuit`, and the hierarchy's; errors first
```

- **Each circuit is compiled once, on its own**, with the document registry (`compileCircuit`):
  that result is its scene and its design checks wherever it is placed. A `CompileCache` keeps
  results while the circuit and the definitions of the parts it uses stay the same objects, and
  the last document registry (`cache.registry(document, library)`), so an edit inside one
  module recompiles only it — and the circuits placing it when its ports change.
- **Expansion** walks the instances from the top, depth first in document order. An inner
  simulated part becomes `<path>/<id>` (`A1/U3`, `A1/A2/U1`: paths are designators from the
  top down); components keep that order, so `sameNetlistStructure` holds across edits that
  change no connections.
- **Ports join nets**: an instance pin's net outside ∪ the net of the port's name inside. A bus
  port joins the outer bus at the instance's bus pin member by member (bit 0 with bit 0, by the
  members' names on both sides; a member nothing else names is a net of its own, so a named bus
  between two instances connects them). A bus of another width — or, on bus lines or with other
  bus pins, an unnamed one — is a `bus-port-width` warning; the bits that exist connect.
- **Global names**: the names a simulated part's pin joins (`PinDef.net` of the VCC and GND
  symbols: `VCC`, `GND`) are one net everywhere — a module's own VCC symbol, or a net label named
  `GND` inside it, is the top's. Every other name is local: `CLK` inside `A1` is `A1/CLK`.
- **Flat net ids**: a set of joined nets is called by its outermost member — the fewest path
  segments, then the first made: a top-level net keeps its id (so the top's scene maps one to
  one), a net only inside `A1` is `A1/<its local id>` (`A1/CLK`, `A1/U2.Y`), an open instance
  pin's net its pin (`A1.Y`), power nets `VCC`/`GND`. A key already taken (a top-level label
  named `A1/X`) gets `#2`. Every net of every instance is in the netlist, pins or not.
- **A flat document** (no instances) gives exactly `compileCircuit(top).netlist`.
- **Recursion**: an instance whose circuit would contain itself, directly or through others, is a
  `recursive-subcircuit` error in the circuit where the loop closes (`recursiveInstances` checks
  every circuit, used or not); it is left empty, so flattening always ends.
- Never throws on user mistakes; `ok` is false while any circuit has an error. Measured
  (`pnpm bench`): 16 instances of a 50-part cell in two levels compile and flatten in ≈ 0.65 ms,
  ≈ 0.5 ms with the circuits cached.

## Verilog modules

HDL-1 (`src/circuit/verilog.ts`, [ADR-0030](adr/0030-hdl-modules.md)): a **circuit written in
Verilog** has `verilog` instead of parts and wires — `{}` until its first Compile, then
`{ module }`, the IR the library's converter made of Yosys's JSON netlist
([components.md](components.md#verilog-modules-hdl)). The `.v` source is not in the document.
Everything else is a circuit's: it is in the Circuits list, has an id, a name, probes and its
own test script, and is placed as `sub/<id>` (designator `A`), opened in its instances, renamed,
duplicated and deleted like a drawn one.

- **Ports** (`modulePorts`, what `circuitPorts` gives for it): the module's, in declaration
  order, inputs left and outputs right; a vector is a bus port (`addr[15..12]`, the Verilog
  indices) joined to the outer bus member by member, as a drawn circuit's bus port. The
  instance's definition is the same box as a subcircuit's (title "Verilog module: …") with the
  module part's one property, `delay` (15 ns).
- **The part**: the document registry asks the library's registry (`ComponentRegistry.hdlPart`)
  for the part the module runs as — type `hdl/<id>` — once per IR object and name, so edits
  elsewhere keep the same definition and a running simulator keeps its state; it serves that
  type to the kernel (`DocumentRegistry.get('hdl/<id>')`, `modulePart(id)` with the messages).
- **Compiled on its own** (`compileModule`): one part, `U1` (the chip on the module's board), and
  a net per port bit named after its pin (`addr12`, `rom_cs_n`). So flattening needs nothing
  new but one thing: the instance's props (its `delay`) go to the part inside, `A1/U1`; and a
  bench with the module as the top drives its port nets as any circuit's.
- **Issues** of the module's circuit: `hdl-not-compiled` (a warning: no IR yet, nothing to
  place), and the part's messages — `hdl-error` (the IR can't run: the part is left out) and
  `hdl-warning` (an inferred latch, an `init` value) — with the source location in front of the
  message and in `src`.
- `CompileCache` compiles a module again when its part changes; `sameCircuit` compares IRs by
  value, so compiling the same JSON again is no edit.

## Compiler

```ts
const result = compileCircuit(circuit, registry); // or compileDocument(document, registry)
const sim = new Simulator(result.netlist, registry);
```

```ts
interface CompileResult {
  netlist: Netlist; // components (id, type, props as given) + one net per connected group
  nets: CircuitNet[]; // each net with its placed pins (simulated, schematic-only, instance) and wires
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
- **Schematic-only parts** (`schematicOnly`: net labels; graphics such as texts, which have no
  pins, PLT-1) connect but are left out of the
  netlist; their pins are in `CircuitNet.schematicPins`, apart from the simulated `pins`, and no
  design check counts them as inputs or outputs. Adding, moving or renaming a label that
  changes no pin connections keeps the netlist's structure (`sameNetlistStructure`); adding or
  editing a text never changes it.
- **Never throws on user mistakes.** Components with errors (unknown type, invalid props) are
  left out of the netlist and reported; the rest compiles. Whether to simulate with errors is the
  host's decision: it simulates anyway, without them (R05). Only library bugs throw (an inconsistent package definition).

## Design checks

`DesignIssue = { severity: 'error' | 'warning', code, message, component?, pin?, wire?, net?,
at?, src? }` — enough to locate the issue on the canvas (`src`: in a Verilog module's source).

| Code                   | Severity | When                                                                                                                                                                                                        |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown-type`         | error    | the part type isn't in the registry                                                                                                                                                                         |
| `invalid-props`        | error    | `resolveProps` rejects the props (message names the prop)                                                                                                                                                   |
| `shorted-outputs`      | error    | two or more strong push-pull (`out`, not `weak`) pins on one net; outputs tied to the same level (`constant`, e.g. two VCC symbols) count as one                                                            |
| `undriven-input`       | warning  | an `in` pin (not `sense`) on a net with no possible driver: unconnected, or only inputs and wires                                                                                                           |
| `dangling-wire`        | warning  | a wire or bus line end that touches nothing (often: one cell short of a pin); a wire ending on a bus line says "use a bus entry"                                                                            |
| `multiple-net-names`   | warning  | a net with more than one name (labels `CLK` and `CLOCK` on one wire, a label on a VCC wire), or a bus with more than one; it is called by its first name, the issue sits at the first pin giving the second |
| `single-net-label`     | warning  | a net label or bus entry whose name no other label, entry or VCC/GND symbol uses: it joins nothing by name (a typo?); bus labels never                                                                      |
| `bus-entry-member`     | warning  | a bus entry on a named bus whose name isn't one of the bus's members (`D9` on `D[0..7]`)                                                                                                                    |
| `duplicate-port`       | error    | a port giving a name another port of the circuit gives already: two ports `CLK`, or `D3` beside the bus port `D[0..7]` (R11a)                                                                               |
| `recursive-subcircuit` | error    | an instance whose circuit would contain itself, directly or through others; it is left empty ([Flattening](#flattening))                                                                                    |
| `bus-port-width`       | warning  | a bus port on a bus of another width, or on an unnamed bus; the bits that exist connect ([Flattening](#flattening))                                                                                         |
| `hdl-not-compiled`     | warning  | a Verilog module without its IR yet ([Verilog modules](#verilog-modules))                                                                                                                                   |
| `hdl-error`            | error    | a Verilog module's IR the interpreter can't run (a loop, a clock made inside it, …); the module's part is left out                                                                                          |
| `hdl-warning`          | warning  | what a Verilog module runs differently from a Verilog simulator: an inferred latch, an `init` value not simulated yet                                                                                       |

An `out` pin with a pull resistor (`weak` pin) or with tri-state outputs is legal; conflicts
between drivers that can actually disagree at run time are the kernel's `contention` diagnostic.

**Ports** ([components.md](components.md#ports-net-port)) are where a circuit meets the outside:
a net an input or bidirectional port names (a bus port: its members) may be driven from there,
so its inputs aren't `undriven-input`; a name a port gives never makes a label or bus entry a
`single-net-label` (a bus port's members are joined through it).

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
  .tests("bench('inverts', (b) => b.row({ S: 1 }, { 'U2.Y': 1 }));") // the test script (R15a)
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
- **Circuits** (R11a, `src/circuit/document-edit.ts`): pure `CircuitDocument → CircuitDocument`
  operations that keep unchanged circuits — `addCircuit` (empty, an id from the name),
  `renameCircuit` (the name; the id too while nothing places the circuit), `duplicateCircuit` (right after
  it, "<name> copy"), `removeCircuit` (with every instance of it; never the last circuit),
  `setTopCircuit` (moved to the front), `replaceCircuit`; `circuitUses` (where a circuit is
  placed), `circuitsContaining` (the circuits that contain one, itself included: placing any of
  them in it would recurse), `placementsOf(document, root, target)` (the instance paths of
  `target` below `root`).
- **Renames across circuits**: `renamePartInDocument(document, circuit, from, to)` renames a part
  of any circuit and rewrites the probe references that reach it from every circuit, through
  each instance path that leads into it (`A1/U5.A0`); renaming an instance rewrites the paths
  through it.
- **Fragments with instances**: `fragmentDocument(document, fragment)` is the clipboard document
  of a copy — the fragment first, then every circuit its instances need, transitively;
  `importCircuits(document, clipboard)` brings those into the document a paste lands in: a
  circuit of the same id and content is reused, one with a free id added, one whose id holds
  something else added under a new id (`cell-2`) with its instances retargeted, inner circuits
  first.

## Resolver

`src/circuit/resolve.ts` (R12b, [ADR-0018](adr/0018-memory-inspector.md)): references as the
app writes them, turned into the parts and nets of a compiled design (or of one compiled
circuit). The memory inspector, probes (R13), watches and breakpoints (R14) and test benches
([test benches](#test-benches), R15a) find what they show through it; R11a added instance
paths in this one place.

```ts
const resolver = new Resolver(compileDesign(document, registry), registry); // or a CompileResult
resolver.resolve('U5'); // { kind: 'part', part: 'U5', type: 'mem/6116' }
resolver.resolve('U5.A0'); // { kind: 'pin', part: 'U5', pin: 'A0', net: 'A0' }
resolver.resolve('CLK'); // { kind: 'net', net: 'CLK' } — by any name of the net, or its id
resolver.resolve('D[0..7]'); // { kind: 'bus', bus: 'D[0..7]', members: ['D0', …, 'D7'] }
resolver.resolve('U5[10..1F]'); // { kind: 'cells', part: 'U5', type, memory, from: 16, to: 31 }
resolver.resolve('U9'); // 'no part or net named U9'
resolver.memories(); // the parts with `memory`, in designator order (U2 before U10)
resolver.signal('D[0..7]'); // { nets: ['D0', …, 'D7'], vector: true } — what a probe shows
resolver.probe({ name: 'PC', members: ['U3.Q0', 'U3.Q1'] }); // a group: { nets, vector: true }
resolver.netReference('U1.Y'); // how to probe a net: its name, else a (driving) pin on it
resolver.resolve('A1/U3.Q0'); // { kind: 'pin', part: 'A1/U3', pin: 'Q0', net: 'BUS0' } — inside A1
resolver.resolve('A1/CLK'); // a net by a name it has inside A1: { kind: 'net', net: 'A1/CLK' }
resolver.resolve('A1.CLK'); // instance A1's pin: the net it is on, { kind: 'net', net: 'CLOCK' }
```

- A target carries **netlist ids** (component id, net ids); the simulator maps them to indices
  (`componentIndex`, `netIndex`). A pin's net is the one the compiler put it on (an open pin is
  a net of its own).
- A **bus** reference lists its members bit 0 first; a member no net is named after is
  `undefined` (it reads `Z`, as on the canvas); a bus none of whose members is named is refused.
- **Memory cells** (R14, watches): a memory part's designator with an address or a range in
  brackets — `U5[1F]`, `U5[0x10..$1F]` — addresses as the Memory tab's Go to takes them
  (`parseAddress`: hex, bare or with `0x`, `$` or `h`), either way round, within the memory
  (`U5[800]: The last address is 7FF.`). A memory's designator before `[` wins over a bus name
  (`U5[10..15]` is cells, not a bus); another part's is refused (`U1 holds no memory`) unless
  the text is a bus name.
- Parts the compiler left out (design errors) and schematic-only parts (net labels) are not in
  the simulation and don't resolve.
- References that name nothing are refused with the reason (`U1 has no pin Q`, `no part U9`).
- **Instance paths** (R11a): a reference starting with designators of instances and `/`
  (`A1/U3.Q0`, `A2/B1/U1[2..3]`, `A1/D[0..7]`) names a part, pin, net, bus or cells of that
  instance's circuit; targets carry flat ids (`A1/U3`, the flat net the local net is in), so
  a port's name inside is the outer net (`A1/IN` → `HIGH`). An instance's pin (`A1.CLK`) is the
  net it is on, a bus pin (`A1.Q[0..3]`) its port's bits inside. The instance itself isn't a
  part (`A1 is a subcircuit: name a part or a signal inside it (A1/…)`). Net names may contain
  `/` (`R/W`): the leading segments are walked while they name instances, and a rest that names
  nothing there is tried further out; a path that goes nowhere says where (`no instance B9 in
  A2`, `U1 is not a subcircuit`). `memories()` lists every memory by path, in designator order
  (`A1/U3`, `U2`); `netReference(net)` names a flat net from the outermost circuit it is in
  (`HIGH`, `A1/LOCAL`, `A2/B1/U2.Y`).
- **Renames** (`renameReference(ref, from, to, scopes)`): a part's pins (`U5.A0` → `U7.A0`), the
  paths through a renamed instance (`A1/U3.Q0` → `A3/U3.Q0`), and with `scopes` — the instance
  paths of the circuit the part was renamed in — the part in every instance (`A1/U1.Q`,
  `A2/U1.Q`).
- **Probes** (R13): `signal(reference)` gives the nets a net, pin or bus reference shows (a part
  is refused: "U5 is a part: probe one of its pins"), `probe(probe)` also groups, whose members
  must each be one signal ("D[0..7] is a bus: a group's members are single signals"; a failing
  member is named: "U9.Y: no part U9"). `netReference(net)` is how the editor stores a probe
  on a wire: the net's name, else a pin on it — a driving one (`out`, `tristate`, `bidir`)
  first. `renameReference(ref, from, to)` rewrites a signal reference after a part rename: its
  pins only (`U5.A0` → `U7.A0`; a net or a bus may be called like a designator).
- `compareDesignators` orders designators as people count them (`U2` before `U10`).

## Test benches

A circuit carries its own **test script** (`Circuit.testScript`, R15a,
[ADR-0025](adr/0025-test-benches.md)): JavaScript registering benches with `bench(name, fn)`,
each run on its own fresh simulation of that circuit **as the top** — a subcircuit tested as a
unit through its ports, the top circuit through its switches and buttons, as a hand on the
board would. `src/circuit/bench/`: values, tables, the bench (`CircuitBench`) and the scripts
(`runBench`, `runTestScript`); pure — the text becomes code only in a script host.

```js
// Circuit: Decade Counter (ports CLK, EN, ~{RST} in; Q[0..3], CO out)
const clear = (b) => {
  b.row({ '~{RST}': 0, EN: 1, CLK: 'C' }, { 'Q[0..3]': 0, CO: 0 });
  b.set({ '~{RST}': 1 });
};

bench('counts to 9, carries, and starts again', (b) => {
  clear(b);
  for (let n = 1; n <= 12; n++) {
    b.row({ CLK: 'C' }, { 'Q[0..3]': n % 10, CO: n % 10 === 9 ? 1 : 0 }, `pulse ${n}`);
  }
});

bench('holds while disabled, without a carry', (b) => {
  clear(b);
  b.clock('CLK', 9);
  b.table`
    EN CLK | Q[0..3] CO
    1  -   | 9       1
    0  -   | 9       0     # CO only while enabled
    0  C   | 9       0     # disabled: holds
  `;
});
```

### Scripts

- The script's top level registers benches (names unique) and may define helpers and
  constants; it sees `bench` and the time helpers `ps`, `ns`, `us`, `ms`, `s` (numbers in
  picoseconds, as core's) — no `Math.random`, no `Date`, no `console`, nothing of the host. It
  runs in strict mode (a typo is an error, `b` is read-only).
- **Each bench loads the script afresh** and runs on a new simulation: benches can't leak state
  into each other, and the same document gives the same report.
- Benches are **synchronous**: a function returning a Promise is an error.

### The API (`b`)

| Call                                  | Does                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `b.set({ ref: value, … })`            | Inputs now: a port's driver (`0`, `1`, `'X'`, `'Z'`, a number for a bus port), a switch (`0`/`1`), a button (`0`/`1` pressed), a DIP switch (a number, switch 1 = bit 0) |
| `b.press(ref)`, `b.release(ref)`      | A button                                                                                                                                                                 |
| `b.action(ref, payload)`              | Any part's action (`sim.action`), for parts the bench doesn't operate itself                                                                                             |
| `b.clock(ref, count = 1)`             | `count` steps of a pulse: LOW at the start, rising at ¼, falling at ¾ (a port's driver, a button's press, a manual clock's `step`)                                       |
| `b.wait(time)`                        | Time passes, inputs held (`us(10)` or `'10us'`)                                                                                                                          |
| `b.row(inputs, outputs, note?)`       | One step: inputs at its start (`'C'` pulses, `'-'` leaves one as it is), outputs checked at its end (`'-'`: not checked)                                                 |
| `` b.table`…` ``                      | Rows of a text table, each one `b.row` ([below](#tables))                                                                                                                |
| `b.expect({ ref: value, … }, note?)`  | Check now: signals (net, pin, bus, instance path) and memory cells (`U5[1F]`, a range takes an array)                                                                    |
| `b.get(ref)`                          | A value now: a number when every bit is known (a BigInt beyond 2⁵³), else as a report writes it (`'X'`, `'Z'`, `'0xX5'`); an array for a range of cells                  |
| `b.memory(ref, address, bytes)`       | Bytes into a memory: an array or hex text (`'2A 55 FF'`); `b.loadIntelHex(ref, text)` loads a file's text                                                                |
| `b.setStep(time)`, `b.step`, `b.now`  | The step a row or a pulse takes (default `us(1)`); the simulated time                                                                                                    |
| `b.random()`, `b.log(…)`, `b.fail(m)` | A number in [0, 1) seeded by the bench's name; a line in the report; a failure that ends the bench                                                                       |

- **Inputs**: the circuit's `in` and `bidir` ports (or one bit of a bus port), each driven by a
  test driver (core's `testDriver`, released until set, so an input never set floats), and the
  interactive parts anywhere in the design (`SW1`, `A1/SW1`), operated by their symbol kind as
  the Interact tool does: `switch`, `button`, `dip-switch`, `clock` (manual only). Anything
  else is refused with the reason.
- **Values**: numbers or BigInts within the width, `0`/`1`, `'X'`, `'Z'`, or text: decimal,
  `0x2A`, `$2A`, `0b101` (`_` between digits), hex and binary digits `X` or `Z`. Expected, `'X'`
  (whole or a digit) is **don't care**, as in data sheets and Digital; `'unknown'` expects every
  bit `X`. A weakly pulled level counts as its value.
- **Time** (Q4 of the plan): a step (default 1 µs) sets the inputs at its start, a pulse rises a
  quarter step later (data set up for a quarter step) and falls at three quarters, and outputs
  are checked at its end, before the next step changes anything. A pulsed port is driven LOW
  from the step's start: a rise from a released `Z` or an unknown level is no edge to a
  flip-flop. A change and a check at one instant see nothing of each other: let time pass.
- **Failures are soft**: a mismatch is recorded with what was there and the bench goes on (all
  failing rows at once, as `functionTable` does); the first 100 are kept, the rest counted.
  Simulation **errors** (contention, `*-violation`s, oscillation) are failures at their
  instant; **warnings** (floating inputs, …) are listed. An exception, a bad reference or a
  halted simulation ends the bench as an `error`; `b.fail` ends it as failed.
- **Memories**: a RAM takes `b.memory` at any time through its `poke`; a ROM's image (its
  `image`-type prop) is replaced in the bench's flattened netlist — that instance only — and
  only before the simulation starts (before anything else in the bench). Addresses are numbers
  or hex text as the Memory tab's Go to takes them.
- Design errors in the circuit or the circuits it places make every bench of it an `error`
  listing them.

### Tables

```text
  ~{RST} EN CLK | Q[0..3] CO
  0      1  C   | 0       0     # comment
  1      1  C   | ${n}    -
```

The first line is the header (inputs `|` outputs); cells are separated by spaces; `-` leaves an
input as it is or doesn't check an output; `C` pulses an input; values as above (`unknown`
too); `${…}` puts a script value in a cell of its own. A table's failures and mistakes name the
row's line in the script. `b.table` also takes a plain string.

### Reports and hosts

```ts
interface ScriptHost {
  load(source: string, globals: Readonly<Record<string, unknown>>): void; // a fresh scope each time
  call(fn: unknown, args: readonly unknown[]): unknown; // within the host's limits
  line(error?: unknown): number | undefined; // the script line, from a stack
}
runBench(document, circuitId, name, library, host); // a BenchResult
runTestScript(document, circuitId, library, host); // { error?, results }
loadTestScript(source, host); // { benches: [{ name, line }], error? }
benchService(library, host); // (request, reply) => void: a runner by messages (R15b)
```

- A result: `status` (`pass`, `fail`, `error`), `failures` (`{ line, time, message, ref,
  expected, actual }`: `line 3 at 1 µs: Q[0..3] is 0xX, expected 0x0`), `failureCount`,
  `error` (`{ message, line }`), `warnings` (the simulation's, merged), `logs`, `time`, `events`.
  It never throws for the script's sake.
- **Hosts**: `functionScriptHost()` runs the script as a `new Function` in this realm (tests;
  inside the app's sandbox) — no isolation, no time limit. The Node host
  (`scripts/script-host.ts`) runs each script in a `node:vm` context holding only its globals,
  with a time limit (60 s) on its top level and on every bench, lines from stack frames. Neither
  is a security boundary: the app runs scripts in a browser sandbox (R15b,
  [editor.md](editor.md#running), [ADR-0026](adr/0026-test-bench-sandbox.md)) with its time
  limits outside it.
- **The bench service** (`bench/service.ts`, R15b): what a runner does, as messages a worker can
  pass — `{ kind: 'load', job, source }` answers `loaded` (the script's benches or its error);
  `{ kind: 'run', job, document, targets: [{ circuit, benches? }] }` answers `planned` (every
  bench it will run, with its line), a `script-error` per circuit whose script doesn't load,
  then `started` (an index into the plan) and `result` for each bench; every request ends with
  `done`. Synchronous and pure; answers are plain data (structured clone).
- **Headless**: `pnpm test:circuits [--timeout=ms] [files…]` (default: `examples/*.logic.json`)
  prints one line per bench, every failure, log and error, and a summary; exit 0 when all
  passed, 1 when one failed or erred or a script didn't load, 2 when a file didn't load. CI runs
  it; `pnpm check` runs every example bench (`tests/scenarios/example-benches.test.ts`).
- References are not rewritten when a part is renamed (they are strings in code, maybe
  computed): the bench then says `U9: no part or net named U9`.

## Performance

Measured by `pnpm bench` (`tests/bench/circuit.bench.ts`): a 3 600-part, 10 620-wire schematic
compiles in ≈ 8 ms, serializes in ≈ 10 ms and parses in ≈ 5 ms (Apple M3 Pro, R03; R02 measured
≈ 9 ms with box layouts). Layouts are computed once per part type and props, so symbol
validation costs nothing per instance. Recompiling on every edit is affordable.

## Planned extensions

- Unconnected power-pin and fan-out checks _(backlog)_.
- Subcircuit follow-ups _(backlog)_: drawn symbols, global labels, parameters per instance, a
  static shorted-outputs check across the hierarchy, circuits imported from other files.

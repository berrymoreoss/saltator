# Plan: feat/subcircuits

| Field      | Value                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| Branch     | `feat/subcircuits`                                                                    |
| Roadmap    | R11a — Subcircuits ([roadmap](../../docs/roadmap.md))                                 |
| Status     | in-progress                                                                           |
| Depends on | R02 (document, compiler), R10a/R10b (labels, buses), R12b (resolver), R13/R14 (tools) |
| Created    | 2026-11-08                                                                            |

## Goal

Hierarchical design: a document holds several circuits, and a circuit can be placed in another
as a **subcircuit instance** — a box whose pins are the circuit's **ports** — the way a real
build is made of modules (Ben Eater's clock, registers, ALU are separate boards on one bus). The
compiler flattens the hierarchy into the kernel's flat netlist (instance paths `A1/U3`), so the
kernel and the parts don't change; the editor edits any circuit of the document while the top
circuit simulates, and the memory inspector, probes, watches and breakpoints reach into
instances by path (`A1/U3.Q0`). R15's test benches need exactly this to test a module as a
unit, and R16a builds the SAP-1 modules on it. Going _into_ an instance while simulating (live
levels, Interact and Probe inside, breadcrumbs) is R11b.

## Scope

**In scope**

- `circuit`: schema v4 — circuit ids are slugs (`main`, `decade-counter`), the first circuit is
  the top; subcircuit instances as components of type `sub/<circuit id>`; a document registry
  that serves a generated definition per circuit (pins from its ports, a generated symbol);
  the flattening compiler (`compileDesign`) with hierarchy checks; resolver instance paths;
  edit operations for circuits (add, rename, duplicate, delete, set top) and references
  rewritten across circuits; copy/paste of instances with the circuits they need.
- `library`: the **port** part (`net/port`): name (a net or bus name), direction, side.
- `editor`: the editor holds the whole document and an open circuit; one undo history for the
  document; the simulation, the analyzer, the debugger and the memory inspector work on the
  flattened top design; the port and subcircuit symbol drawers.
- `ui`: a Circuits list (Q5), subcircuits in the Parts panel, Place ▸ Port, Properties of an
  instance and of the open circuit, Messages for every circuit, the document session and
  autosave over every circuit.
- An example built from subcircuits (Q6) and an e2e test that builds one in the app.

**Out of scope** (and where it goes instead)

- Going into an instance while simulating: live levels and indicators inside, Interact and the
  Probe tool inside, breadcrumbs, gestures to go in and out → **R11b** (`feat/subcircuit-navigation`).
- A drawn symbol for a subcircuit (symbol editor, DIP-like module) → backlog.
- Global net labels (joining by name across the hierarchy) → backlog (Q3).
- Parameters per instance (props, a ROM image per instance) → backlog: a ROM inside a
  subcircuit has one image for every instance.
- A static shorted-outputs check across the hierarchy → backlog (the kernel's `contention`
  reports it while running).
- Importing circuits from another file (a module library) → backlog; copy/paste carries them.
- Test benches → R15.

## Context

Read before starting:

- [docs/circuit.md](../../docs/circuit.md) — document, connectivity, compiler, resolver: all
  extended here.
- [docs/editor.md](../../docs/editor.md) — shell, placing, editing while running, files.
- [ADR-0006](../../docs/adr/0006-circuit-document-and-connectivity.md),
  [ADR-0015](../../docs/adr/0015-net-labels.md) (labels; "scope: until R11"),
  [ADR-0016](../../docs/adr/0016-buses.md) (buses as named member nets),
  [ADR-0018](../../docs/adr/0018-memory-inspector.md) (resolver; `/` reserved),
  [ADR-0010](../../docs/adr/0010-running-simulations.md) (carry-over by component id).
- `src/circuit/compile.ts`, `resolve.ts`, `edit.ts`, `schema.ts`, `migrations.ts`.
- `src/library/net/label.ts` (the model for the port part).
- `src/editor/editor.ts` (state, `edit`, `#show`), `simulation.ts` (`sync`, signal map),
  `analyzer.ts`, `debugger.ts`, `memory-inspector.ts` (all on `scene.compiled` today),
  `history.ts`.
- `src/ui/document-session.ts`, `document-controller.ts`, `autosave.ts`, `parts-filter.ts`.

## Design

### Answered forks (2026-11-08)

- **Split** (Q1): R11 → R11a (this branch) + R11b navigation.
- **What simulates** (Q2): the **top** circuit — the document's first — always, flattened. An
  open definition is drawn without levels in R11a (R11b shows an instance's).
- **Label scope** (Q3): net and bus labels join only within their circuit; the power names are
  global; everything else leaves a circuit through its ports.
- **Ports and symbols** (Q4): a port part with name, direction and side; a generated box
  symbol; bus ports.

### Document (schema v4)

```ts
interface CircuitDocument {
  schemaVersion: 4;
  circuits: Circuit[]; // the first is the top circuit: simulated, opened at load
}
interface Circuit {
  id: string; // a slug: 'main', 'decade-counter' — the part half of a type id
  name: string; // 'Decade Counter': display text, the symbol's title
  // components, wires, probes as before
}
// An instance is an ordinary component:
{ "id": "A1", "type": "sub/decade-counter", "x": 10, "y": 4 }
```

- Circuit ids match `CIRCUIT_ID` (`[a-z0-9]+(-[a-z0-9]+)*`), unique; generated from the name
  when a circuit is added (`Decade Counter` → `decade-counter`, `-2` if taken). Renaming a
  circuit changes its name only; its id stays (instances keep their type).
- **Instances**: type `sub/<circuit id>` (the `sub` family is reserved), no props; designator
  prefix `A` (IEEE 315 "assembly": a separable board or module): `A1`, `A2`. Users rename them
  like any part (`ALU`, `REGA`), which is what paths then read (`REGA/U1.Q0`).
- **Migration v3 → v4**: circuit ids that aren't slugs become slugs (only `main` was ever
  written). The bump also makes an older app refuse a document whose other circuits it would
  ignore ("saved by a newer version").
- **Set as Top Circuit** moves a circuit to the front; the others keep their order (the Circuits
  list's order).

### Ports (`net/port`)

- A schematic-only part like the net label, prefix `P`: `name` (a net name, or a bus name
  `D[0..7]` for a bus port), `direction` (`in` · `out` · `bidir`, default `in`), `side` (`auto`
  · `left` · `right` · `top` · `bottom`, default `auto`: inputs left, outputs and bidir right).
- Its pin joins the circuit's net (or bus) of its name, as a label does; a bus port's pin is a
  bus pin. Drawn as KiCad's hierarchical labels: a flag whose point shows the direction (in:
  into the circuit, out: away from it, bidir: both).
- **Checks**: `duplicate-port` (error: two ports of one name, or a bit in two ports: `D3` and
  `D[0..7]`); `single-net-label` doesn't fire for a port (its name is its outside connection);
  an `in` or `bidir` port counts as a possible driver of its net (no `undriven-input` inside a
  definition for inputs fed by ports).
- In the top circuit a port is a named net with nothing outside — what R15's benches drive.

### Document registry and the generated symbol

`documentRegistry(document, library): ComponentRegistry` (`circuit`): the library's parts plus
one definition per circuit — type `sub/<id>`, name and title from the circuit, prefix `A`,
pins from its ports, a generated symbol — so the existing layout, scene, hit-testing, drawing,
Parts panel, Properties and Part tab work for instances unchanged. The definitions have no
behavior: the compiler never hands a `sub/*` component to the kernel.

- **Pins**: one per port, named after it (`CLK`, `Q[0..3]`); `in` → `in`, `out` → `out`,
  `bidir` → `bidir`, a bus port → a bus pin. For the outer circuit's checks an instance pin is
  a possible driver (`out`, `bidir`) but never a push-pull output (`shorted-outputs` doesn't
  count it): what drives it is inside.
- **Symbol** (`kind: 'subcircuit'`): a box with the circuit's name on top, ports on their side;
  on each side **in the order they are drawn in the definition** — left and right by y then x,
  top and bottom by x then y — so moving ports in the definition reorders the pins. Width and
  height from the names and counts, on the grid.
- **Generation is cached** by each circuit's ports and name: an edit that doesn't touch them
  keeps the definition, so the parent's layouts and scenes stay. A change of ports moves the
  instances' pins in every parent: wires may come loose there, and the checks say so.

### Flattening (`compileDesign`)

```ts
const design = compileDesign(document, registry); // the top circuit, flattened
new Simulator(design.netlist, registry);

interface Design {
  readonly top: string; // circuit id
  readonly netlist: Netlist; // components 'U1', 'A1/U3', 'A1/A2/U1'; flattened nets
  readonly circuits: ReadonlyMap<string, CompileResult>; // each circuit compiled once, alone
  readonly instances: readonly DesignInstance[]; // { path: 'A1/A2', circuit, parent: 'A1' }
  netOf(path: string, net: string): string | undefined; // a circuit's local net in an instance
  busOf(path: string, bus: string): readonly (string | undefined)[] | undefined;
  readonly issues: readonly DesignIssue[]; // every circuit's, each with its circuit; + hierarchy
  readonly ok: boolean;
}
```

- **Every circuit is compiled once, on its own** (`compileCircuit` with the document registry),
  cached by circuit identity: that compile is also the circuit's scene and its design checks.
  Flattening then walks the instances from the top, depth first in document order: an inner
  simulated part becomes `<path>/<id>`, a net is a union of (instance path, local net) pairs.
- **Ports connect**: an instance pin's net in the parent ∪ the net of the port's name inside.
  A bus port joins the parent's bus at the instance's bus pin to the inner bus member by member
  (bit 0 with bit 0); a different width or an unnamed outer bus is a `bus-port-width` warning
  (the bits that exist connect).
- **Global power names**: a name some rail part gives (a simulated pin's `net`: `VCC`, `GND`)
  is global wherever it appears — a rail symbol or a net label named `GND` inside an instance
  is the top's `GND`. Other names are local: `CLK` inside `A1` is `A1/CLK`.
- **Net ids**: the outermost net's id — a top-level net keeps its id (so the top's scene maps
  one to one), a net only inside `A1` is `A1/<local id>` (`A1/CLK`, `A1/U2.Y`), power nets
  `VCC`/`GND`. Unique, because local ids are unique per circuit and top ids have no `/`.
- **Hierarchy checks**: `recursive-subcircuit` (error: a circuit that contains itself, at the
  instance closing the loop; the instance is left out), `bus-port-width` (above). A `sub/*`
  type without its circuit is the existing `unknown-type`.
- Components and nets in a deterministic order (the top's, each instance expanded where it
  stands), so `sameNetlistStructure` keeps the simulator on edits that change no structure.
- A bench (`tests/bench/circuit.bench.ts`): 16 instances of a 50-part module, two levels.

### Resolver

- References take an instance path: `A1/U3` (part), `A1/U3.Q0` (pin), `A1/CLK` (a net by a
  name it has inside `A1`), `A1/D[0..7]` (a bus inside), `A1/U5[1F]` (memory cells), nested
  `A1/A2/U1.Y`. `A9/U1`: `no instance A9`; `U1/U2` where U1 is a chip: `U1 is not a
  subcircuit`. Top-level references are unchanged.
- `memories()`: every memory of the design with its path (`U2`, `A1/U3`), in designator order.
- `netReference(net)`: the shortest reference to a flat net — a top-level name or pin first.
- `renameReference`: an instance rename (`A1` → `A3`) rewrites the paths through it; a rename
  inside a circuit rewrites references through every instance of that circuit (`A1/U1.Q0`
  and `A2/U1.Q0`). Probes live on the circuit whose Waveforms they are (the top's).

### Editor on documents

- `EditorState` gains `document` and `design` (the flattened top); `circuit` and `scene` stay
  the **open** circuit's, so the gesture and drawing code is untouched. `edit(label, circuit)`
  replaces the open circuit in the document; `editDocument(label, document, options)` does the
  circuit operations (add, rename, duplicate, delete, set top), edits elsewhere (a ROM image in
  `A1/U3` edits its definition's prop) and reference rewrites.
- **One undo history for the document**: an entry holds the documents before and after and the
  circuit edited; undo of an edit in another circuit opens it. Opening a circuit isn't an edit
  (the camera is remembered per circuit).
- `setDocument(document, { open?, fit?, camera? })` replaces `setCircuit` (history cleared,
  simulation stopped).
- **Placing an instance**: the Parts panel's **Subcircuits** group (first) lists the document's
  circuits except the open one and those that contain it; a click arms the place tool, a drag
  places one. Place ▸ Port arms the port.
- **Opening a definition** (Q7): double-click on an instance (any tool that selects; R11b:
  into the instance while simulating), the context menu's Open Subcircuit, the Circuits list.
- **Deleting a circuit** removes its instances too, one undo step; with instances it asks first
  (where they are). The top circuit can't be deleted while it is the only one.

### Simulation and the tools on the design

- `Simulation.sync(design, view, renames)`: the simulator runs `design.netlist`; same-structure
  and carry-over as before, by path ids. Renames expand: `A1` → `A3` renames every `A1/*`; a
  rename inside circuit D renames it in every instance path of D.
- **Live drawing**: the top circuit open → as today (its net ids are the flat ids); another
  circuit open → drawn as when stopped, the status bar saying what simulates (`Main is
  simulating`; R11b: an instance's levels). Interact works on the top circuit.
- The analyzer, the debugger (watches, breakpoints), the memory inspector and the timeline use
  `design` and a resolver over it instead of `scene.compiled`; the Waveforms tab shows the top
  circuit's probes; the Probe tool works on the top circuit (inside instances: R11b, typed
  paths now).

### UI

- **Circuits list** (Q5): a CIRCUITS section above PARTS in the left dock, with its own
  splitter (size and visibility are settings, like the docks): the document's circuits in
  order, the top marked `★`, the open one highlighted, each with its instance count; a click
  opens one; Add Circuit (a button and the menu), and in its context menu Rename, Duplicate,
  Delete, Set as Top Circuit.
- **File ▸ New Circuit** becomes **New Document** (a document holds several circuits); the new
  circuit commands live with the list and in a **Circuit** menu.
- **Properties**: an instance — its circuit (Open), designator, label, placement, its pins
  (ports) with their nets; nothing selected — the open circuit's name (editable), id, top or
  not, where it is used.
- **Messages** lists every circuit's issues, each with its circuit; a click opens it and selects
  the item.
- **Document session**: unsaved = any circuit differs from the saved document; autosave keeps the
  document, the open circuit and a camera per circuit; the example gallery draws the top.
- **Clipboard**: a copy with instances carries the circuits they need (transitively) as further
  circuits of the clipboard document. Pasting reuses a circuit of the same id and content, and
  imports a differing one under a new id (`decade-counter-2`), retargeting the pasted instances.

### ADR

ADR-0023 "Subcircuits: flattened instances, ports, local labels": flattening vs a hierarchical
kernel, `sub/<id>` types from a document registry vs a stored definition per instance, local
labels with global power names (vs global labels), the top circuit simulating (vs the open
one), the generated symbol ordered by drawing.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `circuit`: schema v4 — `CIRCUIT_ID`, migration v3 → v4, validation (unique slug ids),
  serialization; `emptyDocument`, `circuitIdFor(name, taken)`; docs (circuit.md Document).
- [ ] 2. `library` + `editor`: the port part `net/port` (props, pins, symbol, drawer, Place ▸
  Port) and its checks in a single circuit (`duplicate-port`, no `single-net-label`, a driver
  for `undriven-input`); components.md.
- [ ] 3. `circuit`: `documentRegistry` — generated `sub/<id>` definitions (pins from ports,
  symbol ordered by drawing, cached by ports and name); the subcircuit symbol drawer; outer
  checks treat instance pins as possible drivers, never push-pull.
- [ ] 4. `circuit`: `compileDesign` — per-circuit compiles, flattening with path ids, port and
  bus-port joins, global power names, net ids, `recursive-subcircuit`, `bus-port-width`,
  `netOf`/`busOf`; scenario tests with real chips (two instances of one module, two levels);
  bench.
- [ ] 5. `circuit`: resolver over a design — instance paths for parts, pins, nets, buses, cells;
  `memories()` with paths; `netReference`; `renameReference` for instance and inner renames.
- [ ] 6. `circuit`: document edit operations — add, rename, duplicate, delete (with instances),
  set top; part renames rewriting references across circuits; copy/paste carrying circuits.
- [ ] 7. `editor`: the editor on documents — `document`, `design`, open circuit, `edit` /
  `editDocument`, `setDocument`, document-wide history, a camera per circuit.
- [ ] 8. `editor`: simulation host, timeline, analyzer, debugger, memory inspector on the
  design; renames expanded by path; live drawing only for the top; tests of editing a
  definition while running (carry-over keeps the other instances' state).
- [ ] 9. `ui`: Circuits list and Circuit menu, Subcircuits in Parts, Open Subcircuit
  (double-click, context menu), Properties of an instance and of the circuit, Messages per
  circuit, New Document; status bar note.
- [ ] 10. `ui`: document session, autosave and Open Recent over every circuit; the gallery's
  thumbnails; clipboard across documents.
- [ ] 11. Example (Q6) with probes into its instances; examples test; e2e test that adds a
  circuit, places ports, places an instance in Main, wires it, runs it and sees the LED.
- [ ] 12. Docs: circuit.md, editor.md, components.md, simulation.md (paths), architecture.md,
  glossary (subcircuit, instance, port, top circuit, instance path), ADR-0023, roadmap (R11
  split into R11a/R11b, backlog items), lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] A v3 file opens unchanged (its circuit is the top); a v4 file round-trips losslessly; an
  older-version check refuses nothing it used to open.
- [ ] In the app: add a circuit, give it ports (in, out, a bus port), place two instances of it
  in Main, wire them; the instance symbols show the ports on their sides in drawing order;
  moving a port in the definition reorders the pins.
- [ ] Two instances of one module keep their internal nets apart (a label `CLK` in each), while
  `GND`/`VCC` inside them are the top's.
- [ ] Running the example: its outputs behave as the flattened circuit should (scenario test
  against the same circuit drawn flat).
- [ ] Editing a definition while running carries the simulation over; the other instances keep
  their state.
- [ ] A memory inside an instance shows in the Memory tab as `A1/U3`; a probe `A1/U3.Q0`, a
  watch and a breakpoint on an inner signal work; renaming `A1` keeps them.
- [ ] A recursive placement is impossible from the Parts panel and reported if a file has one.
- [ ] Undo restores an edit made in another circuit and opens that circuit.
- [ ] Copying an instance into a new document brings its circuits along.

## Open questions

- [x] Q1. One branch or a split? — _proposed:_ R11a (hierarchy, editing, tools by path) + R11b
  (navigation into instances while simulating) — **answer:** split as proposed (2026-11-08).
- [x] Q2. What does Run simulate? — _proposed:_ the top circuit (the first; Set as Top) —
  **answer:** the top circuit (2026-11-08).
- [x] Q3. Net labels inside subcircuits? — _proposed:_ local; VCC/GND global; global labels in
  the backlog — **answer:** as proposed (2026-11-08).
- [x] Q4. Ports and the instance symbol? — _proposed:_ a port part with direction and side, a
  generated box ordered by drawing, bus ports; a drawn symbol in the backlog — **answer:** as
  proposed (2026-11-08).
- [x] Q5. Where the circuits are listed? — _proposed:_ a CIRCUITS section above PARTS in the
  left dock (own splitter; top marked, open one highlighted, instance counts; commands in its
  context menu and a Circuit menu) rather than tabs over the canvas — **answer:** the left-dock
  section (2026-11-08).
- [x] Q6. The example? — _proposed:_ **Two-Digit Counter**, two levels: Decade Counter
  (74HC163 cleared synchronously after 9 while enabled, 74HC10/08, carry out CO) inside
  Counter Digit with a 74HC4511 (bus port `Q[0..3]` between them, outputs `a`–`g`); Main has
  two Counter Digits, two 7-segment displays, a clock and RESET — **answer:** as proposed
  (2026-11-08).
- [x] Q7. Double-click on an instance? — _proposed:_ opens its circuit (R11b: goes into the
  instance while simulating); Properties through the context menu or the panel — **answer:**
  opens its circuit (2026-11-08).

## Progress log

- 2026-11-08 — plan drafted; Q1–Q7 answered; approved, branch started (R11 split into R11a/R11b
  in the roadmap).

## Handoff

- **State:** plan approved; no code yet.
- **Next step:** task 1 (schema v4).
- **Watch out:** —
- **Verify with:** `pnpm check`.

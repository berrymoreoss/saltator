# Plan: feat/circuit-model

| Field      | Value                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| Branch     | `feat/circuit-model`                                                         |
| Roadmap    | R02 — Circuit document & netlist compiler ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                                  |
| Depends on | R01                                                                          |
| Created    | 2026-11-06                                                                   |

## Goal

Build the circuit model in `src/circuit`: the editable, versioned document a user draws (component
instances placed on a grid, wires), geometric connectivity that turns drawn wires into nets, a
compiler from document to the kernel's `Netlist`, design checks that run before simulation, and a
code-first builder for tests and examples. The editor (R04), the simulator host (R05) and
persistence (R07) all sit on this model, so the file format, the connectivity rules and the
compile result must be right and stable.

## Scope

**In scope**

- `src/circuit`: geometry helpers, document types, JSON parsing/validation with `schemaVersion`
  and a migration runner, stable serialization, part layouts (pin positions), connectivity,
  compiler, design checks, `CircuitBuilder`.
- Small `core` addition: `PinDef.weak` (passive weak drivers such as `prim/pull`), so the
  "shorted outputs" check can tell a pull resistor from a push-pull output.
- Scenario tests (document → compile → simulate) and a compile benchmark.
- Docs: new spec `docs/circuit.md`, architecture section, ADR for the document/connectivity model.

**Out of scope** (and where it goes instead)

- Explicit symbol geometry for IO parts and primitive gate shapes (`symbol`) → R03 (this branch
  provides the fallback layouts and the hook).
- Drawing, hit-testing, editing commands, wire normalization while editing → R04.
- Recompiling while running and preserving state → R05.
- Files on disk, autosave, example gallery → R07.
- Net labels, tunnels, buses → R10. Subcircuits (several circuits per document in use) → R11.
- Power-pin checks, fan-out checks → backlog.

## Context

Read before starting:

- [docs/architecture.md#circuit-model](../../docs/architecture.md#circuit-model) — the starting
  proposal this branch confirms or revises.
- [docs/simulation.md#netlist](../../docs/simulation.md#netlist) — the `Netlist` the compiler
  produces; `resolveNetlist` rules (implicit nets, error reporting).
- [docs/components.md](../../docs/components.md) — `PinDef`, `package`, `props`; `resolveProps`.
- [ADR-0004](../../docs/adr/0004-chips-as-packages.md) (DIP view, generic renderer),
  [ADR-0005](../../docs/adr/0005-layered-architecture.md) (circuit imports only core; registry
  injected).
- `src/core/netlist.ts` (`Netlist`, `NetlistBuilder`, `resolveNetlist`), `src/core/component.ts`,
  `src/core/registry.ts`.
- `.ai/lessons.md`.

## Design

### Module layout

```
src/circuit/
  index.ts          public API
  geometry.ts       Point ([x, y] integer grid coords), Rotation, transforms, segment helpers
  document.ts       CircuitDocument, Circuit, ComponentInstance, Wire; CURRENT_SCHEMA_VERSION
  migrations.ts     migration runner (v1 has none; runner tested with injected migrations)
  schema.ts         parseDocument(json: unknown) → validated, migrated document; DocumentError
  serialize.ts      serializeDocument(doc) → stable, pretty, diff-friendly JSON
  layout.ts         partLayout(definition, props) and instance pin positions (rotation/flip)
  connectivity.ts   union-find over grid points; T-junctions; junction dots
  checks.ts         design checks → DesignIssue[]
  compile.ts        compileCircuit(circuit, registry) → CompileResult
  builder.ts        CircuitBuilder (code-first documents)
```

### Document (schema v1)

```ts
interface CircuitDocument {
  schemaVersion: 1;
  circuits: Circuit[]; // ≥ 1; v1 uses circuits[0] (R11 gives the others a meaning)
}
interface Circuit {
  id: string; // 'main'
  name: string;
  components: ComponentInstance[];
  wires: Wire[];
}
interface ComponentInstance {
  id: string; // the designator: 'U1', 'SW1' (Q3); letters, digits, '_', '-'; no dots
  type: string; // 'prim/nand' — not checked against a registry at load time (see below)
  x: number; // integer grid coordinates of the anchor (local origin)
  y: number;
  rotation: 0 | 90 | 180 | 270; // clockwise
  flip: boolean; // mirror horizontally, applied before rotation
  props: Record<string, PropValue>;
  label?: string; // free display text ("RESET", "CARRY")
}
type Wire = { id: string; from: Point; to: Point }; // one straight segment (Q2)
```

- **Loading** (`parseDocument`) checks structure only: types, integer coordinates, rotation
  values, unique ids, id syntax, orthogonal non-zero-length wires, unknown fields (rejected). It
  reports **all** problems with JSON paths (`circuits[0].wires[3].to: expected [x, y] integers`).
  Unknown part types and bad props are _not_ load errors — a file must open even if a part is
  missing; the compiler reports them.
- **Versioning**: `schemaVersion` is required. Older versions are migrated forward step by step
  (`migrations[n]` turns version n into n + 1); a newer version is rejected with "this file was
  saved by a newer version". v1 has no migrations; the runner is tested with injected ones.
- **Serialization**: stable key order, 2-space indent, defaults omitted (`rotation: 0`,
  `flip: false`, empty `props`), so example files diff well in git. The parser fills defaults, so
  in memory every field is present. Round trip: `parse(serialize(doc))` equals `doc`.
- **Props** are stored as given; the compiler fills defaults with `resolveProps`. The editor
  (R04) will write all props at placement so files don't change meaning when a default changes.
- **"Labels" in the roadmap item** = component display labels (`label`). Named net labels and
  tunnels are R10 (the compiler's net naming leaves room for them).
- Several circuits per document: kept as an array now (as architecture.md proposes) because it
  costs nothing and avoids a migration in R11.

### Part layouts (pin positions) — Q1

`partLayout(definition, props)` returns, in local grid units, a bounding box and the connection
point of every pin (power pins too: DIP parts draw them, wires may attach to them, and the kernel
simply neither reads nor drives them):

- **DIP** (`package.kind === 'dip'`, N pins): vertical, notch up, pin pitch 1 cell. Pins 1…N/2
  down the left side (x = 0, y = 1…N/2), pins N/2+1…N up the right side (x = w), so pin N is
  top-right, as in the datasheet drawing. Width e.g. 4 cells for ≤ 20 pins, 6 for wider
  packages; final numbers set in the task and may be refined by R04 before files exist (R07).
- **Generic box** (no package, no symbol — all `prim/*` today): `in` pins top to bottom on the
  left, `out`/`tristate`/`bidir` pins on the right, pitch 1 cell.
- **Symbol** (R03): explicit pin placement from the definition overrides the fallbacks.
- Instance pin position = flip (mirror x) → rotate (clockwise, around the local origin) →
  translate by `(x, y)`.

Pin positions of `prim/*` parts will change when R03 gives them real symbols; harmless before
R07 (no saved files yet), noted for R03.

### Connectivity — Q4

Rules (Logisim-like: everything that touches connects):

- A wire endpoint connects to any pin, wire endpoint or wire interior at the same grid point
  (T-junction).
- A pin connects to any wire endpoint or wire interior at its point, and to other pins at the
  same point.
- Two wire interiors that cross do **not** connect. Collinear overlapping wires connect (an end
  of one lies on the other).
- **Junction dots** are derived, not stored: a dot is drawn at every point where ≥ 3 wire ends,
  pass-through wires (counting 2) or pins meet. The compile result lists them for the editor.

Algorithm: collect every wire endpoint and pin point; union-find keyed by point; each wire joins
its endpoints and every collected point lying strictly inside it. Points inside segments are
found through an index (horizontal segments bucketed by y and sorted by x; vertical by x),
O((P + W) log W), so recompiling large schematics on every edit (R05) stays cheap.

### Compile result

```ts
interface CompileResult {
  netlist: Netlist; // ready for new Simulator(netlist, registry)
  wireNets: ReadonlyMap<string, string>; // wire id → net id (wire coloring in R05)
  junctions: readonly Point[]; // where dots are drawn
  issues: readonly DesignIssue[];
  ok: boolean; // no error-severity issues
}
```

- **Net ids** are deterministic: named after the net's first driver pin (`out`/`tristate`/
  `bidir`, in component then pin order), else its first pin (`U1.Y`, `U3.A`); a net made only of
  wires is named after its first wire. Wire-only nets are kept in the netlist so the editor can
  color them (`Z`).
- Components with errors (unknown type, invalid props) are left out of the netlist and reported;
  the rest still compiles, so the editor can show everything else. Whether to run with errors is
  the host's call (R05).
- Compile never throws on user mistakes; it throws only on programming errors (e.g. a document
  that didn't come through `parseDocument` and violates its invariants).

### Design checks

`DesignIssue = { severity: 'error' | 'warning', code, message, component?, pin?, wire?, net?,
at? }` — enough to locate the issue on the canvas (click-to-locate in R05).

| Code              | Severity | When                                                                           |
| ----------------- | -------- | ------------------------------------------------------------------------------ |
| `unknown-type`    | error    | a component's type isn't in the registry                                       |
| `invalid-props`   | error    | `resolveProps` rejects its props                                               |
| `shorted-outputs` | error    | ≥ 2 strong push-pull `out` pins on one net (`weak` pins such as pulls ignored) |
| `undriven-input`  | warning  | an `in` pin whose net has no possible driver (unconnected, or only inputs)     |
| `dangling-wire`   | warning  | a wire end that touches nothing (the classic "one cell short of the pin")      |

`out` + `tristate` on one net is legal (contention only when both drive), so it is left to the
kernel's runtime `contention` diagnostic.

### Core addition: `PinDef.weak`

`weak?: boolean` on `PinDef` marks a pin that only ever drives weakly (pull resistors). Static
checks ignore it when counting push-pull outputs; the editor may draw it differently. `prim/pull`
sets it. Kernel behavior is unchanged.

### Code-first builder

```ts
const circuit = new CircuitBuilder(registry)
  .add('U1', 'prim/nand', { at: [10, 4] })
  .add('U2', 'prim/not', { at: [20, 4], rotation: 90, props: { delay: ns(2) } })
  .wire([0, 2], [5, 2], [5, 6]) // polyline → orthogonal wires w1, w2
  .connect('U1.Y', 'U2.A') // L-shaped route between the pin points (optional via points)
  .build(); // Circuit (document() wraps it in a CircuitDocument)
builder.pin('U1.A'); // → [x, y], for hand-placed wires
```

The builder throws on programming mistakes (unknown part, diagonal segment) immediately, since
it is used from code. Auto-routing is a plain L-shape; anything smarter is editor work.

## Tasks

- [ ] 1. Core: `PinDef.weak`; `prim/pull` sets it; docs/components.md. Tests.
- [ ] 2. `geometry.ts`: points, rotation/flip transforms, orthogonal segment helpers (contains
  point, interior vs end). Tests.
- [ ] 3. `document.ts`, `migrations.ts`, `schema.ts`, `serialize.ts`: types, `parseDocument`
  (all problems with paths), migration runner (injected migrations in tests, newer version
  rejected), stable serializer, round-trip tests.
- [ ] 4. `layout.ts`: DIP and generic-box layouts; instance pin positions under every
  rotation/flip. Tests (DIP-14 pins 1, 7, 8, 14; 2-input gate; transforms).
- [ ] 5. `connectivity.ts`: point union-find with the segment index; one test per rule (T-junction,
  pin on wire interior, pin-to-pin, crossing, collinear overlap, junction dots).
- [ ] 6. `compile.ts`, `checks.ts`: netlist, deterministic net ids, `wireNets`, wire-only nets,
  every design check. Tests incl. running compiled netlists in the `Simulator`.
- [ ] 7. `builder.ts`: `CircuitBuilder` with `add`, `wire`, `connect`, `pin`, `build`,
  `document`. Tests.
- [ ] 8. `tests/scenarios`: SR latch and a T-junction fan-out drawn as documents → compile →
  simulate, matching the same circuits built with `NetlistBuilder` (trace hash); crossing wires
  stay separate; save → load → same netlist.
- [ ] 9. `tests/bench/circuit.bench.ts`: compile a large synthetic document (thousands of parts,
  ~10 000 wires); record the time below.
- [ ] 10. Docs: `docs/circuit.md` (document format, layouts, connectivity, checks, compiler,
  builder); architecture.md circuit section (drop _(planned)_); ADR-0006; `src/circuit/README.md`;
  glossary (junction, designator); coverage threshold for `src/circuit`; lessons; roadmap.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green; `src/circuit` imports only `core` (enforced).
- [ ] `pnpm coverage`: `src/circuit` ≥ 90 % lines, enforced by a threshold.
- [ ] Every connectivity rule and every design check has a dedicated test.
- [ ] `parseDocument` reports all structural problems with JSON paths; a newer `schemaVersion`
  is rejected with a clear message; migrations run in order (tested); round trip is lossless.
- [ ] A circuit drawn as a document simulates exactly like the same circuit built with
  `NetlistBuilder` (identical trace hash).
- [ ] Compile benchmark recorded in this plan.
- [ ] `docs/circuit.md`, architecture.md and ADR-0006 describe the implemented model.

## Open questions

Asked at branch start (2026-11-06); all answered.

- [x] Q1. Where do pin positions come from before R03 defines `symbol`? — _proposed:_ derived
  layouts in `circuit/layout.ts` (DIP from `package`, generic box otherwise; `symbol` overrides
  in R03). Alternative: pull a minimal `symbol` (pin positions as data) into core now and declare
  it for every part. — **answer:** derived layouts in `circuit/layout.ts`, as proposed.
- [x] Q2. Wire model? — _proposed:_ one straight horizontal/vertical segment per wire
  (Logisim/KiCad); an L-shape is two wires; the editor merges/splits segments. Alternative:
  orthogonal polylines (Proteus-like). — **answer:** one straight segment per wire
  (`{ id, from, to }`), as proposed.
- [x] Q3. Component identity? — _proposed:_ the designator is the id (`U1`, `SW1`), readable in
  netlists, diagnostics and test benches; renaming is an editor command; optional free-text
  `label`. Alternative: opaque stable id plus a separate designator (KiCad UUID + reference).
  — **answer:** the designator is the id, plus an optional free-text `label`, as proposed.
- [x] Q4. Connectivity strictness? — _proposed:_ everything that touches connects (wire ends and
  pins on a wire's end or interior; pins at the same point); only crossing interiors don't.
  Alternative: pins connect only at wire endpoints. — **answer:** everything that touches
  connects (Logisim-like), as proposed.

## Progress log

- 2026-11-06 — branch created; plan drafted.
- 2026-11-06 — Q1–Q4 answered (all as proposed); plan approved by the user; status in-progress.

## Handoff

- **State:** plan approved, Q1–Q4 answered; implementation starts with task 1.
- **Next step:** task 1 (`PinDef.weak`).
- **Watch out:** architecture.md proposed nanoid ids and polylines; Q2/Q3 deviate (segments,
  designator as id) — record that in ADR-0006 and update architecture.md.
- **Verify with:** `pnpm check`.

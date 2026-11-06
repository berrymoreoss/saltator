# Plan: feat/editor-tools

| Field      | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Branch     | `feat/editor-tools`                                         |
| Roadmap    | R04b — Schematic editing ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                 |
| Depends on | R04a                                                        |
| Created    | 2026-11-06                                                  |

## Goal

Make the schematic view an editor: place parts from the Parts panel, draw orthogonal wires,
move (with wires following), rotate, flip, delete, copy/paste/duplicate, undo/redo every change,
edit designator, label and props in the Properties panel, and reach all of it from menus, the
toolbar, a context menu and shortcuts. Parts get conventional designator prefixes (`U`, `SW`,
`D`, …) from their definitions. After this branch the M1 circuits can be drawn by hand in the
browser; R05 then runs them, R07 saves them.

## Scope

**In scope**

- `core`: `designatorPrefix` on `ComponentDefinition` (validated by the registry); `library`:
  prefixes for every built-in part (Q4).
- `circuit` (pure document operations): next free designator, add/remove/update components,
  rename, wire normalization (merge collinear runs, drop zero-length), fragments (copy a subset
  to a standalone circuit, paste with fresh ids).
- `editor`: edit history (Q2), tools — select/move, place, wire (Q3, Q5), pan; move with
  rubber-banded wires (Q1); rotate/flip/delete/nudge; clipboard; floating paste and duplicate;
  ghost and wire previews in the renderer; context-menu requests to the UI.
- `ui`: editing commands (Edit menu, toolbar, shortcuts), Parts panel arms the place tool (click)
  or places by drag-and-drop, editable Properties (designator, label, position, rotation, flip,
  props by type with validation), context menu, File ▸ New, undo labels in the menu
  ("Undo Move"), status-bar hints per tool.
- e2e tests for every editing interaction; docs, ADR-0009.

**Out of scope** (and where it goes instead)

- Live levels, clicking switches while running, recompiling with state carried across edits →
  R05 (this branch records renames per edit for it).
- Save/load, autosave, "discard unsaved changes?" → R07.
- Net labels, buses, bus rippers → R10. Subcircuits → R11.
- Editing props of several selected parts at once, find-and-replace, re-annotate all
  designators, alignment/distribution tools, wire auto-routing around parts → backlog.

## Context

Read before starting:

- [docs/editor.md](../../docs/editor.md) — the R04a view this builds on (scene, hit-testing,
  selection, commands, the `Editor` facade).
- [docs/circuit.md](../../docs/circuit.md) — document, wires as straight segments, connectivity
  ("everything that touches connects", crossings don't), ids.
- [ADR-0006](../../docs/adr/0006-circuit-document-and-connectivity.md) (wires are segments; ids are
  designators; moving parts must stretch wires), [ADR-0008](../../docs/adr/0008-desktop-workbench.md).
- `src/editor/editor.ts` (gestures, stores), `scene.ts`, `hit-test.ts`, `selection.ts`,
  `renderer.ts`; `src/ui/workbench-commands.ts`, `commands.ts`, `PropertiesPanel.tsx`,
  `PartsPanel.tsx`, `MenuBar.tsx`; `src/circuit/document.ts`, `builder.ts`, `connectivity.ts`;
  `src/app/examples.ts` (its `PREFIX` map is replaced by real prefixes).
- `.ai/lessons.md`.

## Design

### Edit history (Q2)

- **Snapshots.** Documents are immutable, so an undo entry is the circuit (plus the selection)
  before and after an edit; unchanged components and wires are shared between snapshots. A
  3 600-part circuit costs ~30 KB of references per entry; the stack keeps 200 entries.
- `History` (pure, `src/editor/history.ts`): `push({ label, before, after, coalesce? })`, `undo`,
  `redo`, `canUndo`, `labels`. Consecutive entries with the same `coalesce` key merge (arrow-key
  nudges of the same selection, typing into one Properties field commits once anyway). A new
  edit clears the redo stack. Undo/redo restore the selection the edit had.
- **One entry per user action**: a whole drag, one paste, one Properties commit. Previews during a
  gesture (moving, wiring) never touch the history; they render a temporary circuit.
- Every edit goes through `editor.edit(label, change)`; the result also carries `renames`
  (old → new designator) so R05 can carry simulator state across renames (ADR-0006).
- Opening an example and File ▸ New are edits too (undoable) until R07 adds files and the
  "discard changes?" question.

### Document operations (circuit, pure)

`src/circuit/edit.ts`, all `Circuit → Circuit`, unit-tested in Node:

- `nextDesignator(circuit, prefix)` — lowest unused number (`U1`, `U2`, … filling gaps).
  `nextWireId` likewise (`w1`, …).
- `addComponents`, `removeItems(ids)`, `updateComponent(id, patch)`, `renameComponent(old, new)`
  (rejects invalid or taken ids with a message for the UI), `translateItems(ids, dx, dy)`.
- `normalizeWires(wires)` — drops zero-length wires and merges collinear wires that overlap or
  meet end to end, **except** where another wire's interior passes through the joint (two
  segments ending on a crossing wire connect to it; one long wire would cross it unconnected).
  Merging never changes connectivity otherwise ("everything that touches connects"), so a
  straight run is one wire and clicking it selects the whole run. The merged wire keeps the
  smaller id. Applied after every edit that touches wires.
- `copyFragment(circuit, selection)` → a standalone `Circuit` with the selected parts and wires;
  `pasteFragment(circuit, fragment, offset)` → new circuit + the pasted ids: designators kept
  when free, otherwise renumbered with their prefix; wire ids always fresh; labels kept.

### Tools and gestures (editor)

`Tool = 'select' | 'pan' | 'wire' | { place: type }`. Esc cancels the current gesture, then
returns to Select, then clears the selection.

- **Select / move.** Press on an item selects it (as today); dragging a selected item past the
  threshold moves the whole selection, snapped to whole cells, with a live preview; release
  commits one "Move" entry. Arrow keys nudge by one cell (Shift: 10). Dragging from an open pin
  tip or a wire's free end starts a wire instead (Q5).
- **Rubber-band (Q1).** While moving, wires stay connected. Moving points are the pin tips of
  moved parts and the ends of selected wires. For each moving point that touched something
  fixed before the move:
  1. an unselected wire ending there, whose other end also moves → it moves along;
  2. an unselected wire ending there → its end follows; if the wire would go diagonal and its
     fixed end is a plain corner (exactly one perpendicular wire there, nothing else), that
     corner slides and the neighbour stretches (KiCad's drag); otherwise the wire becomes a Z
     (bend at the midpoint) so both ends keep their direction — a pin is still entered head-on;
  3. a pin or a wire's interior (a direct pin-to-pin contact, a pin on a wire) → a new wire is
     drawn from the old point to the new one (an L).
     Then `normalizeWires`. Pure (`src/editor/move.ts`), tested case by case.
- **Place (Q3).** Clicking a part in the Parts panel arms the place tool: a ghost of the part
  (with its next designator) follows the pointer, R rotates and F flips it before placing, a
  click places it with all its resolved props written (circuit.md: a file must not change
  meaning when a default changes) and selects it; the tool stays armed until Esc/V. Dragging a
  part from the panel onto the canvas places one copy where it is dropped.
- **Wire (Q5).** Wire tool (`W`): click starts at a grid point; an L-shaped preview follows the
  pointer (the first leg follows a start pin's direction, otherwise the axis the pointer moved
  along first; `Tab` swaps the bend); each click fixes a corner; clicking a pin, a wire or a
  wire end finishes, double-click finishes anywhere, Backspace removes the last corner, Esc
  cancels. In the Select tool, press-drag-release from an open pin tip or a free wire end draws
  one L. The preview marks where the wire will connect (end dots) so connections along pin rows
  are visible before they are made.
- **Rotate / flip** (`R`, `Shift+R`, `F`, `Shift+F` — vertical flip = flip + 180°): parts turn
  about the selection's center snapped to the grid; selected wires turn with them; attached
  wires rubber-band as in a move.
- **Delete** (`Delete`, `Backspace`): selected parts and wires; wires attached to deleted parts
  stay (dangling, the design check shows them).
- **Copy / cut / paste / duplicate** (`Mod+C/X/V/D`): the clipboard holds the fragment as a
  one-circuit document in the file format (`serializeDocument`), so it round-trips through the
  system clipboard between tabs and into a text editor; parsing reuses `parseDocument`. Keyboard
  copy/paste use the browser's `copy`/`paste` events (no permission prompt); menu items use the
  async Clipboard API with an in-memory fallback. **Paste and duplicate float**: the pasted
  items follow the pointer until a click drops them (Esc cancels) — pasting in place would
  connect to whatever the copies touch.
- **Context menu** (right click): on an item (selected first if it isn't) — Cut, Copy, Paste,
  Duplicate, Delete, Rotate, Flip, Properties; on empty canvas — Paste, Select All, Zoom to Fit.
  The editor reports `{ screen, hit }`; the UI renders it with the menu bar's item component.
- **Double-click** a part → Properties focuses its designator field.

### Designator prefixes (Q4)

`ComponentDefinition.designatorPrefix?: string` (letters only, default `U`), validated by the
registry. Built-in parts:

| Part                                      | Prefix |
| ----------------------------------------- | ------ |
| `prim/*` gates, buffers, constants        | `U`    |
| `prim/pull`                               | `R`    |
| `io/switch`, `io/button`, `io/dip-switch` | `SW`   |
| `io/led`, `io/led-bar`                    | `D`    |
| `io/seven-segment`, `io/hex-display`      | `DS`   |
| `io/clock`                                | `X`    |
| `io/probe`                                | `TP`   |
| `io/vcc`, `io/gnd`                        | `PWR`  |
| 74HC chips (R06)                          | `U`    |

### Properties editing (ui)

- One part: designator (text; Enter commits a rename, invalid or taken ids show the reason and
  don't commit, Esc reverts), label (empty removes it), position (two integers), rotation
  (select), flip (checkbox), each prop by `PropDef.type` — number/integer (min/max/step, unit),
  time (text with units: `10 ns`, `1.5us`; `parseTime` next to `formatTime`), boolean
  (checkbox), enum (select), color (LED color select with swatches), string. Values are checked
  with `resolveProps` before committing; errors stay inline. One commit = one undo entry.
- A prop that changes the layout (gate inputs, DIP-switch count) moves pins; attached wires are
  not re-routed (the design checks show what came loose).
- One wire: endpoints read-only (moving them is the move tool's job). Several items: counts, as
  today.

### Commands, menus, toolbar

- **Edit**: Undo, Redo, Cut, Copy, Paste, Duplicate, Delete, Rotate, Rotate Counter-clockwise,
  Flip Horizontal, Flip Vertical, Select All, Deselect, Find Part. **Place**: Wire, Part… (focuses
  the Parts search). **File**: New, Examples.
- Shortcuts: `Mod+Z`; `Mod+Shift+Z`, `Mod+Y`; `Mod+X/C/V/D`; `Delete`, `Backspace`; `R`,
  `Shift+R`; `F`, `Shift+F`; `W`; arrows, `Shift+arrows`. Commands get optional dynamic labels
  (`label: string | () => string`) for "Undo Move".
- Toolbar: `[select] [pan] [wire] │ [undo] [redo] │ [rotate] [flip] [delete] │ zoom … │ grid,
  gate style`.

### Rendering additions

Ghost of the part being placed and of floating pasted items (translucent), wire preview with
connection marks, moved items drawn from the preview circuit. During a gesture the scene is
rebuilt from the preview circuit at most once per frame (compile ≈ 8 ms for the 3 600-part
stress schematic; small circuits are free).

### Testing

- Pure: `edit.test.ts` (designators, rename, normalization incl. the crossing exception,
  fragments), `history.test.ts`, `move.test.ts` (each rubber-band rule, rotations), wire routing
  (L posture), `parseTime`, command labels — Vitest in Node.
- Scenario: build Hello LED by edits only (place, wire, rename) and check it compiles to the
  same nets as `helloLed()` (`tests/scenarios/editing.test.ts`).
- e2e (`tests/e2e/editing.spec.ts`): place by click and by drag; draw a wire and see the
  `undriven-input` warning go; move a part and keep its connection; rotate, flip, delete;
  undo/redo; copy/paste floating; duplicate; rename and an invalid rename; edit a prop; context
  menu; Esc chains.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. core + library: `designatorPrefix` (registry validation) and prefixes for every
  built-in part; `examples.ts` uses them; docs/components.md.
- [x] 2. circuit: `edit.ts` — designators and wire ids, add/remove/update/rename/translate,
  `normalizeWires`, fragments + tests.
- [x] 3. editor: `History` + `editor.edit()`, undo/redo restoring selection, renames record;
  Edit ▸ Undo/Redo with dynamic labels, File ▸ New.
- [x] 4. editor: delete, rotate/flip about the selection center, arrow nudges (coalesced);
  commands, toolbar, shortcuts.
- [x] 5. editor: rubber-band move (`move.ts`) + drag gesture with live preview.
- [x] 6. editor: wire tool (click-click, L posture, finish/cancel rules) and drag-from-pin in the
  Select tool; preview with connection marks.
- [x] 7. editor + ui: place tool (arm from Parts, ghost, R/F before placing, sticky) and
  drag-and-drop from the Parts panel.
- [x] 8. editor + ui: clipboard (fragments as documents, system clipboard with fallback),
  floating paste and duplicate, cut.
- [x] 9. ui: editable Properties (designator, label, position, rotation, flip, props by type,
  `parseTime`), double-click to focus.
- [x] 10. ui: context menu; status-bar hints per tool and gesture.
- [ ] 11. Tests: editing scenario (Hello LED by edits) and `tests/e2e/editing.spec.ts`; look at
  everything in the browser in both themes; measure drag frame time on the stress schematic.
- [ ] 12. Docs: editor.md (editing, tools, shortcuts), circuit.md (edit operations,
  normalization), architecture.md, ADR-0009 (editing model), glossary, `src/*` READMEs,
  roadmap (R04b done, R05 next), lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] Every built-in part has a designator prefix; placing parts numbers them `U1`, `U2`, `SW1`,
  … filling gaps.
- [ ] The M1 Hello LED circuit can be drawn from an empty document with mouse and keyboard only,
  and compiles to the same nets as the built-in example (scenario test + e2e).
- [ ] Moving, rotating and flipping parts keeps their wire connections (move tests per rule;
  e2e: a moved part's net is unchanged).
- [ ] Wires are orthogonal, merged into straight runs, and never connect where they only cross.
- [ ] Every edit is one undo step; undo/redo restore the document and the selection; the menu
  shows what will be undone.
- [ ] Copy/paste works within the page and between two tabs; paste and duplicate float until
  dropped.
- [ ] Properties edits designator (with validation), label, placement and every prop type; each
  commit is undoable.
- [ ] Context menu and every editing command are reachable from menu, toolbar or shortcut, and
  listed in the shortcuts dialog.
- [ ] Dragging a selection in the 3 600-part stress schematic stays interactive (frame time
  recorded in the plan).
- [ ] docs/editor.md, circuit.md, components.md, architecture.md, ADR-0009 and the roadmap
  describe what was built.

## Open questions

Asked at branch start (2026-11-06); all answered.

- [x] Q1. Moving a part: do attached wires follow (rubber-band) or stay and detach? —
  _proposed:_ rubber-band (KiCad "drag" / Logisim): connections are kept. Alternatives: detach
  (KiCad "move"), both with a modifier. — **answer:** rubber-band.
- [x] Q2. Undo model? — _proposed:_ document snapshots (immutable documents make them cheap;
  can't drift out of sync). Alternative: do/undo command objects. — **answer:** snapshots.
- [x] Q3. Place tool after a click? — _proposed:_ stays armed until Esc/V (Proteus, Logisim,
  KiCad); drag-and-drop from the panel places one. Alternative: one-shot (back to Select). —
  **answer:** stays armed.
- [x] Q4. Designator prefixes? — _proposed:_ field on the part definition, KiCad/IEEE-style
  table above (`U`, `R`, `SW`, `D`, `DS`, `X`, `TP`, `PWR`). Alternative: descriptive (`LED`,
  `DISP`, `CLK`, `PROBE`). — **answer:** KiCad/IEEE style.
- [x] Q5. Wire drawing? — _proposed:_ both: Wire tool (`W`) click-click with corners, and
  drag from a pin tip / wire end in the Select tool. Alternatives: click-click only (KiCad),
  drag only (Logisim). — **answer:** both.

## Progress log

- 2026-11-06 — branch created; plan drafted.
- 2026-11-06 — Q1–Q5 answered as proposed; plan approved by the user; status in-progress.
- 2026-11-06 — the user went out and asked to drive the branch to the end; finish/merge waits for
  their approval. Tasks 1–6 done: designator prefixes; `circuit/edit.ts` (ids, part ops,
  `normalizeWires` with a connectivity property test, fragments); snapshot history +
  `Editor.edit`; `move.ts` rubber-band (pin stubs leave pins head-on — a straight stub along a
  pin column connected to the neighbour pin); delete/rotate/flip/nudge; the Editor's gestures now
  run on `PointerInput` (DOM adapters only), so drag-move, Wire tool, drag-from-pin, place tool,
  floating paste/duplicate and context-menu requests are unit-tested headless
  (`gestures.test.ts`). Place/paste UI wiring (tasks 7–8) still to do.

## Handoff

- **State:** tasks 1–6 committed; the editor side of tasks 7–8 (place tool, drop, clipboard,
  floating paste) is implemented and tested in `src/editor/editor.ts` + `gestures.test.ts`.
- **Next step:** UI — Parts panel arms `editor.placePart(type)` on click and drag-and-drop
  (`editor.dragPart`/`dropPart`), Wire tool command (`W`, own icon), clipboard commands
  (keyboard via `copy`/`paste` events, menus via async Clipboard API + in-memory fallback),
  Duplicate; then task 9 (editable Properties; `requests` store asks to focus it), task 10
  (context menu from `editor.requests`; status hints exist: `statusHint`).
- **Watch out:** `edit()` compares circuits by value (`sameCircuit`), so a no-op edit records
  nothing. Biome reflows nested arrays in tests; compare wires as `'x,y-x,y'` strings.
- **Verify with:** `pnpm check && pnpm build && pnpm e2e`.

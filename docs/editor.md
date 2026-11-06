# Editor and workbench

Specification of `src/editor` (the canvas engine, no React) and `src/ui` (the React shell around
it): the workbench and schematic view (R04a) and editing (R04b); running the simulation in the
editor is R05 _(planned)_. Rationale: [ADR-0008](adr/0008-desktop-workbench.md) (workbench),
[ADR-0009](adr/0009-editing-model.md) (editing).

## Shell

A desktop CAD-style window (`Workbench`), dense like KiCad or Altium: 12 px UI text, 22 px rows,
1 px borders, no page scroll — every region scrolls itself.

```
 File  Edit  Place  View  Help                                       ← menu bar
┌──────────────────────────────────────────────────────────────────┐
│ tools │ undo redo │ rotate flip delete │ zoom │ grid  gate style    │ ← toolbar
├────────────┬──────────────────────────────────────┬──────────────┤
│ PARTS      │                                      │ PROPERTIES   │
│ [search  ] │                                      │ U1  NAND     │
│ ▾ Gates    │            schematic canvas          │ Inputs  2    │
│ ▾ IO       │                                      │ Delay 1 ns   │
│ ── preview │                                      │              │
├────────────┴──────────────────────────────────────┴──────────────┤
│ MESSAGES  2  78   (tabs; Memory, Analyzer later)                  │
├──────────────────────────────────────────────────────────────────┤
│ X 12  Y 4 │ 100 % │ U1 · NAND │ hint …        14 parts · 20 wires │ ✖ 0 ⚠ 1 │
└──────────────────────────────────────────────────────────────────┘
```

- **Docks** are fixed regions around the canvas: Parts (left), Properties (right) and a tabbed
  bottom dock (Messages). Splitters resize them within limits; each can be hidden from its title
  bar or View ▸ Panels. Sizes and visibility are settings (below).
- **Parts**: families as collapsible groups (74HC Logic, Primitives, Input / Output, and Developer
  Fixtures in dev builds); a search box (`/` or `Mod+F`) matching every word against name, title,
  type and keywords; the selected part's preview — its symbol drawn by the canvas drawers — with
  title, pins and datasheet link. Clicking a part arms the place tool with it (the row is marked);
  dragging it onto the canvas places one ([Placing parts](#placing-parts)).
- **Properties**: one part — designator, label, position, rotation, flip and every prop, all
  editable ([Properties](#properties)), plus type, datasheet and pins with their nets; one wire —
  endpoints, length, net and the pins on it; several items — counts by part name; nothing — the
  circuit's name and counts.
- **Messages**: the compile result's design issues, errors first, with code, message and location
  (`U1.A`, `wire w3`). Click selects the item and brings it into view; double-click zooms to it.
  The tab title and the status bar show the counts.
- **Status bar**: grid position under the pointer, zoom, a one-line selection summary, a hint for
  the current tool and gesture (`statusHint`), part/wire counts, redraw time (dev builds),
  error/warning counts (click opens Messages).
- **Context menu** (right click on the canvas): over a part or wire (selected first) — Cut, Copy,
  Paste, Duplicate, Delete, Rotate, Rotate Counter-clockwise, Flip Horizontal, Flip Vertical,
  Properties; over empty canvas — Paste, Select All, Zoom to Fit. A right click while drawing a
  wire, floating a paste or placing parts cancels that instead.
- **Dialogs**: Help ▸ Keyboard Shortcuts (generated from the command registry), About. Escape or
  a click outside closes them.

## Commands and shortcuts

Every action is one `Command` (`src/ui/commands.ts`): id, label, icon, shortcuts, `enabled`,
`checked`, `run`. Menus, toolbar buttons (tooltips show the shortcut), the keyboard handler and
the shortcuts dialog all read the same `CommandRegistry`, which rejects duplicate shortcuts.

- Shortcuts are written once as text — `Mod+0`, `Shift+G`, `Home`, `/`, `Mod++` — where `Mod` is
  ⌘ on macOS and Ctrl elsewhere, and shown as `⌘0` / `Ctrl+0`. Characters typed with Shift on
  common layouts (`+`, `?`) ignore Shift.
- Keys typed into text fields never trigger commands (except commands marked `global`); a
  focused dialog or open menu handles Escape first.
- A command marked `nativeKeys` (Cut, Copy, Paste) shows its shortcut but leaves the key to the
  browser, whose clipboard events the app handles ([Copy and paste](#copy-and-paste)).
- Menus can show a state-dependent label (`menuLabel`): Edit ▸ Undo Move.

| Command             | Shortcuts                  | Command                    | Shortcuts                 |
| ------------------- | -------------------------- | -------------------------- | ------------------------- |
| Select tool         | `V`                        | Undo                       | `Mod+Z`                   |
| Pan tool            | `H`                        | Redo                       | `Mod+Shift+Z`, `Mod+Y`    |
| Wire tool           | `W`                        | Cut, Copy, Paste           | `Mod+X`, `Mod+C`, `Mod+V` |
| Select All          | `Mod+A`                    | Duplicate                  | `Mod+D`                   |
| Escape (see below)  | `Escape`                   | Delete                     | `Delete`, `Backspace`     |
| Find Part           | `/`, `Mod+F`               | Rotate (counter-cw)        | `R` (`Shift+R`)           |
| Zoom In             | `Mod+=`, `Mod++`, `=`, `+` | Flip Horizontal (Vertical) | `F` (`Shift+F`)           |
| Zoom Out            | `Mod+-`, `-`               | Nudge (10 cells)           | arrows (`Shift`+arrows)   |
| Zoom to Fit         | `Mod+0`, `Home`            | Show Grid                  | `Shift+G`                 |
| Actual Size (100 %) | `Mod+1`                    | Toggle Gate Style          | `Shift+I`                 |
| Keyboard Shortcuts  | `?`, `Mod+/`               | Swap wire bend (drawing)   | `Tab`                     |

**Escape** goes one step back: it cancels the current gesture (a drag, a wire being drawn, a
floating paste), else leaves the Wire or place tool for Select, else clears the selection.

## Settings and themes

`Settings` (`src/ui/settings.ts`): theme (`system` · `dark` · `light`), gate style (`ansi` ·
`iec`), grid on/off, scroll-wheel mode (`pan` · `zoom`), and each dock's visibility and size.
They live in `localStorage` (`logic.settings.v1`), saved with a short debounce; reading repairs
each invalid field to its default, and blocked storage (private mode) just means nothing is
remembered.

- **Themes**: CSS custom properties in `src/ui/styles/tokens.css` for both themes, selected by
  `data-theme` on `<html>`; `system` follows `prefers-color-scheme` live. The canvas gets the
  matching `CanvasTheme` (`src/editor/theme.ts`): dark — warm part outlines on near-black; light —
  a KiCad-like maroon on cream "paper". R05 adds signal-level colors.
- Settings are view preferences, never part of the document: the same file looks the same on
  every machine apart from them.

## Camera

World unit = one grid cell = 0.1" (one DIP pin pitch). `screen = (world − origin) × scale` in CSS
pixels (`src/editor/camera.ts`, immutable values).

- 100 % = 16 px per cell; zoom is clamped to 12.5 %…1600 %. Keyboard and toolbar zoom step along a
  √2 ladder through 100 %, so stepping from any zoom lands on round levels. Zoom to fit never
  magnifies beyond 200 % (a lone part doesn't fill the screen).
- **Navigation** (`EditorSettings.wheel`):

  | Input                     | `pan` (default, Figma-like) | `zoom` (KiCad-like)     |
  | ------------------------- | --------------------------- | ----------------------- |
  | Wheel / two-finger scroll | pans                        | zooms about the pointer |
  | Shift + wheel             | pans (horizontally on mice) | pans horizontally       |
  | Pinch, `Mod` + wheel      | zooms about the pointer     | zooms about the pointer |
  | Middle drag, Space + drag | pans                        | pans                    |
  | Pan tool (`H`) + drag     | pans                        | pans                    |

  Pinch gestures arrive as Ctrl+wheel with small deltas and get a higher sensitivity than mouse
  wheels.

## Scene

`buildScene(circuit, registry)` (`src/editor/scene.ts`, pure) precomputes everything drawing and
hit-testing need, once per document change: per part its definition, resolved props, drawing kind
(`symbol` · `dip` · `box` · `broken`), local layout and bounds, placement, world bounds and body,
placed pins (tip, stub base, side, net, open?) and text; per wire its segment and net; junction
dots, dangling wire ends and the design issues from `compileCircuit`. Layouts are cached per type
and props across rebuilds (`LayoutCache`). A part whose type is unknown or whose props don't
resolve is `broken`: a red dashed placeholder, reported in Messages.

## Rendering

`renderScene(ctx, scene, frame, options)` (`src/editor/renderer.ts`) draws a whole frame:
background → grid → hover → selection fill → wires → junctions → parts (pin stubs, body, text) →
open-pin and dangling-end marks → selection box. The `Editor` calls it on demand (a dirty flag and
one `requestAnimationFrame`), never in a loop.

- **HiDPI**: the backing store is `devicePixelRatio` × the CSS size, re-measured by a
  `ResizeObserver` and when the ratio changes (moving to another display, page zoom).
- **Grid**: dots at every cell when a cell is ≥ 8 px on screen, else every 5th, 10th, … cell;
  stronger dots every 10 steps.
- **Culling and level of detail**: parts and wires outside the view are skipped; text smaller
  than 4 px on screen (pin names: 6 px) is skipped; all wires of one style are one path.
- **Lines**: outlines 0.1 cell, wires 0.125 cell, never thinner than 1 CSS px. Junction dots,
  open-pin circles and dangling-end squares keep a minimum screen size.
- **Overlays**: the item under the pointer gets a soft outline; selected parts are drawn in the
  selection color over a tinted box, selected wires in the selection color.
- **Ghosts** (`RenderOptions.ghost`): parts not placed yet (the place tool, a floating paste)
  are translucent and carry no open-pin marks; wires being drawn use the selection color.
  `connections` are rings where they will connect.
- **Budget**: a full redraw of the 3 600-part, 10 620-wire stress schematic (dev builds: File ▸
  Examples ▸ Stress Test) takes ≈ 4 ms at fit zoom and ≈ 1 ms at 100 % (headless Chromium, Apple
  M3 Pro, R04a). Dragging 100 of its parts costs ≈ 3.4 ms per pointer move (the rubber-band
  transform) and ≈ 13 ms per frame including the preview's scene rebuild (compile ≈ 8 ms); the
  drop (normalize, rebuild, panels) ≈ 30 ms once (dev build, R04b).

## Symbol drawing

Parts are drawn by kind (`src/editor/symbols/`): a `symbol.kind` drawer, the generic DIP drawing
for parts with a `package` (ADR-0004), a labeled box for parts with neither or with a kind the
editor doesn't know.

- A drawer gets a `SymbolGraphics` — a subset of the Canvas path API in the part's **local**
  cells, with semantic paints (`line`, `body`, `ink`, `pin`, `text`, `pinText` or a CSS color)
  — and the part's layout, body, props and the gate style. The renderer applies the placement
  (mirror, rotate, move) as a canvas transform and draws the pin stubs from the layout, so drawn
  pins always end where the compiler connects wires. The same drawers draw the Parts preview, and
  a recording `SymbolGraphics` lets tests check every part draws inside its layout.
- **Gate style** (a view setting): ANSI/IEEE 91 distinctive shapes or IEC 60617 rectangles with
  a qualifying symbol (`&`, `≥1`, `=1`, `1`, `▽` for tri-state). ANSI shapes keep a 4-cell height
  centered on the output; gates with more inputs extend their input side with straight lines,
  and input stubs continue to an OR/XOR shape's curved back. Inversion is a bubble at the output.
  Pull resistors follow the style too: zigzag (ANSI) or rectangle (IEC).
- **Kinds**: `gate-and|nand|or|nor|xor|xnor`, `buffer`, `not`, `tristate-buffer`, `constant`,
  `pull-up`, `pull-down`, `vcc`, `gnd`, `switch` and `button` (SPDT/SPST contacts with `1`/`0`
  throws; switches show their power-on position, buttons a plunger), `dip-switch`, `clock`
  (square wave, or a single pulse in manual mode), `led` and `led-bar` (diodes tinted with the LED
  color), `seven-segment`, `hex-display`, `probe`. R04a draws the idle look; R05 draws lit LEDs,
  displayed digits and live switch positions.
- **DIP**: body with the notch at the top, pin numbers outside next to each stub, pin names
  inside (overlined when `activeLow`, after a clock triangle when `clock`), the part name down
  the middle.

## Text

Text never reads upside down or mirrored.

- **Designator and label** (`src/editor/text-placement.ts`): a block of horizontal text outside
  the part's bounding box (pins included) on the first side without pins, in the order top,
  bottom, right, left; designator first, then the label. Power symbols show their rail name
  (VCC, GND) at the end away from the pin instead of a designator.
- **Text inside a symbol** rotates with the part only by 0° or 90° and reads left-to-right or
  bottom-to-top (`uprightText`): a part rotated 180° draws its text at 0°, 270° at 90°, and a
  flipped part moves the anchors, not the glyphs.

## Hit-testing and selection

- `hitTest(scene, point, tolerance)`: a part body (with the tolerance around it) wins; otherwise
  the nearest pin stub or wire within the tolerance (5 px on screen), parts on ties, later items
  over earlier ones.
- **Selection** is a set of part ids and a set of wire ids (`src/editor/selection.ts`). Click
  selects one item; Shift-click toggles; a click on empty canvas clears; dragging on empty
  canvas draws a box — left-to-right selects items entirely inside (solid box), right-to-left
  items it touches (dashed box), Shift adds to the selection. `Mod+A` selects all, Escape clears.
  After a document change the selection keeps the ids that still exist.
- Pressing on an item and dragging moves the selection ([Moving](#moving)); pressing on a pin tip
  or a dangling wire end and dragging draws a wire ([Drawing wires](#drawing-wires)) — a click
  there without a drag selects as usual.

## Editing

Every change to the document is one call of `editor.edit(label, circuit, options)`: it normalizes
the wires ([circuit.md](circuit.md#editing)), ignores edits that change nothing, and records one
undo step. Tools and gestures compute the new circuit with the pure operations in
`src/circuit/edit.ts` and `src/editor/` (`move`, `operations`, `wire-route`, `clipboard`); while
a gesture is in progress the canvas draws a **preview** circuit instead of the document, with
**ghosts** (translucent parts, wires in the selection color) and rings where they will connect.

### Tools

`Tool = 'select' | 'pan' | 'wire' | { kind: 'place', type }`, in the toolbar and View menu
(`V`, `H`, `W`; the place tool is armed from the Parts panel). Tools are sticky: they stay until
another tool is chosen or Escape. The editor's `mode` store says what is going on (`idle`,
`moving`, `boxing`, `panning`, `wiring`, `floating`) for the status-bar hint.

### Placing parts

- Clicking a part in the Parts panel arms the place tool: a ghost of the part with its next
  designator follows the pointer, centered on it; `R`/`Shift+R` turn it and `F`/`Shift+F` mirror
  it before it is placed; each click places one (selected, so Properties shows it) and the tool
  stays armed until Escape or `V`.
- Dragging a part from the panel onto the canvas places one where it is dropped (its ghost
  follows the drag), in the default orientation, and leaves the current tool alone.
- A placed part gets its designator from its definition's prefix — the lowest free number
  (`U1`, `U2`, `SW1`, … filling gaps) — and **every resolved prop** written into the document.

### Moving

Dragging a selected item moves the whole selection by whole cells, shown live and committed on
release as one step; arrow keys nudge it by one cell (`Shift`: ten), consecutive nudges are one
undo step. **Wires follow** (`src/editor/move.ts`): moving points are the pin tips of moved parts,
the ends of selected wires, and fixed wire ends or pins sitting on a selected wire's middle. For
each moving point that touched something fixed:

1. an unselected wire with both ends moving moves along;
2. an unselected wire with one end there follows it: stretched if it stays straight; else, if its
   fixed end is a plain corner (exactly one perpendicular wire there, nothing else), that corner
   slides and the neighbour stretches (KiCad's drag); else it becomes a Z bent at the midpoint,
   so both ends keep their direction;
3. a fixed pin or a fixed wire's interior there (a pin touching a pin, a pin on a wire) gets a new
   wire from the old point to the new one: straight along the pin's axis, otherwise one cell out
   of the pin before turning — a wire running along a part's column of pin tips would connect to
   each of them.

A move can create new contacts where moved parts or bends land on other pins (everything that
touches connects); the design checks report what came loose or got shorted.

### Rotate, flip, delete

- **Rotate** turns the selection a quarter turn about its center (the grid point nearest to the
  center of its bounds); **flip** mirrors it about the same point — horizontally (a part's own
  `flip`) or vertically (flip + half turn). Attached wires follow as in a move. In the place tool
  and while a paste floats they orient the ghost instead.
- **Delete** removes the selected parts and wires; wires attached to deleted parts stay (the
  `dangling-wire` check marks them). While drawing a wire, Delete/Backspace takes back its last
  corner.

### Drawing wires

- **Wire tool** (`W`): a click starts a wire at a grid point; an L-shaped preview follows the
  pointer. The first leg leaves a pin head-on, otherwise it continues at a right angle to the
  previous leg, otherwise it follows the axis the pointer moved along first; `Tab` swaps the bend.
  Each click fixes the corner(s) up to it; clicking a pin, a wire end or a wire finishes the wire,
  a second click on the same point (a double-click) finishes it anywhere. Escape cancels the wire
  being drawn (the tool stays), right click too.
- **Select tool**: press on a pin tip or a dangling wire end, drag, release — one L-shaped wire.
- The preview rings every point where the new path will connect — including pins it merely runs
  over, which connect too ([circuit.md](circuit.md#connectivity)).
- The wire is committed as segments (`addWires`) and normalized: collinear pieces merge into
  straight runs.

### Copy and paste

- **Copy** puts the selected parts and the selected wires on the clipboard as a one-circuit
  document in the file format (`fragmentText`, `serializeDocument`), so it is plain text: it
  pastes into another tab, and any document's text pastes too (`parseFragment` validates and
  migrates it like a file). **Cut** copies, then deletes.
- **Paste** and **Duplicate** float: the items follow the pointer as ghosts until a click drops
  them (one undo step, selected), Escape or right click cancels; `R`/`F` orient them meanwhile.
  Pasted parts keep their designators where they are free and are renumbered with their prefix
  otherwise; wires get fresh ids; labels are kept.
- **Clipboard access** (`src/ui/clipboard.ts`): `Mod+C/X/V` go through the browser's `copy`,
  `cut` and `paste` events (no permission prompt; ignored in text fields). Menu items use the
  async Clipboard API (paste may ask for permission) and fall back to the last copy kept in
  memory when it is refused.

### Properties

The Properties panel edits a single selected part: double-click it, or Edit ▸ Properties, to
focus its designator.

- **Designator**: Enter applies a rename (one step; the edit records `old → new` for R05);
  invalid or taken designators show the reason and are not applied (`designatorError`); Escape
  reverts.
- **Label** (empty removes it), **position** (whole cells), **rotation** (0/90/180/270) and
  **flipped**: placement changes go through the move transforms, so wires follow.
- **Props** by `PropDef.type` (`src/ui/prop-input.ts`): numbers and integers checked against
  `min`/`max` (the unit may be typed), times with units (`10 ns`, `1.5us`, `2 µs`; a bare number
  is nanoseconds; `parseTime` in core), booleans as checkboxes, enums as selects (LED colors with
  a swatch), strings as text. Each commit is one undo step and writes all resolved props. A prop
  that changes the layout (gate inputs, DIP-switch count) moves pins; attached wires are not
  re-routed.

### Undo and redo

`src/editor/history.ts`: an entry is the circuit and the selection before and after one action,
labelled (`Move`, `Place NAND`, `Rename U1`, `Change Delay`); documents are immutable, so
snapshots share every unchanged part and wire ([ADR-0009](adr/0009-editing-model.md)). A new
edit clears the redo stack; 200 entries are kept; consecutive entries with the same `coalesce`
key merge (nudges of one selection). Undo and redo restore the selection too and report the
renames they undo or redo in `state.renames`. Opening an example and File ▸ New are undoable
edits until R07 brings files; loading a circuit with `setCircuit` clears the history.

## Editor API

`new Editor(registry, circuit?, settings?)` (`src/editor/editor.ts`) owns the circuit, its scene,
the selection, the undo history, the camera and the tool. The UI mounts it with
`editor.mount(canvas)` (returns the detach function) and reads through `useSyncExternalStore`:
`editor.state` (circuit, scene, selection, renames), `editor.view` (camera, viewport, pointer
position, last redraw time — changes often, keep consumers small), `editor.tool`, `editor.mode`,
`editor.history` and `editor.requests` (the editor asking the UI to open the context menu or to
focus Properties).

- Document: `setCircuit` (load; clears history), `edit(label, circuit, options)`, `undo`, `redo`,
  `undoLabel`, `redoLabel`.
- Editing: `deleteSelection`, `rotate(clockwise)`, `flip(direction)`, `nudge(dx, dy)`,
  `copySelection`, `cutSelection` (both return clipboard text), `pasteText(text)`, `duplicate`,
  `renamePart`, `setPartLabel`, `setPartProp`, `setPartPlacement` (the last three return an error
  message instead of editing when the value isn't valid).
- Tools: `setTool`, `placePart(type)`, `dragPart(type, client?)`, `dropPart(type, client)`,
  `swapWirePosture`, `escape`, `cancel`.
- View and selection: `setSettings`, `setSelection`, `selectAll`, `clearSelection`, `zoomIn`,
  `zoomOut`, `zoomActual`, `zoomToFit`, `locate(item, { zoom? })`.
- Input: the DOM layer converts events into `PointerInput` (canvas pixels, button, Shift, client
  position) and calls `pointerDown`, `pointerMove`, `pointerUp`, `doubleClick`, `pointerLeave` —
  so every gesture runs, and is tested, without a browser.

Dev builds expose the editor as `window.logicEditor`.

## Examples

Until R07 brings files, File ▸ Examples opens documents built in code (`src/app/examples.ts`):
**Hello, LED** (the M1 circuits, opened at start-up), **Symbol Gallery** (every part with prop
variants and placements; dev builds add the `dev/*` renderer fixtures — DIP-14, DIP-28, generic
box, unknown kind — and two broken parts) and, in dev builds, a **Stress Test** (3 600 NANDs,
`nandGrid`, shared with the circuit benchmark). `?example=<id>` (or `?gallery`) in the URL opens
one directly.

## Testing

- Pure modules (camera, scene, text placement, hit-testing, selection, grid, shortcuts, settings,
  command registry, formatting, history, move, operations, wire routing, clipboard, prop input) —
  Vitest in Node, next to the code.
- Gestures — `src/editor/gestures.test.ts` drives the `Editor` with `PointerInput`s: drag-move
  and cancel, nudges, the Wire tool (corners, Tab, Delete, double-click, Escape), wires dragged
  from a pin, the place tool, drop from the panel, floating paste and duplicate, cut, context-menu
  and properties requests.
- Editing scenario — `tests/scenarios/editing.test.ts` draws Hello, LED from an empty document
  with gestures only and checks it compiles to the example's nets with no design issues.
- Drawers — `tests/scenarios/symbol-drawing.test.ts` draws every registered part (default,
  boundary and enum props, both gate styles) with a recording `SymbolGraphics`: something is
  drawn, everything stays inside the layout, and drawn pins equal the compiler's pin positions.
- The browser — Playwright (`pnpm e2e`, `tests/e2e/`, Chromium against a production build):
  shell regions, drawing, gallery without errors, locate from Messages, canvas click,
  Shift-click, select all, box selection in both directions, keyboard and wheel zoom in both wheel
  modes, Space/middle/Pan-tool panning, theme switch, View ▸ Panels, persisted panel layout,
  shortcuts dialog; editing (`editing.spec.ts`): a circuit drawn by hand, drag-and-drop from the
  panel, moving with wires, undo/redo and the Undo label, rotate/flip/delete, floating paste,
  duplicate, paste into a second tab, keyboard clipboard events, Properties edits and invalid
  input, the context menu. Not part of `pnpm check` (it needs a browser); CI runs it after the
  build.

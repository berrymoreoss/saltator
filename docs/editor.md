# Editor and workbench

Specification of `src/editor` (the canvas engine, no React) and `src/ui` (the React shell around
it): the workbench and schematic view (R04a), editing (R04b), running the simulation (R05) and
files (R07).
Rationale: [ADR-0008](adr/0008-desktop-workbench.md) (workbench),
[ADR-0009](adr/0009-editing-model.md) (editing), [ADR-0010](adr/0010-running-simulations.md)
(simulation), [ADR-0012](adr/0012-files-and-sessions.md) (files and sessions).

## Shell

A desktop CAD-style window (`Workbench`), dense like KiCad or Altium: 12 px UI text, 22 px rows,
1 px borders, no page scroll — every region scrolls itself.

```
 File  Edit  Place  View  Help                              • adder   ← menu bar, document
┌──────────────────────────────────────────────────────────────────┐
│ tools │ undo redo │ rotate flip delete │ zoom │ grid  gate style    │ ← toolbar
├────────────┬──────────────────────────────────────┬──────────────┤
│ PARTS      │                                      │ PROPERTIES   │
│ [search  ] │                                      │ U1  NAND     │
│ ▾ Gates    │            schematic canvas          │ Inputs  2    │
│ ▾ IO       │                                      │ Delay 1 ns   │
│ ── preview │                                      │              │
├────────────┴──────────────────────────────────────┴──────────────┤
│ MESSAGES  2  78 · SIMULATION  1 · PART  (Memory, Analyzer later)  │
├──────────────────────────────────────────────────────────────────┤
│ X 12  Y 4 │ 100 % │ U1 · NAND │ hint …        14 parts · 20 wires │ ✖ 0 ⚠ 1 │
└──────────────────────────────────────────────────────────────────┘
```

- **Docks** are fixed regions around the canvas: Parts (left), Properties (right) and a tabbed
  bottom dock (Messages). Splitters resize them within limits; each can be hidden from its title
  bar or View ▸ Panels. Sizes and visibility are settings (below).
- **Parts**: families as collapsible groups (74HC Logic, Timers, Primitives, Input / Output,
  Nets, and Developer Fixtures in dev builds); a search box (`/` or `Mod+F`) matching every word against name, title,
  type and keywords; the selected part's preview — its symbol drawn by the canvas drawers — with
  title, pins and datasheet link. Clicking a part arms the place tool with it (the row is marked);
  dragging it onto the canvas places one ([Placing parts](#placing-parts)).
- **Properties**: one part — designator, label, position, rotation, flip and every prop, all
  editable ([Properties](#properties)), plus type, datasheet and pins with their nets; one wire —
  endpoints, length, net and the pins on it; several items — counts by part name; nothing — the
  circuit's name and counts.
- **Bottom dock tabs** (the active one is a setting): **Messages** — the compile result's design
  issues, errors first, with code, message and location (`U1.A`, `wire w3`); click selects the
  item and brings it into view, double-click zooms to it; the tab and the status bar show the
  counts. **Simulation** — what happened while running ([Simulation](#simulation)). **Part** —
  the pins and function table of the last part picked ([Part info](#part-info)).
- **Status bar**: grid position under the pointer, zoom, a one-line selection summary, the
  simulation (state, simulated time, the speed reached when lagging, runtime problems; click opens
  the Simulation tab), a hint for the current tool and gesture (`statusHint`), part/wire counts,
  redraw time (dev builds), error/warning counts (click opens Messages).
- **Context menu** (right click on the canvas): over a part or wire (selected first) — Cut, Copy,
  Paste, Duplicate, Delete, Rotate, Rotate Counter-clockwise, Flip Horizontal, Flip Vertical,
  Properties; over empty canvas — a **Place** submenu ([Placing parts](#placing-parts)), Paste,
  Select All, Zoom to Fit. A right click while drawing a wire, floating a paste or placing parts
  cancels that instead.
- **Dialogs**: Help ▸ Keyboard Shortcuts (generated from the command registry), About, the
  example gallery, "Save changes?" and file problems ([Files](#files)). Escape or a click
  outside closes them (for "Save changes?" that is Cancel).
- **Document name** at the right end of the menu bar and in the browser tab's title
  (`adder — Logic`), with `•` while there are unsaved changes.

### Part info

The **Part** tab of the bottom dock is a datasheet summary to keep open while wiring a chip
(R06). It shows the part picked last — a single part selected on the canvas (its designator
in the header, its props for prop-dependent pins) or a part clicked in the Parts panel:

- the part drawn by the canvas drawers (DIP for chips), name, title, type and a link to the
  datasheet named after its document (`Datasheet 74HC_HCT00`);
- the pins in pin-number order: number, name (the pin's `label` where it has one, with the
  name after it: `Y̅ (YN)` on the 74HC151; overlined as on the canvas; `NC` for n.c. pins), type
  (`input`, `output`, `3-state output`, `input/output`, `power`, `not connected`, and `not
  simulated` for `nc` pins that are not n.c., such as a 555's timing pins in astable mode) and
  the datasheet's description;
- the definition's `functionTable` (docs/components.md#function-tables) with its note
  (`each gate (n = 1 to 4)`), a column named like a pin, or like its generic name (`nO̅E̅`,
  `nY̅0`), drawn as the pin is (its label, its overlines), text cells spaced out
  (`A3 > B3`), the output group headed `Inputs/outputs` for bus ports (245), and the letters'
  legend; sequential tables as the data sheets write them (`↑`, `h`, `q̅`);
- the definition's **timing** (R09a, under the function table): every delay with its typical and
  maximum value, every timing requirement (set-up, hold, pulse width, recovery) with its typical
  value and the guaranteed minimum the timing checks use, the path's pin names as drawn
  (`nCP to nQ, nQ̅`), the conditions and the source.

Parts without descriptions, a function table or timing (`prim/*`, `io/*`) show what they have. Edit ▸ Part Info and the part context menu open the tab. The pure model is
`src/ui/part-info.ts` (unit-tested); the selection-following lives in `Workbench`.

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
| Interact tool       | `I`                        | Run / Pause                | `F5`                      |
| Step                | `F10`                      | Stop                       | `Shift+F5`                |
| Reset               | `Mod+Shift+F5`             | New Circuit                | `Mod+Alt+N`               |
| Open…               | `Mod+O`                    | Save (As…)                 | `Mod+S` (`Mod+Shift+S`)   |
| Net Label           | `L`                        |                            |                           |

Commands marked `global` run while typing in a text field and keep their key from the browser
even while disabled: F5 never reloads the page, `Mod+S` and `Mod+O` never show the browser's own
Save Page and Open File. Chrome keeps `Mod+N` (a new window) from the page, hence `Mod+Alt+N`;
with Alt a shortcut's letter or digit is read from the physical key (`event.code`), since Option
changes the character on a Mac (⌥N types `˜`).

**Escape** goes one step back: it cancels the current gesture (a drag, a wire being drawn, a
floating paste), else leaves the Wire or place tool for Select, else clears the selection.

## Settings and themes

`Settings` (`src/ui/settings.ts`): theme (`system` · `dark` · `light`), gate style (`ansi` ·
`iec`), grid on/off, scroll-wheel mode (`pan` · `zoom`), each dock's visibility and size, and
the bottom dock's tab (`messages` · `simulation`).
They live in `localStorage` (`logic.settings.v1`), saved with a short debounce; reading repairs
each invalid field to its default, and blocked storage (private mode) just means nothing is
remembered.

- **Themes**: CSS custom properties in `src/ui/styles/tokens.css` for both themes, selected by
  `data-theme` on `<html>`; `system` follows `prefers-color-scheme` live. The canvas gets the
  matching `CanvasTheme` (`src/editor/theme.ts`): dark — warm part outlines on near-black; light —
  a KiCad-like maroon on cream "paper"; each with level colors for wires while simulating
  (`CanvasTheme.levels`, mirrored as `--level-*` CSS tokens for the Properties badges).
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
  throws; a changeover switch draws its rail on the left and its `ON`/`OFF` throws as the two
  pins; switches show their power-on position, buttons a plunger), `dip-switch`, `clock`
  (square wave, or a single pulse in manual mode), `led` and `led-bar` (diodes tinted with the LED
  color), `seven-segment`, `hex-display`, `probe`, `net-label` (an outlined tag pointing at its
  connection point, the name inside in a monospaced font, overlined where it says `~{…}`).
  Stopped, drawers show the idle look
  (power-on switch positions, unlit lights); while simulating they get `DrawContext.live`
  ([Simulation](#live-drawing)).
- **DIP**: body with the notch at the top, pin numbers outside next to each stub, pin names
  inside (the pin's `label` where it has one; an active-low pin's letters overlined but not its
  digits, `1R̅D̅`, `E̅1`, as the data sheets draw them, or the characters a label marks with
  U+0305, `U̅/D`, `Q̅0̅` — `pinTextRuns` in core; after a clock triangle
  when `clock`, `NC` for n.c. pins named `NC<number>`, other `nc` pins under their names), the
  part name down the middle. A body is two cells wider when a row's names would crowd the name
  ([circuit.md](circuit.md#part-layouts)).

## Text

Text never reads upside down or mirrored.

- **Designator and label** (`src/editor/text-placement.ts`): a block of horizontal text outside
  the part's bounding box (pins included) on the first side without pins, in the order top,
  bottom, right, left; designator first, then the label. Power symbols show their rail name
  (VCC, GND) at the end away from the pin instead of a designator; net labels show only the
  name inside their tag.
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

`Tool = 'select' | 'pan' | 'wire' | 'interact' | { kind: 'place', type }`, in the toolbar and
View menu (`V`, `H`, `W`, `I`; the place tool is armed from the Parts panel; the Interact tool
operates parts while simulating, [below](#interacting-with-parts)). Tools are sticky: they stay until
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
- **Place menu** (the menu bar's Place, and right click on empty canvas ▸ Place): Power (VCC),
  Ground (GND), Pull-up, Pull-down, Wire, Net Label (`L`), Find Part…. A part item arms the place
  tool like a click in the Parts panel, with preset props where it needs them (`PlaceTool.props`:
  the pull's direction).
- **Net labels** are placed with their connection point under the pointer (other parts are
  centered), so a click on a pin tip or a wire end attaches one. Each gets the next name — the
  last label name placed or set in Properties with its trailing number incremented (`D0` →
  `D1`), the same name without one, `NET1` first — so clicking down a chip's data pins names
  them D0…D7. Generic: a part's `nextProps` applied to the props of the last part of its type
  placed or edited in this session.

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

- **Designator**: Enter applies a rename (one step; the edit records `old → new`, which carries
  the part's simulation state over);
  invalid or taken designators show the reason and are not applied (`designatorError`); Escape
  reverts.
- **Label** (empty removes it), **position** (whole cells), **rotation** (0/90/180/270) and
  **flipped**: placement changes go through the move transforms, so wires follow.
- **Props** by `PropDef.type` (`src/ui/prop-input.ts`): numbers and integers checked against
  `min`/`max` (the unit may be typed), numbers marked `si` with SI prefixes, shown as `4.7 kΩ`
  and typed as `4.7k`, `4.7 kΩ`, `100n`, `1u` or `1µ` (`formatSi`/`parseSi`: exact, `100n` is
  1e-7; the NE555's R and C, the clock frequency), times with units (`10 ns`, `1.5us`, `2 µs`; a
  bare number is nanoseconds; `parseTime` in core), booleans as checkboxes, enums as selects (LED colors with
  a swatch), strings as text — checked as typed against a `pattern` (a net label's **Name**:
  "Use letters, digits, …"), without the spaces at its ends. A schematic-only part (net label)
  has no **Label** row: its free text would never be drawn. Each commit is one undo step and writes all resolved props. A prop
  that changes the layout (gate inputs, DIP-switch count) moves pins; attached wires are not
  re-routed.

### Undo and redo

`src/editor/history.ts`: an entry is the circuit and the selection before and after one action,
labelled (`Move`, `Place NAND`, `Rename U1`, `Change Delay`); documents are immutable, so
snapshots share every unchanged part and wire ([ADR-0009](adr/0009-editing-model.md)). A new
edit clears the redo stack; 200 entries are kept; consecutive entries with the same `coalesce`
key merge (nudges of one selection). Undo and redo restore the selection too and report the
renames they undo or redo in `state.renames`. Opening a document (New, Open, an example, a
dropped file) loads it with `setCircuit`, which clears the history ([Files](#files)).

## Simulation

The simulator host (`src/editor/simulation.ts`, `editor.simulation`) runs the kernel for the
circuit in the editor ([ADR-0010](adr/0010-running-simulations.md)). Commands: Simulate menu,
the toolbar group (Run/Pause, Step, Stop, Reset, speed select) and `F5`, `F10`, `Shift+F5`,
`Mod+Shift+F5`.

### Run control

`SimState`: **stopped** (no simulator; the plain drawing — where a session starts), **running**,
**paused**, **halted** (the kernel stopped on an oscillation).

- **Run** powers on (a new `Simulator` at t = 0 from the scene's compiled netlist) and runs;
  from paused it continues. It arms the Interact tool. **Pause** freezes time.
- **Step** (stopped or paused) runs to the next timestamp with events, all its delta cycles:
  propagation can be followed gate delay by gate delay. Stale (cancelled) events are skipped;
  with nothing pending it does nothing. From stopped it powers on and runs t = 0.
- **Stop** discards the simulator; the tool goes back to Select. **Reset** powers on again at
  t = 0 (diagnostics and brightness samples cleared), keeping running or paused; a halted
  simulation runs again.
- Design errors don't block running: parts the compiler left out are missing.
- Opening a document stops the simulation first.

### Pacing

- **Speed** (`Speed`, `ALL_SPEEDS`): simulated time per wall second — 1 ns/s, 10 ns/s, … 100 ms/s,
  **real time** (1 s/s, the default), **Max** (as much as the frame budget allows).
- Each animation frame: `target = now + min(wall Δ, 100 ms) × speed`; the kernel runs in chunks of
  20 000 events until the target or the frame budget (8 ms of wall time) is reached. Behind
  schedule, the backlog is dropped, not caught up; the status bar then shows the speed reached
  (smoothed), in the warning color, for a while after the last overrun. Max runs `settle` and
  stops advancing when nothing is pending.
- The clock and the frame scheduler are injected (`SimClock`; `BROWSER_CLOCK` uses
  `performance.now` and `requestAnimationFrame`), so pacing is tested with a fake clock.
- Stores: `status` (state, time, speed, measured speed, lagging, error — refreshed at most 10×
  per second while running), `diagnostics`, `ticks` (panels showing live values refresh on it),
  `revision` (the canvas redraws on it, synchronously inside the host's frame). The canvas
  redraws only when events were processed, a light's brightness changed by a visible step
  (1/32), or a contention flash phase is due.

### Editing while running

Every committed edit, undo and redo is followed (`Simulation.sync`, from `editor.state`):

- **Same structure** (`sameNetlistStructure`: same components in order with type and props, same
  pins connected; net ids don't matter) — moving, rotating, relabelling, rerouting: the simulator
  goes on untouched; only the map from scene wires to simulator nets (`signalMap`, through the
  pins of each net) is rebuilt.
- **Otherwise** the run continues in the recompiled netlist with `Simulator.carryOver`, through
  the edit's renames ([simulation.md](simulation.md#editing-while-running-carry-over)): unchanged
  parts keep everything, parts with other props power on without an `X` glitch, new parts power
  on. A halted simulation becomes paused.

### Interacting with parts

The **Interact tool** (`I`, a pointing hand): a press on a part looks up its symbol kind in
`INTERACTIONS` (`src/editor/symbols/interact.ts`) with the press in the part's local cells
(`inverseTransformPoint`), and sends the action to the simulator:

| Part                    | Press                           | Release   |
| ----------------------- | ------------------------------- | --------- |
| `io/switch`             | `toggle`                        | —         |
| `io/button`             | `press`                         | `release` |
| `io/dip-switch`         | `toggle` the switch on that row | —         |
| `io/clock`, manual mode | `step` (one pulse)              | —         |

A held button is released when the press ends, is cancelled, the window loses focus or the tool
changes. Elsewhere a click selects (Properties shows live levels) and a drag pans; over an
interactive part the pointer is a hand. While stopped the tool only selects and pans. While
paused, an action's zero-delay effects are applied at once (`runUntil(now)`); gate delays wait for
time to move.

### Live drawing

- **Wires and junctions** take the color of their net's `SignalStyle`: `L1` bright green, `L0`
  dark green, `Z` blue, `X` red, `WEAK_1`/`WEAK_0` (only a pull resistor) paler, `CONTENTION`
  (`sim.contended`) flashing red twice a second while running. Wires the simulation doesn't know
  (new ones during a gesture) keep the plain color; ghosts the selection color; a selected wire
  keeps its level color over a selection halo. Pin stubs keep the part color.
- **Parts** get `DrawContext.live` (`PartLive`: `state`, `level(pin)`, `light(i)`) and
  `levelColor`: switches, buttons and DIP switches show their positions; LEDs, LED bars and
  7-segment segments their brightness, with a glow; an unknown light is drawn in the `X` color;
  the clock's wave takes its output's level color; the hex display shows its digit (unknown: a
  dash in the `X` color); the probe its level letter in the level color.
- **Net labels**, which the simulator doesn't have (schematic-only), get `DrawContext.pinColor`
  instead: the wire color of the net at their point (the signal map includes label points), so
  the tag's outline shows its net's level like the wires do.
- **Brightness** while running is the on-time over the last frame
  (`(onTimeAt(t1) − onTimeAt(t0)) / (t1 − t0)`, from samples the host keeps per indicator), so a
  multiplexed display or an LED on a fast clock shows its average; while paused or stepping, what
  the light shows at that instant. Samples survive a carry-over and are cleared on Reset.
- **Budget**: redrawing the 3 600-part, 10 620-wire stress schematic with level colors takes
  ≈ 4.4 ms at fit zoom (3.9 ms stopped); Run ≈ 46 ms, a structural edit while running ≈ 39 ms, a
  nudge ≈ 47 ms with the same simulator (dev build, headless Chromium, Apple M3 Pro, R05).

### Diagnostics and live values

- The **Simulation** tab lists the kernel's and parts' diagnostics (`contention`,
  `floating-input`, `oscillation`, part-reported kinds) in order of first occurrence: kind,
  message, first time, last time and count, where (`U1.A`, `net U1.Y`). Contention,
  oscillation and timing violations (set-up, hold, pulse width, recovery — R09a) are errors, the
  rest warnings. Click locates the part, or selects the wires of the
  net (`Editor.locateNet`); double-click zooms. **Clear** hides the current entries until they
  happen again. The tab shows the counts; so does the status bar's simulation cell.
- **Properties** shows a live level badge (`0`, `1`, `Z`, `X`; weak levels paler, contention red)
  next to each pin of the selected part, the net of a selected wire and the pins on it.

## Editor API

`new Editor(registry, circuit?, settings?, options?)` (`src/editor/editor.ts`) owns the circuit,
its scene, the selection, the undo history, the camera, the tool and the simulator host
(`editor.simulation`; `options.simulation` injects its clock in tests). The UI mounts it with
`editor.mount(canvas)` (returns the detach function) and reads through `useSyncExternalStore`:
`editor.state` (circuit, scene, selection, renames), `editor.view` (camera, viewport, pointer
position, last redraw time — changes often, keep consumers small), `editor.tool`, `editor.mode`,
`editor.history` and `editor.requests` (the editor asking the UI to open the context menu or to
focus Properties).

- Document: `setCircuit(circuit, { fit?, camera? })` (load; clears history; `camera` restores a
  view instead of zooming to fit), `edit(label, circuit, options)`, `undo`, `redo`,
  `undoLabel`, `redoLabel`.
- Editing: `deleteSelection`, `rotate(clockwise)`, `flip(direction)`, `nudge(dx, dy)`,
  `copySelection`, `cutSelection` (both return clipboard text), `pasteText(text)`, `duplicate`,
  `renamePart`, `setPartLabel`, `setPartProp`, `setPartPlacement` (the last three return an error
  message instead of editing when the value isn't valid).
- Tools: `setTool`, `placePart(type)`, `dragPart(type, client?)`, `dropPart(type, client)`,
  `swapWirePosture`, `escape`, `cancel`.
- View and selection: `setSettings`, `setSelection`, `selectAll`, `clearSelection`, `zoomIn`,
  `zoomOut`, `zoomActual`, `zoomToFit`, `locate(item, { zoom? })`, `locateNet(net, { zoom? })`.
- Simulation (`editor.simulation`): `run`, `pause`, `toggle`, `step`, `stop`, `reset`,
  `setSpeed`, `action(component, payload)`, `clearDiagnostics`; `state`, `simulator`,
  `signalView()`, `pinStyle`, `wireStyle`, `wiresOfNet`; stores `status`, `diagnostics`,
  `ticks`, `revision`.
- Input: the DOM layer converts events into `PointerInput` (canvas pixels, button, Shift, client
  position) and calls `pointerDown`, `pointerMove`, `pointerUp`, `doubleClick`, `pointerLeave` —
  so every gesture runs, and is tested, without a browser.

Dev builds expose the editor as `window.logicEditor` and the document controller as
`window.logicDocuments`.

## Files

Circuits are `.logic.json` files ([circuit.md](circuit.md#loading-versioning-saving)); R07,
[ADR-0012](adr/0012-files-and-sessions.md).

### Document session

`DocumentSession` (`src/ui/document-session.ts`, pure) is the open document around the editor's
circuit: its **name** (the file name without `.logic.json`, `Untitled`, or an example's title),
the **document** as loaded (the editor edits the first circuit; the others are written back
unchanged), the **file** Save writes to (a File System Access handle) and the circuit as last
**saved**. Unsaved changes = the editor's circuit differs from the saved one, by identity then
by value (`sameCircuit`): undoing back to the saved state is clean again. File names map both
ways (`fileNameOf` replaces characters no file system accepts; `nameOfFile` strips
`.logic.json` or `.json`).

`DocumentController` (`src/ui/document-controller.ts`) runs the File commands on a
`Store<DocumentSession>`; it asks and reports through callbacks (the workbench shows dialogs),
one file operation at a time:

- **New Circuit** (`Mod+Alt+N`), **Open…** (`Mod+O`), **Open Recent**, an **example** and a
  `.logic.json` **dropped** anywhere on the window replace the document: with unsaved changes
  they first ask **"Save changes to “name”?"** — Save (the default button; a cancelled Save
  cancels the action), Don't Save, Cancel (also Escape). Then `setCircuit` (history cleared,
  simulation stopped, zoom to fit).
- An example opens as an **untitled copy** named after it; unchanged, it is clean.
- **Save** (`Mod+S`) writes to the document's file; without one (untitled, an example, a
  download) or without write permission it is **Save As…** (`Mod+Shift+S`): a save picker
  suggesting `name.logic.json`. The session then takes the saved file's name.
- A file that doesn't load opens nothing and shows "Cannot open file" with every problem of
  the `DocumentError` (or "saved by a newer version"); a failing write shows "File error".
  Unknown part types are not load errors (the compiler reports them).

### Reading and writing files

`FileAccess` (`src/ui/files.ts`), picked by feature detection:

- **native** (File System Access, Chromium): `showOpenFilePicker` / `showSaveFilePicker`
  (`.logic.json`, the folder remembered by the picker id); Save writes through the handle and,
  after a reload, asks for write permission first (refused → Save As). A closed picker
  (`AbortError`) is not an error.
- **fallback** (Firefox, Safari): Open is a file input (`cancel` resolves nothing); Save and
  Save As download `name.logic.json`, so every Save downloads; no Open Recent.

The browser primitives are injected (`nativeFileAccess(pickers)`, `fallbackFileAccess(...)`), so
both run in Node tests; `droppedFile(dataTransfer)` reads a dropped file during the event and
keeps its handle where the browser gives one.

### Autosave and session restore

The open document is restored as it was after a reload or a closed tab (`src/ui/autosave.ts`):

- `Autosave` writes a `StoredSession` — name, the document text in the file format, unsaved
  flag, file handle, camera, time — at most **500 ms** after a change of the circuit, the session
  or the view (later changes in that time ride along; selection and pointer moves don't count),
  at once when the page is hidden, and synchronously to `localStorage` on `pagehide`
  (`logic.unload.<id>`, without the handle: IndexedDB writes started while a page unloads don't
  finish). At start-up `recoverUnloadWrites` moves those into IndexedDB when newer.
- Storage: IndexedDB database `logic` (`src/ui/browser-storage.ts`): `sessions` (by id, with an
  `updated` index; the 10 most recent are kept) and `recent` (Open Recent).
- **Per tab**: `claimSessionId` keeps the tab's id in `sessionStorage` (a reload finds it) and
  holds a Web Lock on it, so a duplicated tab (same `sessionStorage`) gets a new id and copies
  the session.
- **Start-up** (`src/app/App.tsx`, before the first render): `?example=<id>` (or `?gallery`) opens
  that example; else this tab's session, else the most recent one (a new tab), else Hello, LED
  (a first launch). A restored session keeps its view and unsaved state; the history starts
  empty and the simulation stopped. Blocked storage means nothing is restored or kept.

### Open Recent

`RecentFiles` (`src/ui/recent-files.ts`): the ten files opened or saved last, newest first, by
their handles (deduplicated with `isSameEntry`). File ▸ Open Recent lists them by file name with
Clear Recent Files; opening one asks for read permission; a file that is gone leaves the list
with a message. Only where the browser gives file handles.

## Examples

File ▸ Examples (a submenu) and **File ▸ New from Example…** (a gallery: a card per example with
a thumbnail drawn live by `drawCircuitPreview`, title and description; examples without a
description, like the stress test, are only in the submenu) open the examples as untitled
copies. The **example files** are ordinary saved documents in `examples/` at the repository
root, bundled as text and loaded like any file (`src/app/example-files.ts` lists them with a
title and a description, in gallery order):

- **Hello, LED** — the M1 circuits, opened at a first launch: a switch through a 74HC00 gate to
  an LED, with the chip's power pins wired and its unused inputs tied to GND, and a 1 Hz clock
  blinking an LED.
- **Half Adder** — switches A and B into a 74HC86 (XOR → SUM LED) and a 74HC08 (AND → CARRY LED).
- **Net Labels** — switches A and B reach a 74HC00's first gate through net labels instead of
  wires, its output Y reaches an LED the same way; labels named GND, stacked on the chip's
  pins, tie its unused inputs to the GND symbol by name, and the VCC pin has a VCC symbol.
- **SR Latch** — two cross-coupled 74HC00 NANDs; SET and RESET push buttons pull their line low
  against a pull-up; Q and /Q LEDs. It starts unknown until set or reset (the missing-reset
  lesson of 4-state logic).
- **Ring Oscillator** — a 74HC00 NAND (EN switch) and two 74HC04 inverters in a ring: three
  inversions, period 2 × (9 + 9 + 9) = 54 ns; at 10 ns/s the OSC LED blinks visibly.
- **BCD to 7-Segment** — a 4-way DIP switch (to VCC, with pull-downs; 5 at power-on) into a
  74HC4511 (LT, BI high, LE low: transparent) driving a common-cathode display; codes 10–15 blank.
- **Clock Module** — Ben Eater's clock module: an astable NE555 (1 kΩ, 470 kΩ, 1 µF: ≈ 1.5 Hz), a
  monostable NE555 debouncing the STEP button (110 ms), a bistable NE555 on the MANUAL changeover
  switch, and 74HC04/08/32 for CLK = (clock · /select + step · select) · /HLT on a blue LED. In
  manual mode the clock is unknown until the first STEP (the monostable starts at `X`).
- **SAP-1 A Register** — Ben Eater's A register: two 74HC173s load an 8-bit bus (a DATA DIP
  switch through a 74HC245, pull-downs, a BUS bar) and a second 74HC245 drives them back onto
  it; CLR, LOAD, DATA OUT, A OUT switches and a manual clock. Unknown until CLR.
- **Shift Register LEDs** — a 74HC595 with SHCP and STCP tied to a 2 Hz clock and Q7S inverted
  by a 74HC04 into DS: a Johnson counter, the eight LEDs fill and empty by themselves, one step
  behind the Q7S LED (the storage register takes the contents from before each shift). CLEAR
  (a button with a pull-up) first; OUTPUTS floats the outputs while it keeps counting.
- **SAP-1 Program Counter** — Ben Eater's program counter: a 74HC161 (CLR, CE, J) loading from a
  4-bit bus, a 74HC245 putting it on the bus (CO); the bus has pull-downs, a BUS bar and a
  DATA switch stand-in through another 74HC245. Unknown until CLR.

Two examples stay built in code (`src/app/examples.ts`): **Symbol Gallery** (every registered
part with prop variants and placements, the 74HC chips, the NE555 in each mode and a 74HC245 in
every orientation; dev
builds add the `dev/*` renderer fixtures — a DIP-14 with a clock pin, DIP-28, generic box,
unknown kind — and two broken parts) and, in dev builds, a **Stress Test** (3 600 NANDs,
`nandGrid`, shared with the circuit benchmark). `?example=<id>` (or `?gallery`) in the URL opens
one directly.

Example files are kept canonical (`tests/scenarios/examples.test.ts`): exactly what
`serializeDocument` writes, wires normalized, every resolved prop stored, no design issues.
Biome ignores `*.logic.json`, which it would reformat. To change an example, open it in the app,
edit, and save over the file.

## Testing

- Pure modules (camera, scene, text placement, hit-testing, selection, grid, shortcuts, settings,
  command registry, formatting, history, move, operations, wire routing, clipboard, prop input,
  document session, file access with injected pickers, document controller, autosave with a
  memory store and controlled timers, recent files) — Vitest in Node, next to the code.
- Examples — `tests/scenarios/examples.test.ts` keeps every file canonical (listed, bundled as
  on disk, what `serializeDocument` writes, normalized wires, every resolved prop, no design
  issues); `example-circuits.test.ts` and `hello-led.test.ts` run them (truth table, set /
  reset / hold, the 54 ns period).
- Gestures — `src/editor/gestures.test.ts` drives the `Editor` with `PointerInput`s: drag-move
  and cancel, nudges, the Wire tool (corners, Tab, Delete, double-click, Escape), wires dragged
  from a pin, the place tool, drop from the panel, floating paste and duplicate, cut, context-menu
  and properties requests, the Interact tool (switch, held button, DIP switch on a rotated and
  flipped part, manual clock, click-to-select and drag-to-pan, nothing while stopped).
- Simulation — `src/editor/simulation.test.ts` with a fake clock: run control, pacing, frame
  budget and measured speed, Max, step, actions while paused and running, the same simulator
  after a move, carry-over after structural edits and renames (undo/redo), halting, diagnostics
  and Clear, signal styles, contention flashing, redraws only on change, brightness from on-time;
  `renderer.test.ts` checks wire colors with a recording 2D context.
- Editing scenario — `tests/scenarios/editing.test.ts` draws Hello, LED from an empty document
  with gestures only and checks it compiles to the example's nets with no design issues.
- Drawers — `tests/scenarios/symbol-drawing.test.ts` draws every registered part (default,
  boundary and enum props, both gate styles) with a recording `SymbolGraphics`: something is
  drawn, everything stays inside the layout, and drawn pins equal the compiler's pin positions;
  again with live state (lit, half lit, unknown), plus switch positions, digits and probe levels.
- The browser — Playwright (`pnpm e2e`, `tests/e2e/`, Chromium against a production build):
  shell regions, drawing, gallery without errors, locate from Messages, canvas click,
  Shift-click, select all, box selection in both directions, keyboard and wheel zoom in both wheel
  modes, Space/middle/Pan-tool panning, theme switch, View ▸ Panels, persisted panel layout,
  shortcuts dialog; editing (`editing.spec.ts`): a circuit drawn by hand, drag-and-drop from the
  panel, moving with wires, undo/redo and the Undo label, rotate/flip/delete, floating paste,
  duplicate, paste into a second tab, keyboard clipboard events, Properties edits and invalid
  input, the context menu; simulation (`simulation.spec.ts`): Hello, LED drawn by hand runs (the
  switch drives the LED, the clock blinks), Step/Pause/Stop/Reset from keys and toolbar with F5
  never reloading, a held button, edits and a rename while running, a short located from the
  Simulation tab, the speed select; chips (`chips.spec.ts`, R06): a 74HC00 placed from the
  Parts panel and wired switch → gate → LED runs, the Part tab follows the Parts panel, the
  canvas and the context menu; files (`files.spec.ts`, R07): Save / Save again without a
  picker / Open, "Save changes?" (Cancel, Escape, Save, Don't Save), a broken file, a dropped
  file, Open Recent across a reload, the download / file-input fallback; autosave
  (`autosave.spec.ts`): a reload restores the unsaved circuit, name and view, a reload right
  after an edit, the file kept across a reload, per-tab sessions, `?example=`; the gallery
  (`examples.spec.ts`); **M1** (`m1.spec.ts`): switch → 74HC00 → LED and clock → LED built,
  run, saved, reloaded, run again. The File System Access pickers are stubbed with handles from
  the origin private file system (`tests/e2e/file-system.ts`); specs load the app with
  `openApp`, which waits for the start-up restore. Not part of `pnpm check` (it needs a
  browser); CI runs it after the build.

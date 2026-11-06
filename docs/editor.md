# Editor and workbench

Specification of `src/editor` (the canvas engine, no React) and `src/ui` (the React shell around
it), implemented in R04a. Editing tools (placing, wiring, moving, undo) are R04b _(planned)_;
running the simulation in the editor is R05 _(planned)_. Rationale:
[ADR-0008](adr/0008-desktop-workbench.md).

## Shell

A desktop CAD-style window (`Workbench`), dense like KiCad or Altium: 12 px UI text, 22 px rows,
1 px borders, no page scroll — every region scrolls itself.

```
 File  Edit  View  Help                                              ← menu bar
┌──────────────────────────────────────────────────────────────────┐
│ [select] [pan] │ [zoom in] [zoom out] [fit] │ [grid] [gate style] │ ← toolbar
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
  title, pins and datasheet link. Placing from the panel is R04b.
- **Properties** (read-only in R04a): one part — designator, type, label, position, rotation,
  props with units (times as ns/µs/ms, enum labels, LED color swatches), pins with their nets;
  one wire — endpoints, length, net and the pins on it; several items — counts by part name;
  nothing — the circuit's name and counts.
- **Messages**: the compile result's design issues, errors first, with code, message and location
  (`U1.A`, `wire w3`). Click selects the item and brings it into view; double-click zooms to it.
  The tab title and the status bar show the counts.
- **Status bar**: grid position under the pointer, zoom, a one-line selection summary, a hint for
  the current tool, part/wire counts, redraw time (dev builds), error/warning counts (click opens
  Messages).
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

| Command               | Shortcuts                  | Command             | Shortcuts       |
| --------------------- | -------------------------- | ------------------- | --------------- |
| Select tool           | `V`                        | Zoom to Fit         | `Mod+0`, `Home` |
| Pan tool              | `H`                        | Actual Size (100 %) | `Mod+1`         |
| Select All            | `Mod+A`                    | Show Grid           | `Shift+G`       |
| Deselect (and Select) | `Escape`                   | Toggle Gate Style   | `Shift+I`       |
| Find Part             | `/`, `Mod+F`               | Keyboard Shortcuts  | `?`, `Mod+/`    |
| Zoom In               | `Mod+=`, `Mod++`, `=`, `+` | Zoom Out            | `Mod+-`, `-`    |

R04b adds the editing commands (undo, redo, delete, rotate, copy, paste, …).

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
- **Budget**: a full redraw of the 3 600-part, 10 620-wire stress schematic (dev builds: File ▸
  Examples ▸ Stress Test) takes ≈ 4 ms at fit zoom and ≈ 1 ms at 100 % (headless Chromium, Apple
  M3 Pro, R04a).

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

## Editor API

`new Editor(registry, circuit?, settings?)` (`src/editor/editor.ts`) owns the circuit, its scene,
the selection, the camera and the tool. The UI mounts it with `editor.mount(canvas)` (returns the
detach function) and reads `editor.state` (circuit, scene, selection), `editor.view` (camera,
viewport, pointer position, last redraw time — changes often, keep consumers small) and
`editor.tool` through `useSyncExternalStore`. Commands call `setCircuit`, `setSettings`,
`setSelection`, `selectAll`, `clearSelection`, `setTool`, `zoomIn`, `zoomOut`, `zoomActual`,
`zoomToFit`, `locate(item, { zoom? })`. Dev builds expose the editor as `window.logicEditor`.

## Examples

Until R07 brings files, File ▸ Examples opens documents built in code (`src/app/examples.ts`):
**Hello, LED** (the M1 circuits, opened at start-up), **Symbol Gallery** (every part with prop
variants and placements; dev builds add the `dev/*` renderer fixtures — DIP-14, DIP-28, generic
box, unknown kind — and two broken parts) and, in dev builds, a **Stress Test** (3 600 NANDs,
`nandGrid`, shared with the circuit benchmark). `?example=<id>` (or `?gallery`) in the URL opens
one directly.

## Testing

- Pure modules (camera, scene, text placement, hit-testing, selection, grid, shortcuts, settings,
  command registry, formatting) — Vitest in Node, next to the code.
- Drawers — `tests/scenarios/symbol-drawing.test.ts` draws every registered part (default,
  boundary and enum props, both gate styles) with a recording `SymbolGraphics`: something is
  drawn, everything stays inside the layout, and drawn pins equal the compiler's pin positions.
- The browser — Playwright (`pnpm e2e`, `tests/e2e/`, Chromium against a production build):
  shell regions, drawing, gallery without errors, locate from Messages, canvas click and box
  selection, keyboard and wheel zoom in both wheel modes, theme switch, persisted panel layout,
  shortcuts dialog. Not part of `pnpm check` (it needs a browser); CI runs it after the build.

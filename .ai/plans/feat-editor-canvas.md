# Plan: feat/editor-canvas

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| Branch     | `feat/editor-canvas`                                                 |
| Roadmap    | R04a — App shell & schematic view ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                          |
| Depends on | R02, R03                                                             |
| Created    | 2026-11-06                                                           |

## Goal

Give the simulator its face: a desktop, CAD-style application shell (menu bar, toolbar, Parts
panel, Properties panel, a tabbed bottom dock, status bar) around a fast Canvas2D schematic
view that draws every part the library has — gates in ANSI or IEC style, IO symbols, DIP
packages — with designators and labels, wires and junction dots, in a dark and a light theme.
The view can be panned, zoomed and selected from; Properties shows what is selected; Messages
lists the design checks live. Editing (placing, wiring, moving, undo) is R04b, built on this
view; running the simulation in it is R05.

R04 was split at branch start (Q4): **R04a** `feat/editor-canvas` — shell and view (this plan);
**R04b** `feat/editor-tools` — editing.

## Scope

**In scope**

- `ui`: the Classic CAD shell (Q1) with fixed panel regions, resizable splitters, panels shown
  and hidden from the View menu, bottom dock with tabs, layout remembered (Q5); dark and light
  themes from CSS tokens, following the OS with a View override (Q2); a command registry that
  drives menus, toolbar buttons and keyboard shortcuts; icons from `lucide-react` plus our own
  SVGs for domain tools (Q7).
- `ui` panels: Parts (family tree, search, preview of the selected part), Properties
  (read-only view of the selection), Messages (design-check issues, click to locate), status bar
  (cursor position, zoom, selection, issue counts), keyboard-shortcut reference dialog.
- `editor`: camera (pan/zoom, fit), HiDPI canvas renderer redrawn on demand, adaptive grid,
  wires, junction dots, unconnected pin ends, selection and hover overlays, viewport culling and
  level of detail; drawing functions for every `symbol.kind` in the library (gates in ANSI and
  IEC, Q3), the generic DIP package renderer and the box fallback; designator/label placement
  that keeps text readable at every rotation; hit-testing; selection (click, Shift-click, box);
  navigation per Q6 (Figma-style by default, KiCad-style wheel as a setting).
- `app`: composition root, a start-up demo document (the M1 circuits), a symbol gallery
  document (every part; a dev-only DIP-14 part until R06 brings real chips).
- Playwright smoke test (`pnpm e2e`), run in CI.
- Docs: `docs/editor.md` (new spec), architecture, ADR-0008, roadmap split.

**Out of scope** (and where it goes instead)

- Placing parts, moving, rotating, deleting, wire drawing, copy/paste, undo/redo, editing props
  in the inspector, context menu, designator prefixes in part definitions → **R04b**
  (`feat/editor-tools`).
- Wire colors by level, clicking switches/buttons, lit LEDs and displays, run controls in the
  toolbar → R05.
- Save/load, autosave, example gallery → R07 (R04a's demo documents are built in code).
- Drag-to-redock panels, floating windows (rejected in Q5; revisit if needed).
- Command palette, Proteus/KiCad multi-unit symbols, rulers, print/export → backlog.

## Context

Read before starting:

- [docs/architecture.md](../../docs/architecture.md) — layers, data flow, Editor and UI
  sections (both still _planned_; this branch makes them real).
- [docs/circuit.md](../../docs/circuit.md) — document, part layouts (`partLayout`, placement
  transforms), compile result (`wireNets`, `junctions`, `issues`).
- [docs/components.md](../../docs/components.md#symbols-non-package-parts) — `SymbolDef`, kinds,
  IO parts.
- [ADR-0002](../../docs/adr/0002-tech-stack.md) (React for chrome only, custom Canvas2D,
  Playwright from R04), [ADR-0004](../../docs/adr/0004-chips-as-packages.md) (DIP view),
  [ADR-0005](../../docs/adr/0005-layered-architecture.md) (editor without React).
- `src/circuit/layout.ts`, `src/circuit/geometry.ts`, `src/circuit/compile.ts`,
  `src/core/symbol.ts`, `src/library/**` (every `symbol` definition), `src/app/App.tsx`,
  `src/app/global.css`.
- `.ai/lessons.md`.

## Design

### Shell (ui, Q1)

```
 File  Edit  View  Help                                              ← menu bar
┌──────────────────────────────────────────────────────────────────┐
│ [select] [pan] │ [zoom in] [zoom out] [fit] [100%] │ [grid]      │ ← toolbar
├────────────┬──────────────────────────────────────┬──────────────┤
│ PARTS      │                                      │ PROPERTIES   │
│ [search  ] │                                      │ U1  NAND     │
│ ▾ Gates    │            schematic canvas          │ Inputs  2    │
│ ▾ IO       │                                      │ Delay 1 ns   │
│ ── preview │                                      │              │
├────────────┴──────────────────────────────────────┴──────────────┤
│ MESSAGES (tabs; Memory, Analyzer later)                          │
├──────────────────────────────────────────────────────────────────┤
│ X 12  Y 4 │ 100 % │ 1 selected │ 14 parts │ ✖ 0  ⚠ 1             │ ← status bar
└──────────────────────────────────────────────────────────────────┘
```

- Dense desktop look: 12 px UI text, 28 px toolbar, 22 px rows, panel title bars in small caps,
  1 px borders; no page scroll — every region scrolls itself.
- **Regions** are fixed (Q5): left, right, bottom docks around the canvas, split by draggable
  splitters with min/max sizes; each panel can be hidden from View ▸ Panels (and its title bar);
  sizes and visibility persist in `localStorage` (wrapped in try/catch; defaults if unavailable).
- **Commands**: one registry `{ id, label, icon?, shortcut?, enabled?, checked?, run }`. Menus,
  toolbar buttons (tooltips show the shortcut) and the keyboard handler all read it, so a
  shortcut is defined once. Shortcuts are written `Mod+0` and shown as `⌘0` on macOS, `Ctrl+0`
  elsewhere. Keys typed into inputs never trigger canvas commands. The Help ▸ Keyboard shortcuts
  dialog lists the registry.
- **Menus in R04a**: File (Examples ▸ Hello LED, Symbol gallery), Edit (Select all, Deselect),
  View (zoom in/out/fit/100 %, grid, theme ▸ system/dark/light, gate style ▸ ANSI/IEC, scroll
  wheel ▸ pans/zooms, panels ▸ …), Help (Keyboard shortcuts, About). R04b adds the editing
  commands, R05 a Simulate menu.
- **State flow**: the `Editor` (editor layer) owns document, selection and camera; React reads
  them through `subscribe`/`getSnapshot` stores with `useSyncExternalStore`. High-rate view
  state (cursor position, zoom) lives in a separate small store so pointer moves re-render only
  the status bar.
- Styling: plain CSS with custom-property tokens (`--panel-bg`, `--border`, `--accent`, …) in
  `src/ui/styles/`; one CSS file per component area, no CSS framework.

### Themes (Q2)

Two token sets, `dark` and `light` (light: a white "paper" canvas, CAD-like), selected by
`data-theme` on `<html>`; default `system` follows `prefers-color-scheme` live. The canvas gets a
`CanvasTheme` object (background, grid, wire, junction, part stroke and fill, pin, text, selection,
hover, error/warning marks) derived from the same choice, so the canvas and the chrome always
match. R05 adds level colors to `CanvasTheme`.

### Camera (editor)

World unit = one grid cell (0.1", one DIP pin pitch). `scale` = screen px per cell (CSS px),
16 at 100 %, clamped to 2…256 (12.5 %…1600 %). `toScreen`/`toWorld`, `zoomAt(screenPoint,
factor)` keeps the world point under the cursor fixed, `panBy(dx, dy)`, `fit(rect, viewport,
padding)`. Keyboard/menu zoom steps by √2. Pure and unit-tested.

**Navigation (Q6)**: default "Figma" mode — wheel/two-finger scroll pans, pinch (`ctrlKey` wheel)
and `Mod`+wheel zoom about the cursor; "KiCad" mode (View ▸ Scroll wheel ▸ Zooms) — wheel zooms
about the cursor, Shift+wheel pans horizontally. Always: middle-button drag and Space+drag pan;
`Mod+=`/`Mod+-` zoom, `Mod+0` fit (Home too), `Mod+1` 100 %.

### Renderer (editor)

- One `<canvas>` sized by a `ResizeObserver`, backing store × `devicePixelRatio` (re-checked on
  DPR change: moving between displays), so lines are crisp on Retina.
- **On demand**: anything that changes the picture marks it dirty; one `requestAnimationFrame`
  redraws the whole frame. No continuous loop until R05 needs one.
- **Layers** in draw order: background → grid → wires → junctions → parts (body, pins, text) →
  pin-end and dangling-end marks → hover → selection → box-select rectangle.
- **Grid**: dots at every cell when a cell is ≥ 8 px on screen, else every 5th/10th cell; stronger
  dots every 10 cells. Toggle in View.
- **Culling and level of detail**: parts and wires outside the viewport are skipped (bounds
  precomputed in the scene); text is skipped when its screen size is < 4 px; pin names inside
  DIPs < 6 px. Wires of one style are stroked as one path.
- **Budget**: a full redraw of the 3 600-part bench schematic at fit zoom under 16 ms (Chrome,
  Apple M3 Pro); at 100 % culling makes frames trivial. A dev-only overlay shows draw time.

### Scene (editor, pure)

`buildScene(circuit, registry, compileResult)` → per component: definition, resolved props,
`PartLayout`, placement, world bounding box, placed pins (tip, side), the drawing (`symbol`,
`dip`, `box` or `unknown` for parts the registry lacks), text items; per wire: segment, net id;
junction dots; unconnected pin tips (a pin alone in its net); dangling wire ends and the issues
from the compile result. Rebuilt when the document changes (layouts are cached per type+props,
compile is ≈ 8 ms for the bench schematic). No DOM: unit-tested in Node.

### Symbol drawing (editor, Q3)

- `drawers: Record<kind, (g: SymbolGraphics, symbol, layout, props) => void>` in
  `src/editor/symbols/`. A drawer works in the part's **local** cell coordinates (the layout's
  body rect, pin tips); the renderer applies the placement (flip, rotation, translation) as a
  canvas transform. `SymbolGraphics` is a thin wrapper over the 2D context (lines, arcs, curves,
  fills, `text`), so the same drawer serves the canvas, the Parts preview and tests.
- **Pins**: the renderer draws every pin stub (body edge → tip) from the layout; drawers draw
  bodies only. Inversion bubbles sit at the body edge.
- **Gates**: ANSI shapes (AND, OR, XOR families, buffer, inverter, tri-state buffer) and IEC
  rectangles with qualifying symbols (`&`, `≥1`, `=1`, `1`, `▽` for tri-state) — the same body
  and pins, selected by the view setting `gateStyle` (default `ansi`). N-input gates widen the
  input side (OR/XOR back curve spans the whole height).
- **Other kinds**: `constant` (0/1/X tie), `pull-up`/`pull-down` (resistor zigzag to a rail),
  `vcc`/`gnd` (rail bar / ground symbol), `switch` (SPDT/SPST lever per `contact`), `button`
  (push button), `dip-switch` (bank of slides, one per position), `clock` (square-wave glyph),
  `led` (diode triangle + arrows, body tinted with its color), `led-bar` (n diodes),
  `seven-segment` (digit outline, segments unlit), `hex-display` (digit box), `probe`
  (round tip). States (lit, on/off) are drawn in R05; R04a draws the power-on/idle look.
- **DIP** (`package`): rectangle with the notch at the top, pin numbers outside along each stub,
  pin names inside (an overline for active-low names written `~OE`/`/OE` — as the library
  writes them), part name (`74HC00`) inside, rotated with the body.
- **Fallbacks**: unknown kind → labeled box; part missing from the registry → red dashed box with
  the type id (the compile result reports `unknown-type`).

### Text placement (editor, pure)

- Each part shows its **designator** (`U1`) and, if set, its **label**; DIP parts also their name.
  Power symbols show their rail name (VCC/GND) instead of the designator.
- Positions are computed in world space from the placed bounding box: rotation 0/180 —
  designator above the box, centered; label below. Rotation 90/270 — both to the right of the
  box, left-aligned, stacked. Text never reads upside down or mirrored: text inside a symbol
  rotates with it by 0° or 90° only (180° draws as 0°, 270° as 90°), as in KiCad; flipping moves
  anchors, not glyphs.
- Unit-tested over all 8 placements: anchors outside the body, never overlapping pin tips.

### Hit-testing and selection (editor)

- `hitTest(scene, point, tolerance)` → topmost part (body rect + pin stubs) or wire (distance to
  the segment ≤ tolerance, ~4 px converted to cells); parts win over wires.
- **Selection** = sets of component ids and wire ids. Click selects one; Shift-click toggles;
  click on empty space clears; drag on empty space draws a box — left-to-right selects items
  fully inside, right-to-left items it touches (KiCad/AutoCAD convention, shown by solid vs
  dashed box). `Mod+A` selects all, Esc clears. Hover highlight on the item under the cursor.
- Selection survives document changes for ids that still exist (needed by R04b).

### Panels (ui)

- **Parts**: families as collapsible groups (Primitives, IO; 74HC from R06), each part by name
  with its title as secondary text; search box (filters by name, title, keywords, type; `/`
  focuses it). The selected part shows a preview at the bottom: its symbol drawn by the same
  drawers on a small canvas, title, pin list, datasheet link. Placing from the panel is R04b.
- **Properties**: one component — designator, type (`prim/nand`), name and title, label,
  position, rotation/flip, props with units (time props formatted as ns/µs), net of each pin;
  one wire — id, endpoints, net; several items — counts by type. Read-only in R04a.
- **Messages**: the compile result's issues (severity icon, code, message, location), errors
  first; click selects the item and centers the camera on it; double-click zooms to it. Status
  bar shows error/warning counts; clicking them opens Messages.
- **Status bar**: cursor grid position, zoom %, selection summary, part/wire counts, issue
  counts, a hint for the current tool.

### Demo documents (app)

Built with `CircuitBuilder` (persistence comes in R07): **Hello LED** (the M1 circuits: switch →
NAND → LED with its cathode to GND; clock → LED) opens at start-up; **Symbol gallery** places
every registered part with default props plus prop variants (gate input counts, contacts, LED
colors, common anode/cathode) at all four rotations for a few parts, and — in dev builds only — a
`dev/dip-14` part registered by the app to exercise the DIP renderer until R06. Opened from
File ▸ Examples (gallery also by `?gallery` in the URL, for e2e).

### Testing

- Pure editor modules (camera, scene, text placement, hit-testing, selection, grid spacing,
  command shortcuts) — Vitest in Node.
- Drawers — a recording `SymbolGraphics` checks that every registered part (default and
  boundary props, both gate styles) draws only inside its layout's bounding box and draws
  something (`tests/scenarios/symbol-drawing.test.ts`).
- React components — no unit tests (no DOM test environment); covered by Playwright.
- **Playwright** (`pnpm e2e`, `tests/e2e/*.spec.ts`, Chromium, against `vite preview` of the
  build): the shell regions render; no console errors on the demo and the gallery; clicking a
  part fills Properties; clicking a message selects its item; keyboard zoom changes the zoom
  readout; theme switch changes the canvas background; panel resize persists over reload. Not
  part of `pnpm check` (needs a browser); CI runs it as a separate step.

### Dependencies (ADR-0008)

`lucide-react` (ui only; tree-shaken) and `@playwright/test` (dev). Nothing in pure layers.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. chore: `lucide-react`, `@playwright/test`; `playwright.config.ts`, `pnpm e2e`, a first
  smoke test (app loads, no console errors); CI step installs Chromium and runs e2e; Biome/TS
  configs cover `tests/e2e`.
- [x] 2. editor: camera (transforms, zoom about a point, limits, √2 steps, fit) + tests.
- [x] 3. editor: scene builder (placed parts, bounds, wires, junctions, unconnected pin ends,
  issues) + text placement for all 8 placements + tests.
- [x] 4. editor: hit-testing and selection model (click, toggle, box enclosed/crossing, select
  all, survival across document changes) + tests.
- [x] 5. editor: renderer core — HiDPI canvas, resize/DPR handling, on-demand redraw, canvas
  theme, adaptive grid, wires, junctions, pin stubs, box/unknown fallbacks, text with LOD,
  culling, hover/selection overlays; pure helpers (grid spacing, visible rect) tested.
- [ ] 6. editor: gate drawers (ANSI + IEC; buffer, inverter, tri-state), `constant`,
  `pull-up/down`, `vcc`/`gnd`; recording-graphics test harness.
- [ ] 7. editor: IO drawers (switch, button, dip-switch, clock, led, led-bar, seven-segment,
  hex-display, probe) and the DIP package renderer; scenario test: every registered part draws
  inside its bounds in both gate styles.
- [ ] 8. editor: `Editor` facade — mounts on a canvas, input handling (Figma/KiCad wheel modes,
  middle/Space-drag pan, click/Shift-click/box select, hover), state and view stores.
- [ ] 9. ui: theme tokens (dark/light/system), settings store (persisted, guarded), command
  registry and shortcut matching (Mod = ⌘/Ctrl, ignore inputs) + tests of the pure parts.
- [ ] 10. ui: shell — menu bar (dropdowns, hover-switching, Esc), toolbar with icons and
  tooltips, dock layout with splitters and hide/show, bottom dock tabs, status bar, canvas host.
- [ ] 11. ui: Parts panel — family tree, search, preview (symbol canvas, title, pins, datasheet).
- [ ] 12. ui: Properties (read-only), Messages (click to locate), status bar counters, Keyboard
  shortcuts dialog, About.
- [ ] 13. app: composition root, Hello LED and Symbol gallery documents, dev-only DIP-14 part;
  e2e smoke extended (see Testing); look at both themes and both gate styles in the browser;
  measure the bench schematic redraw.
- [ ] 14. Docs: `docs/editor.md` (shell, commands and shortcuts, camera, rendering, symbols, text
  placement, selection), architecture.md (Editor/UI no longer planned), ADR-0008, components.md
  (drawing by kind), `src/editor` and `src/ui` READMEs, glossary, roadmap (R04a done, R04b
  next), lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green; CI runs e2e.
- [ ] The shell has the Classic CAD layout: menu bar, toolbar, Parts (left), Properties (right),
  Messages in a tabbed bottom dock, status bar; splitters resize the docks, View ▸ Panels hides
  and shows them, and sizes/visibility survive a reload.
- [ ] Dark and light themes: the default follows the OS (live), View ▸ Theme overrides it and the
  choice survives a reload; the canvas follows the theme.
- [ ] Every registered part has a drawing for its kind (no box fallback among built-in parts) in
  ANSI and IEC style, drawn inside its layout bounds with pin stubs ending exactly at the
  `partLayout` pin tips (scenario test); the gallery shows all of them in the browser, plus the
  dev DIP-14 with pin numbers and names.
- [ ] Designators and labels are placed outside the body and readable (never upside down or
  mirrored) in all 8 placements (unit test + gallery check).
- [ ] Navigation: scroll pans and pinch/`Mod`+wheel zooms about the cursor (default); the KiCad
  setting makes the wheel zoom; middle-drag and Space-drag pan; zoom in/out/fit/100 % from menu,
  toolbar and keyboard; lines crisp on a HiDPI display.
- [ ] Selection: click, Shift-click, box left-to-right (inside) and right-to-left (touching),
  `Mod+A`, Esc; Properties shows the selection.
- [ ] Messages lists the current document's design issues; clicking one selects and centers its
  item; status-bar counts match.
- [ ] A full redraw of the bench schematic (3 600 parts, 10 620 wires) at fit zoom takes < 16 ms in
  Chrome on Apple M3 Pro (dev overlay), recorded in the progress log.
- [ ] docs/editor.md, architecture.md, ADR-0008 and the roadmap describe what was built.

## Open questions

Asked at branch start (2026-11-06); all answered.

- [x] Q1. Window layout? — _proposed:_ Classic CAD (menu, toolbar, Parts left, Properties
  right, Messages dock, status bar). Alternatives: KiCad-style (tool strip, dialogs for parts and
  properties), IDE-style (activity bar). — **answer:** Classic CAD.
- [x] Q2. Theme? — _proposed:_ dark and light, default follows the OS, override in View.
  Alternatives: dark by default; dark only. — **answer:** dark and light, following the OS.
- [x] Q3. Gate drawing style? — _proposed:_ ANSI by default, IEC as a view setting (same
  geometry). Alternatives: ANSI only; IEC only. — **answer:** ANSI + IEC switch.
- [x] Q4. Split R04? — _proposed:_ R04a shell and view (`feat/editor-canvas`), R04b editing
  (`feat/editor-tools`). Alternative: one branch. — **answer:** split.
- [x] Q5. Panel flexibility? — _proposed:_ fixed regions with splitters, hide/show, tabbed bottom
  dock, layout remembered; no dependency. Alternative: full docking library (dockview: drag
  tabs, floating panels). — **answer:** fixed regions + splitters.
- [x] Q6. Canvas navigation? — _proposed:_ Figma-style (scroll pans, pinch/`Mod`+wheel zooms)
  with a View setting for KiCad-style (wheel zooms); middle/Space-drag always pans.
  Alternative: KiCad-style only. — **answer:** Figma-style + setting.
- [x] Q7. Icons? — _proposed:_ `lucide-react` for generic icons + own SVGs for domain tools.
  Alternative: own SVGs only. — **answer:** lucide-react + own.

For R04b's plan (ask at its start): do wires follow a moved part (rubber-band) or detach;
undo as document snapshots (immutable documents make it cheap) vs do/undo commands; does the
place tool stay active after a click; designator prefixes per part.

## Progress log

- 2026-11-06 — branch created; Q1–Q7 answered; R04 split into R04a/R04b; plan drafted.
- 2026-11-06 — plan approved by the user; status in-progress; roadmap split into R04a/R04b.

## Handoff

- **State:** plan approved, roadmap split; no production code yet.
- **Next step:** task 1 (dependencies, Playwright config, first smoke test, CI step).
- **Watch out:** `pnpm check` must stay browser-free (e2e is separate); keep React out of
  `src/editor`; Biome formats Markdown (run `pnpm lint:fix` after editing docs).
- **Verify with:** `pnpm check && pnpm build && pnpm e2e`.

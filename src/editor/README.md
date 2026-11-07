# src/editor — schematic editor engine

Framework-agnostic canvas editor: scene, Canvas2D renderer, camera (pan/zoom), grid, symbol
drawers, hit-testing, selection and the `Editor` facade (R04a); tools, gestures and undo/redo
(R04b); the simulator host, live levels and the Interact tool (R05).

- **Depends on:** `core`, `library`, `circuit`.
- **May use:** DOM and Canvas APIs. **Must not use:** React (the UI wraps the editor, not the
  other way round).

Modules: `camera`, `scene` + `text-placement`, `hit-test`, `selection`, `graphics`
(`SymbolGraphics`, upright text), `renderer`, `grid`, `theme`, `symbols/` (drawers by kind,
DIP, fallbacks), `editor` (the facade: tools, gestures on `PointerInput`, stores), `history`
(snapshot undo), `move` (rubber-band transforms, per layer: wires, bus lines), `operations`
(delete, rotate, flip, nudge), `wire-route` (L routes, connection marks, one layer's
`ConnectionIndex`), `clipboard` (fragments as document text), `store`,
`preview` (Parts panel), `simulation` (the simulator host: run control, pacing, following edits,
signal and part views for the renderer), `memory-inspector` (the Memory tab's model: memories
through the resolver, live cells, addresses, access highlighting, ROM image edits and RAM
pokes, R12b), `symbols/interact` (part actions for the Interact tool),
`recording-graphics` and `fake-clock` (tests), `dev-parts` (renderer fixtures, never in the
default registry). Pure modules and the gestures (`gestures.test.ts`) have Node unit tests;
the facade's DOM adapters are covered by `tests/e2e`.

Spec: [docs/editor.md](../../docs/editor.md).

# src/editor — schematic editor engine

Framework-agnostic canvas editor: scene, Canvas2D renderer, camera (pan/zoom), grid, symbol
drawers, hit-testing, selection and the `Editor` facade (R04a); tools and undo/redo (R04b); live
signal overlay (R05).

- **Depends on:** `core`, `library`, `circuit`.
- **May use:** DOM and Canvas APIs. **Must not use:** React (the UI wraps the editor, not the
  other way round).

Modules: `camera`, `scene` + `text-placement`, `hit-test`, `selection`, `graphics`
(`SymbolGraphics`, upright text), `renderer`, `grid`, `theme`, `symbols/` (drawers by kind,
DIP, fallbacks), `editor` (the facade: input, stores), `store`, `preview` (Parts panel),
`recording-graphics` (tests), `dev-parts` (renderer fixtures, never in the default registry).
Pure modules have Node unit tests; the facade's DOM side is covered by `tests/e2e`.

Spec: [docs/editor.md](../../docs/editor.md).

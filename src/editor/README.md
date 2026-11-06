# src/editor — schematic editor engine

Framework-agnostic canvas editor: Canvas2D renderer, camera (pan/zoom), grid, hit-testing,
tools (select, place, wire), commands with undo/redo, live signal overlay.

- **Depends on:** `core`, `library`, `circuit`.
- **May use:** DOM and Canvas APIs. **Must not use:** React (the UI wraps the editor, not the
  other way round).

First implemented in R04 (feat/editor-canvas).

# src/ui — React interface

Application chrome around the canvas: toolbar, component palette, property inspector, bottom
dock panels (diagnostics, memory inspector, logic analyzer), dialogs.

- **Depends on:** `core`, `library`, `circuit`, `editor`.
- Talks to the editor and simulator through their public APIs and subscriptions
  (`useSyncExternalStore`), never by reaching into internals.

First implemented in R04 (feat/editor-canvas).

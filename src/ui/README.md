# src/ui — React interface

Application chrome around the canvas: toolbar, component palette, property inspector, bottom
dock panels (diagnostics, memory inspector, logic analyzer), dialogs.

- **Depends on:** `core`, `library`, `circuit`, `editor`.
- Talks to the editor and simulator through their public APIs and subscriptions
  (`useSyncExternalStore`), never by reaching into internals.

Implemented in R04a: `Workbench` (the shell), `MenuBar`, `Toolbar`, `Panel`/`Splitter`,
`StatusBar`, `PartsPanel`, `PropertiesPanel`, `MessagesPanel`, `Dialogs`; `commands` +
`workbench-commands` (one registry for menus, toolbar and shortcuts), `shortcuts`, `settings`
(persisted view preferences), `ui-state`; styles in `styles/` (tokens for both themes).

Spec: [docs/editor.md](../../docs/editor.md#shell).

# src/ui — React interface

Application chrome around the canvas: toolbar, component palette, property inspector, bottom
dock panels (diagnostics, memory inspector, logic analyzer), dialogs.

- **Depends on:** `core`, `library`, `circuit`, `editor`.
- Talks to the editor and simulator through their public APIs and subscriptions
  (`useSyncExternalStore`), never by reaching into internals.

Implemented in R04a: `Workbench` (the shell), `MenuBar`, `Toolbar`, `Panel`/`Splitter`,
`StatusBar`, `PartsPanel`, `PropertiesPanel`, `MessagesPanel`, `Dialogs`; `commands` +
`workbench-commands` (one registry for menus, toolbar and shortcuts), `shortcuts`, `settings`
(persisted view preferences), `ui-state`; styles in `styles/` (tokens for both themes). R04b:
`ContextMenu`, editable `PropertiesPanel` (`prop-input` parses typed values), `clipboard` (the
browser's clipboard events and the async Clipboard API), place/drag from `PartsPanel`. R05:
Simulate menu and toolbar commands, `SimControls` (speed select, the status bar's simulation
cell), `SimulationPanel` (runtime diagnostics tab), `LiveLevel` (level badges in Properties),
bottom-dock tabs. R06: `PartInfoPanel` (the Part tab; pure model in `part-info.ts`),
`PartPreview` (a part drawn by the canvas drawers, shared with `PartsPanel`).

Spec: [docs/editor.md](../../docs/editor.md#shell).

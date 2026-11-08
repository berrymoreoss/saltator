# Plan: feat/subcircuit-navigation

| Field      | Value                                                                          |
| ---------- | ------------------------------------------------------------------------------ |
| Branch     | `feat/subcircuit-navigation`                                                   |
| Roadmap    | R11b — Navigation into instances ([roadmap](../../docs/roadmap.md))            |
| Status     | in-progress                                                                    |
| Depends on | R11a (subcircuits, `Design`, resolver paths), R05 (live drawing), R13 (probes) |
| Created    | 2026-11-08                                                                     |

## Goal

Going **into an instance** while simulating, the way one puts a scope probe on one board of a
breadboard computer: the instance's circuit drawn with _that instance's_ live levels and
indicators, the Interact tool pressing its buttons and the Probe tool probing its signals (by
path, `A1/U3.Q0`), breadcrumbs showing where one is (`Main › A1 Counter Digit › A1 Decade
Counter`) and gestures to go in and out. R11a made every tool reach into instances by typed
paths and drew a subcircuit without levels; R11b makes the canvas itself work inside them, which
R16a's SAP-1 modules (a clock module with its step button inside, registers watched on their
own board) need to be debugged as built.

## Scope

**In scope**

- `editor`: an **instance path** for the open circuit (`''` the top, `A1`, `A1/A2`; none for a
  circuit not placed in the design), kept across edits, undo/redo and renames; the simulation
  model mapping the open scene to the instance's flat nets and parts; live drawing, Properties'
  live levels, Interact and the Probe tool (and the context menu's Add to Waveforms, Break When,
  Watch) inside an instance; Go Into, Go Up, Go to Top; locating a flat id (`A1/U3`, net
  `A1/CLK`) goes into its instance first (Simulation tab, Messages).
- `ui`: a **breadcrumb bar** over the canvas (crumbs to go up, the instances of the open circuit
  to switch to, Up), Circuit menu and context menu entries, shortcuts, the status bar note; the
  session and autosave keep the path.
- An e2e test on the Two-Digit Counter: run, go into a digit and into its counter, see levels,
  probe inside, come back.

**Out of scope** (and where it goes instead)

- A hierarchy tree of instances (a navigator panel) → backlog (Q2).
- Live levels on an instance's box at the parent (its pin stubs, a "peek" tooltip) → backlog;
  the wires to its pins show them already.
- Per-instance parameters, a drawn symbol, global labels → backlog (R11a).
- The Memory tab following the instance open (preselecting `A1/U3`) → backlog.
- Test benches → R15.

## Context

Read before starting:

- [docs/editor.md](../../docs/editor.md) — Shell (Circuits, status bar), Simulation (Editing
  while running, Interacting with parts, Live drawing), Waveforms (Probing from the canvas).
- [ADR-0023](../../docs/adr/0023-subcircuits.md) — flattening, the top simulates, resolver paths.
- [ADR-0010](../../docs/adr/0010-running-simulations.md) — the host, carry-over, Interact.
- `src/editor/editor.ts` — `EditorState`, `#stateOf`, `#model` (the `SimulationModel` per
  state: `flatNet`/`flatPart` map nothing outside the top today), `openCircuit`, `doubleClick`,
  `#spotAt` (refuses outside the top), `locate`/`locateNet`, `#flatRenames`.
- `src/editor/simulation.ts` — `SimulationModel`, `sync` (returns early on the same netlist
  and scene), `signalMap`, `signalView().part`.
- `src/editor/history.ts` (`Snapshot.open`), `src/editor/probe-target.ts`.
- `src/circuit/design.ts` — `Design.instances`, `circuitAt`, `netOf`.
- `src/ui/StatusBar.tsx` (the "drawn without levels" note), `CircuitsPanel.tsx`,
  `workbench-commands.ts` (`circuit.openSubcircuit`, `circuit.openTop`), `autosave.ts`
  (`open`), `LiveLevel.tsx`, `SimulationPanel.tsx`, `MessagesPanel.tsx`.

## Design

### Answered forks (2026-11-08)

- **Opening by circuit** (Q1): a placed subcircuit opened from the Circuits list or Messages
  opens inside its first instance; only a circuit not placed in the design is drawn without
  levels.
- **Where one is** (Q2): a breadcrumb bar over the canvas with an instance switcher; a
  hierarchy tree is backlog.
- **Shortcuts** (Q3): `Mod+↓` Go Into, `Mod+↑` Go Up.
- **Probe names inside** (Q4): as read inside, with the path (`A1/Q0`).

### The open instance

```ts
interface EditorState {
  // … document, circuit, scene, design, selection, renames as in R11a
  /**
   * The instance path of the open circuit: '' the top, 'A1', 'A1/A2'; undefined when the
   * circuit isn't placed in the design (drawn without levels).
   */
  readonly path: string | undefined;
}
```

- **Kept while it leads to the open circuit** (`design.circuitAt(path) === circuit.id`); after
  any change that breaks that (an instance deleted or renamed, Set as Top, a document loaded)
  it becomes the open circuit's **first instance** in design order (depth first, document
  order — `Design.instances`), else undefined. The top circuit open is always `''`.
- **Opening**: `openInstance(path)` — the circuit at `path`, that instance; `openCircuit(id)`
  (Circuits list, Messages, undo of an edit elsewhere) — its first instance (Q1); `goUp()` —
  the parent path, with the instance one came from selected and brought into view; `goTop()`
  — `''`. None is an edit; the camera stays one per circuit (R11a), so the instances of a
  circuit share a view.
- **History**: `Snapshot` records the path with the open circuit, so undo of an edit made inside
  `A2` comes back inside `A2` (if it still exists, else as above).
- **Editing inside an instance edits its circuit** — every instance of it changes (R11a,
  ADR-0023); the breadcrumb bar says so (`Edits change every instance: A1, A2`). Running, the
  edit carries over as today.

### The simulation model of a path

`#model(state)` builds, for `path !== undefined`:

```ts
flatNet: (net) => design.netOf(path, net),
flatPart: (id) => (path === '' ? id : `${path}/${id}`), // only parts the netlist has
```

and maps nothing for an unplaced circuit. Everything drawn live goes through these two already
(`signalMap`: wires, points, buses by member names, label colors; `signalView().part`: lights,
switch positions, LCD glass; `LiveLevel`: Properties' badges), so the canvas inside an instance
shows its levels without touching the drawers. `Simulation.sync` compares models, not netlist
and scene, so going into another instance of the same circuit (same scene, same netlist) rebuilds
the signal map. Indicator samples are kept per flat part, so a light inside `A2` has its own
brightness history.

### Tools inside

- **Interact**: actions go to `flatPart(id)` (`A1/SW1`) — already the code path; it now maps.
- **Probe tool**: `probeSpotAt` on the open scene as today, the reference **prefixed with the
  path** (`A1/U3.Q0`, `A1/CLK`, `A1/D[0..7]`, a driving pin `A1/U2.Y`) — Q4; the refusal "only
  Main simulates as drawn" goes; an unplaced circuit says it isn't placed. A signal probed
  inside and again from outside under its outer name (`CNT0`) is two rows, as two names of one
  net at the top are today. The context menu's
  Add to Waveforms, Break When … Rises and Watch use the same spot.
- **Locating a flat id**: `locate({ component: 'A1/U3' })` and `locateNet('A1/U2.Y')` open the
  instance first (the path is what precedes the last `/`), then select and bring into view —
  the Simulation tab's diagnostics and anything else naming design ids. Messages (design
  issues, per circuit) open the circuit in its first instance (Q1).

### Gestures and commands

- **Go into**: double-click an instance (Select or Interact; running or stopped — R11a's
  "opens its circuit" becomes "goes into the instance"); the context menu's **Go Into A1**
  (was Open Subcircuit); **Circuit ▸ Go Into Instance** on the selected one, `Mod+↓` (Q3).
- **Go out**: a crumb in the breadcrumb bar, its **Up** button, **Circuit ▸ Go Up** and the
  empty-canvas context menu's **Go Up to Counter Digit**; **Go to Top** (was Open Top
  Circuit); `Mod+↑` Go Up (Q3).

### Breadcrumb bar

A 22 px bar floating over the canvas's top left corner (so the canvas keeps its size when a
second circuit is added), shown when the document has more than one circuit (Q2; a hierarchy
tree is backlog):

```
 ↑ │ ★ Main › A1 · Counter Digit › A1 · Decade Counter ▾      edits change every instance: A1/A1, A2/A1
```

- Each crumb is an instance (designator · circuit name); a click goes up to it. The last crumb's
  `▾` lists every instance of the open circuit in the design (`A1/A1`, `A2/A1`) to switch to.
- An unplaced circuit: `Counter Digit — not placed in Main (drawn without levels)`; this
  replaces the status bar's "Main simulates; this circuit is drawn without levels".

### Session

Autosave stores the path beside `open`; restoring goes back into the same instance (if it is
still there, else as above).

### ADR

ADR-0024 "Instance navigation: the open view is an instance path": a path in the editor state
mapping one shared scene to one instance's flat ids (vs a scene per instance, or showing every
instance's levels at once), opening by circuit picking an instance (Q1), probe references as
read inside (Q4).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `editor`: `EditorState.path` — derived and kept by `#stateOf` (kept while it leads to
  the open circuit, else the first instance, else undefined); `openInstance`, `goUp`, `goTop`,
  `openCircuit` to the first instance (Q1); `Snapshot.path` in the history; tests (edits,
  undo/redo across circuits, instance renames and deletes, Set as Top).
- [x] 2. `editor`: the simulation model of a path (`flatNet`/`flatPart`), `Simulation.sync` by
  model; live levels, lights and bus values inside an instance; tests: two instances of one
  module drawn with their own levels, carry-over while inside, lights per instance.
- [x] 3. `editor`: Interact and the Probe tool inside — path-prefixed references, the context
  menu's spot; `locate`/`locateNet` by flat ids going into the instance; tests.
- [x] 4. `editor`: double-click goes into the instance; Go Up selects the instance one came
  from, in view; tests.
- [x] 5. `ui`: the breadcrumb bar (crumbs, instance switcher, Up, the edits note, the unplaced
  note), Circuit menu and context menu entries, `Mod+↓`/`Mod+↑`, the status bar note removed;
  Simulation tab locating into instances; looked at in the browser, light and dark.
- [x] 6. `ui`: autosave and session restore keep the path; tests.
- [ ] 7. e2e: the Two-Digit Counter — run, double-click a digit, see its levels, go into its
  Decade Counter, probe a wire (a row `A1/A1/…` in Waveforms), switch to the other digit, go up
  by the breadcrumb and by the shortcut.
- [ ] 8. Docs: editor.md (Shell: breadcrumbs, Circuits; Simulation: live drawing and Interact
  inside instances; Probing inside), circuit.md if the resolver changes, glossary (open
  instance), ADR-0024, roadmap (R11b done, backlog items), lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] Running the Two-Digit Counter, going into each digit shows that digit's levels (the two
  differ while counting), live, in the browser and in a unit test.
- [ ] A button or switch pressed inside an instance acts on that instance only (unit test with
  two instances of one module; looked at in the browser).
- [ ] The Probe tool inside an instance adds `A1/…` references that record; a second click
  removes them; Break When … Rises and Watch inside work the same way.
- [ ] In and out by double-click, the context menu, the Circuit menu, the shortcuts and the
  breadcrumbs; Go Up selects the instance one came from.
- [ ] The path survives edits inside the instance while running (carry-over) and undo/redo; an
  edit undone comes back in the instance it was made in.
- [ ] A Simulation tab diagnostic of a part inside an instance locates it inside that instance.
- [ ] Reloading the page restores the same instance.

## Open questions

- [x] Q1. Opening a placed subcircuit by its circuit (Circuits list, Messages)? — _proposed:_
  its first instance (levels shown, the breadcrumbs say which; switch with `▾`) rather than its
  definition without levels — **answer:** its first instance (2026-11-08).
- [x] Q2. Breadcrumbs only, or a hierarchy tree too? — _proposed:_ a breadcrumb bar over the
  canvas with an instance switcher; a tree of instances in the backlog — **answer:** the
  breadcrumb bar; the tree to the backlog (2026-11-08).
- [x] Q3. Shortcuts to go in and out? — _proposed:_ `Mod+↓` Go Into (the selected instance),
  `Mod+↑` Go Up (as Finder's folders; arrows alone nudge, Backspace deletes) — **answer:**
  `Mod+↓` / `Mod+↑` (2026-11-08).
- [x] Q4. What the Probe tool calls a signal inside an instance? — _proposed:_ as read inside,
  with the path (`A1/Q0`), rather than the flat net's shortest name (`CNT0` when the net reaches
  the top) — **answer:** as read inside, with the path (2026-11-08).

## Progress log

- 2026-11-08 — plan drafted; Q1–Q4 answered (all as proposed); approved, branch started.

## Handoff

- **State:** plan approved, branch started; no code yet.
- **Next step:** task 1 (`EditorState.path`).
- **Watch out:** `Simulation.sync` returns early when netlist and scene are the same objects —
  switching between instances of one circuit changes neither.
- **Verify with:** `pnpm check`; `pnpm e2e`.

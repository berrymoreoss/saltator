# 0024. Instance navigation: the open view is an instance path

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** R11b (`feat/subcircuit-navigation`)

## Context

R11a flattened the hierarchy for the kernel (ADR-0023) and let every tool reach inside
instances by typed paths (`A1/U3.Q0`), but the canvas drew a subcircuit without levels: a
module could be edited while the design ran, not watched or operated. Debugging a build of
modules — Ben Eater's clock board with its step button, a register watched on its own board —
needs the canvas inside one instance: its levels, its buttons, probes by pointing. One circuit
is placed many times, every instance with its own state but one drawing, and the scene of a
circuit is built once per change of it.

## Decision

- **The open circuit is seen in one instance**: `EditorState.path` (`''` the top, `A2`,
  `A2/A1`; none for a circuit the design places nowhere). The simulation model maps the open
  scene through it — nets by `Design.netOf(path, net)`, parts as `path/id` — so the drawers,
  the Interact tool and Properties work inside unchanged; the host re-maps a scene when only
  the path changes.
- **Opening by circuit picks an instance** (Q1): the Circuits list, Messages and undo open a
  circuit in its first instance in design order; a broken path falls back to its longest end
  that still places the circuit, then the first instance. Only a circuit placed nowhere is
  drawn without levels.
- **Where one is shows over the canvas** (Q2): a floating breadcrumb bar — Up, the top, each
  instance down to the one open, a switcher among the circuit's instances, "edits change all N
  instances". Double-click, Go Into (`Mod+↓`) and Go Up (`Mod+↑`, Q3) move in and out; going up
  selects the instance left.
- **Probes inside are named as read there** (Q4): the path, then the local reference
  (`A1/MID`, `A1/A2/U1.Y`), not the flat net's outermost name.
- **One camera per circuit, one history per document**: the history records the path, so an
  undone edit comes back in the instance it was made in.

## Consequences

- The scene, layouts and compile caches stay per circuit: going into another instance of a
  module costs a signal map, not a scene.
- An edit inside an instance still edits the circuit, every instance of it; the bar says so.
- One signal probed inside and outside under two names is two rows (as two names of one net at
  the top already were).
- A hierarchy tree (navigator), live levels on an instance's box at the parent and the Memory
  tab following the instance open are left for later (roadmap backlog).

## Alternatives considered

- **A scene per instance** (an instance view object holding its own scene) — duplicates scenes
  and caches for nothing: the drawing is the circuit's, only the map to the simulator differs.
- **Showing every instance's levels at once** (a summary on the shared drawing) — no level is
  "the" level of a wire shared by two instances; a scope probe looks at one board.
- **Opening by circuit without levels** (R11a's definition view) — two ways to see one drawing,
  and the one without levels is rarely what is wanted while simulating.
- **Shortest flat names for probes** (`CNT0` for `A1/Q0`) — no duplicate rows, but the row
  isn't named like what was clicked, and the name depends on what the module is wired to.
- **A breadcrumb strip above the canvas** — resizes the canvas when a second circuit is added;
  a hierarchy tree in the Circuits panel is more than navigating needs now.

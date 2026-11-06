# 0006. Circuit document: wire segments, designator ids, geometric connectivity

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R02 (feat/circuit-model)

## Context

The circuit document is what the user draws and what gets saved; the editor (R04), the simulator
host (R05), persistence (R07) and test benches (R15) all build on it, and saved files must keep
opening forever. architecture.md proposed orthogonal polylines, opaque `nanoid`-style ids and
Logisim-style geometric connectivity. Explicit part symbols only arrive in R03, yet connectivity
needs every pin's grid position now.

## Decision

- **A wire is one straight horizontal or vertical segment** `{ id, from, to }` (Logisim, KiCad).
  An L-shape is two wires; the editor splits and merges segments.
- **A component's id is its designator** (`U1`, `SW1`), unique within the circuit together with
  wire ids, with no dots. Netlists, diagnostics, the simulator API and test benches use it as is.
  An optional free-text `label` is for display only.
- **Connectivity is geometric and everything that touches connects**: wire ends and pins connect
  to wire ends, wire interiors (T-junctions) and pins at the same point; only crossing wire
  interiors don't. Junction dots are derived (three or more things meet), never stored.
- **Pin positions are derived from part definitions** by `partLayout` in `src/circuit`: a DIP
  drawing for parts with a `package` (vertical, notch up, datasheet numbering), a generic box
  otherwise; explicit symbols (R03) take precedence. The compiler and the editor share it.
- **Documents carry `schemaVersion`** and are migrated forward step by step on load; files from a
  newer version are rejected. Loading checks structure only; unknown part types and bad props are
  compile-time design issues, so a file opens even when a part is missing.

Details: [circuit.md](../circuit.md).

## Consequences

- Connectivity is a small union-find over points (≈ 9 ms for 10 000 wires), and the document
  has no connection data that could disagree with the drawing.
- Readable ids everywhere ("floating input U3.A", `sim.pinLevel('U1', 'Y')`, test vectors by
  designator). Renaming a part changes its identity: R05 must carry simulator state across a
  rename explicitly (the rename command knows old → new).
- A wire running over a pin connects to it, so routes must avoid pin rows; the `dangling-wire`
  and `undriven-input` checks catch the opposite mistake (a wire that stops short).
- Moving or rotating a part doesn't drag wires along by itself: the editor has to stretch the
  attached segments (R04).
- Pin positions of `prim/*` parts may change when R03 gives them symbols; fine before R07.

## Alternatives considered

- **Orthogonal polylines** (Proteus) — a wire is selected and moved as one object, but T-junctions
  on a path's middle, splitting and merging are harder to edit and to diff.
- **Opaque stable id + separate designator** (KiCad UUID + reference) — renames never change
  identity, but every diagnostic, lookup and test bench would have to map id ↔ designator.
- **Pins connect only at wire ends** — avoids accidental connections along pin rows, but what you
  see would no longer be what you get.
- **Explicit junction objects** (KiCad) — more state to keep consistent with the geometry.
- **A minimal `symbol` in core now** — every part would need explicit pin positions before R03
  defines what symbols look like.

# 0009. Editing model: snapshot undo, rubber-band moves, normalized wires, sticky tools

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R04b (`feat/editor-tools`)

## Context

R04b turns the schematic view into an editor. Every later feature edits documents through it
(R05 recompiles on edit, R07 saves, R10 adds labels and buses, R11 subcircuits). The document
model is fixed by ADR-0006: wires are straight segments, a part's id is its designator,
everything that touches connects, and nothing drags wires along by itself. Questions decided at
branch start (plan Q1–Q5): what happens to wires when a part moves, how undo works, whether the
place tool stays armed, designator prefixes, how wires are drawn.

## Decision

- **Undo is document snapshots.** An undo entry is the circuit and selection before and after one
  user action (a whole drag, one paste, one Properties commit); immutable documents share every
  unchanged part and wire between snapshots. Consecutive arrow-key nudges of one selection
  coalesce. Entries record renames (old → new designator) so the simulator host can carry state
  across them (R05).
- **Wires follow moved parts (rubber-banding).** Moving, rotating and flipping are one transform
  of points: unselected wires attached to moving points stretch, slide a plain corner (KiCad's
  drag) or bend into a Z; direct contacts (pin on pin, pin on a wire's middle) get a new wire that
  leaves the fixed pin head-on.
- **Wires are normalized after every edit**: no zero-length wires, collinear wires that overlap
  or meet end to end become one straight run — split only where perpendicular wires pass through,
  so normalization never changes connectivity. A straight run is one selectable wire.
- **Tools are sticky.** The place tool stays armed until Escape (each click places the next
  designator); the Wire tool draws wire after wire. Wires are drawn click by click with an
  L-shaped preview, or dragged out of a pin tip in the Select tool. Paste and duplicate float
  under the pointer until a click drops them.
- **Designator prefixes live in part definitions** (`designatorPrefix`, KiCad/IEEE letters, default
  `U`); new parts and renumbered pastes take the lowest free number.
- **Gestures don't touch the DOM.** The `Editor` takes `PointerInput` values (canvas pixels,
  button, Shift); the DOM layer only converts events, so every gesture is unit-tested in Node.
- **The clipboard holds document text** (a one-circuit document in the file format), through the
  browser's clipboard events for keyboard shortcuts and the async Clipboard API for menus.

## Consequences

- Undo can't drift out of sync with the document and needs no inverse operations; memory is
  references (≈ 30 KB per entry for 3 600 parts, 200 entries kept).
- Moves keep connections, but may create new ones where a moved part or a Z bend lands on other
  pins (everything that touches connects); the design checks and the connection marks of the
  previews make that visible.
- The connectivity-preserving normalization is the invariant future wire edits (net labels,
  buses) must keep; its property test guards it.
- Floating paste costs a click, but a paste never connects by accident to what the copies would
  overlap in place.
- Copies paste into other tabs and, from R07, between files; any saved document's text pastes.

## Alternatives considered

- **Do/undo command objects** — less memory, but every operation needs a correct inverse and one
  buggy inverse corrupts the history.
- **Wires stay where they are (KiCad "move")** — simpler, but every move breaks connections the
  user then has to redraw; possibly later as a modifier.
- **One-shot place tool** (back to Select after one placement) — fewer accidental placements, but
  drawing a circuit means placing several parts of a kind.
- **Drag-only wiring (Logisim) or click-only wiring (KiCad)** — both have users; offering both
  costs one gesture.
- **Paste in place / at an offset** — immediate, but a copy laid over existing wiring connects to
  whatever it touches.
- **Prefixes in an editor table** — keeps display data out of definitions, but every new family
  would have to update a table far from its parts.

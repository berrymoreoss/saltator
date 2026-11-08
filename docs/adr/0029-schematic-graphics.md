# 0029. Schematic graphics are schematic-only parts without pins

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** PLT-1 (feat/schematic-text)

## Context

A schematic says more than its connections: a title, what a block does, how to run it, the
program in a ROM. Until now the only free text was a part's `label` beside its designator, and
the examples explained themselves in their test scripts' comments, out of sight of someone
looking at the canvas. Schematic editors draw text, lines, frames and title blocks that take no
part in the netlist (KiCad's graphic items, Logisim's text tool). The document has components and
wires, and every editing feature — placing, selecting, moving, rotating, copy/paste, undo,
Properties, saving — is built for those two; net labels, bus entries and ports already ride on
components as schematic-only parts ([ADR-0015](0015-net-labels.md)).

## Decision

- **A graphic element is a library part** of the family `draw` (`draw/text` first): a
  `ComponentDefinition` with `schematicOnly: true`, no pins and a symbol whose size follows its
  props. The compiler already leaves schematic-only parts out of the netlist, so graphics never
  reach the simulator or the design checks, and the file format doesn't change.
- **A text's box is estimated in the pure layers.** `circuit` and `library` have no font
  metrics, so `textBlockSize` measures lines with fixed character widths (exact for the mono
  font; for sans a table of character classes following the system UI font at 10 px, erring
  wide). The drawer starts the text at the box's top-left, so an estimate that falls short only
  shows in the selection outline.
- **Multi-line text is a string prop** (`PropDef.multiline`): validated as any string, edited in
  Properties in a text area.
- **Text reads upright as a block**: `SymbolGraphics.textBlock` lays the lines out inside the
  placed box, so a rotated or flipped text keeps its lines in order and never reads upside down.
- **Graphics sit under the circuit for the pointer**: hit-testing tries them after other parts
  and wires, so a text over a chip doesn't take the chip's clicks.

Details: [components.md](../components.md#graphics-draw), [editor.md](../editor.md#schematic-text).

## Consequences

- Texts get designators (`TXT1`) because every component has one; they are never drawn, and
  test benches and the resolver never see them (not in the netlist).
- Everything that works on parts works on texts: copy/paste between circuits and documents,
  undo, moving with the selection, subcircuits.
- Lines, rectangles, frames and images can follow as `draw/*` parts on the same model; a shape
  that should not have a body hit area (a long line) will need its own hit shape.
- A sans text's selection box is only as good as the width table; a real measurement would need
  the editor to supply metrics to the layout.

## Alternatives considered

- **A separate list of annotations in the circuit** (`Circuit.notes`, schema v6) — the natural
  model, but a second selectable kind in hit-testing, selection, moves, clipboard, undo and
  Properties, and a migration, for no difference the user sees.
- **Annotations as the circuit's or document's notes field** (the R07 idea of document notes) —
  text off the canvas; it can't sit next to the block it explains.
- **Measuring text in the editor and storing the box in the document** — exact boxes, but the
  document would carry derived data that goes stale with fonts, and pure layers could no longer
  lay a part out from its props.

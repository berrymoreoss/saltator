# Plan: feat/schematic-text

| Field      | Value                                                                               |
| ---------- | ----------------------------------------------------------------------------------- |
| Branch     | `feat/schematic-text`                                                               |
| Roadmap    | PLT-1 — Schematic text, track [Platform](../../docs/roadmap/platform.md)            |
| Status     | in-progress                                                                         |
| Depends on | R04b (place tool, Properties), R10a (schematic-only parts), R17a (the 6502 example) |
| Created    | 2026-11-08                                                                          |

## Goal

Graphic elements without logic in the library, starting with **Text**: a block of free text
drawn on the schematic — a title, a description of what a circuit does, a program listing — that
is placed, moved, copied, undone and saved like any part and never simulated. The first use is
the **6502 ROM and RAM** example: one text explaining what the example is and what happens when
it runs, and one with the assembly listing of the program in its ROM.

## Scope

**In scope**

- `core`: `PropDef.multiline` — a `string` prop whose value may hold line breaks.
- `library`: a new family `draw` (graphics, schematic-only, no pins) and its first part
  `draw/text` with props `text` (multi-line), `size`, `font`; its block size in whole cells
  computed from the text (`textBlockSize`).
- `editor`: a `text` drawer; `SymbolGraphics.textBlock` (lines laid out upright inside a box
  whatever the part's rotation); no designator drawn; hit-testing on the block.
- `ui`: the Parts panel's **Graphics** group; a multi-line text field in Properties (Enter: new
  line, `Mod+Enter` or leaving the field: apply, `Esc`: revert); double-click / Edit ▸ Properties
  on a text focuses that field; Place ▸ Text (`T`, KiCad's key).
- Example: the 6502 ROM and RAM example gets its description and its program listing as texts;
  a scenario test keeps the listing's bytes equal to the ROM's contents.
- Docs: components.md (family `draw`), editor.md (placing and editing text), architecture.md,
  circuit.md if needed, an ADR (graphics as schematic-only parts), the Platform track (PLT-1,
  ideas for more graphics).

**Out of scope** (and where it goes instead)

- Editing text in place on the canvas → Platform idea.
- Bold, alignment, colors, a frame around the text → Platform idea.
- Other graphics: lines, rectangles, frames, title block, images → Platform ideas (each a
  `draw/*` part on the same model).
- Texts in the other examples → later, as examples are touched.

## Context

Read before starting:

- [docs/components.md](../../docs/components.md#net-labels-net) — schematic-only parts, symbols,
  props.
- [docs/editor.md](../../docs/editor.md#placing-parts) — place tool, Place menu, Properties.
- [ADR-0015](../../docs/adr/0015-net-labels.md) — schematic-only parts in the library.
- `src/library/net/label.ts` — a schematic-only part whose symbol size follows a prop.
- `src/editor/symbols/net.ts`, `src/editor/graphics.ts` (`SymbolGraphics.text`, `uprightText`).
- `src/editor/scene.ts` (`partTexts`), `src/editor/hit-test.ts`, `src/editor/editor.ts`
  (`#newPart`, `doubleClick`).
- `src/ui/PropertiesPanel.tsx` (`Field`, `PropEditor`), `src/ui/parts-filter.ts` (families),
  `src/ui/workbench-commands.ts` (`PLACE_PARTS`, `PLACE_MENU`).
- `examples/6502-rom-ram.logic.json` — the ROM image and the bench describing the program.

## Design

**Graphics are schematic-only parts** (Q0, the user's ask: "add to the library graphic elements
without logic"). A `draw/*` part is a `ComponentDefinition` with `schematicOnly: true`, no pins
and a symbol; the compiler already leaves schematic-only parts out of the netlist, so a text
never reaches the simulator, and selection, moving, rotating, clipboard, undo, Properties and
saving work as for any part. No schema change: a new part type with its props. The alternative,
a separate `Circuit.notes` list (schema v6), would need a second path through every editing
feature. Recorded in an ADR.

**`draw/text`** (`src/library/draw/text.ts`), designator `TXT` (never drawn, like `NL`):

| Prop   | Type                  | Default  | Values                                                      |
| ------ | --------------------- | -------- | ----------------------------------------------------------- |
| `text` | `string`, `multiline` | `Text`   | any text; `\n` separates lines                              |
| `size` | `enum`                | `normal` | `small` 0.5, `normal` 0.7, `large` 1.0, `title` 1.5 (cells) |
| `font` | `enum`                | `sans`   | `sans`, `mono` (listings, tables)                           |

- Symbol `text`: no pins; body `width × height` in whole cells (≥ 1 × 1) from `textBlockSize`:
  lines × line height (1.25 × size) plus padding; the widest line by a per-character width
  estimate — exact for mono (0.6 em), a small table of character classes for sans (narrow
  `il.,:;'|!`, wide `MW@m w`, upper case, digits), erring wide. The library has no font metrics
  (pure layer), so the box is an estimate; the drawer draws the text at the box's top-left, so a
  short estimate never clips (canvas text isn't clipped), it only shows in the selection outline.
- Empty lines keep their height; tabs are expanded to the next multiple of 4 columns when
  measuring and drawing (listings); trailing spaces count in mono.
- Placed centered under the pointer (a part without pins), like other parts.

**Drawing.** `SymbolGraphics.textBlock(lines, box, style)`: the canvas implementation maps the
local box through the placement to a world box and draws the lines in it upright — reading
left-to-right top-down at 0°/180°, bottom-to-top left-to-right at 90°/270° — so a rotated or
flipped text never reads upside down or backwards and its lines keep their order (a per-line
`text()` call would reverse them at 180°). Level of detail: skipped below 4 px like other text.
The recording graphics records the call for tests. The block has no outline or fill when idle;
selection draws the usual outline around the body.

**Scene and hit-testing.** `partTexts` returns nothing for the `text` kind (no designator, no
label). A text's body is its hit area. Hit-testing tries part bodies top-down, then pins and
wires; a text placed over a chip or a wire would take its clicks — texts are tried after
everything else (annotations sit under the circuit for the pointer), still drawn in document
order.

**Properties.** A `multiline` string prop gets a `TextArea` field across the panel's width
(the label above it), monospaced when the part's font is mono, no wrapping (horizontal scroll),
rows following the text up to a limit. Enter inserts a line break; `Mod+Enter` or blur commits;
`Esc` reverts. For a part with a multiline prop, the focus request (double-click, Edit ▸
Properties) focuses that field instead of the designator. Free label text stays hidden
(schematic-only).

**Place menu.** Place ▸ Text (`T`), after Port, arming the place tool with `draw/text`.

**The example.** Two texts in `examples/6502-rom-ram.logic.json`, English (the repo's language):

1. Description (sans, a `title`-sized heading as its own text, the body `normal`): what the
   computer is (W65C02S, AT28C256 ROM at $8000–$FFFF, 62256 RAM at $0000–$3FFF decoded by a
   74HC00 as in Ben Eater's 6502, 1 kHz clock, RESET button, hex displays on the address bus),
   what to do (Run, press and release RESET) and what to watch (the address on DS1–DS4, the
   count in U3[$10] and U3[$200] in the Memory tab, the stack page at U3[$1FE..$1FF]).
2. The listing (mono, `small` or `normal`): addresses, bytes, labels, mnemonics, comments —
   `LDX #$FF / TXS / STZ $10 / loop: INC $10 / LDA $10 / JSR store / BRA loop`, `store: PHA /
   STA $0200 / PLA / RTS`, and the reset vector `$FFFC: $8000`, with cycle counts (34 a loop).
3. A scenario test reads the listing text, parses `ADDR  BB BB …` columns and checks them
   against U2's `contents` image byte for byte (and nothing else programmed), so the listing
   can't drift from the ROM.

Positions chosen after looking at the example in the browser (free space below the chips and
the pull-ups, y ≥ 33).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. ADR-0029 (graphics as schematic-only parts) + roadmap row/section PLT-1 and ideas.
- [x] 2. `core`: `PropDef.multiline` (docs in components.md#properties); `string` validation
  unchanged otherwise.
- [x] 3. `library`: `draw/text` with `textBlockSize` and its tests (sizes, tabs, empty lines,
  the registry); family `draw` in the registry; the gallery example lists it.
- [x] 4. `editor`: `SymbolGraphics.textBlock` (canvas + recording) with placement tests; the
  `text` drawer; no designator in the scene; texts hit after other parts; tests.
- [ ] 5. `ui`: Graphics group in Parts; Place ▸ Text (`T`); the `TextArea` field for multiline
  props; the focus request on a text; tests (prop-input, commands).
- [ ] 6. e2e: place a text with `T`, type two lines in Properties, apply, check the document and
  the canvas; undo.
- [ ] 7. Example: the description and listing texts in 6502 ROM and RAM; the listing-vs-ROM
  scenario test; looked at in the browser (light and dark).
- [ ] 8. Docs: components.md (family `draw`, `draw/text`), editor.md (Place ▸ Text, Properties,
  double-click), architecture.md, library/editor READMEs, lessons; roadmap status.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check` and `pnpm build` are green; `pnpm e2e` passes.
- [ ] A Text placed from Parts ▸ Graphics or Place ▸ Text (`T`) shows on the canvas, moves,
  rotates (reads upright, lines in order), copies, undoes and survives save and reload.
- [ ] Its text is edited in Properties over several lines; size and font change the drawing and
  the selection box.
- [ ] A text is never in the netlist and adds no design-check messages.
- [ ] The 6502 ROM and RAM example shows its description and its program listing; the listing
  matches the ROM byte for byte (scenario test); its bench still passes.

## Open questions

- [x] Q1. Text props — _proposed:_ text + size + font — **answer:** text + size (Small / Normal /
  Large / Title) + font (sans / mono).
- [x] Q2. Editing — _proposed:_ in Properties, double-click focuses the field — **answer:** in
  Properties.

## Progress log

- 2026-11-08 — plan drafted; Q1, Q2 answered; approved, started.

## Handoff

- **State:** plan approved; nothing built yet.
- **Next step:** task 1.
- **Watch out:** —
- **Verify with:** `pnpm check`.

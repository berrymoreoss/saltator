# Plan: feat/memory-inspector

| Field      | Value                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------ |
| Branch     | `feat/memory-inspector`                                                                    |
| Roadmap    | R12b — Memory inspector, image files ([roadmap](../../docs/roadmap.md))                    |
| Status     | in-progress                                                                                |
| Depends on | R12a (memory chips, `MemoryDef`, `poke`, `image` props), R05 (simulator host), R07 (files) |
| Created    | 2026-11-07                                                                                 |

## Goal

See and change what the memories of a circuit hold, as a designer at the bench does with a
programmer and a logic probe: a **Memory** tab with a hex view of any memory part — live while
simulating, with the cells being read and written lit up and the address on the chip's pins
followed — where bytes are edited in place; `.bin` and Intel HEX files loaded into and saved
from a memory through a programmer-style dialog that shows what a file holds before it is
written; and one **resolver** that turns references (`U5`, `U5.A0`, `CLK`, `D[0..7]`) into the
compiled netlist's parts and nets, which the inspector uses now and R13's probes, R14's watches
and breakpoints and R11's instance paths (`U5/D0`) will extend in one place. It is the first of
the design tools that now come before the SAP-1 (Q1): the roadmap is reordered into a tools
phase ending in M2 "Tools" and a SAP-1 phase (R16a modules, R16b the computer).

## Scope

**In scope**

- `core`: access stamps on the memory view (when each cell was last read and written), the
  memory's address pins on `MemoryDef` (for following the address); image file codecs — raw
  binary and Intel HEX (records 00–05, checksums), a file's summary, placing a file's bytes
  into a memory at an offset.
- `library`: memory parts stamp their reads, writes and pokes.
- `circuit`: the resolver (`resolve.ts`): parts, pins, nets, buses by reference; the memories of
  a compiled circuit.
- `editor`: a pure inspector model on the simulator host — the memory's cells (live from the
  simulator, a ROM's image while stopped), the current address, highlighting, edits as
  document changes (ROM images) or pokes (a simulated RAM).
- `ui`: the Memory tab (picker, virtualized hex view with ASCII, editing, highlighting, follow
  address), following the canvas selection; binary file access; the Load Image (programmer)
  and Save Image dialogs; Erase; commands and menu entries.
- Browser tests on the existing examples (EEPROM 7-Segment Decoder, RAM by Hand).
- Roadmap reordered (Q1): phase 3 "Design tools" (R12b, R13, R14, R11, R15) → M2 "Tools";
  phase 4 "SAP-1" (R16a `example/sap-1-modules`, R16b `example/sap-1`) → M3 "SAP-1 runs"; R15
  gains a setup that loads memories before t = 0 (Q2); vision.md's milestones to match.
- Docs: editor.md, components.md, simulation.md, circuit.md, architecture.md, glossary,
  READMEs, ADR-0018, roadmap, vision, lessons.

**Out of scope** (and where it goes instead)

- The SAP-1 modules (ALU and B register, RAM and memory address register, the output register
  with its multiplexed EEPROM decoder; the clock, A register and program counter redone as
  subcircuits with test benches) → R16a; the whole computer → R16b (Q1).
- Loading a program into a RAM before the simulation starts → R15's bench setup (Q2). RAMs stay
  as real ones are: `X`, zeros or random at power-on, contents lost at Reset.
- Generating an image from a script (Ben Eater's Arduino sketch for the decoder EEPROM) →
  backlog; examples compute their images in their generators.
- Disassembly in the inspector → R17; symbols → R19; watches and memory breakpoints → R14.
- EEPROM write cycles from the circuit → backlog (R12a, Q5).
- Moving `Simulation.busLive`/`pinStyle` onto the resolver → R11 decides with instance paths
  (they work on the scene shown, one circuit level).

## Context

Read before starting:

- [ADR-0017](../../docs/adr/0017-memories.md) — images in the document, circuit writes in the
  simulator only, `MemoryDef`, `poke`.
- [docs/components.md#memories-mem](../../docs/components.md#memories-mem) — the read and
  write paths, power-on modes, inspection.
- [docs/simulation.md#observability](../../docs/simulation.md#observability) — `stateOf`,
  lookups, `ticks`.
- [docs/editor.md](../../docs/editor.md) — shell, Part info (selection-following), Properties
  (image summary), Simulation host stores, Files.
- [ADR-0008](../../docs/adr/0008-desktop-workbench.md) (fixed docks),
  [ADR-0012](../../docs/adr/0012-files-and-sessions.md) (`FileAccess`).
- `src/core/memory.ts`, `src/library/mem/` (`memory.ts`, `write.ts`, `srams.ts`,
  `eeproms.ts`), `src/circuit/compile.ts`, `src/editor/simulation.ts`, `src/ui/Workbench.tsx`,
  `PartInfoPanel.tsx`, `PropertiesPanel.tsx`, `files.ts`, `Dialogs.tsx`.

## Design

### Access stamps (core, library)

Live read/write highlighting needs to know which cells were touched, at every speed: at real
time a SAP-1 reads its RAM a thousand times a second, many accesses per frame.

- `MemoryView` gains `readAt` and `writtenAt`: `Float64Array`s with one simulated time per word
  (`-Infinity`: never). The part stamps a **read** when its outputs drive a cell's data (the
  data became valid for one known address; merged unknown addresses stamp nothing), a **write**
  when a write ends and stores a cell (also a cell a violation made `X`) and on a `poke`. One
  typed-array store per access: no allocation, negligible next to the drives (benchmark checked
  against R12a's ≈ 7.5M events/s).
- The inspector compares the stamps of the visible cells with the simulated times of the last
  few frames: a cell touched since the previous frame lights up and fades over ≈ ½ s of wall
  time, so a cell read in every frame stays lit and a single access is seen. Works while paused
  and stepping (what the last step touched).
- 512 KB per 62256 (two stamps per byte); the stamps move with the state in a carry-over.
- Alternative rejected: the last read and write address only — at real time most accesses fall
  between frames and the highlighting would flicker on one cell.

`MemoryDef` gains `addressPins: readonly string[]` (A0 first): the inspector reads the levels
on them to show and follow the address the chip sees (`0x01F`, or with `X` bits).

### The resolver (circuit)

`resolve.ts`: `new Resolver(compileResult, registry)` over one compiled circuit.

- References as the rest of the app writes them: `U5` (a part), `U5.A0` (a pin), `CLK` (a named
  net, or a net id), `D[0..7]` (a bus, its members most significant first, as Properties lists
  them). `resolve(text)` returns the target with its netlist ids (component id, net ids) or the
  reason it doesn't resolve ("no part U9", "U5 has no pin Q3", "D[0..7] has no member named on
  this circuit"); `parts(filter?)` and `memories()` (the parts whose definitions have `memory`,
  in designator order). Simulator indices come from the ids (`componentIndex`, `netIndex`).
- Instance paths (`U5/D0`) are R11's: `/` is reserved (pin names have none since R12a) and the
  parser rejects it with "subcircuits come with R11".
- A reference is text, so the inspector keeps `U3` and follows renames from `editor.state`
  (`renames`), as the simulator does.

### Inspector model (editor)

`MemoryInspector` (pure, on the `Editor` and its `Simulation`):

- **Memories**: `resolver.memories()` of the scene's compile result, updated with the document.
- **Cells**: while simulating, the instance's `memory.view(sim.stateOf(id))` (no copy; read
  every `ticks`); while stopped, a ROM's image (parsed from its prop, cached per image text); a
  stopped RAM has no cells — the tab says so: "A RAM holds data only while simulating: Step
  (F10) powers on at t = 0, paused, to edit or load it before running" (Q2).
- **Address**: levels of `addressPins` through `sim.pinLevel` → number or text with `X` bits.
- **Edits** (one byte or a block):
  - ROM, stopped or running → the `image` prop (`setPartProp`), one undo step per byte,
    consecutive bytes of one memory coalesced into one (`Edit U3 contents`); a running ROM
    restarts from the new image with its outputs carried (ADR-0010, ADR-0017).
  - RAM, simulating → `poke` at the current instant (not undoable: simulation state, like a
    switch flipped by the Interact tool; lost at Reset as on real hardware).
- Pure and headless-tested (fake clock), like the host.

### Memory tab (ui)

A fourth bottom-dock tab, **Memory** (the architecture's "memory · analyzer" slot; ADR-0008):

```text
 MEMORY  U3 · AT28C16 ▾ │ Address 0x00A │ ☑ Follow │ Go to [    ] │ Load… Save… Erase
 0000  7E 30 6D 79 33 5B 5F 70  7F 7B 77 1F 4E 3D 4F 47  ~0my3[_p.{w.N=OG
 0010  FF FF FF FF FF FF FF FF  FF FF FF FF FF FF FF FF  ................
```

- **Picker** of the circuit's memories (`U3 · AT28C16 · 2K × 8 EEPROM`); selecting a memory part
  on the canvas shows it (as the Part tab follows the pick); the context menu and Edit ▸ Inspect
  Memory open the tab on it.
- **Hex view**, virtualized (only the visible rows are rendered: 2048 rows for a 62256): 8, 16
  or 32 bytes per row by the dock's width, an ASCII column (`.` for non-printable), unknown
  bits as `X` nibbles in the `X` color (`XX`, `3X`); erased bytes of a ROM dimmed.
- **Highlighting** while simulating: reads in the level-1 green, writes in the warning orange,
  fading; the cell at the current address outlined. **Follow** (on by default) scrolls to keep
  it visible; scrolling by hand turns Follow off.
- **Editing**: click a byte (or arrows to move), type two hex digits to commit and move on, or
  Enter; Escape cancels; Mod+G / the Go to box jumps to an address. A stopped RAM refuses with
  the reason in the status hint.
- Settings: the tab (`bottomTab: 'memory'`) and Follow; the picked memory is UI state.

### Image files and the programmer (core, ui)

- **Formats** (`core`, pure; R15's bench setup and R19's flashing use them headless):
  - **Binary** (`.bin`, `.rom`): the bytes from address 0 (or an offset).
  - **Intel HEX** (`.hex`, `.ihx`): records 00 (data), 01 (end), 02 (extended segment address),
    04 (extended linear address), 03/05 (start address: read and ignored); checksums checked;
    a bad file is reported with its line ("line 12: checksum 0x3C, expected 0x4A"). Written with
    16 data bytes per record, 04 records only above 64 KB, uppercase, `\n` line ends.
  - Detected by extension, else by content (a first line starting with `:` and hex).
- **Load Image…** — the programmer (Q3): the file's format, the address range it covers
  (`0x8000–0xFFFF`, 32768 bytes), its byte count and checksum (sum of bytes, 16 bits, as
  programmer software shows), the target memory and its size, **Offset** (where the file's
  first address lands; a hex file lying wholly above the memory's size suggests the offset that
  brings it to 0, as a BE6502 ROM assembled for 0x8000 into an AT28C256), **Erase the rest**
  (fill the bytes the file doesn't cover with 0xFF; on by default — a programmer erases before
  it writes); what doesn't fit refuses the load with the reason. Program writes a ROM's image
  (one undo step, `Load image into U3`) or pokes a simulated RAM.
- **Save Image…**: `.bin` (the whole memory) or Intel HEX (16-byte records, leaving out records
  that are all 0xFF); a RAM's unknown bits are written as 0, and the dialog says how many bytes
  had them.
- **Erase** (ROM): every byte 0xFF, one undo step.
- `FileAccess` (`ui/files.ts`) gets binary open and save (`openBytes(types)`,
  `saveBytes(bytes, name, types)`), native and fallback, with its own picker id so the images
  folder is remembered apart from the circuits folder.

### RAMs stay volatile (Q2)

No power-on image: RAMs power on `X`, zeros or random as since R12a, and their contents live
only in a simulation. A designer prepares a RAM by hand (Step to power on paused, then edit or
load) or, from R15 on, with a bench's setup that loads memories before t = 0 — which is how
R16b's SAP-1 gets its demo program. ADR-0017's rule stands: what the circuit writes stays in the
simulator.

### ADR-0018

"Memory inspector: live views with access stamps, edits through the document or pokes, one
resolver": per-cell stamps vs last-access-only vs an access log; ROM edits as document edits vs
a separate buffer; RAMs volatile (loaded by bench setups) vs power-on images in the document;
the programmer as the Load dialog vs a separate window; the resolver in `circuit` vs in the
editor host.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `core` + `library`: `readAt`/`writtenAt` on `MemoryView`, `addressPins` on `MemoryDef`
  (registry validation); the read path, write path and `poke` stamp; tests (each access kind,
  merged addresses stamp nothing, carry-over keeps stamps); mutation-checked; benchmark.
- [x] 2. `core`: image file codecs — binary and Intel HEX parse/format, file summary (range,
  bytes, checksum), placing into a memory with offset and erase; tests (record types, checksum
  and syntax errors with lines, > 64 KB addresses, round trip as a property test).
- [x] 3. `circuit`: the resolver — parts, pins, nets, buses, memories, error messages, `/`
  reserved; tests on circuit test parts and a scenario with real memories.
- [x] 4. `editor`: `MemoryInspector` — memories, cells (live, stopped ROM, stopped RAM),
  address, highlighting frames, edits (ROM image with coalescing, RAM poke), renames; headless
  tests with the fake clock.
- [x] 5. `ui`: the Memory tab — picker, virtualized hex view, ASCII, `X`, highlighting, follow,
  editing and Go to, selection-following, settings; commands (Edit ▸ Inspect Memory, context
  menu, View); unit tests for the pure pieces (rows per width, cell text, key handling).
- [ ] 6. `ui`: binary `FileAccess`; Load Image (programmer) and Save Image dialogs, Erase; tests
  of the dialog models.
- [ ] 7. e2e: EEPROM 7-Segment Decoder — the image in the Memory tab, a byte edited changes the
  digit while running, undo; a `.hex` and a `.bin` loaded; RAM by Hand — a write by the
  switches highlighted, a poke read back on the LEDs, Save Image's file checked; looked at in
  both themes, stopped and running.
- [ ] 8. Docs: editor.md (Memory tab, dialogs), components.md (stamps, address pins),
  simulation.md (inspection), circuit.md (resolver), architecture.md, glossary, READMEs,
  ADR-0018; roadmap (R12b done, R13 next; backlog: image scripts); lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] The Memory tab lists every memory of the circuit; selecting one on the canvas shows it; a
  62256 (2048 rows) scrolls with only the visible rows rendered.
- [ ] While running, every cell read or written since the last frame is highlighted (a RAM read
  at real time from a fast clock stays lit), the cell at the address on the chip's pins is
  outlined and followed; while paused, a step shows what it touched.
- [ ] Editing a ROM byte is one undoable document edit (consecutive bytes coalesced) and a
  running ROM's outputs follow it; editing a simulated RAM pokes it without changing the
  document; a stopped RAM is read-only and says why.
- [ ] `.bin` and Intel HEX load and save round-trip (property test); bad Intel HEX is reported
  with its line; a hex file assembled for 0x8000 loads into an AT28C256 with the suggested
  offset; the dialog shows range, size and checksum before writing.
- [ ] The resolver resolves parts, pins, nets and buses of a compiled circuit and explains
  references that don't resolve; the inspector finds memories through it.
- [ ] Memory benchmark within 5 % of R12a's (≈ 7.5M events/s with stamps).
- [ ] The roadmap has the tools before the SAP-1 (phase 3 → M2 "Tools", phase 4 → M3 with R16a
  and R16b), R15 lists the memory setup; vision.md's milestones agree.

## Open questions

- [x] Q1. R12b is the inspector, two file formats, the programmer, the resolver **and** three
  SAP-1 modules: split? — _proposed:_ the modules to R12c `example/sap-1-modules` — **answer:**
  take the SAP-1 out as a whole: the tools needed to design and develop digital devices come
  first. Roadmap: phase 3 "Design tools" (R12b, R13, R14, R11, R15) → M2 "Tools"; phase 4
  "SAP-1" with R16a `example/sap-1-modules` (every module as a subcircuit with its test bench,
  the clock, A register and program counter redone so) and R16b `example/sap-1` (the computer)
  → M3 "SAP-1 runs"; CPU systems → M4, "My computer" M5 (2026-11-07).
- [x] Q2. RAM contents outside a simulation — _proposed:_ a power-on image in the document —
  **answer:** realistic modes only (`X`, zeros, random; lost at Reset); a test bench's setup,
  run like an init script before the simulation starts, prepares RAMs (R15) (2026-11-07).
- [x] Q3. The "programmer" — _proposed:_ the inspector's Load Image dialog (file summary,
  offset, erase the rest) plus Save and Erase — **answer:** the Load Image dialog (2026-11-07).

## Progress log

- 2026-11-07 — plan drafted; `main` green (1918 tests). Q1–Q3 answered: the SAP-1 leaves R12b
  and the roadmap puts the design tools first (M2 "Tools"; R16a modules, R16b the computer →
  M3); RAMs stay volatile, R15's setup loads them; the programmer is the Load Image dialog.
- 2026-11-07 — plan approved; branch started. Roadmap reordered: phase 3 "Design tools" (R12b in
  progress, R13, R14, R11, R15 with the memory setup) → M2 "Tools"; phase 4 "SAP-1" (R16a
  modules, R16b the computer) → M3; CPU systems phase 5; vision.md's milestones to match.
- 2026-11-07 — task 1: `MemoryView.readAt`/`writtenAt` (`createAccessStamps`), stamped by the
  read path (one known address), every write-path change of a cell (store, maybe-write merge,
  violation `X`, data hold) and `poke`; `MemoryDef.addressPins` (validated: `2 ** n` words,
  input pins). Mutation-checked (8 mutations). Benchmark 7.82M events/s vs 7.92M on `main`
  (−1.2 %). 1930 tests.
- 2026-11-07 — task 2: `core/image-files.ts` — format detection, binary and Intel HEX reading
  (records 00–05, checksums, segment wrap, overlaps, a missing end record: errors with lines),
  `summarizeImage`, `suggestedLoadAddress` (the lowest address modulo the size), `placeImage`
  (`at`, `eraseRest`) giving writes for a ROM image or pokes, `memoryBytes` (unknown bits 0),
  `writeIntelHex` (`base`, `omitErased`, 04 records above 64 KB); round trip as a property test;
  mutation-checked (one equivalent mutation led to a simpler `suggestedLoadAddress`).
- 2026-11-07 — task 3: `circuit/resolve.ts` — `Resolver` over a `CompileResult`: parts, pins
  (with their net), nets by any name or id, buses (members bit 0 first, `undefined` where no
  net has the name), `memories()` in designator order (`compareDesignators`: `U2` before
  `U10`); reasons for what doesn't resolve; `/` reserved for R11. Test part `test/rom`; a
  scenario on RAM by Hand checks the net ids against the simulator. Mutation-checked.
- 2026-11-07 — task 4: `editor/memory-inspector.ts` (`editor.memory`) — `memories()` from the
  resolver per scene (`U1 · AT28C16 · 2K × 8`), `cells()` (live view, a stopped ROM's image,
  or the stopped-RAM reason), `address()` from `addressPins`, `intensity(stamp)` from an
  `AccessClock` (simulated time vs wall time sampled on the host's `revision`/`status`; fades
  over 500 ms while running, frozen while paused; cleared when time goes back), `write`
  (ROM: image prop, coalesced `Edit U1 contents`; RAM: poke), `load`, `erase`, `contents`.
  `setPartProp` takes a label and a coalesce key. Mutation-checked (two survivors: one line
  removed as equivalent, a test added for sampling while paused).
- 2026-11-07 — task 5: the Memory tab (`MemoryPanel.tsx`, pure pieces in `memory-view.ts`):
  picker, live address, Follow (a setting, `memoryFollow`; scrolling by hand or Go to turns it
  off), Go to (hex, `0x`/`$`/`h`), a virtualized hex view (8/16/32 cells a row by the dock's
  width, ASCII column, `X` nibbles, erased ROM bytes dimmed, reads green and writes orange
  fading, the address outlined), keyboard editing (`hexKey`: digits, Enter, Escape, arrows,
  Home/End, Page Up/Down; handled keys don't reach shortcuts); problems in a notice line under
  the toolbar (not the status hint). `memoryPick` follows the canvas selection and renames;
  Edit ▸ Inspect Memory and the part context menu. Looked at in both themes (EEPROM decoder
  running with the read lit; RAM by Hand stopped and running).

## Handoff

- **State:** tasks 1–5 done (stamps, image codecs, resolver, `MemoryInspector`, Memory tab).
- **Next step:** task 6 (binary `FileAccess`, Load Image / Save Image dialogs, Erase).
- **Watch out:** —
- **Verify with:** `pnpm check`.

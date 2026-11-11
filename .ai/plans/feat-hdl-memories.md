# Plan: feat/hdl-memories

| Field      | Value                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Branch     | `feat/hdl-memories`                                                                                          |
| Roadmap    | HDL-6 — Memories in modules, track [Programmable logic](../../docs/roadmap/programmable-logic.md)            |
| Status     | in-progress                                                                                                  |
| Depends on | HDL-1, HDL-8, HDL-9 (IR, converter, interpreter), HDL-4 (references inside modules), R12b (memory inspector) |
| Created    | 2026-11-11                                                                                                   |

## Goal

Verilog arrays run as memories. A register file, a FIFO's buffer, a block RAM, a ROM filled by
`initial` or `$readmemh` — today refused ("a memory — not supported yet (HDL-6)") — run inside a
module as word-level memories, not as thousands of flip-flops, with the same 4-state rules,
races and diagnostics as the rest of the interpreter. Their cells show in the Memory tab and are
references the tools take (`A1/buf_[0F]`, `b.memory('A1/rom', …)`, `expect`), as a chip's do.
This is what HDL-7 (PicoRV32 with its memory) and HDL-10's benchmark stand on.

## Scope

**In scope**

- The Yosys command collects each memory into one cell (`memory_collect`); the converter turns
  `$mem_v2` into the IR's memories and ports; what it can't run is refused with the reason.
- The IR: memories (name, width, size, first address, power-up contents) and their read and
  write ports as cells; document schema v9.
- The interpreter: asynchronous read ports in topological order, write ports on clock edges
  (pin clocks and clocks made by logic), `X` rules, races, collisions, the floating rule;
  power-up contents.
- Differential tests against Yosys's `sim` for memory designs.
- The core memory view generalized for module memories (several per part, wider words, no address
  pins, a first address) — ADR-0036.
- References to a module's memories and their cells (resolver), benches (`b.memory`,
  `b.loadIntelHex`, `expect` on cells), the Memory tab (picker, cells, edits, Load/Save), the
  module view's Memories list.
- Proof (Q4: tests only): fixtures, differential designs, a scenario test, e2e (a module made from
  a fixture's JSON in the browser), a benchmark.

**Out of scope** (and where it goes instead)

- Synchronous read ports in the IR (`memory_dff`'s merged read registers, with transparency and
  collision masks): the command reads asynchronously and leaves the read register a flip-flop
  (`memory_collect` without `memory_dff`); a JSON with them is refused with the command. A track
  idea if a flow needs them.
- Memory contents carried over a Compile → HDL-3.
- Faster reads and writes (word-parallel, compiled) → HDL-10; this branch measures.
- Library parts written in Verilog (a 6116 as a module, its `specify` timing) → HDL-2. Asynchronous
  writes (`always @*` into an array) already run: Yosys turns such an array into latches.
- FPGA memory primitives (`SB_RAM40_4K`) → the track's "FPGA primitives" idea.
- Per-instance images or in-app editing of a module's power-up contents (Q1: as an FPGA's block
  RAM, the contents come from Yosys) → a track idea.
- A new example (Q4: tests only); a UART with a message ROM and a FIFO stays a possible example.
- Big-endian packing of files into wide words (Q3: little-endian only, as RISC-V tools).

## Context

- [docs/roadmap/programmable-logic.md](../../docs/roadmap/programmable-logic.md) — HDL-6, HDL-7
  (needs 32-bit memories), HDL-10, HDL-3.
- [ADR-0030](../../docs/adr/0030-hdl-modules.md) ("memories stay memory cells"),
  [ADR-0035](../../docs/adr/0035-inner-signals.md) (names inside modules; "HDL-6 adds memories
  through the part's `memory` view"), [ADR-0017](../../docs/adr/0017-memories.md),
  [ADR-0018](../../docs/adr/0018-memory-inspector.md) (stamps, edits, one resolver).
- [docs/components.md](../../docs/components.md#verilog-modules-hdl) and `#memories-mem`,
  [docs/circuit.md](../../docs/circuit.md#resolver), [docs/editor.md](../../docs/editor.md)
  (Memory tab, module view).
- `src/core/hdl-module.ts` (IR, shape check), `src/core/memory.ts` (`MemoryDef`, `MemoryView`,
  `PokeAction`), `src/library/hdl/{from-yosys,command,analyze,cells,module-part}.ts`,
  `src/library/mem/{memory,write}.ts` (the chips' `X` rules: `forEachCandidate`,
  `MAX_MERGED_BITS`), `src/circuit/resolve.ts`, `src/circuit/bench/bench.ts`,
  `src/editor/memory-inspector.ts`, `src/ui/{MemoryPanel,ImageDialogs,ModuleView}.tsx`,
  `scripts/{hdl-fixtures,hdl-examples,hdl-differential}.ts`.
- `$(yosys-config --datdir)/simlib.v`, `module \$mem_v2` — the cell's meaning.

## Design

### What Yosys gives (tried on Yosys 0.70, 2026-11-11)

Ten small designs (register file, FIFO, block RAM with `$readmemh`, character ROM, byte enables,
two write ports, dual clock, `m[16:25]`, a reset loop over the array, mixed widths):

- After `proc`, a memory is `$memrd_v2`/`$memwr_v2`/`$meminit_v2` cells; the JSON doesn't carry
  the memory's size. `memory_collect` makes one `$mem_v2` per memory with everything: `SIZE`,
  `OFFSET`, `WIDTH`, `ABITS`, `INIT` (every bit, `x` where none), the read ports (`RD_ADDR`,
  `RD_DATA`; `RD_CLK_ENABLE` 0: asynchronous) and the write ports (`WR_CLK`, `WR_EN` per bit,
  `WR_ADDR`, `WR_DATA`, `WR_CLK_POLARITY`, `WR_PRIORITY_MASK`).
- Without `memory_dff`, every read is asynchronous and a registered read (`q <= m[a]`) stays a
  `$dff` after it: the interpreter's two-phase edges then give read-before-write as Verilog says.
- `$readmemh` is read by Yosys, relative to the source's folder: the contents arrive in `INIT`. The
  document never needs the `.hex` file (the roadmap's "a file in the document" is moot).
- `always @*` writes into an array: Yosys makes latches of it (no memory). A reset loop over the
  array makes one write port per word (wide ports only with `memory_share`, which we don't run).
- An integer index gives a 32-bit address (`ABITS` 32); `m[16:25]` has `OFFSET` 16, `SIZE` 10.
- `memory_collect` changes nothing in a module without memories: every example, fixture and
  differential design gives the same JSON (checked).

### Command

`… opt -keepdc; memory_collect; check; write_json …`. `proc -norom` stays: a `case` table stays
logic, as a GAL gets it, and HDL-1's examples don't change. A JSON made without `-norom` now runs
(its ROM is a memory), so that error goes. Refused with "make the JSON with the command": the
`$memrd_v2`/`$memwr_v2`/`$meminit_v2` of a JSON without `memory_collect`, a `$mem_v2` with
synchronous read ports (`memory_dff`, `memory -nomap`), the old `$mem`. Wide ports (from
`memory_share` elsewhere) are split by the converter into one port per word (the low address bits
constant).

### IR (schema v9)

- `HdlModule.memories: HdlMemory[]` — `name` (`buf_`, a flattened `u_fifo.mem`), `width`,
  `size`, `offset` (the first Verilog address), `init` (power-up contents: sparse hex runs of
  words, `x` digits unknown; absent: all `X`), `src`.
- Two cells: `$memrd` (`ADDR` → `DATA`, param `MEMORY`: the memory's index) and `$memwr` (`CLK`,
  `EN` per bit, `ADDR`, `DATA`; `CLK_POLARITY`, `MEMORY`, `PRIORITY`: the bits of the memory's
  earlier write ports it overrides). The shape check knows them (widths against the memory).
- v8 → v9: modules gain `memories: []`.

### Interpreter

- State per memory: packed words (`Uint8Array`/`Uint16Array`/`Uint32Array` by width; 32-bit
  limbs beyond 32) for values and unknown bits, plus the access stamps of ADR-0018. Plain typed
  arrays: snapshots, rewind and replicas as for any part. Power-up from `init`.
- `$memrd`: a combinational step after its address: the word at a known address in range; `X` out
  of range; unknown address bits merge the candidates (bits they agree on stay known) up to 8 such
  bits, all `X` beyond — the chips' rule (`MAX_MERGED_BITS`).
- `$memwr`: edge-triggered like a flip-flop, in the same two phases (sample `EN`/`ADDR`/`DATA`
  before the edge, store with the other loads), with pin clocks, clocks made by logic (rounds),
  uncertain edges (each bit it could write `X` where it differs), unknown `EN` bits likewise,
  unknown address bits (every candidate cell, as the chips' writes), out of range ignored
  (simlib), and races (`setup-violation`, `race-violation`) as flip-flops. Two ports writing one
  bit at one edge: the one with priority wins; without priority it is `X` where they differ — a
  dual-port RAM's collision (Yosys's `sim` takes the later port: differs on purpose, unit-tested).
- Analysis: a read port's data bits are driven by it; its cone is its address's (contents are
  state, like a flip-flop's `Q`); write ports join the flip-flops for clocks, data cones (races)
  and the floating rule (a write storing `X` from a floating pin reports it).
- Read stamps only when a port's word changes (address or contents), never on a mere re-run of the
  steps — the R17a lesson ("re-drive must not have side effects").

### The memory view (ADR-0036)

`MemoryDef` today is one memory per part, 1–8 bits, `2^pins` words read from address pins. A
module has several, any width, any size, a first address, no pins. Proposed: a definition may
list `memories` (each a `MemoryDef` with a `name`), `MemoryDef` gains `offset` and widths up to 32
(`data`/`unknown` typed by width), `addressPins` becomes optional (the Memory tab shows no "now"
address without them); `PokeAction` names the memory. Chips keep `memory` (one); a module gives
`memories`. Wider than 32 bits: runs, listed, not shown ("too wide to show").

### References, benches, UI

- Names as ADR-0035's: `A1/rom` (a memory of instance `A1`), `S1/A1/rom`, `rom` in the module's
  own benches, `A1/u_fifo.mem` flattened; cells as a chip's: `A1/rom[1F]`, `A1/rom[10..1F]`
  (addresses per Q2). Tried after pins, nets, buses, parts and signals, so nothing changes meaning.
- Benches: `b.memory`, `b.loadIntelHex`, `expect`/`get`/rows on cells work on module memories;
  wider words take numbers up to `2^width` (hex text: one word per group of digits, per Q3).
- Memory tab: module memories in the picker (`A1/rom  2K × 8`), cells live while running; while
  stopped their power-up contents, read-only (Q1). Edits and Load are pokes while running.
- Wide memories (Q3): shown as words by default (`ceil(width/4)` hex digits, the Verilog index as
  the address), with a Words/Bytes switch per memory: Bytes shows each word as its bytes
  little-endian at byte addresses, as a CPU sees it (PicoRV32's RAM). Files (`.bin`, Intel HEX)
  always carry byte addresses and are packed into words little-endian (word = byte address ÷ bytes
  per word), whichever view is on; Save writes them back the same way. Benches take words (numbers
  up to `2^width`).
- Module view: a Memories section beside Signals (name, `size × width`, source line; Open in the
  Memory tab for the open instance).

## Tasks

Small, ordered, each committable with its tests (`pnpm check` green).

- [x] 1. Core IR: `HdlMemory`, `memories`, `$memrd`/`$memwr` specs and shape checks, `init`
  text (parse/format); schema v9 migration.
- [x] 2. Converter + command: `memory_collect`; `$mem_v2` → memories and ports (wide ports split,
  priorities, `INIT`); refusals; the case-ROM error gone; fixtures (`pnpm hdl:fixtures`):
  register file, FIFO, ROM with `$readmemh`, byte enables, two write ports, offset, dual clock,
  reset loop, a JSON from `memory -nomap`.
- [x] 3. Analysis: drivers, order and cones of read ports; write ports with the flip-flops
  (clocks, data cones, internal clocks, floating rule).
- [x] 4. Interpreter: memory state and power-up, `$memrd`, `$memwr` at pin and internal edges,
  `X` rules, races, collisions, stamps; unit tests per rule.
- [x] 5. Differential: memory designs in `pnpm hdl:differential` against Yosys's `sim`; what
  differs on purpose (collisions) unit-tested.
- [x] 6. Core view (ADR-0036): `memories`, `MemoryDef` offset/width/optional pins, `PokeAction`
  with the memory; the module part's view and pokes; chips unchanged.
- [x] 7. Resolver: module memories and cells by name (Q2), listed in `memories()`; errors that
  say what exists.
- [x] 8. Benches: module memories in `b.memory`, `b.loadIntelHex`, `expect`/`get`/rows; wide
  words; `pnpm test:circuits`.
- [x] 9. Memory tab: module memories in the picker, stopped view (Q1), pokes; wide words with the
  Words/Bytes switch, Load/Save packed little-endian (Q3).
- [ ] 10. Module view: the Memories section.
- [ ] 11. Proof (Q4, tests only): `tests/scenarios/verilog-memories.test.ts` (a FIFO, a register
  file and a `$readmemh` ROM with chips and benches around them), `tests/e2e/hdl.spec.ts` (a
  module from a fixture: Memory tab, edits, a bench), a memory benchmark in
  `tests/bench/hdl.bench.ts`.
- [ ] 12. Docs: ADR-0036; ADR-0030 (command, memories), ADR-0018 (module memories);
  components.md, circuit.md, editor.md; the track file (HDL-6 built, `$readmemh` wording);
  lessons.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green; `pnpm e2e` and `pnpm test:circuits` pass (the
  examples unchanged).
- [ ] The register file, FIFO, block RAM, `$readmemh` ROM, byte-enable, two-port, offset and
  dual-clock fixtures convert and run; the refused forms say why and how to fix the command.
- [ ] `pnpm hdl:differential` covers memory designs; `differential.test.ts` checks their outputs
  against Yosys's `sim`; mutation-checked (a broken read or write fails it).
- [ ] `X` rules hold in unit tests: unknown address (merge ≤ 8 bits), out of range, unknown
  enable, uncertain clock edge, a race at the clock edge, a collision of two write ports.
- [ ] A module's memory is in the Memory tab while running, its cells lit as they are read and
  written; an edit there changes what the module reads; stopped, it shows the power-up
  contents read-only; Reset brings them back (Q1).
- [ ] `A1/rom[1F]` and `A1/m[10..19]` (hex, Verilog addresses: Q2) resolve in watches and benches;
  `b.memory` loads a module memory in a bench's setup, `expect` checks a cell — headless and in
  the app.
- [ ] A 32-bit memory shows as words and, switched, as little-endian bytes; a `.bin` and an Intel
  HEX file load into it packed little-endian; Save gives the same file back (Q3).
- [ ] The scenario test (FIFO, register file, `$readmemh` ROM) passes headless; the e2e test in the
  browser (Q4).
- [ ] HDL-1's benchmark unchanged; a memory module's speed measured and written down.

## Open questions

- [x] Q1. Where do a module memory's contents come from, and what can change them? —
  _proposed:_ as an FPGA's block RAM: the power-up contents are Yosys's (`initial`,
  `$readmemh` read on the user's computer), kept in the IR; while simulating they change by
  the circuit, pokes from the Memory tab and benches' setups; Reset goes back to them; while
  stopped the Memory tab shows them read-only. New contents: edit the `.hex`, run Yosys,
  Compile. — **answer:** as proposed (2026-11-11).
- [x] Q2. How are a module memory's cells addressed in references? — _proposed:_ hex, as every
  memory tool (`U5[1F]`), at Verilog's addresses (`m[16:25]` is `A1/m[10..19]`). —
  **answer:** as proposed.
- [x] Q3. Memories wider than 8 bits (PicoRV32's 32-bit RAM) in the Memory tab and file loads? —
  _proposed:_ words as words (8 hex digits, the Verilog index as the address); `.bin` and
  Intel HEX packed into words little-endian, as RISC-V tools write them. — **answer:** the
  user asked whether it is only the viewer (no: file loads and benches too) and whether to let
  them choose — "do what works best in practice": words by default with a Words/Bytes switch
  per memory (bytes little-endian at byte addresses, as the CPU sees it); files always packed
  little-endian by byte address; benches take words.
- [x] Q4. Proof? — _proposed:_ a new example built on the UART: a message ROM (`$readmemh`) the
  transmitter sends on SEND, the receiver pushes bytes into a 16-byte FIFO, POP shows the next
  byte on the LED bar, the Memory tab shows the ROM and the FIFO; benches check it. Register
  file, block RAM and the rest in fixtures, differential and scenario tests. — **answer:**
  tests only: fixtures, differential tests, a scenario test, e2e; no example.

## Progress log

- 2026-11-11 — plan drafted; Yosys tried on ten memory designs (see Design). Q1–Q4 answered.
- 2026-11-11 — plan approved; started.
- 2026-11-11 — task 1: IR (`HdlMemory`, `$memrd`, `$memwr`, `init` as hex runs in
  `core/hdl-memory.ts`), schema v9; examples and differential data regenerated. Task 2: the
  command gains `memory_collect`; `$mem_v2` converted (wide ports need nothing: their words come
  with constant low address bits); 13 memory fixtures. Until task 4, `hdlPart` refuses modules
  with memories ("not supported yet"), so the converter's IR is testable.
- 2026-11-11 — task 3: analysis (write ports apart, cones, a 256K-word / 8 Mbit limit). Task 4:
  `memory-cells.ts` (read steps, write ports in two phases, collisions, stamps on change only);
  `CellStep` takes the instance's memories as a third argument. Found while testing: `proc` gives
  a write's address and data an `x` default (`we ? rd : x`), so an unknown `we` made the address
  unknown and the whole memory `X`; the converter now takes `ADDR`/`DATA` through such
  `$procmux$` cells (only proc's, one input all `x`) — an unknown enable makes `X` only the word
  it addresses. HDL-1's benchmark unchanged (main and branch alternately, two rounds).
- 2026-11-11 — task 5: five memory designs in `pnpm hdl:differential` (register file, FIFO, ROMs
  from `$readmemh` / `initial` / `m[16:25]`, byte lanes, two clocks and a divided one); 23
  designs, ≈ 128 k output bits, all agree. Yosys's `sim` loops on two ports writing one bit at
  one edge (lessons): the byte-lane design writes different halves. Mutation-checked (wrong word,
  enable ignored, one enable for all lanes, first address ignored, `init` ignored: each fails).
- 2026-11-11 — task 6: `MemoryDef` gains `name`, `offset`, `powerUp`, widths to 32
  (`MemoryWords` = `Uint8Array | Uint32Array`), optional `addressPins`; `memories` on a
  definition (`memoriesOf`), `PokeAction.memory`, `pokeOf`; `memoryBytes` packs wider words
  little-endian. The module part shows memories ≤ 32 bits (views over its state, `powerUp` from
  the IR) and takes pokes (settles and drives at once). ADR-0036 written.
- 2026-11-11 — task 7: the resolver names a module's memories like its signals (`A1/rom`, a
  `memory` target; `A1/rom[1F]`, `cells` with `name` and word indices from the memory's
  `offset`); `parseAddress` takes the first address; `memories()` lists them with the holding
  part apart (`MemoryPart.part`). The inspector and the debugger's watches now reach the
  simulator through that part (watches keep the memory's reference and addresses).
- 2026-11-11 — task 8: benches take a module's memory (`b.memory('A1/regs', …)`, addresses from
  its first one, hex words for wider memories), `b.loadIntelHex` packs bytes into wider words
  little-endian (`packWords` in core), `expect`/`get` on its cells; a whole memory as an output
  says to check its cells. `tests/scenarios/verilog-memories.test.ts` (own benches, through an
  instance, a 32-bit RAM fixture `mem_word32`).
- 2026-11-11 — task 9: the inspector lists module memories (label, `offset`, `bytes`), shows a
  stopped one's power-up contents read-only (`power-up` cells, `STOPPED_MODULE_MEMORY` for
  edits), pokes words (`write`), a byte of a wider word (`writeByte`), loads files packed
  little-endian; the Memory tab shows wider memories as words or, switched, bytes (addresses
  from the first one, no ASCII column for words); selecting a placed module picks its first
  memory; Insert Image lists a module's own memories and writes wide binaries as Intel HEX. Not
  yet looked at in the browser (with task 11's e2e).

## Handoff

- **State:** tasks 1–9 done and committed (IR + schema v9, converter + command, analysis,
  interpreter in `memory-cells.ts`, differential). Modules with memories run headless; nothing
  shows them yet (no view, references, benches or UI).
- **Next step:** task 10 — the module view's Memories section (beside Signals); then task 11:
  e2e (look at the Memory tab in the browser), the benchmark.
- **Watch out:** `$readmemh` paths are relative to the `.v`; read stamps change only on a new
  word or a write since (`stampReads`); `pnpm check` and `pnpm e2e` one after the other; Yosys's
  `sim` loops on colliding write ports (lessons).
- **Verify with:** `pnpm check`; `pnpm hdl:fixtures` / `pnpm hdl:differential` need Yosys.

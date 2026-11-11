# 0036. Memories in modules: Yosys collects them, the interpreter runs words, the tools see them as a chip's

- **Status:** accepted
- **Date:** 2026-11-11
- **Roadmap item:** HDL-6 (feat/hdl-memories)

## Context

Verilog arrays — register files, FIFOs, block RAMs, ROMs filled by `initial` or `$readmemh` —
were refused ([ADR-0030](0030-hdl-modules.md): "memories stay memory cells", not yet run). A soft
core (HDL-7) needs a register file and kilobytes of memory, and HDL-10 is measured on it. Forces:

- After `proc`, Yosys's JSON has a memory's reads, writes and initial words as separate cells
  and not its size; `memory_collect` makes one `$mem_v2` cell with everything. `memory_dff`
  (and `memory -nomap`) merge a registered read into the memory as a synchronous read port, with
  transparency and collision masks; `memory_map` turns a memory into flip-flops and decoders.
- Yosys reads `$readmemh` itself, relative to the `.v`: the contents arrive in `INIT`.
- `proc` gives a write's address and data an `x` default where the process doesn't write
  (`we ? rd : x`); `opt -keepdc` keeps it.
- The memory tools (ADR-0017, [ADR-0018](0018-memory-inspector.md)) know one memory per part, of
  1–8 bits, addressed by its pins; a module has several, of any width, any size, from any first
  address (`m[16:25]`), and no pins. Benches, watches and the Memory tab go through the resolver.
- The interpreter's hot path is HDL-1's baseline; snapshots copy component states page by page.

## Decision

- **The command collects, nothing more**: `… opt -keepdc; memory_collect; check; write_json`.
  Reads stay asynchronous and a registered read stays a flip-flop after one (no `memory_dff`), so
  read-before-write is the interpreter's two-phase edges, and no transparency logic is needed.
  `proc -norom` stays (a `case` table is logic, as a GAL gets it). Separate memory cells, a
  synchronous read port, a write without a clock, negative addresses are refused with the
  command; a wide port (from `memory_share` elsewhere) needs nothing — its words come as ports of
  their own with constant low address bits.
- **The IR**: `memories` (name, width, size, first address, power-up contents as sparse hex runs,
  `x` unknown), `$memrd` (address → data) and `$memwr` (clock, an enable per bit, address, data,
  and which earlier write ports it wins over); schema v9. The converter takes a write's address and
  data through `proc`'s don't-care multiplexers, so an unknown enable makes `X` only the word it
  addresses, as a board's RAM would.
- **The interpreter**: words in 32-bit limbs in the instance's state, power-up from the IR (as an
  FPGA's bitstream loads its block RAMs). A read port is a step in topological order — the word,
  `X` outside the memory, the words an unknown address could select merged up to 8 unknown bits
  (the chips' rule), all `X` beyond. A write port is edge-triggered in the flip-flops' two phases,
  with their pin and logic clocks, uncertain edges, races and floating rule; unknown enable or
  address bits make `X` the bits a write would change; two ports writing one bit at one edge make
  it `X` where they differ unless one wins (a dual-port RAM's collision). Up to 256K words and 8
  Mbit per memory.
- **The tools see a chip's memory** (Q1–Q3 of the plan): a part holds one `memory` (a chip,
  named by its designator) or several named `memories` (a module's, named like its signals:
  `A1/rom`); `MemoryDef` gains `name`, `offset`, `powerUp`, widths up to 32 bits (`Uint32Array`
  words), optional address pins; a poke names the memory. A module's memory is volatile from its
  power-up contents: running, its cells change by the circuit, pokes and benches, and Reset goes
  back to them; stopped, the Memory tab shows them read-only. Cells are addressed in hex at Verilog
  addresses (`A1/m[10..19]` for `m[16:25]`). A wider memory shows as words, or switched as
  little-endian bytes; files carry byte addresses and are packed little-endian.

## Consequences

- Modules hold register files, FIFOs, block RAMs and ROMs at the cost of their words (two limbs
  and two stamps per word, snapshots sharing unchanged pages); HDL-1's benchmark is unchanged.
- Yosys's `sim` is the reference again (`pnpm hdl:differential`), except where it differs on
  purpose: it takes the later port on a collision, and it loops when two ports write one bit at
  one edge — those are unit tests.
- New power-up contents mean a new `.hex` and a Compile, as on an FPGA; programs for a running
  memory go in a bench's setup (`b.memory`, `b.loadIntelHex`). Per-instance images and editing a
  module's contents in the app are left for later (a track idea).
- A `case` ROM from a command without `-norom` now runs instead of being refused.
- Memories wider than 32 bits run but aren't shown or poked.

## Alternatives considered

- **`memory -nomap` with synchronous read ports in the IR** — what an FPGA flow does, but every
  read port flavour (enable, set/reset, transparency, collision masks) would be the interpreter's;
  the flip-flops already run them.
- **`memory` with `memory_map`** — no IR change at all, but a 64 KB memory becomes half a million
  flip-flops and their decoders, and no memory to inspect.
- **Grouping `$memrd_v2`/`$memwr_v2`/`$meminit_v2` by `MEMID` in the converter** — the JSON lacks
  the memory's size and first address.
- **Keeping the `x` defaults** — "as written", but an unknown write enable then makes the whole
  memory `X`, which no board does; the defaults are `proc`'s, not the user's.
- **A memory's contents in the document, editable or per instance** (the `.hex` "in the
  document") — the IR would drift from the `.v` and `.hex` on the user's disk, and the next
  Compile would overwrite the edits silently (Q1).
- **Decimal addresses** (`A1/rom[31]`, as signal slices) — every other memory tool writes hex
  (Q2).
- **A byte view of wide memories only** (as the CPU sees them) — `A1/regs[1]` would be a byte,
  not register x1 (Q3: both, switched).

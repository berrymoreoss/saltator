# 0018. Memory inspector: access stamps, edits through the document or pokes, one resolver

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R12b (feat/memory-inspector); extended in HDL-6 by
  [ADR-0036](0036-memories-in-modules.md): a Verilog module's memories — several per part, words
  up to 32 bits (shown as words or little-endian bytes), a first address, power-up contents shown
  read-only while stopped, pokes by name

## Context

R12a gave memories a view of their cells (`MemoryDef`), a debug write (`poke`) and ROM images in
the document (ADR-0017). Designing a computer around them needs more: seeing what a memory holds
while the circuit runs, which cells the circuit is reading and writing, changing bytes, and
moving images in and out as the files assemblers and EEPROM programmers use. Several forces:

- At real time a SAP-1 reads its RAM a thousand times a second and the canvas draws 60 frames:
  most accesses happen between frames.
- A ROM's contents are part of the design (a prop, undoable, saved); a RAM's are simulation
  state that a Reset throws away.
- The inspector refers to parts by designator; probes (R13), watches and breakpoints (R14) and
  test benches (R15) will refer to parts, pins, nets and buses, and subcircuits (R11) will add
  paths into instances.
- The roadmap now puts the design tools before the SAP-1 (R12b, Q1): the tools have to stand on
  their own, on the example circuits.

## Decision

- **Access stamps**: a memory's view carries, per cell, the simulated time it was last read
  (`readAt`: the outputs drove its data for one known address) and written (`writtenAt`: the
  circuit's write stored it or made it `X`, or a poke). The part stamps them, one typed-array
  store per access. The inspector samples simulated against wall time each frame and lights a
  cell from the frame that first reached its stamp, fading over ½ s; the fade stops while paused,
  so a Step shows what it touched.
- **Edits follow ADR-0017's split**: a ROM's bytes are its `image` prop — an edit, a loaded file
  or Erase is a document edit (undoable; consecutive byte edits of one memory coalesce), and a
  running ROM restarts from the new image with its outputs carried (ADR-0010). A RAM's bytes
  exist only in a simulation: edits and loaded files are pokes at the current instant, not
  undoable, gone at Reset. A stopped RAM shows no cells and says so (Q2: RAMs stay as real ones
  are; a test bench's setup loads them before t = 0, R15).
- **Image files** (`.bin`, Intel HEX) are read, summarized, placed and written by pure `core`
  code; the **programmer** is the Memory tab's Load dialog (Q3): it shows what the file holds
  (range, bytes, 16-bit sum) and where it lands (the lowest address modulo the memory's size by
  default) before writing, erasing the rest first unless told not to.
- **One resolver** in `circuit` (`Resolver` over a `CompileResult`) turns references (`U5`,
  `U5.A0`, `CLK`, `D[0..7]`) into netlist ids, or says why it can't; the inspector finds its
  memories through it, and R11 adds instance paths there (`/` is reserved).

## Consequences

- Every access is visible at every speed, at the cost of 16 bytes of stamps per cell (512 KB for
  a 62256) and ≈ 1 % of the memory benchmark.
- Undo covers what the document holds and nothing else: a RAM poked by hand is like a switch
  flipped with the Interact tool.
- Programs for a RAM can't be stored with the circuit until R15's setups; until then the user
  powers on paused (Step) and loads the file.
- Probes, watches, breakpoints and test benches get references and their error messages for
  free, and hierarchy changes one module.
- The kernel and the netlist are unchanged; only memory parts and their view grew.

## Alternatives considered

- **The last read and written address only** — cheap, but at real time most accesses fall
  between frames and the highlight would flicker on one cell.
- **An access log the host drains every frame** — complete, but unbounded at Max speed, and it
  allocates in the kernel's hot path.
- **A separate edit buffer for ROMs, "programmed" on demand** — a second copy of the contents to
  keep in step with the document, and edits invisible to a running circuit until programmed.
- **RAM power-on images in the document** (`powerOn: image`) — convenient, but no real SRAM
  powers on holding a program; loading memories belongs to the bench's setup (R12b, Q2).
- **A separate programmer window** (chip, buffer, program, verify, read, as the TL866's software)
  — it would repeat the inspector, which already shows and holds the buffer (Q3).
- **The resolver in the editor's simulation host** — headless test benches (R15) need it
  without an editor; the compile result it works on lives in `circuit`.

# 0028. CPU model: a cycle-level core behind pin-level timing, unknown bits per bit, lost until reset

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** R17a (`feat/cpu-6502`)

## Context

R17a brings the first CPU, the WDC W65C02S — the 6502 of Ben Eater's computer (R20) and of most
hobby builds. A CPU is the biggest part yet: 212 instructions in 16 addressing modes, each a
sequence of bus cycles, around a pin-level bus the other chips see. Forces:

- **Test before fab**: the bugs of a 6502 build are on its bus — a decoder too slow for the
  access time, a latch strobed after the CPU let go of its data, RDY or BE left floating, a
  program running out of uninitialized RAM, a reset too short. The CPU has to show them the way
  the memories and the LCD show theirs (ADR-0014, ADR-0017, ADR-0022).
- **Cycle accuracy**: what each cycle puts on the bus — the dummy reads, the re-read of the last
  instruction byte when indexing crosses a page, the read-modify-write's two reads — matters to
  the circuit (a dummy read of an I/O register has side effects). The 2022 W65C02S data sheet
  gives the opcode matrix, Table 7-1's differences from the NMOS 6502 and the AC timing, but no
  per-cycle table.
- **4-state logic**: a CPU reading `X` from a floating bus or uninitialized RAM is the normal
  state of a broken design; the CPU must neither hide it nor turn every `X` into a halt.
- Plain-data state for snapshots and carry-over (ADR-0010, ADR-0021); no allocation per cycle.

## Decision

- **A pure cycle-level core** (`w65c02s-core.ts`) beside the **pin-level part** (`w65c02s.ts`),
  as the LCD keeps its controller beside its bus code: the core is the CPU between two PHI2
  falling edges — registers, the instruction register and cycle counter, latches, as plain
  numbers — with one call per cycle (`endCycle` with the byte read) that sets up the next
  cycle's bus (address, direction, data, SYNC, VPB, MLB). A `switch` over the addressing mode
  and cycle, no closures or generators. The opcode table (`w65c02s-opcodes.ts`) is data, shared
  with R17b's disassembler and R19's assembler.
- **The bus cycles are verified against SingleStepTests** 65x02 `wdc65c02` (MIT, 10,000 cases
  per opcode, every cycle's address, data and direction): all 2.54M cases pass (`pnpm
  test:65c02`, the files downloaded into a cache; a sample of 8 per opcode in `pnpm check`).
  **Where the data sheet speaks, it wins**: `5C` takes Table 7-1's 8 cycles (the cases say 4);
  where the cases follow no rule (the decimal-mode extra cycle of `ADC #`/`SBC #` reading `$7F`
  or `$0000`) the core reads at PC, like its other internal cycles. Reset and interrupt
  sequences follow the W65C816S data sheet's Table 5-7 (emulation mode).
- **The data sheet's limits on the pins** (the 5 V column, Table 6-3; limits only, as
  memories): PHI2 falling ends a cycle — read data and the control inputs are sampled with their
  set-up and hold times checked, the core moves at tDHR, and the outputs that change keep their
  level until tAH, are `X` until tADS, then show the new cycle; lines that keep their level
  don't move (Q5: a CMOS output that doesn't switch doesn't glitch, and windows on every line
  would double the events). A write drives `X` from PHI2 rising and the data from tMDS, held
  tDHW after it falls. BE releases the buses after tBVD. A violated requirement is reported and
  makes what was sampled `X` (ADR-0014); a violated clock loses the CPU.
- **Unknown bits per bit** (Q2): every register keeps a mask of unknown bits; logic is exact per
  bit (`AND #$0F` clears unknown high bits), sums are unknown from their lowest unknown bit up.
  Unknown data never stops the CPU by itself — it is stored as `X`, driven as `X`. When **what
  the CPU does next** depends on unknown bits — an opcode, a branch condition, a program
  counter, whether indexing crossed a page, D in `ADC`/`SBC`, whether an interrupt is taken, an
  unknown RDY or RESB — the CPU is **lost**: its outputs go `X` (the data bus `X` while PHI2 is
  high: it may be writing), a `cpu-lost` error names why and where, and only RESB brings it
  back. `cpu-lost` joins the errors in `diagnosticSeverity`.
- **Power-on unknown** (Q3): the W65C02S has no internal reset, so it starts lost (without a
  report) until RESB has been LOW for two cycles; then the seven-cycle reset sequence, D = 0 and
  I = 1 by hardware, the other registers as unknown as before. Examples and benches press
  RESET, as Ben Eater does after power-up.
- **RDY is bidirectional**: `WAI` drives it strong LOW, so an RDY tied straight to VCC is a
  short (`contention`), as the data sheet warns; a floating RDY is a lost CPU.
- **Inspection**: `CpuDef` on `ComponentDefinition.cpu` — registers (name, width, flag letters),
  the program counter's name, the bus pins, and a view of the values, unknown bits, mode and the
  instruction under way — for R17b's CPU tab and watches.

## Consequences

- A program's bus activity is the chip's, cycle by cycle, and a design is checked against the
  CPU's guaranteed timing: the classic 74HC574 output port strobed from PHI2 fails (the CPU
  holds write data only 10 ns, a decoder takes longer; Q8) — breadboards get away with it on bus
  capacitance, which a 4-state simulator doesn't model. Output ports wait for the VIA (R18).
- A CPU that reads garbage is shown as lost with a reason, instead of executing random
  instructions that would look plausible.
- Cost: ≈ 43 events per cycle in a ROM/RAM computer, 8M events/s — 18 % of real time at 1 MHz
  (M3 Pro). The BE6502 (R20) will run about 5× slower than the board; a faster kernel is the
  Platform track's (Worker, fast mode).
- The carry-over property on a running CPU found a bug elsewhere: the memories stamped a read on
  a recompile's re-drive (fixed in the read path).
- Not modeled: the lower-voltage columns of the data sheet, PLCC/QFP packages, PHI1O/PHI2O's
  delay (no 65C02 data sheet gives one: 10 ns, marked as an estimate), interrupt-polling quirks
  of taken branches.

## Alternatives considered

- **Instruction-level execution** replaying an instruction's bus cycles afterwards — can't read
  the bus a cycle at a time: what a cycle reads decides the next cycle's address.
- **A transistor-level netlist** (visual6502's) — none is public for the 65C02, and it would be
  far too slow for 1 MHz.
- **A third-party emulator core** — the pure layers take no packages (ADR-0005); 4-state
  registers and per-cycle bus fields would have to be added anyway.
- **Byte-level unknowns** — simpler, but masking a port's floating bits would still give `X`.
- **Halting on any `X`** — too noisy: harmless reads of uninitialized cells would stop programs.
- **Merging outcomes** (the LCD's way) — a CPU's outcomes multiply every cycle; masks bound it.
- **A power-on reset prop** — the chip has none; a reset supervisor part is a Parts idea.
- **`X` windows on every output line** — stricter than any real chip, twice the events.

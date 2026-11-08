# Plan: feat/cpu-6502

| Field      | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Branch     | `feat/cpu-6502`                                                                        |
| Roadmap    | R17a — W65C02S CPU, track [MOS 6502](../../docs/roadmap/mos6502.md)                    |
| Status     | in-progress                                                                            |
| Depends on | R09a (timing checks), R12a (limits-only timing, `X` windows), LIB-1 (merging outcomes) |
| Created    | 2026-11-08                                                                             |

## Goal

The **W65C02S** — the CMOS 6502 that Ben Eater's computer and most hobby builds use — as a part
that behaves like the chip on the breadboard: a 40-pin DIP driven by its `PHI2` clock, every one
of its opcodes with the bus cycles the real chip makes (address, data, `RWB`, `SYNC`, `VPB`,
`MLB` per cycle), the data sheet's bus timing (the address valid `tADS` after `PHI2` falls, write
data `tMDS` after it rises, read data sampled with `tDSR`/`tDHR`), its requirements checked, and
`RESB`, `IRQB`, `NMIB`, `RDY`, `BE`, `SOB` as the data sheet describes them. Unknown bits flow
through its registers; a CPU that fetches an unknown opcode is lost until reset, as a crashed
one is. Its registers are visible to tools through an inspection interface. This is the heart of
M4: R18's VIA, R19's assembler and R20's BE6502 are built around it.

## Scope

**In scope**

- `core`: `CpuDef` — a CPU's registers and a view of an instance's state (values, unknown bits,
  what it is doing) on `ComponentDefinition.cpu`, validated by the registry; the R17b tools and
  the scenario tests read it.
- `library`: a new family `cpu` with `cpu/w65c02s` (WDC W65C02S, DIP-40, the 5 V column):
  - the opcode table (Table 5-2: mnemonic, addressing mode, bytes, cycles), shared with R17b's
    disassembler and R19's assembler;
  - a **pure cycle-level core** (registers with unknown-bit masks, the instruction register and
    cycle counter, internal latches; one bus cycle at a time) — testable without a bench;
  - the **pin-level part** around it: `PHI2` edges, output windows, write data timing, read
    sampling, timing checks, `BE`, `RDY` (bidirectional: `WAI` pulls it low), `SOB`, `PHI1O`
    and `PHI2O`, interrupts, reset, power-on.
- Verification: SingleStepTests 65x02 `wdc65c02` (MIT): a committed sample in `pnpm check`, the
  full suite (≈ 2.5M cases) by `pnpm test:65c02` from a download cache (Q4); hand-written tests
  for pins, timing, control lines, reset, interrupts, `WAI`/`STP`, unknowns.
- Scenarios: a 65C02 with an AT28C256, a 62256 and a 74HC00 decoder running a hand-assembled
  program; the carry-over and rewind properties with the CPU; a benchmark.
- Examples (Q6): **6502 NOP Sled** and a **program from ROM** driving LEDs, with test benches.
- Docs: components.md (the `cpu` family), simulation.md, architecture.md, glossary, ADR,
  READMEs, lessons, the track file.

**Out of scope** (and where it goes instead)

- The CPU tab (registers, flags, current instruction), disassembly in the Memory tab, Step
  Instruction, CPU registers in watches and test benches → **R17b** (`feat/cpu-6502-tools`).
- Other 6502s (NMOS 6502 and its decimal mode and dummy writes, Rockwell R65C02, Synertek) and
  the W65C02S's lower-voltage columns (1.8–3.3 V) → MOS track ideas.
- PLCC-44 and QFP-44 packages → not planned (one part, the DIP a breadboard takes).
- A reset supervisor part (DS1813) holding `RESB` low after power-on → Parts track idea.
- Klaus Dormann's functional test (GPL-3.0) → not chosen (Q4).
- A kernel fast enough for a 1 MHz BE6502 in real time → measured here; the Platform track's
  Worker / fast-mode ideas if it matters for R20.
- The VIA and the ACIA → R18; the assembler → R19; the BE6502 → R20.

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md) — components at runtime, timers, timing checks,
  carry-over, snapshots (component state must be plain data).
- [docs/components.md](../../docs/components.md) — definition shape, timing (limits only),
  timing checks, memories (the `X` window, `ReadPath`), the HD44780 (a controller beside its
  bus code, merged outcomes).
- [ADR-0014](../../docs/adr/0014-timing-checks.md) (report, `X` where outcomes differ),
  [ADR-0017](../../docs/adr/0017-memories.md) (limits, `X` windows),
  [ADR-0022](../../docs/adr/0022-character-lcd.md) (a pure controller, capped enumeration).
- `src/library/mem/memory.ts` (`ReadPath`: windows by wake-ups with a generation token),
  `src/library/periph/hd44780.ts` (bus side of a controller), `src/core/timing-checks.ts`,
  `src/core/memory.ts` (`MemoryDef`, the model for `CpuDef`), `tests/scenarios/carry-over.test.ts`,
  `tests/scenarios/rewind.test.ts`, `scripts/test-circuits.ts` (a Node script on `src`).
- Data sheet: WDC W65C02S, April 8, 2022 — copy in the scratchpad
  (`ds-w65c02s/w65c02s.pdf`, from westerndesigncenter.com/wdc/documentation/w65c02s.pdf):
  §3 pin functions, Figure 3-1 pinout, Table 3-1 vectors, Table 5-2 opcode matrix, Table 6-3
  AC characteristics, Figure 6-3 timing diagram, Table 6-4 operations, Table 7-1 caveats.
- Bus cycles per instruction (the 2022 data sheet has no per-cycle table): SingleStepTests
  `65x02/wdc65c02/v1` (github.com/SingleStepTests/65x02, MIT); for reset and interrupts the
  W65C816S data sheet's Table 5-7 (emulation mode) and Ben Eater's bus monitor traces.

## Design

### The part

`cpu/w65c02s`, name `W65C02S`, title "8-bit microprocessor (65C02)", designator `U`, keywords
`6502`, `65c02`, `cpu`, `microprocessor`, `wdc`. Package DIP-40 (Figure 3-1):

| Pins         | Names                 | Dir       | Notes                                       |
| ------------ | --------------------- | --------- | ------------------------------------------- |
| 1, 5, 7      | VPB, MLB, SYNC        | out       | vector pull, memory lock (active LOW); SYNC |
| 2            | RDY                   | bidir     | ready; `WAI` pulls it LOW                   |
| 3, 39        | PHI1O, PHI2O          | out       | `PHI2` inverted / in phase (Q7)             |
| 4, 6, 40, 38 | IRQB, NMIB, RESB, SOB | in        | active LOW                                  |
| 37           | PHI2                  | in, clock | the clock                                   |
| 36           | BE                    | in        | bus enable                                  |
| 34           | RWB                   | tristate  | `R/W̅`: 1 read, 0 write; released by `BE`    |
| 9–20, 22–25  | A0–A11, A12–A15       | tristate  | address bus; released by `BE`               |
| 33–26        | D0–D7                 | bidir     | data bus                                    |
| 8, 21        | VDD, VSS              | power     | not simulated                               |
| 35           | NC                    | nc        |                                             |

Active LOW pins are drawn overlined. No props: one part, the 5 V column (the lower-voltage
grades are an idea).

**Timing** (Table 6-3, 5.0 V ± 5 %, 14 MHz grade; limits only, as memories: `typical` empty):
`max` — `tADS` 30 (address, `RWB`, `SYNC`, `VPB`, `MLB` valid after `PHI2` falls), `tMDS` 25
(write data valid after `PHI2` rises), `tBVD` 25 (BE to valid data / high impedance); `min` —
`tAH` 10 (outputs held after `PHI2` falls), `tDHW` 10 (write data held), `tDSR` 10 / `tDHR` 10
(read data set-up / hold to `PHI2` falling), `tPCS` 10 / `tPCH` 10 (`IRQB`, `NMIB`, `RDY`,
`RESB`, `SOB` set-up / hold), `tPWH` 35, `tPWL` 35, `tCYC` 70, `tACC` 30 (shown, not checked:
it follows from the others). Conditions: `VDD = 5.0 V ± 5 %, CL = 35 pF, TA = 0 to 70 °C (DIP)`.

### A pure core and a pin wrapper

As the LCD keeps its controller beside its bus code (ADR-0022):

- **`w65c02s-opcodes.ts`** — the 256 opcodes: mnemonic, addressing mode (Table 4-1's 16), bytes,
  base cycles; the reserved ones as the NOPs the W65C02S makes of them (1, 2 or 3 bytes; their
  cycles from Table 7-1 and SingleStepTests). Data, no behavior.
- **`w65c02s-core.ts`** — the CPU between two `PHI2` falling edges, as plain data (snapshots,
  carry-over): `A X Y S P PC` with an unknown-bit mask each, the instruction register, the cycle
  counter (TCU), the internal latches (address, data, pointer), the mode (running, reset, `WAI`,
  `STP`, unknown), the interrupt latches. Two calls per cycle: `busCycle(core)` — what the
  cycle puts on the bus (address and its unknown bits, read or write, `SYNC`, `VPB`, `MLB`, the
  write data); `endCycle(core, data, unknown, inputs)` — the data read and the control inputs
  sampled at the falling edge; it advances to the next cycle. The per-cycle behavior is one
  `switch` over (addressing mode, cycle) with the operation per mnemonic — no closures,
  generators or allocations, so the state freezes and copies.
- **`w65c02s.ts`** — the part: reacts to `PHI2` edges and its wake-ups, drives the pins with the
  data sheet's timing, runs the timing checks, gives the core what the pins read.

### One bus cycle on the pins (Figure 6-3)

`PHI2` falling at `t0` ends a cycle and starts the next:

1. **Read data**: the cycle that ended was a read → the data bus as it is at `t0 + tDHR` is what
   the core reads; a bit that changed within `tDSR` before `t0` (set-up) or `tDHR` after it
   (hold) is reported and read as `X` (ADR-0014). The core advances at `t0 + tDHR` (a wake-up).
2. **Write data** of the cycle that ended: held until `t0 + tDHW`, then released (`Z`).
3. **Outputs** of the new cycle (`A0`–`A15`, `RWB`, `SYNC`, `VPB`, `MLB`): a line whose value
   changes keeps the old value until `t0 + tAH`, is `X` until `t0 + tADS`, then shows the new
   value; a line that keeps its value doesn't move (Q5). Wake-ups with a generation token, as
   `ReadPath` does, so a recompile's forced evaluation changes nothing.
4. **Control inputs** `RDY`, `IRQB`, `NMIB`, `RESB` are sampled at `t0` (`tPCS`/`tPCH` checked;
   a violation makes that input unknown for the sample).

`PHI2` rising at `t1`: a write cycle drives the data bus — `X` from `t1`, the data at
`t1 + tMDS`; `SOB` is sampled (a falling edge since the last sample sets `V`). `PHI1O` is `PHI2`
inverted and `PHI2O` follows it, with a delay from another 65C02 data sheet (Rockwell R65C02 or
MOS) if one gives it, else an estimate marked as an assumption in the timing's source (Q7).

`PHI2` itself: `tPWH`, `tPWL` and `tCYC` checked (`pulse-width-violation`,
`cycle-violation`): a violation loses the CPU's state (below). An edge from or to `X`/`Z` is no
edge: after the clock was known once, it loses the state (pessimistic, as flip-flops go `X`).
The CPU is fully static: no maximum cycle time, the clock may stop in either phase.

### Control lines

- **`RESB`** (Q3): low for at least two `PHI2` cycles (shorter: `pulse-width-violation`, still
  reset); while low the CPU reads (`RWB` high), `SYNC` low, `RDY` ignored. On its rising edge,
  the seven-cycle reset sequence: two reads at `PC`, three stack reads at `0x0100 + S`
  (decrementing `S`; the 65C02 reads where an interrupt would push), then `0xFFFC`/`0xFFFD`
  with `VPB` low; `D` = 0, `I` = 1 by hardware, every other register as it was (unknown after
  power-on). Exact cycles from the W65C816S Table 5-7 and a bus trace, cited in the code.
- **`IRQB`** (level, masked by `I`), **`NMIB`** (falling edge, latched), **`BRK`**: the
  interrupt sequence after the current instruction — push `PC` and `P` (`B` clear for
  interrupts, set for `BRK`), `I` = 1, `D` = 0, the vector with `VPB` low.
- **`RDY`** (`bidir`): sampled at `PHI2` falling; low halts the CPU in the current cycle, read or
  write (the 65C02 halts on writes too), its outputs held, until a falling edge with `RDY` high.
  `WAI` drives it **strong LOW** (the data sheet's bidirectional `RDY`) until `IRQB` or `NMIB`
  goes low (with `I` set, `WAI` resumes without vectoring), `Z` otherwise: tied straight to VCC
  it is a short (`contention`) — why the data sheet asks for a pull-up resistor.
- **`STP`**: stops until `RESB`.
- **`BE`**: asynchronous; low releases `A0`–`A15`, `D0`–`D7`, `RWB` after `tBVD`; high drives
  them again (`X` until `tBVD`, then the values).
- **`SYNC`** high during opcode fetches; **`VPB`** low on vector reads; **`MLB`** low during the
  modify and write cycles of read-modify-write instructions (§3.5).

### Unknown bits (Q2)

- Each register, latch and the effective address keep an **unknown-bit mask**. Logic
  (`AND`, `ORA`, `EOR`, `BIT`, `TRB`, `TSB`, `RMB`, `SMB`) is exact per bit (`AND` with a known
  0 is 0); shifts and rotates move the masks; additions, subtractions, increments and compares
  are unknown from the lowest unknown bit of an operand (or the carry in) upward. Flags follow
  their bits: `Z` known when a known bit is 1 or every bit is known, `N` is bit 7's, `C` and `V`
  unknown when they depend on unknown bits. Decimal mode with any unknown bit: the result and
  flags unknown.
- An address with unknown bits drives `X` on those lines; a store of unknown bits writes `X`
  (the RAM stores them as unknown). Unknown data never stops the CPU by itself.
- The CPU is **lost** when what it does next depends on unknown bits: an opcode fetched with
  unknown bits, a branch or `BBR`/`BBS` on an unknown bit, a `PC` with unknown bits (from `RTS`,
  `RTI`, `JMP (a)`, a vector, `S` pulling it), a page-crossing decision that can't be made, `D`
  unknown in `ADC`/`SBC` (the 65C02 takes an extra cycle in decimal mode), an `IRQB` that may be
  taken, a `PHI2` violation. Lost: `A0`–`A15`, `RWB`, `SYNC`, `VPB`, `MLB` drive `X`, the data
  bus `X` while `PHI2` is high (it may be writing), `RDY` released; reported once per loss as an
  error (`cpu-lost`, message naming why and where: "fetched opcode 1X0X1010 at 0x8003"); only
  `RESB` brings it back.
- **Power-on**: lost without a report — every register unknown, the outputs `X` — until `RESB`
  has been held low (Q3). A program that never sets `S` pushes to page 1 at an unknown address.

### The inspection interface (core)

`CpuDef<State>` on `ComponentDefinition.cpu`, modeled on `MemoryDef`: the registers (`name`,
`width`, an optional flag string for a status register: `NV-BDIZC`), the address and data pins,
and `view(state)` → register values and unknown masks, the mode (`running`, `reset`, `waiting`,
`stopped`, `unknown`), the current instruction's address and opcode and the cycle in it. Read in
place, no copies. The registry checks the register names and widths. R17b builds the CPU tab
and watches on it; the scenarios read registers through it now.

### Tests

- **Opcode table**: Table 5-2 spot checks, 212 defined opcodes, the reserved NOPs' sizes.
- **Core** (no bench): every addressing mode and instruction class by hand; the SingleStepTests
  sample (≈ 20 cases per opcode, chosen by a fixed seed, ≈ 1 MB of compact JSON under
  `src/library/cpu/testdata/`) — initial state, every cycle's address, data and read/write, the
  final state; reset, interrupts, `WAI`/`STP`, `SOB`, decimal mode, unknown propagation and
  losing the state.
- **`pnpm test:65c02`** (`scripts/test-65c02.ts`, Node on `src` through `resolve-hooks.ts`):
  downloads `wdc65c02/v1/*.json` (≈ 1.2 GB) into a git-ignored cache once and runs every case
  against the core; `scripts/sample-65c02.ts` makes the committed sample from the cache.
- **Pins** (`Bench`): pinout by number (Figure 3-1); every window measured (`tAH`, `tADS`,
  `tMDS`, `tDHW`, `tBVD`) against Figure 6-3; each requirement just inside (silent) and 1 ns
  outside (reported, `X`): `tDSR`, `tDHR`, `tPCS`, `tPCH`, `tPWH`, `tPWL`, `tCYC`, `RESB` two
  cycles; `RDY` halting reads and writes and single-stepping; `WAI` against a pull-up (fine) and
  against VCC (contention); `BE`; power-on unknown, the reset sequence on the pins; unknown
  clock edges.
- **Scenarios** (`tests/scenarios/cpu-6502.test.ts`): a W65C02S + AT28C256 + 62256 + 74HC00
  running a hand-assembled program (stack, subroutine, RAM, a loop) and checking registers and
  RAM; the CPU reading uninitialized RAM as code (lost, reported, reset recovers). The
  carry-over property over a running CPU; the rewind property covers it as a registered part
  and through the examples.
- **Benchmark** (`tests/bench/cpu.bench.ts`): the ROM program at 1 MHz — events/s and simulated
  µs per wall second, recorded here (R20 needs the BE6502 usable at 1 MHz).
- Mutation-checked, as every part since R09a.

### Examples (Q6)

- **6502 NOP Sled** — Ben Eater's first 6502 step: `D0`–`D7` pulled to `0xEA` (`NOP`) with pull
  resistors, a clock module (manual and slow), a reset button, `RDY`/`IRQB`/`NMIB`/`BE`/`SOB`
  pulled up, the address bus on LEDs and probed in Waveforms. After reset it reads the vector
  `0xEAEA` and counts up every two cycles. Bench: the reset sequence and the count.
- **6502 program from ROM** — W65C02S + AT28C256 (`0x8000`–`0xFFFF`) + 62256 + 74HC00 decoding +
  a 74HC574 output port with LEDs; a hand-assembled program (no assembler before R19) sets the
  stack and walks a light across the LEDs through a subroutine. Bench: the LED pattern. Risk: a
  574 clocked when `PHI2` falls may miss the CPU's 10 ns write data hold through a gate delay —
  the simulator will say so; the decoding is designed to meet the data sheets (or the example
  shows why Ben uses a VIA, and the port moves to R18).

### Decisions (an ADR: CPU model)

ADR-0028 (next free number): a W65C02S as a pure cycle-level core behind a pin-level part; the
data sheet's limits with `X` windows on changing outputs; unknown bits per bit and a lost CPU
until reset; power-on unknown; bus cycles verified against SingleStepTests. Alternatives:
instruction-level execution with replayed bus cycles (can't read a pin per cycle), byte-level
unknowns, halting on any `X`, a power-on reset prop, windows on every line, a transistor-level
netlist (none public for the 65C02; far too slow).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [ ] 1. Roadmap: R17 split into R17a/R17b (track file, M4); plan approved; status
  `in-progress`.
- [x] 2. `core`: `CpuDef`, `CpuView`, `ComponentDefinition.cpu`, registry checks; tests.
- [x] 3. Opcode table from Table 5-2 (and the reserved NOPs); tests.
- [x] 4. Core, known values: registers, every addressing mode and instruction with its bus
  cycles; hand-written tests per mode.
- [x] 5. SingleStepTests: `scripts/test-65c02.ts` (download cache, run all), the sample
  generator, the committed sample in `pnpm check`; the full suite green, result recorded.
- [x] 6. Core: reset sequence, `IRQB`/`NMIB`/`BRK`/`RTI`, `WAI`/`STP`, `SOB`, `RDY` halt; tests.
- [x] 7. Core: unknown masks through the ALU and addressing, losing the state, power-on; tests.
- [x] 8. The part: pins, package, timing, `PHI2` edges, output windows, write data, read
  sampling, `PHI1O`/`PHI2O` (Q7 delay sourced); registered (family `cpu`, Parts panel
  group); pin tests and measured windows.
- [x] 9. The part: timing checks (`tDSR`, `tDHR`, `tPCS`, `tPCH`, clock), `RESB` width, `RDY`
  bidirectional with `WAI`, `BE`, unknown clock edges; tests at each limit.
- [x] 10. Scenarios (ROM/RAM program, lost and reset), carry-over property with the CPU, rewind
  coverage, benchmark recorded.
- [x] 11. Example: 6502 NOP Sled with its bench; looked at in the browser.
- [x] 12. Example: 6502 program from ROM with its bench; looked at in the browser; an e2e check
  that it runs.
- [x] 13. Docs: components.md (`cpu` family, W65C02S), simulation.md (CPU inspection),
  architecture.md, glossary, editor.md examples, ADR-0028, library README, lessons, the
  track file (R17a built), MOS and Parts ideas.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check` and `pnpm build` are green.
- [ ] `cpu/w65c02s` is in the Parts panel and draws as a DIP-40 with Figure 3-1's pinout; the
  Part tab shows every pin's description and the 5 V timing with its source.
- [ ] The core passes the full SingleStepTests `wdc65c02` suite — final state and every cycle's
  address, data and read/write — by `pnpm test:65c02`; the committed sample passes in
  `pnpm check`.
- [ ] On the pins, every window and delay is what Table 6-3 / Figure 6-3 give (measured), and
  every requirement is silent just inside its limit and reported (with `X`) 1 ns outside.
- [ ] Power-on: outputs `X` until `RESB` has been low ≥ 2 cycles; then the seven-cycle reset
  sequence reads `0xFFFC`/`0xFFFD` with `VPB` low and the program starts at the vector.
- [ ] `IRQB`, `NMIB`, `BRK`, `WAI`, `STP`, `SOB`, `RDY` (halt and single cycle) and `BE` behave
  as §3 describes; `WAI` with `RDY` tied to VCC is reported as contention, with a pull-up it
  is not.
- [ ] Unknown bits: masked logic stays known, arithmetic goes unknown upward; an unknown opcode
  or branch loses the CPU with an error naming why and where; `RESB` recovers it.
- [ ] The ROM/RAM scenario runs its program and ends with the expected registers and RAM;
  the carry-over and rewind properties hold with the CPU.
- [ ] Both examples open from File ▸ Examples, run in the browser, and their benches pass
  headless and in the Tests tab.
- [ ] The benchmark's numbers are recorded in this plan.
- [ ] Docs, ADR-0028, lessons and the track file are updated; plan status `done`.

## Open questions

- [x] Q1. Split R17? — **answer:** yes: R17a the part (this branch), R17b the CPU tab,
  disassembly and Step Instruction (`feat/cpu-6502-tools`); M4 needs both.
- [x] Q2. Unknown bits read by the CPU? — **answer:** per bit through registers and the ALU; an
  opcode, branch or `PC` that depends on them loses the CPU (outputs `X`, an error) until
  `RESB`.
- [x] Q3. Power-on? — **answer:** unknown until `RESB` is held low (no internal reset, as on
  the chip); examples and benches press reset; a reset supervisor goes to the Parts ideas.
- [x] Q4. Verification corpus? — **answer:** SingleStepTests `wdc65c02` (MIT): a committed
  sample in `pnpm check`, the full suite by `pnpm test:65c02`; plus hand-written pin and
  timing tests. No Klaus Dormann test.
- [x] Q5. Output window after `PHI2` falls? — **answer:** `X` from `tAH` to `tADS` on the lines
  whose value changes only.
- [x] Q6. Examples? — **answer:** 6502 NOP Sled and a program from ROM (AT28C256 + 62256 +
  74HC00 + 74HC574 LEDs), each with a bench.
- [x] Q7. `PHI1O`/`PHI2O`? — **answer:** follow `PHI2` (inverted / in phase), the delay from
  another 65C02 data sheet, else an estimate marked as an assumption.

## Progress log

- 2026-11-08 — plan drafted; Q1–Q7 answered (all as proposed); W65C02S data sheet (April 8,
  2022) in the scratchpad; SingleStepTests `wdc65c02` checked (MIT, 10,000 cases per opcode,
  ≈ 5 MB per file).
- 2026-11-08 — plan approved; R17a `in-progress` (task 1).
- 2026-11-08 — task 2: `CpuDef` in `src/core/cpu.ts` (registers with widths and flag letters,
  the program counter's name, address and data pins, `view` → values, unknown bits, mode, the
  instruction under way); `cpuProblems` checked by the registry; simulation.md and
  components.md document it. `view` returns a small fresh object (inspection, not a hot path).
- 2026-11-08 — task 3: `w65c02s-opcodes.ts` — Table 5-2 transcribed row by row (checked against
  the rendered page: the text extraction shifts columns), bytes by mode (Table 4-1; `BBR`/`BBS`
  get a mode of their own, `zp,r`, 3 bytes), the 44 reserved NOPs from Table 7-1, base cycles
  by instruction class. Cycles get checked against SingleStepTests in task 5.
- 2026-11-08 — tasks 4–7: the pure core (`w65c02s-core.ts`) with every opcode's bus cycles,
  reset, IRQ/NMI/BRK/RTI, `WAI`/`STP`, `SOB`, unknown masks and losing the CPU; written with the
  SingleStepTests harness (`single-step.ts`, `pnpm test:65c02`, cache in
  `node_modules/.cache/65x02`, 955 MB): **all 2,540,000 cases pass, every cycle compared** (13 s).
  Found on the way: `JMP (a)` across a page reads the high byte's address without the carry
  first (the NMOS address), then with it — Table 7-1's extra cycle; `INC`/`DEC a,x` always take
  7 cycles (Table 7-1's "six in the same page" holds for the shifts only); the cases keep P's B
  bit as given (compared without bits 4, 5). Deviations from the cases, by the data sheet: `5C`
  is 8 cycles (Table 7-1; the cases say 4); the decimal extra cycle of `ADC #`/`SBC #` reads at
  PC (the cases read `$7F` / `$0000`, no rule). The committed sample (`w65c02s-sst-sample.ts`,
  2032 cases, 308 KB, `scripts/sample-65c02.ts`) misses rare paths (decimal boundary, `JMP ($xxFF)`),
  so hand-written tests (`w65c02s-core.test.ts`) cover them, MLB, VPB, reset, interrupts and
  unknowns; 8 mutations all killed.
- 2026-11-08 — tasks 8–9: the part `cpu/w65c02s` (`w65c02s.ts`), registered (family `cpu`, Parts
  group "CPUs"): DIP-40 per Figure 3-1, the 5 V timing, PHI2 edges with wake-ups (the core moves
  at t0 + tDHR, outputs `X` from tAH to tADS on changing lines, write data `X` from PHI2 rising
  and valid at tMDS, released tDHW after it falls), BE (tBVD), RDY (halts; WAI drives it LOW;
  floating → lost), SOB, NMIB edges, RESB ≥ 2 cycles, timing checks (tDSR/tDHR, tPCS/tPCH,
  tPWH/tPWL/tCYC), unknown PHI2 → lost. `cpu-lost` is an error (`diagnosticSeverity`). Q7: no
  65C02 data sheet found with a PHI2 → PHI1O/PHI2O delay (a web search turned up none); 10 ns,
  marked as an estimate in the timing's source. The rewind property covers the CPU as a
  registered part. Lessons: read BE only when it changes (init read it floating); the bench's
  RDY released without a pull-up loses the CPU — a real trap, now a test. Mutation-checked: 11
  mutants, 10 killed, 1 equivalent (`tAH − tDHR` is 0 in the 5 V column).
- 2026-11-08 — task 10: `tests/scenarios/computer-6502.ts` (W65C02S + AT28C256 + 62256 + 74HC00,
  Ben Eater's decoding) and `cpu-6502.test.ts`: a hand-assembled program (stack, JSR, loop) ends
  with the expected RAM and registers at 1 and 4 MHz with no diagnostic; a jump into
  uninitialized RAM loses the CPU (`cpu-lost`), a reset brings it back. The carry-over property
  with a running CPU (two resets, random instants and instants on edges and wake-ups) found a
  **bug in the memories' read path**: a recompile's re-drive stamped a read (`readAt`); fixed in
  `memory.ts` (stamp only at data-valid or when an input changed), pinned by instants in the
  start-up code (the loop re-reads its cells and hides it). Benchmark (`pnpm bench
  tests/bench/cpu.bench.ts`, M3 Pro): **≈ 43 events per cycle, 8.0M events/s — 18 % of real
  time at 1 MHz** (the BE6502 will run about 5× slower than the real board).
- 2026-11-08 — task 11: example **6502 NOP Sled** (`examples/6502-nop-sled.logic.json`, generated
  by a throwaway `CircuitBuilder` script, then deleted): W65C02S, D0–D7 pulled to $EA, a 10 Hz
  clock, RESET with a pull-up, pull-ups on RDY/IRQB/NMIB/BE/SOB, six hex displays on the address
  and data buses, probes (PHI2, RESB, SYNC, VPB, RWB, A[0..15], D[0..7]); its bench checks the
  vector reads ($FFFC/$FFFD with VPB), then $EAEA, $EAEB… with SYNC on the fetches. Design
  checks clean; looked at in the browser (layout readable).
- 2026-11-08 — task 12: the risk came true — a 74HC574 port at $6000 (74HC138 strobe from PHI2
  and RWB) latches `X`: CP rises 17 ns after PHI2 falls, the CPU holds write data 10 ns, so the
  574 sees the bus float (`setup-violation` 7 ns before CP, `floating-input`). On a breadboard
  the bus capacitance usually hides it; the data sheet doesn't promise it. Q8: example **6502 ROM
  and RAM** instead (`examples/6502-rom-ram.logic.json`): the scenario computer as a schematic
  (W65C02S, AT28C256 with the program in its image, 62256, 74HC00, 1 kHz clock, RESET, address
  bus on hex displays, probes), a program counting at $0010 and $0200 through a subroutine; its
  bench checks the stack and ten counts in 340 ms. `tests/e2e/cpu.spec.ts`: both examples'
  benches pass in the Tests tab; looked at in the browser.
- 2026-11-08 — task 13: docs — components.md (`cpu` family, the W65C02S section), simulation.md
  (`cpu-lost` an error), architecture.md, glossary (opcode fetch, PHI2, RDY, reset vector,
  SingleStepTests), editor.md (both examples), ADR-0028 (CPU model) and its index row, library
  README, the track file (R17a built), lessons. All 13 tasks done.

## Handoff

- **State:** all 13 tasks done and committed; `pnpm check` green (3012 tests), `pnpm test:65c02`
  green (2.54M cases), `tests/e2e/cpu.spec.ts` green. Plan status still `in-progress`.
- **Next step:** the finish-branch workflow — merge `main` in, `pnpm check`, `pnpm build`,
  `pnpm test:65c02`, `pnpm e2e`, walk the acceptance criteria (tick them), plan status `done`,
  track status `done`, then merge with the user's approval.
- **Watch out:** component state must stay plain data (snapshots freeze it: no closures,
  generators, `Map`s); `evaluate` idempotent with nothing changed (carry-over); enumerate
  nothing per unknown bit in the CPU (masks, not outcomes).
- **Verify with:** `pnpm check`; `pnpm test:65c02` (downloads ≈ 1 GB once).

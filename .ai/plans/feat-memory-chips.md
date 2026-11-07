# Plan: feat/memory-chips

| Field      | Value                                                                                |
| ---------- | ------------------------------------------------------------------------------------ |
| Branch     | `feat/memory-chips`                                                                  |
| Roadmap    | R12a — Memory chips ([roadmap](../../docs/roadmap.md))                               |
| Status     | in-progress                                                                          |
| Depends on | R09a (timing checks, `X` policy), R06 (3-state outputs, chip specs), R07 (documents) |
| Created    | 2026-11-07                                                                           |

## Goal

The memories an 8-bit computer is built from — AT28C16, AT28C64B and AT28C256 EEPROMs, 6116 and
62256 SRAMs — as DIP packages that follow their data sheets: reads that show `X` until the data
is valid, so sampling a memory too early is caught before the board is built; level-sensitive RAM
writes checked against the data sheet's requirements; ROM contents kept in the document; RAM
powering on unknown, zeroed or random. R12 was split at its start (Q1): this branch is the chips
and their contents, R12b (`feat/memory-inspector`) the memory inspector, `.bin`/Intel HEX files,
the programmer dialog, the part/net resolver and the SAP-1 modules that M2 still needs. The
SAP-1 output module (R12b, R16) and the 6502 build (R20) need these chips.

## Scope

**In scope**

- `core`: an `image` prop type for ROM contents and its text form (sparse hex runs, Q6); a seeded
  pseudo-random generator for random power-on contents; `ComponentDefinition.memory` (what a
  memory part holds and how to view it, for R12b's inspector and test benches).
- `library`: the `mem` family — `mem/at28c16`, `mem/at28c64b`, `mem/at28c256` (EEPROMs read as
  ROMs, Q5), `mem/6116`, `mem/62256` (SRAMs with writes); a shared read engine with the `X`
  window (Q3); the SRAM write engine with its timing checks; power-on modes (Q8); a `poke` action
  (debug write that bypasses timing).
- `ui`: Properties shows a ROM's contents as a read-only summary; the Part tab shows parts whose
  data sheets give only limits (max and min, no typical).
- Examples **EEPROM 7-Segment Decoder** and **RAM by Hand** with their images and nets generated
  in code; browser tests.
- Docs: components.md, simulation.md, architecture.md, editor.md, glossary, ADR-0017, roadmap
  (split, backlog), lessons.

**Out of scope** (and where it goes instead)

- Memory inspector (hex view, edit, live read/write highlighting, follow address), `.bin` and
  Intel HEX import/export, the programmer dialog, the part/net resolver → R12b (Q1). Until then
  ROM contents come from code only: examples, tests, `CircuitBuilder` (Q7).
- SAP-1 modules for the M2 acceptance (ALU and B register, RAM and memory address register, the
  output register with its EEPROM decoder) → R12b.
- 74LS189 → backlog, with the 74LS family and its TTL inputs (Q2); the SAP-1's RAM is built on a
  6116 or 62256 instead.
- EEPROM writes from the circuit (byte and page writes, the self-timed write cycle, DATA polling,
  toggle bit, power-on write delay, noise filter, software data protection) → backlog (Q5). Until
  then a write attempt is reported and ignored. RAM writes are not affected.
- Snapshots of memory contents for rewind → R14.

## Context

Read before starting:

- [docs/components.md](../../docs/components.md) — definition shape, packages, timing,
  edge-triggered chips, timing checks, behavior guidelines.
- [docs/simulation.md](../../docs/simulation.md) — runtime contract, inertial delays, `wakeAfter`,
  carry-over, timing checks, observability (inspection is _planned_ there).
- [ADR-0011](../../docs/adr/0011-real-chips.md) — chip specs and families;
  [ADR-0014](../../docs/adr/0014-timing-checks.md) — violations make what may have loaded `X`;
  [ADR-0013](../../docs/adr/0013-behavioral-timer.md) — timers with a generation token.
- `.ai/workflows/add-component.md`; `.ai/lessons.md` (R06 downloads, R08 overlines and example
  generators, R09a mutation checks, R09b prose rules).
- `src/core/component.ts`, `timing-checks.ts`, `testing/`; `src/library/74xx/pinout.ts`,
  `chip.ts`, `registers.ts`, `transceiver.ts`, `edge-triggered.ts`, `src/library/timer/ne555.ts`;
  `src/ui/PropertiesPanel.tsx`, `PartInfoPanel.tsx`, `part-info.ts`.

## Design

### Parts (`mem/*`)

| Type           | Part      | Organization   | Package | Source (to confirm in task 1) |
| -------------- | --------- | -------------- | ------- | ----------------------------- |
| `mem/at28c16`  | AT28C16   | 2K × 8 EEPROM  | DIP-24  | Atmel/Microchip 0540B         |
| `mem/at28c64b` | AT28C64B  | 8K × 8 EEPROM  | DIP-28  | Microchip                     |
| `mem/at28c256` | AT28C256  | 32K × 8 EEPROM | DIP-28  | Microchip                     |
| `mem/6116`     | 6116SA    | 2K × 8 SRAM    | DIP-24  | Renesas (IDT) 6116SA/LA       |
| `mem/62256`    | AS6C62256 | 32K × 8 SRAM   | DIP-28  | Alliance Memory               |

- The AT28C64B, not the AT28C64: the plain 28C64 is no longer made; the B is the part sold
  today (same pinout).
- Pins in data sheet order and names; `I/O0`–`I/O7` are named `IO0`–`IO7` and drawn with their
  data sheet label (the 191's `UD` → `U̅/D` precedent: no `/` in pin names, which R11's instance
  paths will use). `CE̅`, `OE̅`, `WE̅` (`CS̅` on the 6116) active LOW; data pins `bidir`.
- Designator `U`; search keywords for what they are (`eeprom`, `rom`, `sram`, `ram`, `memory`).
- **Speed grades**: a `speed` prop where the data sheet sells several grades (the 6116SA:
  commercial 15, 20, 25 ns), each with its own timing table; default the slowest, the
  pessimistic choice for access times. Single-grade parts have no prop.
- **Mode tables** as `functionTable` (CE̅ OE̅ WE̅ → mode, I/O): `Dout`, `Din`, `High-Z` are text
  cells, so the tests check those rows by hand.

### Timing: the data sheets' limits (ADR-0017)

Memory data sheets give only guaranteed limits — maximum access, enable and disable times,
minimum hold and turn-on times, minimum write requirements — no typical values. So memories use
**the limits**, not typical values as the 74HC chips do: `timing.max` holds what "valid after"
and "high-Z after" use, `timing.min` what "held until" and "driving from" and the write checks
use; `timing.typical` stays empty. Designing to the guaranteed access time is what a designer
budgets anyway. The Part tab shows the max and min columns for such parts.

### Reads: the `X` window (Q3)

The outputs drive while CE̅ = 0, OE̅ = 0 and WE̅ = 1, as in the mode table.

- **Address change** while driving: the old data for `tOH`, then `X`, the new data `tACC`
  (`tAA`) after the change.
- **Chip enable** falling: released (`Z`) until `tCLZ`, then `X`; valid `tCE` (`tACS`) after it.
  **Output enable** falling: `Z` until `tOLZ`, then `X`; valid `tOE` after it. The data becomes
  valid at the latest of the three deadlines (the data sheets' notes: CE̅ may come up to
  `tACC − tCE` after the address without delaying the data).
- **Disable** (CE̅ or OE̅ rising, WE̅ falling): the data for `tOH`, then `X` until the outputs are
  released `tDF` (`tCHZ`, `tOHZ`, `tWHZ`) after it. A memory handing a bus over drives `X` up to
  its maximum release time, so a driver that starts sooner shows the bus fight.
- One driver holds at most one pending change, so the window uses a wake timer with a
  generation token, like the 555: drive `X` (or the old data) now, wake at the deadline to drive
  the data or release. A new change makes a pending wake stale. The forced evaluation (power-on,
  recompile) only re-drives what is driven or pending: the carry-over property holds.
- **Unknowns**, as precise as cheap: an unknown CE̅/OE̅/WE̅ that might enable the outputs drives
  `X` (as the 3-state buffers do); unknown address bits merge the cells they could select (each
  data bit known only where those cells agree; more than 8 unknown bits → all `X`); unknown bits
  stored in a cell read `X`.

### RAM writes (6116, 62256)

- Level-sensitive, as the data sheets draw it: a write is under way while CE̅ = 0 and WE̅ = 0
  (OE̅ doesn't matter; the outputs are released `tWHZ` after WE̅ falls); it starts when the later
  of the two falls and ends when the first rises (WE̅- or CE̅-controlled write). The cell at the
  address takes the data present at the end.
- **Requirements** (`timing.min`) checked like ADR-0014, reported as `setup-violation`,
  `hold-violation` or `pulse-width-violation` on the pin at fault, with what the write may have
  hit made `X`:

  | Requirement                         | Violated when                                                 | Becomes `X`                          |
  | ----------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
  | `tAS` address set-up                | the address changes less than `tAS` before the start          | the cells at the old and new address |
  | `tAW` address valid to end of write | the address changes during the write, or `tAW` before its end | the cells at the old and new address |
  | `tWR` write recovery                | the address changes less than `tWR` after the end             | the cells at the old and new address |
  | `tWP` / `tCW` write pulse width     | the write lasts less than the minimum                         | the addressed cell                   |
  | `tDW` data set-up                   | a data bit changes less than `tDW` before the end             | that bit of the cell                 |
  | `tDH` data hold                     | a data bit changes less than `tDH` after the end              | that bit, where the new data differs |

  A real chip may also write the addresses an address change passes through; only the old and
  the new address are marked (said in components.md).
- The write strobe comes from two pins, while `TimingChecks` work on one pin's edges: either the
  checks get a derived-strobe form, or the write engine keeps its own times in a `Float64Array`
  (decided in task 4, documented in simulation.md).
- **Unknowns**: an unknown CE̅ or WE̅ that might write makes the addressed cell `X` where the data
  differs from it; unknown address bits during a write do so for every cell they could select;
  unknown data bits are stored `X`.
- **Power-on** (Q8): prop `powerOn` — `x` (default: every bit unknown until written, as
  registers are since R01), `zeros`, `random`. Random comes from a seeded generator in core
  (`random.ts`, e.g. mulberry32, no `Math.random`) seeded from a hash of the designator in
  `init`: every run gives the same bytes, two RAMs different ones.
- State: `data: Uint8Array` and `unknown: Uint8Array` (a set bit is `X`) — plain typed arrays,
  moved by the carry-over.

### EEPROMs: ROM only for now (Q5)

Reads as above. A write attempt — WE̅ falling to 0 while CE̅ = 0 and OE̅ = 1, the data sheet's
write mode — reports a warning (`write-ignored`: "EEPROM writes are not simulated: the write to
0x0123 was ignored") and changes nothing. The data sheet's write inhibit (OE̅ low, CE̅ high or
WE̅ high) is no attempt, so a WE̅ tied to VCC (the SAP-1's EEPROMs) never reports anything. The
self-timed write cycle and the rest are backlog.

### Contents in the document (Q4, Q6)

- Prop type `image` (core): a string holding the contents in **sparse hex runs** — runs
  separated by whitespace, each `AAAA:` (the address in hex) followed by bytes as uppercase hex
  pairs, e.g. `0000:A9FF8D0260 7FFC:00800080`; every byte not in a run is erased (`0xFF`, an
  EEPROM's erased state). `PropDef.max` is the size in bytes. A nearly empty 32 KB ROM is a short
  line, and a diff shows which bytes changed; a dense image is twice its size in text.
- `parseImage(text, size)` rejects bad hex, odd digit counts, overlapping or out-of-range runs;
  `formatImage(bytes)` writes the canonical form (runs in address order, long `0xFF` stretches
  left out); `resolveProps` validates `image` props, so a broken file is reported like any bad
  prop. Default `''`: erased.
- The EEPROM's `create` parses the image once (immutable, in the closure); `createState` copies
  it into the state. A changed image is a changed prop: the part restarts from the new image with
  its outputs carried, as for any prop change (R12b's edits get this for free).
- Writes made by the circuit while simulating live in the simulator only (Q4): Reset powers on
  again from the document.
- Properties shows an `image` prop as a read-only summary — `214 of 2048 bytes programmed` — no
  editing before R12b (Q7).

### Inspection and debug access

- `ComponentDefinition.memory?: MemoryDef` (core): `words`, `width` (8), `volatile` (RAM), and
  `view(state): MemoryView` (`data`, `unknown`). R12b's inspector lists the parts that have it
  and reads the view every frame; test benches read memory through it.
- Debug write: RAM takes the action `{ type: 'poke', address, data: number[] }` at `now`; the
  cells change without timing, and outputs reading them follow through the read path. ROM
  contents change through the `image` prop (a document edit).

### Examples

- **EEPROM 7-Segment Decoder** — the EEPROM replacing combinational logic, as in Ben Eater's
  EEPROM video: an AT28C16 with a 4-way DIP switch on A0–A3 (the other address pins tied LOW),
  I/O0–I/O6 to a common-cathode 7-segment display, CE̅ and OE̅ LOW, WE̅ HIGH; the image (hex
  digits 0–F) computed by the generator.
- **RAM by Hand** — a 6116: address and data DIP switches, the data switches reaching the I/O
  pins through a 74HC245 enabled by a WRITE button (which also takes WE̅ LOW and OE̅ HIGH through
  a 74HC04), LEDs on the I/O lines showing the byte read back when the button is released. Shows
  the bus turnaround around a write.

Both from throwaway `CircuitBuilder` generators that check every net (R07/R08 lessons), saved
canonically, run by scenario tests.

### ADR-0017

"Memories: guaranteed limits with an `X` window; ROM images in the document": limits vs
(nonexistent) typical values; the `X` window vs holding the old data until `tACC`; the image as
sparse hex runs in a prop vs base64 vs separate image files; writes from the circuit kept in the
simulator vs written into the document; EEPROM write cycles deferred.

### Data sheets

The Microchip and Renesas PDFs download directly; Alliance's product table loads by script, so
the user downloads the AS6C62256. Pinning figures and timing tables were rendered with
`pdftoppm` and read off the images (`pdftotext` garbles the 6116's tables).

| Part      | Document                                                                                  |
| --------- | ----------------------------------------------------------------------------------------- |
| AT28C16   | Atmel AT28C16, rev. 0540B–10/98 (`ww1.microchip.com/downloads/en/DeviceDoc/doc0540.pdf`)  |
| AT28C64B  | Atmel AT28C64B, rev. 0270L–PEEPR–2/09 (`…/DeviceDoc/doc0270.pdf`)                         |
| AT28C256  | Atmel AT28C256, rev. 0006M–PEEPR–12/09 (`…/DeviceDoc/doc0006.pdf`)                        |
| 6116      | Renesas (IDT) 6116SA/LA, Jul.17.20 (`renesas.com/us/en/document/dst/6116sala-data-sheet`) |
| AS6C62256 | Alliance Memory AS6C62256 (55 ns) — _the user downloads it_                               |

**Pinouts** (DIP; active-LOW controls overlined in every figure):

- AT28C16, 6116 (DIP-24): 1 A7, 2 A6, 3 A5, 4 A4, 5 A3, 6 A2, 7 A1, 8 A0, 9 I/O0, 10 I/O1,
  11 I/O2, 12 GND, 13 I/O3, 14 I/O4, 15 I/O5, 16 I/O6, 17 I/O7, 18 CE̅ (6116: CS̅), 19 A10,
  20 OE̅, 21 WE̅, 22 A9, 23 A8, 24 VCC.
- AT28C64B (DIP-28): 1 NC, 2 A12, 3 A7 … 10 A0, 11 I/O0, 12 I/O1, 13 I/O2, 14 GND, 15 I/O3 …
  19 I/O7, 20 CE̅, 21 A10, 22 OE̅, 23 A11, 24 A9, 25 A8, 26 NC, 27 WE̅, 28 VCC.
- AT28C256 (DIP-28): as the 64B with 1 A14 and 26 A13.

**Mode tables**: the EEPROMs — Read (CE̅ L, OE̅ L, WE̅ H: Dout), Write (L, H, L: Din), Standby /
Write Inhibit (H, X, X: High Z), Write Inhibit (X, X, H), Write Inhibit (X, L, X), Output
Disable (X, H, X: High Z), Chip Erase (OE̅ at 12 V: not modeled). The 6116 — Standby (CS̅ H:
High-Z), Read (L, L, H: DATAout), Read (L, H, H: High-Z), Write (L, X, L: DATAin).

**EEPROM reads** (ns; one grade each for commercial/industrial use: AT28C16-15, AT28C64B-15,
AT28C256-15 — the 256's -20/-25/-35 are military only). VCC = 5 V ± 10%, CL = 100 pF (`tDF`
at 5 pF):

| Limit                                   | 28C16   | 28C64B | 28C256 |
| --------------------------------------- | ------- | ------ | ------ |
| `tACC` address to output, max           | 150     | 150    | 150    |
| `tCE` CE̅ to output, max                 | 150     | 150    | 150    |
| `tOE` OE̅ to output, min / max           | 10 / 70 | 0 / 70 | 0 / 70 |
| `tDF` CE̅ or OE̅ high to float, min / max | 0 / 50  | 0 / 50 | 0 / 50 |
| `tOH` output hold, min                  | 0       | 0      | 0      |

No low-Z time is given: the outputs may start driving as soon as they are enabled, so the `X`
starts at the enabling edge. Notes 1–2 (CE̅ may come `tACC − tCE` after the address, OE̅
`tCE − tOE` after CE̅) follow from taking the latest deadline.

**6116 reads and writes** (ns; VCC = 5 V ± 10%; commercial grades 15 (0–70 °C only), 20, 25;
CL = 30 pF, the low-Z/high-Z times at 5 pF):

| Limit                                      | 15  | 20  | 25  |
| ------------------------------------------ | --- | --- | --- |
| `tAA` address access, max                  | 15  | 19  | 25  |
| `tACS` chip select access, max             | 15  | 20  | 25  |
| `tCLZ` CS̅ to output in low-Z, min          | 5   | 5   | 5   |
| `tOE` OE̅ to output valid, max              | 10  | 10  | 13  |
| `tOLZ` OE̅ to output in low-Z, min          | 0   | 0   | 5   |
| `tCHZ` CS̅ deselect to high-Z, max          | 10  | 11  | 12  |
| `tOHZ` OE̅ disable to high-Z, max           | 8   | 8   | 10  |
| `tOH` output hold from address change, min | 5   | 5   | 5   |
| `tCW` CS̅ to end of write, min              | 13  | 15  | 17  |
| `tAW` address valid to end of write, min   | 14  | 15  | 17  |
| `tAS` address set-up, min                  | 0   | 0   | 0   |
| `tWP` write pulse width, min               | 12  | 12  | 15  |
| `tWR` write recovery, min                  | 0   | 0   | 0   |
| `tWHZ` WE̅ to output in high-Z, max         | 7   | 8   | 16  |
| `tDW` data to end of write, min            | 12  | 12  | 13  |
| `tDH` data hold from end of write, min     | 0   | 0   | 0   |
| `tOW` output active from end of write, min | 0   | 0   | 0   |

The write waveforms' notes decide the model: "WE̅ or CS̅ must be HIGH during all address
transitions" (an address change during a write is a violation); "a write occurs during the
overlap of a LOW CS̅ and a LOW WE̅"; with OE̅ LOW during a WE̅-controlled write the pulse must be
at least `tWHZ + tDW` (the outputs must turn off before the data arrives) — a third pulse-width
requirement; `tWR` counts from the earlier of CS̅, WE̅ rising; CS̅ falling with or after WE̅
leaves the outputs off. `tWC`/`tRC` (cycle times) are covered by `tAS`, `tAW`, `tWR` and the
read path's `X`, so they are not checked separately. After a write the outputs turn on `tOW`
after its end; the data sheet gives no figure for when they are valid, so the read path's `tAA`
counts from the end of the write (the cell just changed).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [ ] 1. Data sheets: download and read the five; record per part (and grade) the read limits
  (`tACC`/`tAA`, `tCE`/`tACS`, `tOE`, `tOH`, `tCLZ`, `tOLZ`, `tDF`/`tCHZ`/`tOHZ`, `tWHZ`), the
  RAM write requirements (`tAS`, `tAW`, `tWP`, `tCW`, `tDW`, `tDH`, `tWR`), conditions, mode
  tables and pinouts in this plan.
- [x] 2. `core`: `image` prop type with `parseImage`/`formatImage`/summary and `resolveProps`
  validation; `random.ts` (seeded generator, string hash); `MemoryDef`/`MemoryView` on
  definitions with registry validation; tests (image round trip as a property test).
- [x] 3. `library`: the memory read engine with the `X` window (`src/library/mem/`), the three
  EEPROMs as ROMs (write attempts reported), mode tables, `memory` views; tests: mode tables,
  every read path's limits, the window, unknown controls and address bits, images.
- [ ] 4. `library`: the SRAM write engine and its checks, `mem/6116` (speed grades) and
  `mem/62256`, power-on modes, `poke`; tests: writes WE̅- and CE̅-controlled, every requirement
  just inside (silent) and just outside (diagnostic and `X`), unknowns, power-on, random
  reproducible; mutation-checked.
- [x] 5. Scenarios: a 6116 written and read back over a bus through a 74HC245 (turnaround), an
  AT28C16 driving a 7-segment display, a register latching a RAM's output before `tAA` (gets
  `X`), the carry-over property with random networks including memories and images; benchmark
  (a 74HC4040 sweeping sixteen 6116s' addresses: ≈ 7.5M events/s).
- [ ] 6. `ui`: Properties' read-only summary for `image` props; the Part tab for parts with only
  limits; tests.
- [ ] 7. Examples EEPROM 7-Segment Decoder and RAM by Hand (generators, every net checked,
  looked at in the browser), gallery entries; e2e: open each, run, see the digit follow the
  switches and a byte written and read back.
- [ ] 8. Docs: components.md (`mem` family), simulation.md (inspection, the write strobe),
  architecture.md, editor.md (Properties), glossary, READMEs, ADR-0017; roadmap (R12 split into
  R12a/R12b, R12a done, R12b next; backlog: 74LS189 with the 74LS family, EEPROM write cycles);
  lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] Every memory part's pinout, mode table and read limits are checked against its data sheet
  (each read path measured); a read sampled before `tACC` sees `X`, not the old data.
- [ ] A RAM write breaking each requirement (`tAS`, `tAW`, `tWR`, `tWP`/`tCW`, `tDW`, `tDH`)
  reports it on the pin at fault and leaves the cells it may have hit `X`; one just inside every
  limit is silent and stores the data.
- [ ] An EEPROM's contents survive save and load as sparse hex runs; an erased part saves `''`;
  a write attempt is reported and changes nothing; WE̅ tied HIGH reports nothing.
- [ ] RAM powers on `X`, zeros or random; random is the same in every run and differs between two
  RAMs.
- [ ] The carry-over property holds with memories in the networks.
- [ ] Both examples run in the browser; looked at in both themes, stopped and running.

## Open questions

- [x] Q1. R12 is six chips, the inspector, two file formats, a programmer dialog, power-on
  options and the resolver: split? — _proposed:_ R12a chips and contents, R12b inspector, files,
  programmer, resolver and the M2 SAP-1 modules — **answer:** split (2026-11-07).
- [x] Q2. 74LS189 is TTL (a floating input reads HIGH) and has no current data sheet — _proposed:_
  TTL timing from the DM74LS189, inputs like CMOS — **answer:** move it to the backlog with the
  74LS family (2026-11-07).
- [x] Q3. Reads — _proposed:_ an `X` window from `tOH` to `tACC` (and while releasing) —
  **answer:** the `X` window (2026-11-07).
- [x] Q4. Where ROM contents live — _proposed:_ an image in the document, the circuit's writes
  kept in the simulator only — **answer:** as proposed (2026-11-07).
- [x] Q5. EEPROM writes from the circuit — _proposed:_ as the data sheets describe them, without
  software data protection — **answer:** ROM only for now, writes to the backlog; RAM writes
  are unaffected (2026-11-07).
- [x] Q6. Image format in the file — _proposed:_ sparse hex runs — **answer:** sparse hex runs
  (2026-11-07).
- [x] Q7. Programming an EEPROM before R12b — _proposed:_ Load/Save/Erase in Properties with the
  file formats moved here — **answer:** not at all before R12b; contents from code only
  (2026-11-07).
- [x] Q8. RAM power-on default — _proposed:_ `X`, with zeros and random as options — **answer:**
  `X` (2026-11-07).

## Progress log

- 2026-11-07 — plan drafted; `main` green (1781 tests). Q1–Q8 answered: R12 split (this branch
  renamed `feat/memory` → `feat/memory-chips`), 74LS189 to the backlog, the `X` window, images
  in the document as sparse hex runs, EEPROMs as ROMs for now, no programming UI before R12b,
  RAM powering on `X`.
- 2026-11-07 — plan approved; branch started. Roadmap: R12 split into R12a (in progress) and
  R12b; 74LS189 and EEPROM write cycles in the backlog.
- 2026-11-07 — task 1 for four parts (AT28C16/64B/256, 6116; limits recorded above; the
  AS6C62256 PDF waits for the user). Task 2: `image` props (sparse hex runs), `SeededRandom`,
  `MemoryDef`/`PokeAction`. Timing may be a function of props (`timingOf`) for speed grades; the
  Part tab shows the picked instance's. Task 3: the read path (`ReadPath`: old data for `tOH`,
  `X`, the data at the latest deadline; a released output keeps its data until its maximum
  release time, so a bus fight shows as contention) and the EEPROMs as ROMs (`write-ignored`).
  6116 with the write path (`WritePath`): level-sensitive, the cell written at the end, every
  requirement checked; with OE̅ LOW the bits that differ from the cell fight until `tWHZ` (note
  4), which is how note 7's `tWP ≥ tWHZ + tDW` comes out without its own check. An unknown write
  before CS̅/WE̅ were first known is ignored (power-on transient, so `zeros` survives gates
  that start `X`). Mutation-checked. 1893 tests.

## Handoff

- **State:** plan approved, branch started; no code yet.
- **Next step:** task 1 (data sheets).
- **Watch out:** memory data sheets have no typical values (use the limits); Alliance's site may
  not hand out the AS6C62256 PDF to curl. Gate commits on `pnpm check`'s exit code.
- **Verify with:** `pnpm check`.

# 0017. Memories: guaranteed limits with an X window; ROM images in the document

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R12a (feat/memory-chips)

## Context

The computers this simulator is for keep their programs and microcode in EEPROMs (AT28C16,
AT28C256) and their data in SRAMs (6116, 62256). Three things about memories differ from the
74HC chips (ADR-0011):

- Their data sheets give **limits only**: a maximum access time (`tACC`, `tAA`), minimum hold
  and turn-on times (`tOH`, `tCLZ`), maximum release times (`tDF`, `tCHZ`), and the write
  requirements' minima. There is no typical value to simulate with.
- Between an address change and the access time the data sheets draw the outputs as **not
  valid** — the old data for `tOH`, then anything — and between a disable and its release time
  the output may still drive. A register that samples a memory too early, or a driver turning
  on before the memory lets go, is the classic breadboard bug of a memory-based design.
- A ROM has **contents** that belong to the design: they must be saved with it, and an image of
  32 KB has to live somewhere in a `.logic.json` file.

## Decision

- **Memories use their limits** (`timing.max`, `timing.min`; `timing.typical` empty): outputs
  become valid at the maximum access time from the latest of their causes (address, chip
  enable, output enable, the end of a write), keep the old data for the minimum hold time, and
  are released at the maximum release time. Designing to the guaranteed access time is what a
  designer budgets anyway. Parts sold in several speed grades take the grade as a prop
  (`speed`, the slowest by default) and their timing is a function of props (`timingOf`).
- **The `X` window**: after an address change the outputs keep the data for `tOH`, then drive
  `X` until the access time; after being enabled, they float until their turn-on time, then
  drive `X` until valid. A disabled output keeps driving what it drove until its release time,
  so a driver that turns on sooner fights it and the kernel reports the contention. The window
  is one wake-up with a generation token (as the 555's timers), so the forced evaluation of a
  recompile changes nothing.
- **RAM writes are level-sensitive**, as the data sheets draw them: under way while chip select
  and write enable are LOW, the cell taking the data present when the first of them rises. The
  write requirements (`tAS`, `tAW`, `tWP`, `tCW`, `tDW`, `tDH`, `tWR`) are checked as ADR-0014
  checks a register: a violation is reported on the pin at fault and makes the cells the write
  may have hit `X` (the old and new address for an address problem). An unknown control merges
  the data into every cell it might have written — except before the controls were first known
  after power-on, the transient every gate output starts with.
- **EEPROMs are ROMs for now**: their write cycles (byte and page writes, the self-timed cycle,
  DATA polling, software data protection) are not simulated; a write the circuit attempts is
  reported (`write-ignored`) and changes nothing.
- **ROM contents are an `image` prop** in the document, as **sparse hex runs**
  (`0000:A9FF8D 7FFC:0080`; unlisted bytes are erased, `0xFF`). Writes the circuit makes while
  simulating live in the simulator only: Reset powers on from the document again. RAM powers on
  `X` by default, or zeroed, or random from a seed taken from its designator.
- Memories describe themselves to inspectors (`ComponentDefinition.memory`: size, a view of the
  cells) and take a debug write (`poke`) that bypasses their timing.

## Consequences

- A memory sampled before its access time, or handed a bus too early, shows `X` or contention
  in the simulation, never a lucky correct byte.
- A small image stays a short line in a file and a diff shows the bytes that changed; a full
  32 KB image is 64 KB of text in one line.
- Changing an image is a prop change: a running simulation restarts that part from the new
  image with its outputs carried (ADR-0010), which R12b's inspector edits get for free.
- Speed grades multiply the timing tables to transcribe; parts sold in one grade have none.
- EEPROM programming in circuit (an Arduino-style programmer, a 6502 writing its own EEPROM)
  needs the write cycles from the backlog.

## Alternatives considered

- **Typical values, as for 74HC** — there are none; inventing them (a fraction of the maximum)
  would be unsourced.
- **Hold the old data until the access time, then switch** (the inertial model of 74HC) — a
  register latching too early would get the old byte, possibly the right one, and the bug would
  stay hidden until the board is built.
- **Release at once, or drive `X` until released** — releasing at once hides bus fights;
  driving `X` shows them as `X` without the contention diagnostic, although the output may only
  ever be the valid data or off.
- **Base64 of the whole image**, or **image files next to the document** — base64 is compact but
  opaque and as large for an empty ROM as for a full one; separate files break "one document is
  one file" (ADR-0012).
- **Writes made by the circuit go into the document** — the document would change by itself
  while simulating, and undo would mix edits with simulation.
- **EEPROM write cycles now** — moved to the backlog (R12a, Q5); none of the planned builds writes
  its EEPROMs in circuit.

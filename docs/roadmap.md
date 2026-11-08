# Roadmap

What gets built and in which order. The work is split into **tracks** — lines of work that move
in parallel, each with its own ordered items — and **milestones**, goals across tracks that say
the product has got somewhere. Why it is built: [vision.md](vision.md).

## Tracks

| Track                           | Prefix | Goal                                                        |
| ------------------------------- | ------ | ----------------------------------------------------------- |
| [Platform](roadmap/platform.md) | `PLT`  | The kernel, the circuit model, the editor, the design tools |
| [Parts](roadmap/parts.md)       | `LIB`  | Real chips and IO parts, each following its data sheet      |
| [SAP-1](roadmap/sap-1.md)       | `SAP`  | Ben Eater's SAP-1 from tested modules (M3)                  |
| [MOS 6502](roadmap/mos6502.md)  | `MOS`  | 65C02 systems with their companion chips and toolchain (M4) |

Where every track stands — its current item, what that waits for, whether its branch exists —
and the milestones' progress: `pnpm roadmap`. Item statuses live only in the track files.

## Milestones

| ID  | Milestone          | Needs                                               | Status  |
| --- | ------------------ | --------------------------------------------------- | ------- |
| M1  | "Hello, LED"       | R01, R02, R03, R04a, R04b, R05, R06, R07            | reached |
| M2  | "Tools"            | R12a, R12b, R13, R14a, R14b, R11a, R11b, R15a, R15b | reached |
| M3  | "SAP-1 runs"       | R16a, R16b                                          | open    |
| M4  | "6502 Hello World" | R17, R18, R19, R20                                  | open    |
| M5  | "My computer"      | —                                                   | open    |

### M1 "Hello, LED"

**Acceptance:** in the browser, build switch → 74HC00 → LED and clock → LED; run; the LED follows
the logic; save, reload, still works. — **Reached** (`tests/e2e/m1.spec.ts`).

### M2 "Tools"

**Acceptance:** on example circuits — a memory inspected live and programmed from a file; a bus
captured in the waveform view with a trigger and exported; a run stopped at a breakpoint and
stepped; a design built from subcircuits; a test bench with a memory setup passing in the app and
headless in CI. — **Reached** (`memory.spec.ts`, `waveforms.spec.ts`, `debugger.spec.ts`,
`subcircuits.spec.ts`, `tests.spec.ts`; `pnpm test:circuits` in CI).

### M3 "SAP-1 runs"

**Acceptance:** SAP-1 runs a program end to end; its test bench passes in CI.

### M4 "6502 Hello World"

**Acceptance:** BE6502 prints "Hello, world!" on the LCD from code assembled in the app.

### M5 "My computer"

Not a branch: the goal. The author's own 8-bit computer with a 16-bit address bus, designed and
verified in the simulator, then built. Items needed along the way get added to their tracks and
to this milestone's needs.

## How it works

**Tracks.** A track is a line of work with a goal: a file in `docs/roadmap/` and a row in the
table above with the prefix of its ids. Tracks move in parallel. A new line of work (another CPU
architecture, programmable logic, video) gets a track of its own when its first item is planned:
a file with the same parts as the others — title, goal and what does not belong in it,
`## Items`, a section per item, `## Ideas` — and a row above. A track whose items would need to
move at the same time is too wide: split it.

**Items.** An item is delivered by exactly one branch with one plan
(`.ai/plans/<branch with / → ->.md`).

- Ids are `<prefix>-<n>`, numbered within the track from 1 (`LIB-2`), and never change or get
  reused, also when an item moves or a track is split. Items from before the tracks keep their
  ids (`R00`–`R20`). An item found too big at its start is split into `LIB-2a`, `LIB-2b`, with a
  note at the top of the first part's section.
- The status is in the track's items table: `done` · `in-progress` · `next` · `planned`. The
  table is the order of the work: done items first, then at most one **head** — `next`, the one
  to start, or `in-progress` — then planned items in the intended order. A track without a head
  is idle; marking one of its items `next` resumes it.
- Within a track the order is the dependency; **Needs** names the items of other tracks that
  must be done first.
- Each item has a section `` ## <id> · <title> — `<branch>` ``: what it delivers and, once done,
  what was built, with links to the spec, the decision and the plan.
- Ideas are unnumbered bullets under `## Ideas`; promoting one gives it the track's next free id
  and a row. Ideas for tracks that don't exist yet are [below](#track-ideas).

**Milestones** are goals across tracks: the items they need, an acceptance test and a status,
`open` or `reached`. The branch that finishes a milestone's last item checks its acceptance and
marks it reached.

**Branches outside items** — `fix/`, `chore/`, `docs/` — have plans but no ids. Work asked for
between items becomes an item of its track first.

**Working in parallel.** Branches of different tracks can be open at the same time; a track has
one at a time. What keeps their merges clean:

- A branch edits its own track's file; this file changes only when tracks or milestones do.
- A head's `in-progress` lives on its branch until the merge, so `start-branch` checks that no
  other branch of the track exists.
- `finish-branch` merges `main` into the branch and runs the checks before verifying, and
  renumbers an ADR whose number another branch took meanwhile.
- `.ai/lessons.md` is append-only and merges as the union of both sides (`.gitattributes`).

**Checks.** `pnpm check:roadmap`, part of `pnpm check`, reads this file and the track files and
fails on: a track file missing or a prefix used twice; an id or a branch used twice; an id that
is neither `<prefix>-<n>` of its track nor an `R` id; an unknown status; statuses out of order or
two heads in a track; `Needs` naming an unknown item; a reached milestone with items not done; an
item row without its section or a section without its row; a done or in-progress item without
its plan file.

## Track ideas

Lines of work that get a track when their first item is planned:

- CPUs and MCUs, a track each: AVR (ATmega328P, ATtiny85), Z80, 8080/8085, 6800/6809, PIC.
- Programmable logic: GAL and CPLD (ATF22V10, ATF1504) programmed from JEDEC fuse maps — the
  address decoders of homebrew computers — and later FPGAs.
- Video output: VGA (Ben Eater's video card), composite.

## History

Until 2026-11-08 the roadmap was one ordered list in phases, each ending in a milestone:
Phase 0 — Foundation (R00); Phase 1 — Kernel & sandbox → M1 (R01–R07); Phase 2 — Building blocks
(R08–R12a); Phase 3 — Design tools → M2 (R12b, R13, R14a, R14b, R11a, R11b, R15a, R15b);
Phase 4 — SAP-1 → M3 (R16a, R16b); Phase 5 — CPU systems → M4 (R17–R20). Its items moved into
the tracks with their ids and texts ([ADR-0027](adr/0027-roadmap-tracks.md)); the notes on how
items were split or moved are at the top of the items they concern.

Phase 2 ended without its milestone: M2 was "SAP-1 modules built and verified individually".
On 2026-11-07 (R12b, Q1) the SAP-1 left the phases of tools and parts: every tool needed to
design and verify a digital device comes first (phase 3, M2 "Tools"), then the SAP-1 is built
with them — its modules as subcircuits with their own test benches (phase 4, M3), then the
6502 systems (phase 5, M4).

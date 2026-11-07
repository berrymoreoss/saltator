# Roadmap

How to read this file:

- Each **item** (`R01`, `R02`, …) is delivered by exactly **one branch** with **one plan**
  (`.ai/plans/<branch-with-slash-replaced-by-dash>.md`, e.g. `feat/engine-core` →
  `.ai/plans/feat-engine-core.md`). If an item turns out too big, split it (`R09a`, `R09b`) and
  update this file.
- **Status**: `done` · `in-progress` · `next` (exactly one item) · `planned` · `idea`.
- Agents update the status when starting (`in-progress`) and finishing (`done`, then mark the
  following item `next`). See `.ai/workflows/`.
- Order within a phase is the intended order; dependencies are listed where they are not obvious.

## Overview

| ID   | Branch                       | Title                                      | Status  |
| ---- | ---------------------------- | ------------------------------------------ | ------- |
| R00  | — (initial commit on `main`) | Foundation                                 | done    |
| R01  | `feat/engine-core`           | Simulation kernel                          | done    |
| R02  | `feat/circuit-model`         | Circuit document & netlist compiler        | done    |
| R03  | `feat/io-basic`              | Basic IO parts (headless)                  | done    |
| R04a | `feat/editor-canvas`         | App shell & schematic view                 | done    |
| R04b | `feat/editor-tools`          | Schematic editing                          | done    |
| R05  | `feat/sim-ui`                | Running simulations in the editor          | done    |
| R06  | `feat/74hc-gates`            | 74HC gates & bus buffers                   | done    |
| R07  | `feat/persistence`           | Save, load, examples                       | done    |
| R08  | `feat/74hc-msi`              | 74HC combinational MSI                     | done    |
| R09a | `feat/74hc-registers`        | 74HC flip-flops, registers + timing checks | done    |
| R09b | `feat/74hc-counters`         | 74HC counters & shift registers            | done    |
| R10a | `feat/net-labels`            | Net labels                                 | done    |
| R10b | `feat/buses`                 | Buses, rippers, bus values                 | done    |
| R12a | `feat/memory-chips`          | Memory chips (EEPROM, SRAM)                | done    |
| R12b | `feat/memory-inspector`      | Memory inspector, image files              | done    |
| R13  | `feat/logic-analyzer`        | Waveforms & probes                         | done    |
| R14a | `feat/debugger`              | Breakpoints, stepping, watches             | done    |
| R14b | `feat/rewind`                | Snapshots & rewind                         | done    |
| R11  | `feat/subcircuits`           | Hierarchical design                        | next    |
| R15  | `feat/test-benches`          | Circuit test benches ("test before fab")   | planned |
| R16a | `example/sap-1-modules`      | SAP-1 modules as tested subcircuits        | planned |
| R16b | `example/sap-1`              | Ben Eater SAP-1 reference build            | planned |
| R17  | `feat/cpu-6502`              | W65C02S CPU                                | planned |
| R18  | `feat/peripherals`           | VIA, LCD, serial, buzzer                   | planned |
| R19  | `feat/toolchain`             | 6502 assembler & flashing                  | planned |
| R20  | `example/be6502`             | Ben Eater 6502 reference build             | planned |

---

## Phase 0 — Foundation

### R00 · Foundation — `done`

Repository, tooling (Vite, TS strict, React, Vitest, Biome, CI), layered source tree with enforced
boundaries, docs (vision, architecture, simulation, components, ADRs), AI workflow (`AGENTS.md`,
`.ai/`), roadmap, plan for R01.

## Phase 1 — Kernel & sandbox → **M1 "Hello, LED"**

### R01 · Simulation kernel — `feat/engine-core` — `done`

Headless event-driven kernel per [simulation.md](simulation.md): time, 4-state levels with drive
strengths, resolution, event queue, inertial delays, delta cycles, oscillation guard, netlist +
builder, component runtime API, diagnostics (contention, floating input, oscillation), test bench.
Abstract primitives (`prim/*` gates, buffers, tri-state buffer, constant, pull resistor).
Kernel benchmark. Plan: `.ai/plans/feat-engine-core.md`.

### R02 · Circuit document & netlist compiler — `feat/circuit-model` — `done`

Document schema (components with display labels, wires) with `schemaVersion` and migrations;
geometric connectivity (union-find over grid points, T-junctions); compiler to `Netlist`; design
checks (unconnected inputs, shorted outputs, unknown types); code-first builder API for tests and
examples. Spec: [circuit.md](circuit.md). Plan: `.ai/plans/feat-circuit-model.md`.

### R03 · Basic IO parts — `feat/io-basic` — `done`

Headless behavior + symbol geometry for: VCC/GND rails, toggle switch, push button (momentary),
DIP switch bank, pull-up/pull-down resistor, LED (color prop), LED bar, clock generator
(frequency, duty cycle, manual step), 7-segment display (common anode/cathode), hex display, probe.
Symbols as data (`SymbolDef`); `prim/*` parts got gate-shaped symbols. Real contacts (SPDT /
SPST to a rail) and two-terminal LEDs ([ADR-0007](adr/0007-io-electrical-model.md)); indicator
on-time accounting for multiplexed displays. Spec: [components.md](components.md#io-parts-io).
Plan: `.ai/plans/feat-io-basic.md`.

### R04a · App shell & schematic view — `feat/editor-canvas` — `done`

R04 was split at its start into a view (R04a) and editing (R04b). Desktop CAD-style React shell
(menu bar, toolbar, Parts panel with search and preview, Properties panel, tabbed bottom dock
with Messages, status bar; fixed regions with splitters), dark and light themes following the OS,
command registry for menus/toolbar/shortcuts. Canvas2D renderer (HiDPI, grid, layers, culling),
camera pan/zoom (Figma-style with a KiCad-style wheel setting), symbol renderers keyed by
`symbol.kind` (gates in ANSI or IEC style, LEDs, switches, displays), generic DIP renderer,
designator and label placement, selection (click, box), design-check messages with
click-to-locate, demo documents (Hello LED, symbol gallery), Playwright browser tests in CI.
Spec: [editor.md](editor.md). Decision: [ADR-0008](adr/0008-desktop-workbench.md). Plan:
`.ai/plans/feat-editor-canvas.md`.

### R04b · Schematic editing — `feat/editor-tools` — `done`

Sticky place tool armed from the Parts panel (or drag-and-drop) with a ghost and R/F before
placing; designator prefixes in part definitions (KiCad/IEEE: `U`, `R`, `SW`, `D`, `DS`, `X`,
`TP`, `PWR`), lowest free number; Wire tool (click corners, L preview, Tab swaps the bend) and
wires dragged out of pin tips, with connection marks; drag-move, rotate, flip, delete and nudges
with rubber-banded wires; wires normalized into straight runs without changing connectivity;
cut/copy/paste through the system clipboard as document text, floating paste and duplicate;
snapshot undo/redo with labels and recorded renames; editable Properties (designator with
validation, label, placement, every prop type, times with units); context menu, Edit and Place
menus, status hints. Gestures run on plain `PointerInput`s and are unit-tested headless.
Spec: [editor.md](editor.md#editing). Decision: [ADR-0009](adr/0009-editing-model.md). Plan:
`.ai/plans/feat-editor-tools.md`.

### R05 · Running simulations in the editor — `feat/sim-ui` — `done`

Simulator host in the editor (`Simulation`): stopped until Run; run/pause, step to the next
event, stop, reset (F5, F10, Shift+F5, Mod+Shift+F5, never reloading the page); speed presets
from 1 ns/s to real time and Max with a frame budget and the speed reached shown when lagging.
Wires and junctions colored by level (weak levels paler, contention flashing) in both themes;
parts drawn from their live state, indicators at their average brightness from on-time; an
Interact tool (switches, held buttons, DIP switches in any orientation, manual clock step).
Editing while running: same-structure edits keep the simulator, others continue in the
recompiled netlist with every unchanged part's state, drives, pending changes and timers carried
by designator through renames (`Simulator.carryOver`, invisible for an unchanged netlist — a
property test). Simulation tab with runtime diagnostics and click-to-locate; live levels in
Properties. Spec: [editor.md](editor.md#simulation). Decision:
[ADR-0010](adr/0010-running-simulations.md). Plan: `.ai/plans/feat-sim-ui.md`.

### R06 · 74HC gates & bus buffers — `feat/74hc-gates` — `done`

74HC00, 02, 04, 08, 10, 11, 14, 20, 21, 27, 30, 32, 86 (gates), 125, 126, 240, 244 (3-state
buffers) and 245 (bus transceiver) from the Nexperia data sheets: pinouts with pin
descriptions, units, function tables as definition data, timing (`tpd`, `ten`, `tdis`) at
4.5 V / 50 pF citing document, revision and table; function shared per chip number, timing per
logic family. Tests check every function table through physical pin numbers, every delay and
unknown/floating inputs; the carry-over property runs random 74xx networks; a bus scenario shows
contention, the 1 ns fight of a same-instant handover and the 245 both ways. A Part tab in the
bottom dock (drawing, pins with descriptions, function table, datasheet link) follows the part
picked last; Hello, LED runs on a 74HC00. Spec: [components.md](components.md#74xx-chips-74xx).
Decision: [ADR-0011](adr/0011-real-chips.md). Plan: `.ai/plans/feat-74hc-gates.md`.

### R07 · Save, load, examples — `feat/persistence` — `done`

`.logic.json` files: New, Open, Save, Save As through the File System Access API in Chromium
(Save writes back through the file's handle) and a file input / download elsewhere; Open
Recent; a dropped file opens; "Save changes?" before replacing unsaved changes (opening is no
longer an undoable edit); the name and an unsaved mark in the title and the menu bar. The
session — unsaved changes, file and view — is autosaved to IndexedDB (and synchronously on
unload) and restored after a reload, per browser tab. Example files in `examples/` (Hello, LED,
Half Adder, SR Latch, Ring Oscillator; Biome ignores `*.logic.json`), kept canonical and run by
tests; File ▸ New from Example… shows them with live thumbnails. Spec:
[editor.md](editor.md#files). Decision: [ADR-0012](adr/0012-files-and-sessions.md). Plan:
`.ai/plans/feat-persistence.md`.

**M1 acceptance:** in the browser, build switch → 74HC00 → LED and clock → LED; run; the LED follows
the logic; save, reload, still works. — **Reached** (`tests/e2e/m1.spec.ts`).

## Phase 2 — Building blocks

### R08 · 74HC combinational MSI — `feat/74hc-msi` — `done`

74HC85, 138, 139, 147, 148, 151, 153, 157, 158, 283 and 4511 from the Nexperia data sheets, and
from TI where Nexperia has none (147, 148, 283; typical delays of the 147 and 283 from the
Philips sheets): one delay per data sheet path (`tpd(An to Yn)`, the longest changed path wins),
4-state results as precise as cheap, the 4511 as the first stateful chip; exhaustive tests for
283, 85 and 4511, cascades (two 85s, two 148s). Behavioral NE555 (`timer/ne555`, TI pinout):
astable, monostable and bistable modes, RA, RB, C as props with SI-prefixed entry, the RC
network's pins drawn but not simulated, `X` until the first trigger or reset. Pin labels (the
151's `Y̅`), changeover switch contacts (`spdt-gnd`), wider DIP bodies for crowded pin names.
Examples: BCD to 7-Segment and Ben Eater's Clock Module. Spec:
[components.md](components.md#74xx-chips-74xx), [timers](components.md#timers-timer). Decision:
[ADR-0013](adr/0013-behavioral-timer.md). Plan: `.ai/plans/feat-74hc-msi.md`.

R09 (74HC sequential parts + timing checks) was split at its start into flip-flops and
registers with the timing checks (R09a) and counters and shift registers (R09b).

### R09a · 74HC flip-flops, registers + timing checks — `feat/74hc-registers` — `done`

74HC74, 107, 109, 112 (flip-flops) and 173, 175, 273, 374, 377, 574 (registers) from the
Nexperia data sheets, on two engines (`FlipFlopSpec`, `RegisterSpec`): `X` until reset or
loaded, uncertain clock edges `X` only where they could change a bit, set and reset together as
each data sheet says. Timing checks in core (`TimingChecks`: set-up, hold, pulse width,
recovery) against the guaranteed minima at 25 °C in `timing.min`; a violation is an error in the
Simulation tab and makes the bits the edge may have loaded `X`, armed only while the clock
matters. The 74HC4511 checks its LE. Sequential function tables (`↑`, `h`, `q̅`); the Part tab
shows a chip's delays and minima. Example: Ben Eater's A register (two 173s, two 245s, a bus).
Spec: [components.md](components.md#edge-triggered-chips),
[simulation.md](simulation.md#timing-checks). Decision:
[ADR-0014](adr/0014-timing-checks.md). Plan: `.ai/plans/feat-74hc-registers.md`.

### R09b · 74HC counters & shift registers — `feat/74hc-counters` — `done`

74HC161, 163 (synchronous counters), 191, 193 (up/down, asynchronous parallel load), 4040
(12-stage ripple counter: each output one stage delay after the one below, so decoding gates
see the intermediate counts), 164, 165, 595 (shift registers; the 595's storage register one
pulse behind when both clocks are tied, as its data sheet says) from the Nexperia data sheets, on
R09a's timing checks and `X` policy: unknown or late controls merge every mode they allow;
the data sheets' prose usage rules (191 CE̅ and U̅/D, 193's other clock) checked like timing
requirements. `TimingChecks.setupHold` got edge-to-edge and hold-only forms. Pin labels are
overlined as the data sheets draw them — letters, not digits (`1R̅D̅`, `E̅1`), labels can mark
exceptions (`U̅/D`, `Q̅0̅`). Examples: Shift Register LEDs (a self-running Johnson counter) and
Ben Eater's Program Counter. Spec: [components.md](components.md#counters-and-shift-registers).
Plan: `.ai/plans/feat-74hc-counters.md`.

R10 (net labels, tunnels, buses) was split at its start into net labels (R10a) and buses
(R10b). Junction dots, also listed for R10, are derived and drawn since R02/R04a; "tunnel" is
Logisim's name for a net label.

### R10a · Net labels — `feat/net-labels` — `done`

Net labels (`net/label`; KiCad's net label, Logisim's tunnel): a flag with a name and one
connection point; every label of one name is one net across the circuit, so blocks connect
without wires running between them. Schematic-only parts (`schematicOnly`: drawn and connected,
left out of the netlist, so a label that joins nothing new keeps a running simulation as it
is); joining by name is a pin property (`PinDef.net`), which also puts every VCC and GND symbol
on the nets `VCC` and `GND`. A named net is called by its name everywhere; design warnings for
a net with several names and a label nothing else uses. Names with KiCad's `~{…}` overline,
`[ ]` kept for buses. Drawn as an outlined tag, `centered` on its pin's row so labels stack on
adjacent DIP pins, its outline in the net's color while running; placed by its point, each named
after the last (`D0` → `D1`, `nextProps`). The Place menu and the canvas Place submenu (Power,
Ground, Pull-up, Pull-down, Wire, Net Label `L`, Find Part); open pins found by what touches
them. Example: Net Labels. Spec: [circuit.md](circuit.md#connectivity),
[components.md](components.md#net-labels-net). Decision: [ADR-0015](adr/0015-net-labels.md).
Plan: `.ai/plans/feat-net-labels.md`.

### R10b · Buses, rippers, bus values — `feat/buses` — `done`

Buses as KiCad has them: a bus is a group of ordinary nets named by its members (`D[0..7]` →
`D0`…`D7`; names with indices 0…99 either way round), so the kernel and the netlist don't
change. Bus lines (`Wire.bus`, document schema v2 with an identity migration) and bus pins
(`PinDef.bus`) are a second connectivity layer that never touches wires: a wire ending on a bus
is dangling ("use a bus entry"); bus junction dots only where bus lines meet. A net label named
like a bus is a bus label; `net/bus-entry` (KiCad's 45° entry, `BE`, `Z`) carries its member's
name and joins it like a label, placed by its bit end so clicking down a chip's data pins gives
`D0`…`D7`. Checks `bus-entry-member`, `multiple-net-names` on buses, `single-net-label` for
entries. Bus lines heavy in a bus color, `X`/`Z` when members are; the value (`0x3F`, `X`/`Z`
nibbles) on bus labels while simulating; Properties lists a bus's bits with hex, binary and
decimal. The Bus tool (`B`), buses dragged out of bus pins, rubber-banding and normalization per
layer. Example: Data Bus (74HC245 → bus → 74HC574 → LEDs). Spec:
[circuit.md](circuit.md#buses), [components.md](components.md#net-labels-net). Decision:
[ADR-0016](adr/0016-buses.md). Plan: `.ai/plans/feat-buses.md`.

R11 (hierarchical design) was moved after R14 on 2026-11-07, keeping its id: memory, waveforms
and the debugger are useful on the flat circuits that net labels and buses already make
workable, and the SAP-1 modules need R12's chips anyway; hierarchy lands right before the test
benches and the full SAP-1 build, which need it most.

R12 (ROM / RAM + memory inspector) was split at its start into the chips with their contents
(R12a) and the inspector with image files (R12b). The 74LS189 went to the backlog with the 74LS
family (TTL inputs, no current data sheet); the SAP-1's RAM is built on a 6116 or 62256.

### R12a · Memory chips — `feat/memory-chips` — `done`

AT28C16, AT28C64B, AT28C256 (EEPROMs, read as ROMs for now: a write the circuit attempts is
reported) from the Atmel/Microchip data sheets, the 6116 (Renesas, speed grades 15/20/25 ns as a
prop) and the 62256 (Alliance AS6C62256-55) SRAMs: the data sheets' guaranteed limits (no typical
values exist), reads that keep the old data for `tOH`, show `X` until the access time and keep
driving until their release time (a driver turning on sooner fights them), level-sensitive RAM
writes checked against `tAS`, `tAW`, `tWP`, `tCW`, `tDW`, `tDH`, `tWR` (`X` where a violation may
have written). ROM contents in the document (an `image` prop in sparse hex runs), RAM powering on
`X`, zeros or random (seeded by the designator); a memory view (`ComponentDefinition.memory`) and
a debug write (`poke`) for the inspector and test benches; timing as a function of props. The
Part tab shows limits-only timing. Examples: EEPROM 7-Segment Decoder, RAM by Hand. Spec:
[components.md](components.md#memories-mem). Decision: [ADR-0017](adr/0017-memories.md). Plan:
`.ai/plans/feat-memory-chips.md`.

Phase 2 ended without its milestone: M2 was "SAP-1 modules built and verified individually".
On 2026-11-07 (R12b, Q1) the SAP-1 left the phases of tools and parts: every tool needed to
design and verify a digital device comes first (phase 3, M2 "Tools"), then the SAP-1 is built
with them — its modules as subcircuits with their own test benches (phase 4, M3), then the
6502 systems (phase 5, M4).

## Phase 3 — Design tools → **M2 "Tools"**

### R12b · Memory inspector, image files — `feat/memory-inspector` — `done`

The Memory tab: a virtualized hex view of any memory of the circuit (8/16/32 cells a row,
ASCII, `X` nibbles), live while simulating — cells read since the last frame lit green, written
orange, from per-cell access stamps the parts keep (`readAt`, `writtenAt`), the address on the
chip's pins (`MemoryDef.addressPins`) outlined and followed — with bytes typed in place: a ROM's
image as an undoable, coalesced document edit (a running ROM follows), a simulated RAM poked.
`.bin` and Intel HEX (records 00–05, checksums, errors with lines) read, placed and written in
`core`; the programmer is the Load dialog (range, bytes, sum; load address, fill the rest with
FF), with Save and Erase. One resolver (`circuit`) turns `U5`, `U5.A0`, `CLK`, `D[0..7]` into
netlist ids for the inspector and later probes, watches, breakpoints and benches; R11 adds
instance paths there. RAMs stay volatile (Q2): a test bench's setup loads them before t = 0
(R15). The roadmap was reordered at its start: design tools first (M2 "Tools"), then the SAP-1
(R16a, R16b). Spec: [editor.md](editor.md#memory-inspector),
[components.md](components.md#image-files), [circuit.md](circuit.md#resolver). Decision:
[ADR-0018](adr/0018-memory-inspector.md). Plan: `.ai/plans/feat-memory-inspector.md`.

### R13 · Waveforms & probes — `feat/logic-analyzer` — `done`

The Waveforms tab: probes — nets, pins, buses and groups of single signals, by the resolver's
references — saved in the circuit (`Circuit.probes`, schema v3, Q1), added from the canvas with
a Probe tool (`P`, Q4) or the context menu, or typed; only they are recorded (core `Recorder`,
one level per instant, bounded, re-attached by reference after every carry-over, Q2). A Canvas2D
timing diagram: 1-bit rows in the wires' level colors, buses and groups as values in hex,
decimal, binary or ASCII (`X` nibbles), dense blocks where edges are closer than a pixel; fit,
follow and free views with zoom and pan; cursors A and B snapping to edges (`[`/`]`, `{`/`}`)
with Δt and frequency. A single-shot trigger (levels and bus values ANDed with one strict
edge, evaluated once an instant settles) breaks the kernel at its instant
(`Simulator.requestBreak`, `onInstant`); the run goes on for the post-trigger part of the
window (`Simulation.pauseAt`) and pauses (Q3). Export VCD… (core `writeVcd`) of the whole
record or the cursor span. Probes ship with Clock Module and Data Bus. Spec:
[editor.md](editor.md#waveforms), [simulation.md](simulation.md#recorder). Decision:
[ADR-0019](adr/0019-waveforms.md). Plan: `.ai/plans/feat-logic-analyzer.md`.

R14 (breakpoints, stepping, watches, run statistics, snapshot & rewind) was split at its start
into the debugger (R14a) and stepping backwards (R14b): rewind needs the whole kernel state
saved and restored, user actions replayed, and the recorder and the memory inspector kept in
step — a layer of its own on top of R14a's stepping and breakpoints.

### R14a · Breakpoints, stepping, watches — `feat/debugger` — `done`

The Debug tab: breakpoints on any signal — the trigger's terms (edges, levels, bus and group
values) as repeating core triggers on a recorder of their own, hit counts, enable/disable — and
breaks on every error or warning the simulation reports (`DiagnosticLog.onOccurrence`); the host
pauses on requests with a reason that wins over a trigger's run-on (`requestPause`,
`status.reason`). Steps run at Max as jumps (`Simulation.runTo`): **Step Clock** (`F8`) pauses
right before the step clock's next active edge but one, the cycle settled, through a kernel
lookahead (`stopBefore`; `io/clock` now schedules its edges a phase ahead), and gives a manual
clock one pulse and one period (Ben Eater's step button); **Run For** (`Shift+F8`) and **Run
To**. Watches of signals, groups and memory cells (`U5[1F]` in the resolver) marked when they
changed since the last stop; a Watch button in the Memory tab; context-menu Break When … Rises,
Add Breakpoint on …, Watch …; run statistics and the most active nets (measured on request) in
the Simulation tab. The debug setup is kept with the session, not the file (Q2). Fixes on the
way: `runUntil(NaN)` looped forever; a trigger never fires twice at one instant; a fresh
recorder channel records its first level 1 ps early. Spec: [editor.md](editor.md#debugger),
[simulation.md](simulation.md#running). Decision: [ADR-0020](adr/0020-debugger.md). Plan:
`.ai/plans/feat-debugger.md`.

### R14b · Snapshots & rewind — `feat/rewind` — `done`

Snapshot and restore of the whole simulator (`Simulator.snapshot`/`restore`): levels, drives,
contention, pending changes, the event queue with its seq counter, component states — frozen
plain data in 4 KiB pages shared with the previous snapshot, restored into the live objects —
and the diagnostics; replicas of a simulator to replay in. The host's timeline: checkpoints
every 200K events within 64 MiB (thinned, then the start moves), a log of the user's actions,
positions (a time and the actions delivered), so any instant since power-on or the last
structural edit is reached again in a replica the tools don't watch. Step Back (`Alt+F10`),
Step Back Clock (`Alt+F8`), Reverse Continue to the previous breakpoint hit or error (`Alt+F5`)
as backward searches over the history; Run To a past time; Go to Present; a click or drag in
the waveforms' ruler. Behind the present, forward runs replay the recording (Q1) and the
waveforms veil the future; acting there starts a new future; an edit starts the history anew
(Q2). The recorder seeks and confirms, triggers resync, breakpoint hits follow by time, the
memory inspector's highlights restart. Property test: a rewound simulation is the straight run
on every example and every part. Spec: [simulation.md](simulation.md#snapshots),
[editor.md](editor.md#rewinding). Decision: [ADR-0021](adr/0021-rewind.md). Plan:
`.ai/plans/feat-rewind.md`.

### R11 · Hierarchical design — `feat/subcircuits` — `next`

Multiple circuits per project, subcircuit instances with generated or custom symbols, navigation
into instances while simulating. A subcircuit's interface pins (ports) join the Place menu (R10a).
Extends the part and net resolver (R12b) with instance paths, so the memory inspector, probes,
watches and breakpoints reach into instances, and test benches (R15) can test a subcircuit as a
unit.

### R15 · Circuit test benches — `feat/test-benches`

Test vectors (table of inputs/expected outputs over time) and scripted benches for user circuits;
run in the app and headless (Node/CI); pass/fail report. The core of "test before fab". A
bench's setup runs like an init script before the simulation starts and loads memories (a RAM's
program, a ROM image from a file), through R12b's image formats and `poke` (R12b, Q2).

**M2 acceptance:** on example circuits — a memory inspected live and programmed from a file; a
bus captured in the waveform view with a trigger and exported; a run stopped at a breakpoint and
stepped; a design built from subcircuits; a test bench with a memory setup passing in the app
and headless in CI.

## Phase 4 — SAP-1 → **M3 "SAP-1 runs"**

### R16a · SAP-1 modules — `example/sap-1-modules`

Ben Eater's SAP-1 modules, each a subcircuit with its own test bench: clock, A and B registers,
ALU, program counter, RAM and memory address register (on a 6116 or 62256), output register
with its multiplexed EEPROM decoder. The existing Clock Module, SAP-1 A Register and SAP-1
Program Counter examples are redone as subcircuits.

### R16b · SAP-1 reference build — `example/sap-1`

Full Ben Eater 8-bit computer from R16a's modules (control logic with microcode EEPROMs,
7-segment output), with a test bench whose setup loads a demo program into the RAM and checks
what it outputs.

**M3 acceptance:** SAP-1 runs a program end to end; its test bench passes in CI.

## Phase 5 — CPU systems → **M4 "6502 Hello World"**

### R17 · W65C02S CPU — `feat/cpu-6502`

Pin-level, cycle-accurate 65C02 (PHI2, RWB, A0–A15, D0–D7, IRQB, NMIB, RESB, RDY, SYNC), CPU state
panel, disassembly in the memory inspector.

### R18 · Peripherals — `feat/peripherals`

W65C22 VIA (ports, timers, interrupts), HD44780 16×2 LCD, 6551 ACIA + serial terminal panel,
buzzer (Web Audio), keypad/matrix keyboard.

### R19 · 6502 assembler & flashing — `feat/toolchain`

Built-in assembler (ca65/vasm-compatible subset), listing and symbol map, "assemble & flash to
ROM", symbols in debugger.

### R20 · Ben Eater 6502 reference build — `example/be6502`

65C02 + 28C256 + 62256 + 65C22 + LCD with 74HC00 address decoding, running "Hello, world!".

**M4 acceptance:** BE6502 prints "Hello, world!" on the LCD from code assembled in the app.

## M5 — "My computer"

Not a branch: the goal. The author's own 8-bit computer with a 16-bit address bus, designed and
verified in the simulator, then built. Items needed along the way get added to this roadmap.

## Backlog — `idea`

Promote to a numbered item when needed.

- Symbol view: Proteus/KiCad-style multi-unit symbols (U1A…), hidden power pins, per-part toggle.
- Simulation in a Web Worker with SharedArrayBuffer levels; fast mode for synchronous designs.
- Seeded random power-on state as a simulator option (default stays `X`; decided in R01, Q2).
- Contact bounce for buttons and switches (deterministic pattern), to catch missing debouncing
  before fab (R03 switches change cleanly).
- Bussed resistor network part (SIP-9: 8 pull resistors with a common pin) for DIP switch banks
  and buses.
- Design checks: unconnected power pins, fan-out/load limits, worst-case timing corner.
- More CPUs/MCUs: Z80, 8080/8085, 6800/6809, AVR (ATmega328P, ATtiny85), PIC.
- Video output: VGA (Ben Eater's video card), composite.
- Export: KiCad netlist, BOM, SVG/PDF schematic; breadboard layout view.
- Sharing via URL, embed mode, PWA/offline, desktop packaging.
- Editing extras (R04b follow-ups): editing a prop of several selected parts at once, re-annotate
  designators, align/distribute, wire auto-routing around parts, a modifier to move parts without
  dragging their wires (KiCad "move"), dragging a single wire end.
- Worst-case timing mode (R09a follow-up): the recorded `max` delays with the −40 °C to +85 °C
  minima (not recorded yet: add them as a third requirement column); a "report only" setting
  that keeps bits known after a timing violation, if `X` gets in the way.
- More logic families (R06 follow-up): 74HCT and 74AC as timing tables for the existing chip
  specs; 74LS/74F also need TTL inputs (a floating input reads high). The 74LS189 (16 × 4 RAM,
  inverted 3-state outputs; Ben Eater's SAP-1 RAM) comes with them (R12a, Q2); its data sheet
  is the archived Fairchild DM74LS189.
- EEPROM writes from the circuit (R12a follow-up): byte and page writes, the self-timed write
  cycle with DATA polling and toggle bit, the power-on write delay and noise filter, software
  data protection (AT28C64B/256). Until then an EEPROM is a ROM and a write attempt is reported.
- Kernel: mark the forced evaluation (power-on, after a recompile) so multi-section chips can
  re-evaluate only the sections whose inputs changed (a 74HC04 chain runs at ≈ 8.4M events/s
  against ≈ 13.2M for `prim/not`, R06).
- Simulation view extras (R05 follow-ups): LED colors that stay visible on the light theme's
  cream when dim (a dim yellow LED is hard to see); a "toggling" wire style for nets that change
  faster than the frame rate, which now flicker between 0 and 1 from frame to frame.
- Passive parts (R08 follow-up): resistors, capacitors and potentiometers drawn on the schematic
  but not simulated (BOM, breadboard view), a 555 reading its R and C from them, and turning a
  potentiometer with the Interact tool (Ben's clock speed knob); a read-only hint of a 555's
  resulting frequency in Properties. CMOS 555s (TLC555, ICM7555) and the 556 with the same model.
- Bus follow-ups (R10b): a multi-bit ripper (one part fanning a bus out to N adjacent pins);
  a radix setting for bus values (decimal, binary on the canvas); KiCad group buses (`{A B}`)
  and bus aliases if ever needed.
- Net highlighting (R10a follow-up): selecting or hovering a wire or net label highlights every
  wire and label of its net, across labels.
- Placing VCC/GND symbols by their pin (R10a follow-up), as net labels are placed, so a click on
  a pin tip attaches one; other one-pin parts may follow.
- Image generators (R12b follow-up): a memory's contents computed by a short script in the app
  (Ben Eater's Arduino sketch for the decoder EEPROM, microcode tables), kept with the document.
- Waveform follow-ups (R13): serial protocol decoders (UART, SPI, I²C) on probed signals;
  automatic measurements (period, duty cycle, pulse count over a range); VCD import (a dump from
  another simulator beside the circuit's); weak levels drawn paler (the recorder keeps levels
  only); probed wires marked on the canvas; the diagram as SVG/PDF; recording every net in a
  bounded buffer as an option, if probing before running proves a chore (R13, Q2).
- Debugger follow-ups (R14a): breakpoints on memory accesses (break when `U5[0x0F]` is written
  or read; with R17, on the CPU's program counter and instructions); log points (report instead
  of pausing); breakpoint and watch marks on the canvas; break on chosen diagnostic kinds
  rather than all errors or warnings; a shared end-of-instant listener for many breakpoints
  (each costs ≈ 15 % on a ring of 1-instant events now); Step Clock by a gated manual clock (a
  manual `io/clock` driving the net through gates is not recognized and has no edge coming).
- Rewind follow-ups (R14b): bookmarks — snapshots the user takes and names, kept beyond the
  history's reach and marked on the ruler (Q3); re-running the past with an edited circuit and
  the same inputs ("what if", Q2); hit counts in Reverse Continue; the history's start marked on
  the waveforms' ruler.
- Documents (R07 follow-ups): several documents open in one window (tabs); a title, notes and
  simulation settings (speed) stored in the file (schema v2).

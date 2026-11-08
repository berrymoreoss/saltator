# Platform

Track `PLT` of the [roadmap](../roadmap.md).

**Goal:** the simulator itself — the event-driven kernel and the circuit model, the schematic
editor, and the tools that show what a design does and prove that it works: memory inspector,
waveforms, debugger, rewind, test benches. M1 "Hello, LED" and M2 "Tools" were reached here.

**Not here:** parts ([Parts](parts.md)); the computers built with the platform and the CPUs they
need (their own tracks). A tool only one architecture needs (a CPU state panel, a serial
terminal) comes with that architecture's item.

## Items

| ID    | Branch                       | Title                                     | Needs | Status      |
| ----- | ---------------------------- | ----------------------------------------- | ----- | ----------- |
| R00   | —                            | Foundation                                | —     | done        |
| R01   | `feat/engine-core`           | Simulation kernel                         | —     | done        |
| R02   | `feat/circuit-model`         | Circuit document & netlist compiler       | —     | done        |
| R04a  | `feat/editor-canvas`         | App shell & schematic view                | —     | done        |
| R04b  | `feat/editor-tools`          | Schematic editing                         | —     | done        |
| R05   | `feat/sim-ui`                | Running simulations in the editor         | —     | done        |
| R07   | `feat/persistence`           | Save, load, examples                      | —     | done        |
| R10a  | `feat/net-labels`            | Net labels                                | —     | done        |
| R10b  | `feat/buses`                 | Buses, rippers, bus values                | —     | done        |
| R12b  | `feat/memory-inspector`      | Memory inspector, image files             | —     | done        |
| R13   | `feat/logic-analyzer`        | Waveforms & probes                        | —     | done        |
| R14a  | `feat/debugger`              | Breakpoints, stepping, watches            | —     | done        |
| R14b  | `feat/rewind`                | Snapshots & rewind                        | —     | done        |
| R11a  | `feat/subcircuits`           | Subcircuits                               | —     | done        |
| R11b  | `feat/subcircuit-navigation` | Navigation into instances                 | —     | done        |
| R15a  | `feat/test-benches`          | Test benches: scripts and headless runner | —     | done        |
| R15b  | `feat/test-bench-ui`         | Test benches in the app                   | —     | done        |
| PLT-1 | `feat/schematic-text`        | Schematic text                            | —     | in-progress |

## R00 · Foundation

Repository, tooling (Vite, TS strict, React, Vitest, Biome, CI), layered source tree with enforced
boundaries, docs (vision, architecture, simulation, components, ADRs), AI workflow (`AGENTS.md`,
`.ai/`), roadmap, plan for R01.

## R01 · Simulation kernel — `feat/engine-core`

Headless event-driven kernel per [simulation.md](../simulation.md): time, 4-state levels with drive
strengths, resolution, event queue, inertial delays, delta cycles, oscillation guard, netlist +
builder, component runtime API, diagnostics (contention, floating input, oscillation), test bench.
Abstract primitives (`prim/*` gates, buffers, tri-state buffer, constant, pull resistor).
Kernel benchmark. Plan: `.ai/plans/feat-engine-core.md`.

## R02 · Circuit document & netlist compiler — `feat/circuit-model`

Document schema (components with display labels, wires) with `schemaVersion` and migrations;
geometric connectivity (union-find over grid points, T-junctions); compiler to `Netlist`; design
checks (unconnected inputs, shorted outputs, unknown types); code-first builder API for tests and
examples. Spec: [circuit.md](../circuit.md). Plan: `.ai/plans/feat-circuit-model.md`.

## R04a · App shell & schematic view — `feat/editor-canvas`

R04 was split at its start into a view (R04a) and editing (R04b). Desktop CAD-style React shell
(menu bar, toolbar, Parts panel with search and preview, Properties panel, tabbed bottom dock
with Messages, status bar; fixed regions with splitters), dark and light themes following the OS,
command registry for menus/toolbar/shortcuts. Canvas2D renderer (HiDPI, grid, layers, culling),
camera pan/zoom (Figma-style with a KiCad-style wheel setting), symbol renderers keyed by
`symbol.kind` (gates in ANSI or IEC style, LEDs, switches, displays), generic DIP renderer,
designator and label placement, selection (click, box), design-check messages with
click-to-locate, demo documents (Hello LED, symbol gallery), Playwright browser tests in CI.
Spec: [editor.md](../editor.md). Decision: [ADR-0008](../adr/0008-desktop-workbench.md). Plan:
`.ai/plans/feat-editor-canvas.md`.

## R04b · Schematic editing — `feat/editor-tools`

Sticky place tool armed from the Parts panel (or drag-and-drop) with a ghost and R/F before
placing; designator prefixes in part definitions (KiCad/IEEE: `U`, `R`, `SW`, `D`, `DS`, `X`,
`TP`, `PWR`), lowest free number; Wire tool (click corners, L preview, Tab swaps the bend) and
wires dragged out of pin tips, with connection marks; drag-move, rotate, flip, delete and nudges
with rubber-banded wires; wires normalized into straight runs without changing connectivity;
cut/copy/paste through the system clipboard as document text, floating paste and duplicate;
snapshot undo/redo with labels and recorded renames; editable Properties (designator with
validation, label, placement, every prop type, times with units); context menu, Edit and Place
menus, status hints. Gestures run on plain `PointerInput`s and are unit-tested headless.
Spec: [editor.md](../editor.md#editing). Decision: [ADR-0009](../adr/0009-editing-model.md). Plan:
`.ai/plans/feat-editor-tools.md`.

## R05 · Running simulations in the editor — `feat/sim-ui`

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
Properties. Spec: [editor.md](../editor.md#simulation). Decision:
[ADR-0010](../adr/0010-running-simulations.md). Plan: `.ai/plans/feat-sim-ui.md`.

## R07 · Save, load, examples — `feat/persistence`

`.logic.json` files: New, Open, Save, Save As through the File System Access API in Chromium
(Save writes back through the file's handle) and a file input / download elsewhere; Open
Recent; a dropped file opens; "Save changes?" before replacing unsaved changes (opening is no
longer an undoable edit); the name and an unsaved mark in the title and the menu bar. The
session — unsaved changes, file and view — is autosaved to IndexedDB (and synchronously on
unload) and restored after a reload, per browser tab. Example files in `examples/` (Hello, LED,
Half Adder, SR Latch, Ring Oscillator; Biome ignores `*.logic.json`), kept canonical and run by
tests; File ▸ New from Example… shows them with live thumbnails. Spec:
[editor.md](../editor.md#files). Decision: [ADR-0012](../adr/0012-files-and-sessions.md). Plan:
`.ai/plans/feat-persistence.md`.

## R10a · Net labels — `feat/net-labels`

R10 (net labels, tunnels, buses) was split at its start into net labels (R10a) and buses
(R10b). Junction dots, also listed for R10, are derived and drawn since R02/R04a; "tunnel" is
Logisim's name for a net label.

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
them. Example: Net Labels. Spec: [circuit.md](../circuit.md#connectivity),
[components.md](../components.md#net-labels-net). Decision: [ADR-0015](../adr/0015-net-labels.md).
Plan: `.ai/plans/feat-net-labels.md`.

## R10b · Buses, rippers, bus values — `feat/buses`

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
[circuit.md](../circuit.md#buses), [components.md](../components.md#net-labels-net). Decision:
[ADR-0016](../adr/0016-buses.md). Plan: `.ai/plans/feat-buses.md`.

## R12b · Memory inspector, image files — `feat/memory-inspector`

R12 was split at its start; its first half, R12a (the memory chips), is in the
[Parts](parts.md) track.

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
(R16a, R16b). Spec: [editor.md](../editor.md#memory-inspector),
[components.md](../components.md#image-files), [circuit.md](../circuit.md#resolver). Decision:
[ADR-0018](../adr/0018-memory-inspector.md). Plan: `.ai/plans/feat-memory-inspector.md`.

## R13 · Waveforms & probes — `feat/logic-analyzer`

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
[editor.md](../editor.md#waveforms), [simulation.md](../simulation.md#recorder). Decision:
[ADR-0019](../adr/0019-waveforms.md). Plan: `.ai/plans/feat-logic-analyzer.md`.

## R14a · Breakpoints, stepping, watches — `feat/debugger`

R14 (breakpoints, stepping, watches, run statistics, snapshot & rewind) was split at its start
into the debugger (R14a) and stepping backwards (R14b): rewind needs the whole kernel state
saved and restored, user actions replayed, and the recorder and the memory inspector kept in
step — a layer of its own on top of R14a's stepping and breakpoints.

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
recorder channel records its first level 1 ps early. Spec: [editor.md](../editor.md#debugger),
[simulation.md](../simulation.md#running). Decision: [ADR-0020](../adr/0020-debugger.md). Plan:
`.ai/plans/feat-debugger.md`.

## R14b · Snapshots & rewind — `feat/rewind`

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
on every example and every part. Spec: [simulation.md](../simulation.md#snapshots),
[editor.md](../editor.md#rewinding). Decision: [ADR-0021](../adr/0021-rewind.md). Plan:
`.ai/plans/feat-rewind.md`.

## R11a · Subcircuits — `feat/subcircuits`

R11 (hierarchical design) was moved after R14 on 2026-11-07, keeping its id: memory, waveforms
and the debugger are useful on the flat circuits that net labels and buses already make
workable, and the SAP-1 modules need R12's chips anyway; hierarchy lands right before the test
benches and the full SAP-1 build, which need it most.

R11 (hierarchical design) was split at its start into the hierarchy itself (R11a) and going
into instances while simulating (R11b): the compiler, the document model, editing several
circuits and the tools' instance paths are one layer; live levels, interaction and probing
inside an instance build on it.

Several circuits per document, the first one the top circuit that simulates; subcircuit
instances (`sub/<circuit id>`, designators `A1`, …) with a generated box symbol whose pins are
the circuit's ports (`net/port`: name, direction, side; bus ports), ordered as the ports are
drawn. The compiler flattens the hierarchy into the kernel's flat netlist with instance paths
(`A1/U3`); net labels join only within their circuit, the power names everywhere. The resolver
(R12b) takes instance paths (`A1/U3.Q0`, `A1/CLK`, `A1/U5[1F]`), so the memory inspector,
probes, watches and breakpoints reach into instances, and test benches (R15a) can test a
subcircuit as a unit. Schema v4 (circuit ids are slugs, following the name until placed); a
document registry generating `sub/<id>` definitions; checks `duplicate-port`,
`recursive-subcircuit`, `bus-port-width`. The editor holds the whole document (one undo history,
a camera per circuit, flat renames for carry-over); the simulation runs the flattened top
circuit, drawn live only where it is the circuit open. A CIRCUITS list above Parts and a Circuit
menu, subcircuits in the Parts panel (never one that would contain the open circuit),
double-click to open an instance's circuit, Place ▸ Port (`Shift+L`), copies that carry their
circuits. Example: Two-Digit Counter (Decade Counter inside Counter Digit, twice). Spec:
[circuit.md](../circuit.md#subcircuits), [editor.md](../editor.md#shell),
[components.md](../components.md#ports-net-port). Decision:
[ADR-0023](../adr/0023-subcircuits.md). Plan: `.ai/plans/feat-subcircuits.md`.

## R11b · Navigation into instances — `feat/subcircuit-navigation`

Going into an instance while simulating: the open circuit is seen in one instance of the design
(`EditorState.path`: `''` the top, `A2`, `A2/A1`), its scene mapped to that instance's flat nets
and parts, so wires, buses, labels, lights, part states and Properties' badges show its levels,
the Interact tool presses its buttons (`A2/SW1`) and the Probe tool probes by path, named as read
inside (`A1/MID`, Q4). Double-click, Go Into (`Mod+↓`), Go Up (`Mod+↑`, the instance left
selected), Go to Top; the Circuits list opens a circuit in its first instance (Q1); a breadcrumb
bar floats over the canvas — Up, the crumbs, the instance switcher, "edits change all N
instances" (Q2); the history and autosave keep the path; the Simulation tab locates into
instances. Found on the way: Step Clock after a button pressed while paused stopped before the
same edge (fixed). Spec: [editor.md](../editor.md#instances). Decision:
[ADR-0024](../adr/0024-instance-navigation.md). Plan: `.ai/plans/feat-subcircuit-navigation.md`.

## R15a · Test benches: scripts and headless runner — `feat/test-benches`

R15 (circuit test benches) was split at its start into the scripts and their headless runner
(R15a) and running them in the app (R15b): the document field, the bench API and the runner are
pure and fully testable in Node; the Tests tab, the browser sandbox a script needs and the
results view build on them.

A test script per circuit in the document (`Circuit.testScript`, schema v5): JavaScript with
`bench(name, fn)` calls on a synchronous API `b` (the user chose JavaScript over the proposed
text DSL, Q3) — drive ports and interactive parts (by symbol kind, as Interact does), pulse
clocks and step rows of test vectors in fixed steps (inputs at the start, a pulse LOW → HIGH at
¼ → LOW at ¾, checks at the end; text tables `` b.table`A B | Y …` `` inside the script), wait,
check signals and memory cells, load memories before power-on (RAM `poke`, a ROM's image,
Intel HEX). A pure runner in `circuit` tests a circuit as the top (a subcircuit through its
ports, drivers on its inputs); soft failures with the script line, instant, signal, expected
and actual value; simulation errors fail, warnings are listed. Script hosts make the text code:
`node:vm` in Node (no `Math.random`, `Date`, `console`; a time limit), `new Function` where
trusted. Benches for Half Adder, RAM by Hand (a memory loaded before power-on) and the
Two-Digit Counter's three circuits run in `pnpm check`; `pnpm test:circuits` runs any document's
(exit codes; a CI step). Spec: [circuit.md](../circuit.md#test-benches). Decision:
[ADR-0025](../adr/0025-test-benches.md). Plan: `.ai/plans/feat-test-benches.md`.

## R15b · Test benches in the app — `feat/test-bench-ui`

The Tests tab: the open circuit's test script in a CodeMirror 6 editor (Q3; highlighting in the
app's colors, completion of the bench API and the circuit's references, search and replace),
its error marked as it is typed; the benches run — Run (`Mod+Enter`), Run All, one at a time —
in a sandbox (Q1): a Worker started from a blob inside an opaque-origin iframe whose CSP allows
no network, so a document's script reaches neither the app's storage nor anything outside, off
the UI thread with progress, Cancel and time limits (5 s a script's top level, 60 s a bench);
no prompt before running a file's scripts (Q2). Results by circuit, stale once the circuit or
its script changes; a failure is a click from its line and its signal on the canvas (Q4).
Insert Image… writes `b.memory`/`b.loadIntelHex` from a `.bin`/`.hex` file. Under it: a pure
bench service in `circuit` (the protocol), the runner bundled into one script by a Vite plugin
(`virtual:bench-runner`, a lazy chunk), `Editor.setTestScript` (one undo step while typing, the
run and its history untouched). Spec: [editor.md](../editor.md#tests). Decision:
[ADR-0026](../adr/0026-test-bench-sandbox.md). Plan: `.ai/plans/feat-test-bench-ui.md`.

## PLT-1 · Schematic text — `feat/schematic-text`

Graphic elements without logic, starting with text: a `draw` family of schematic-only parts
without pins (never simulated, placed, moved, copied and saved like any part), and its first
part `draw/text` — a block of multi-line text with a size and a sans or mono font, edited in
Properties, placed from Parts ▸ Graphics or Place ▸ Text (`T`). The 6502 ROM and RAM example
gets its description and its program listing on the canvas. Plan: `.ai/plans/feat-schematic-text.md`.

## Ideas

Not scheduled yet; promoting one gives it the next free id and a row in the table.

### Kernel and circuit model

- Simulation in a Web Worker with SharedArrayBuffer levels; fast mode for synchronous designs.
- Seeded random power-on state as a simulator option (default stays `X`; decided in R01, Q2).
- Kernel: mark the forced evaluation (power-on, after a recompile) so multi-section chips can
  re-evaluate only the sections whose inputs changed (a 74HC04 chain runs at ≈ 8.4M events/s
  against ≈ 13.2M for `prim/not`, R06).
- Worst-case timing mode (R09a follow-up): the recorded `max` delays with the −40 °C to +85 °C
  minima (not recorded yet: add them as a third requirement column); a "report only" setting
  that keeps bits known after a timing violation, if `X` gets in the way.
- Design checks: unconnected power pins, fan-out/load limits, worst-case timing corner.

### Editor

- Symbol view: Proteus/KiCad-style multi-unit symbols (U1A…), hidden power pins, per-part toggle.
- Editing extras (R04b follow-ups): editing a prop of several selected parts at once, re-annotate
  designators, align/distribute, wire auto-routing around parts, a modifier to move parts without
  dragging their wires (KiCad "move"), dragging a single wire end.
- Simulation view extras (R05 follow-ups): LED colors that stay visible on the light theme's
  cream when dim (a dim yellow LED is hard to see); a "toggling" wire style for nets that change
  faster than the frame rate, which now flicker between 0 and 1 from frame to frame.
- Bus follow-ups (R10b): a multi-bit ripper (one part fanning a bus out to N adjacent pins);
  a radix setting for bus values (decimal, binary on the canvas); KiCad group buses (`{A B}`)
  and bus aliases if ever needed.
- Net highlighting (R10a follow-up): selecting or hovering a wire or net label highlights every
  wire and label of its net, across labels.
- Schematic graphics (PLT-1 follow-ups): editing a text in place on the canvas; bold,
  alignment, colors and a frame for texts; lines, rectangles and frames around blocks, a title
  block, images — each a `draw/*` part on the text's model.
- Placing VCC/GND symbols by their pin (R10a follow-up), as net labels are placed, so a click on
  a pin tip attaches one; other one-pin parts may follow.

### Subcircuits

- Subcircuit follow-ups (R11a): a drawn symbol for a subcircuit (a symbol editor, a DIP-like
  module); global net labels (joining by name across the hierarchy); parameters per instance
  (props, a ROM image per instance); a static shorted-outputs check across the hierarchy (the
  kernel's `contention` reports it while running); importing circuits from another file (a
  module library); a confirmation before deleting a circuit with instances (it is undoable).
- Navigation follow-ups (R11b): a hierarchy tree of instances (a navigator in the Circuits
  panel, Q2); live levels on an instance's box at the parent (its pin stubs, Properties' badges
  for its ports, a "peek" of the inside); the Memory tab and the Debug tab following the instance
  open (preselecting `A1/U3`); a camera per instance if modules grow large.

### Design tools

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
- Test bench follow-ups (R15a): rewriting a script's references when a part is renamed (they
  are strings in code; a find-and-replace at least); `b.settle()` (run until quiet) if fixed
  steps prove a chore; JUnit/JSON reports for CI dashboards; coverage (which nets a bench
  toggled); forcing a net against its driver (an injector); the examples' TypeScript scenario
  tests moved into their documents' scripts; line numbers from non-V8 engines' stacks.
- Test bench UI follow-ups (R15b): the waveforms of a bench's run — its signals recorded in the
  sandbox, shown in the Waveforms tab with a cursor at the failure (Q4); running the open
  circuit's benches on every edit (a watch mode); progress inside a long bench (its simulated
  time); a bench's time limit as a setting; Insert Image… as a constant shared by benches.

### Files, export, sharing

- Documents (R07 follow-ups): several documents open in one window (tabs); a title, notes and
  simulation settings (speed) stored in the file (schema v2).
- Export: KiCad netlist, BOM, SVG/PDF schematic; breadboard layout view.
- Sharing via URL, embed mode, PWA/offline, desktop packaging.

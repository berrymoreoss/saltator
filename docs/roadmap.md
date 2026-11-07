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

| ID   | Branch                       | Title                                      | Status      |
| ---- | ---------------------------- | ------------------------------------------ | ----------- |
| R00  | — (initial commit on `main`) | Foundation                                 | done        |
| R01  | `feat/engine-core`           | Simulation kernel                          | done        |
| R02  | `feat/circuit-model`         | Circuit document & netlist compiler        | done        |
| R03  | `feat/io-basic`              | Basic IO parts (headless)                  | done        |
| R04a | `feat/editor-canvas`         | App shell & schematic view                 | done        |
| R04b | `feat/editor-tools`          | Schematic editing                          | done        |
| R05  | `feat/sim-ui`                | Running simulations in the editor          | done        |
| R06  | `feat/74hc-gates`            | 74HC gates & bus buffers                   | done        |
| R07  | `feat/persistence`           | Save, load, examples                       | done        |
| R08  | `feat/74hc-msi`              | 74HC combinational MSI                     | done        |
| R09a | `feat/74hc-registers`        | 74HC flip-flops, registers + timing checks | done        |
| R09b | `feat/74hc-counters`         | 74HC counters & shift registers            | done        |
| R10a | `feat/net-labels`            | Net labels                                 | in-progress |
| R10b | `feat/buses`                 | Buses, rippers, bus values                 | planned     |
| R11  | `feat/subcircuits`           | Hierarchical design                        | planned     |
| R12  | `feat/memory`                | ROM / RAM + memory inspector               | planned     |
| R13  | `feat/logic-analyzer`        | Waveforms & probes                         | planned     |
| R14  | `feat/debugger`              | Breakpoints, stepping, watches             | planned     |
| R15  | `feat/test-benches`          | Circuit test benches ("test before fab")   | planned     |
| R16  | `example/sap-1`              | Ben Eater SAP-1 reference build            | planned     |
| R17  | `feat/cpu-6502`              | W65C02S CPU                                | planned     |
| R18  | `feat/peripherals`           | VIA, LCD, serial, buzzer                   | planned     |
| R19  | `feat/toolchain`             | 6502 assembler & flashing                  | planned     |
| R20  | `example/be6502`             | Ben Eater 6502 reference build             | planned     |

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

## Phase 2 — Building blocks → **M2 "Modules"**

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

### R10a · Net labels — `feat/net-labels` — `in-progress`

Essential for readable 8-bit schematics. **Net labels** (KiCad/Altium/Proteus "net label",
Logisim "tunnel"): a flag with a name and one connection point, placed on a wire end or a pin
tip. All labels with the same name are one net, so a circuit can be laid out in blocks without
wires running across it: switches `A`, `B` → labels `A`, `B` in one place; labels `A`, `B` → the
74HC00 inputs in another. The net takes the label's name (Properties, Messages, later the
analyzer); a name used by a single label is a design warning (likely a typo). Scope: the whole
circuit until R11 decides local vs global labels. VCC and GND symbols join by name the same way
([ADR-0007](adr/0007-io-electrical-model.md)). Placed from the canvas context menu's Place
submenu (built here, from the backlog) as well as the Parts panel. Plan:
`.ai/plans/feat-net-labels.md`.

### R10b · Buses, rippers, bus values — `feat/buses`

Multi-bit buses with bus rippers/splitters and bus labels, the bus value shown in hex while
simulating. Builds on R10a's names (`D0`…`D7`); the bus model (KiCad-style, joined by member
names, or Logisim-style rippers by bit index) is decided when it starts.

### R11 · Hierarchical design — `feat/subcircuits`

Multiple circuits per project, subcircuit instances with generated or custom symbols, navigation
into instances while simulating.

**M2 acceptance:** Ben Eater SAP-1 modules (clock, A/B registers, ALU, program counter, output
register) built and verified individually.

## Phase 3 — Memory, debugging, verification → **M3 "SAP-1 runs"**

### R12 · ROM / RAM + memory inspector — `feat/memory`

AT28C16, AT28C64, AT28C256 (EEPROM), 6116, 62256 (SRAM), 74LS189; memory inspector (hex view,
edit, live read/write highlighting, follow address), import/export `.bin` and Intel HEX, "programmer"
dialog, power-on contents option (zeros / random / X).

### R13 · Waveforms & probes — `feat/logic-analyzer`

Probe nets/buses, timing diagram with zoom/pan, cursors and Δt measurement, bus decoding, trigger
conditions, export (VCD).

### R14 · Breakpoints, stepping, watches — `feat/debugger`

Step by clock edge / by time / by event, breakpoints on signal or bus conditions, watch panel,
run statistics, snapshot & rewind.

### R15 · Circuit test benches — `feat/test-benches`

Test vectors (table of inputs/expected outputs over time) and scripted benches for user circuits;
run in the app and headless (Node/CI); pass/fail report. The core of "test before fab".

### R16 · SAP-1 reference build — `example/sap-1`

Full Ben Eater 8-bit computer as an example project (microcode EEPROMs, 7-segment output), with
a test bench running a demo program.

**M3 acceptance:** SAP-1 runs a program end to end; its test bench passes in CI.

## Phase 4 — CPU systems → **M4 "6502 Hello World"**

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
  specs; 74LS/74F also need TTL inputs (a floating input reads high).
- Kernel: mark the forced evaluation (power-on, after a recompile) so multi-section chips can
  re-evaluate only the sections whose inputs changed (a 74HC04 chain runs at ≈ 8.4M events/s
  against ≈ 13.2M for `prim/not`, R06).
- Simulation view extras (R05 follow-ups): LED colors that stay visible on the light theme's
  cream when dim (a dim yellow LED is hard to see); a "toggling" wire style for nets that change
  faster than the frame rate, which now flicker between 0 and 1 from frame to frame.
- Place submenu (instead of a quick-place toolbar group, to keep the toolbar clean): right click
  on empty canvas ▸ **Place** ▸ Power (VCC), Ground (GND), Pull-up, Pull-down (the pull part with
  its direction preset), Wire, Net Label (with R10), Port (a subcircuit's interface pin, with
  R11), then Part… (Search Parts). The menu bar's Place menu shows the same list. A part item arms
  the sticky place tool like a click in the Parts panel (ghost under the cursor, R/F before
  placing, Escape leaves); Wire switches to the Wire tool. Shortcuts can follow (KiCad uses `P`
  for power and `L` for a label; both are free). Everything but Net Label and Port can land any
  time.
- Passive parts (R08 follow-up): resistors, capacitors and potentiometers drawn on the schematic
  but not simulated (BOM, breadboard view), a 555 reading its R and C from them, and turning a
  potentiometer with the Interact tool (Ben's clock speed knob); a read-only hint of a 555's
  resulting frequency in Properties. CMOS 555s (TLC555, ICM7555) and the 556 with the same model.
- Documents (R07 follow-ups): several documents open in one window (tabs); a title, notes and
  simulation settings (speed) stored in the file (schema v2).

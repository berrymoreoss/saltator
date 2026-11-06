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

| ID   | Branch                       | Title                                    | Status      |
| ---- | ---------------------------- | ---------------------------------------- | ----------- |
| R00  | — (initial commit on `main`) | Foundation                               | done        |
| R01  | `feat/engine-core`           | Simulation kernel                        | done        |
| R02  | `feat/circuit-model`         | Circuit document & netlist compiler      | done        |
| R03  | `feat/io-basic`              | Basic IO parts (headless)                | done        |
| R04a | `feat/editor-canvas`         | App shell & schematic view               | in-progress |
| R04b | `feat/editor-tools`          | Schematic editing                        | planned     |
| R05  | `feat/sim-ui`                | Running simulations in the editor        | planned     |
| R06  | `feat/74hc-gates`            | 74HC gates & bus buffers                 | planned     |
| R07  | `feat/persistence`           | Save, load, examples                     | planned     |
| R08  | `feat/74hc-msi`              | 74HC combinational MSI                   | planned     |
| R09  | `feat/74hc-sequential`       | 74HC sequential parts + timing checks    | planned     |
| R10  | `feat/nets-and-buses`        | Net labels, tunnels, buses               | planned     |
| R11  | `feat/subcircuits`           | Hierarchical design                      | planned     |
| R12  | `feat/memory`                | ROM / RAM + memory inspector             | planned     |
| R13  | `feat/logic-analyzer`        | Waveforms & probes                       | planned     |
| R14  | `feat/debugger`              | Breakpoints, stepping, watches           | planned     |
| R15  | `feat/test-benches`          | Circuit test benches ("test before fab") | planned     |
| R16  | `example/sap-1`              | Ben Eater SAP-1 reference build          | planned     |
| R17  | `feat/cpu-6502`              | W65C02S CPU                              | planned     |
| R18  | `feat/peripherals`           | VIA, LCD, serial, buzzer                 | planned     |
| R19  | `feat/toolchain`             | 6502 assembler & flashing                | planned     |
| R20  | `example/be6502`             | Ben Eater 6502 reference build           | planned     |

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

### R04a · App shell & schematic view — `feat/editor-canvas` — `in-progress`

R04 was split at its start into a view (R04a) and editing (R04b). Desktop CAD-style React shell
(menu bar, toolbar, Parts panel with search and preview, Properties panel, tabbed bottom dock
with Messages, status bar; fixed regions with splitters), dark and light themes following the OS,
command registry for menus/toolbar/shortcuts. Canvas2D renderer (HiDPI, grid, layers, culling),
camera pan/zoom (Figma-style with a KiCad-style wheel setting), symbol renderers keyed by
`symbol.kind` (gates in ANSI or IEC style, LEDs, switches, displays), generic DIP renderer,
designator and label placement, selection (click, box), design-check messages with
click-to-locate, demo documents (Hello LED, symbol gallery), Playwright smoke test.
Plan: `.ai/plans/feat-editor-canvas.md`.

### R04b · Schematic editing — `feat/editor-tools`

Place parts from the palette (click or drag), move/rotate/flip/delete, orthogonal wire drawing
with junctions, copy/paste/duplicate, undo/redo, editing shortcuts, context menu, editing props,
designator and label in the Properties panel, designator prefixes per part (`U`, `SW`, `D`, …).
Open questions are listed in R04a's plan.

### R05 · Running simulations in the editor — `feat/sim-ui`

Simulator host (real-time pacing, speed control, run/pause/step/reset), live wire coloring by
level, interactive parts on canvas (buttons, switches, DIP switches, manual clock step via their
actions), LEDs/displays lit from their state with brightness from on-time (`onTimeAt`),
diagnostics panel with click-to-locate, recompile on edit preserving state where possible
(state is keyed by designator: carry it across renames, see ADR-0006).

### R06 · 74HC gates & bus buffers — `feat/74hc-gates`

74HC00, 02, 04, 08, 10, 11, 14, 20, 21, 27, 30, 32, 86, 125, 126, 240, 244, 245 with datasheet
pinouts, timing and function-table tests. Part info panel (pinout, title, datasheet link).

### R07 · Save, load, examples — `feat/persistence`

`.logic.json` save/load (File System Access API + fallback), autosave to IndexedDB, example
gallery, "new from example". Files are written by `serializeDocument` (R02); exclude example
documents in the repo from Biome, which would reformat them.

**M1 acceptance:** in the browser, build switch → 74HC00 → LED and clock → LED; run; the LED follows
the logic; save, reload, still works.

## Phase 2 — Building blocks → **M2 "Modules"**

### R08 · 74HC combinational MSI — `feat/74hc-msi`

74HC138, 139, 151, 153, 157, 158, 283, 85, 147/148, 4511 (BCD → 7-segment). Behavioral NE555
(astable/monostable/bistable as a digital clock/pulse source) for Ben Eater's clock module.

### R09 · 74HC sequential + timing checks — `feat/74hc-sequential`

74HC74, 107/109/112, 161, 163, 173, 175, 191/193, 273, 374, 377, 574, 595, 164, 165, 4040.
Setup/hold violation diagnostics for edge-triggered parts.

### R10 · Net labels, tunnels, buses — `feat/nets-and-buses`

Named net labels/tunnels, multi-bit buses with bus rippers/splitters, bus value display (hex),
junction dots. Essential for readable 8-bit schematics.

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

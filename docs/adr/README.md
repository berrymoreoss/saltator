# Architecture Decision Records

Short records of decisions that shape the codebase: the context, the choice, the consequences and
the alternatives we rejected. Format: [ADR-0001](0001-record-architecture-decisions.md).

| ADR                                               | Title                                                                                           | Status   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)     | Record architecture decisions                                                                   | accepted |
| [0002](0002-tech-stack.md)                        | Tech stack: Vite, TypeScript, React, Canvas2D                                                   | accepted |
| [0003](0003-event-driven-simulation.md)           | Event-driven simulation with real delays and 4-state logic                                      | accepted |
| [0004](0004-chips-as-packages.md)                 | Chips are modeled as packages; DIP view first                                                   | accepted |
| [0005](0005-layered-architecture.md)              | Layered architecture with enforced boundaries                                                   | accepted |
| [0006](0006-circuit-document-and-connectivity.md) | Circuit document: wire segments, designator ids, geometric connectivity                         | accepted |
| [0007](0007-io-electrical-model.md)               | IO parts model real contacts and two-terminal LEDs                                              | accepted |
| [0008](0008-desktop-workbench.md)                 | A desktop CAD-style workbench with fixed docks and view settings                                | accepted |
| [0009](0009-editing-model.md)                     | Editing model: snapshot undo, rubber-band moves, normalized wires                               | accepted |
| [0010](0010-running-simulations.md)               | Running simulations: a host, live edits with carry-over, an Interact tool                       | accepted |
| [0011](0011-real-chips.md)                        | Real chips: Nexperia data sheets, one function per chip, timing per family                      | accepted |
| [0012](0012-files-and-sessions.md)                | Files and sessions: `.logic.json` on disk, the session restored as it was                       | accepted |
| [0013](0013-behavioral-timer.md)                  | Behavioral timer: the 555's RC network as props, its pins not simulated                         | accepted |
| [0014](0014-timing-checks.md)                     | Timing checks: guaranteed minima, a violation makes the loaded bits unknown                     | accepted |
| [0015](0015-net-labels.md)                        | Net labels are schematic-only parts; VCC and GND join by name                                   | accepted |
| [0016](0016-buses.md)                             | Buses are named groups of nets on their own layer                                               | accepted |
| [0017](0017-memories.md)                          | Memories: guaranteed limits with an X window; ROM images in the document                        | accepted |
| [0018](0018-memory-inspector.md)                  | Memory inspector: access stamps, edits through the document or pokes                            | accepted |
| [0019](0019-waveforms.md)                         | Waveforms: probes by reference in the document, a bounded recorder, triggers that break the run | accepted |
| [0020](0020-debugger.md)                          | Debugger: repeating trigger conditions that pause, Step Clock before the edge, setup in session | accepted |
| [0021](0021-rewind.md)                            | Rewind: whole-simulator snapshots, an action log, replays in a replica; forward runs replay     | accepted |
| [0022](0022-character-lcd.md)                     | Character LCD: one HD44780 module part, the controller at instruction level, unknowns merged    | accepted |
| [0023](0023-subcircuits.md)                       | Subcircuits: flattened instances, ports, local labels                                           | accepted |
| [0024](0024-instance-navigation.md)               | Instance navigation: the open view is an instance path                                          | accepted |
| [0025](0025-test-benches.md)                      | Test benches: JavaScript scripts in the document, run in fixed steps by a script host           | accepted |
| [0026](0026-test-bench-sandbox.md)                | Test benches in the app: an opaque-origin sandbox, no prompt, CodeMirror                        | accepted |
| [0027](0027-roadmap-tracks.md)                    | The roadmap is a set of parallel tracks; milestones span them                                   | accepted |
| [0028](0028-cpu-model.md)                         | CPU model: a cycle-level core behind pin-level timing, unknown bits per bit, lost until reset   | accepted |
| [0029](0029-schematic-graphics.md)                | Schematic graphics: schematic-only parts without pins, text boxes estimated in pure layers      | accepted |
| [0030](0030-hdl-modules.md)                       | HDL modules: Yosys synthesizes outside the app, an interpreter runs its netlist as parts        | accepted |
| [0031](0031-tft-modules.md)                       | TFT modules: the ST7789 at command level, the frame memory as the only picture, the veil        | accepted |
| [0032](0032-saltator.md)                          | Saltator: the product name, `.saltator.json` documents, fresh browser storage                   | accepted |
| [0033](0033-pages-demo.md)                        | A live demo on GitHub Pages, deployed by hand from `main`                                       | accepted |
| [0034](0034-commit-version.md)                    | The commit is the version: its hash and date in About, read from git at build time              | accepted |
| [0035](0035-inner-signals.md)                     | Inner signals: a view on the part, named like nets inside a subcircuit, sampled at instants     | accepted |
| [0036](0036-memories-in-modules.md)               | Memories in modules: Yosys collects them, the interpreter runs words, the tools see a chip's    | accepted |
| [0037](0037-hdl-generated-code.md)                | HDL modules run as JavaScript generated from their IR, on 32-bit words, with activity           | accepted |

New ADR: copy [template.md](template.md) to `NNNN-short-title.md` (next free number), fill it in,
add a row here. Branches of different tracks can take the same number at the same time: the one
merged second renumbers its ADR when it merges `main` (`.ai/workflows/finish-branch.md`).
Superseding: set the old one's status to `superseded by NNNN`; never delete ADRs.

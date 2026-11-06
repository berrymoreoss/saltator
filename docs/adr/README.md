# Architecture Decision Records

Short records of decisions that shape the codebase: the context, the choice, the consequences and
the alternatives we rejected. Format: [ADR-0001](0001-record-architecture-decisions.md).

| ADR                                               | Title                                                                      | Status   |
| ------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)     | Record architecture decisions                                              | accepted |
| [0002](0002-tech-stack.md)                        | Tech stack: Vite, TypeScript, React, Canvas2D                              | accepted |
| [0003](0003-event-driven-simulation.md)           | Event-driven simulation with real delays and 4-state logic                 | accepted |
| [0004](0004-chips-as-packages.md)                 | Chips are modeled as packages; DIP view first                              | accepted |
| [0005](0005-layered-architecture.md)              | Layered architecture with enforced boundaries                              | accepted |
| [0006](0006-circuit-document-and-connectivity.md) | Circuit document: wire segments, designator ids, geometric connectivity    | accepted |
| [0007](0007-io-electrical-model.md)               | IO parts model real contacts and two-terminal LEDs                         | accepted |
| [0008](0008-desktop-workbench.md)                 | A desktop CAD-style workbench with fixed docks and view settings           | accepted |
| [0009](0009-editing-model.md)                     | Editing model: snapshot undo, rubber-band moves, normalized wires          | accepted |
| [0010](0010-running-simulations.md)               | Running simulations: a host, live edits with carry-over, an Interact tool  | accepted |
| [0011](0011-real-chips.md)                        | Real chips: Nexperia data sheets, one function per chip, timing per family | accepted |

New ADR: copy [template.md](template.md) to `NNNN-short-title.md` (next free number), fill it in,
add a row here. Superseding: set the old one's status to `superseded by NNNN`; never delete ADRs.

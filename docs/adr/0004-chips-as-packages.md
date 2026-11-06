# 0004. Chips are modeled as packages; DIP view first

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R00 (foundation)

## Context

Schematic tools draw chips either as their physical package (a DIP rectangle with numbered pins,
like on a breadboard) or as logical symbols split into units (Proteus/KiCad: `U1A`…`U1D`, power
pins hidden). The target workflow is building Ben Eater-style computers on breadboards, where the
package view maps 1:1 to the physical build. Logical symbols read better in large schematics.

## Decision

- A chip definition describes the **package**: every physical pin with its datasheet number and
  name, including `VCC`/`GND`.
- Definitions also list **units** (gate sections) as optional data, so a symbol view can be added
  later without changing the file format.
- The editor first ships a **generic DIP renderer** driven by the definition. A symbol view is a
  backlog item.
- **Abstract primitives** (`prim/*`) exist alongside real chips for quick prototyping and learning.
- **Power pins are not simulated** in the MVP (every chip is powered); a later design check flags
  unconnected power pins.

## Consequences

- Adding a 74xx chip needs no drawing code: pins + package + behavior + tests.
- Schematics look like breadboard builds; large designs rely on net labels and buses (R10) for
  readability until the symbol view exists.
- Physical pin numbers are available for future netlist/BOM export.

## Alternatives considered

- **Symbol view first** — better readability, but multi-unit parts complicate the document model
  and editor from day one.
- **Abstract parts only** — simplest, but abandons "test before fab".

# 0015. Net labels are schematic-only parts; VCC and GND join by name

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R10a (feat/net-labels)

## Context

An 8-bit computer's schematic is unreadable if every connection is a drawn wire: a bus, a clock
and a dozen control lines run across every module. Schematic editors solve this with net labels
(KiCad, Altium, Proteus) or tunnels (Logisim): a name at one connection point, and every place
with the same name is the same net. ADR-0007 left the VCC and GND symbols as separate sources
until net labels exist, so a breadboard's single supply rail took a wire between every two
symbols. The document model (ADR-0006) has two kinds of things, components and wires, and every
editing feature — placing, selecting, moving with rubber-banded wires, rotating, copy/paste,
undo, Properties — is built for those two.

## Decision

- **A net label is a library part** (`net/label`, a `name` prop, one pin), not a new kind of
  document object: it is placed, moved, rotated, copied and undone like any part, and the file
  format doesn't change.
- **Joining by name is a pin property.** `PinDef.net` makes a pin join the circuit-wide net of
  that name; the label's pin has its `name`, the VCC and GND symbols' pins have `VCC` and `GND`.
  The compiler unions pins by name after geometric connectivity; it never looks at part types.
- **Labels are schematic-only** (`ComponentDefinition.schematicOnly`): they connect but are left
  out of the netlist, and design checks don't count their pins. Adding, moving or renaming a
  label that changes no pin connections keeps the netlist's structure, so a running simulation
  goes on untouched.
- **A named net is called by its name**: names from simulated pins (rails) first, then label
  names, each in code-point order. Several names on one net are a `multiple-net-names` warning,
  a label name nothing else uses a `single-net-label` warning (as in KiCad's ERC).
- **Names** are letters, digits, `_ + - / #` and KiCad's `~{…}` overline, at most 32
  characters; `.` (netlist pin references) and `[` `]` (bus ranges, R10b) are kept out.
- **Scope**: the whole circuit, until R11 decides local and global labels (R11a: local to their
  circuit, the power names global — [ADR-0023](0023-subcircuits.md)).

Details: [circuit.md](../circuit.md#connectivity), [components.md](../components.md#net-labels-net).

## Consequences

- All VCC symbols are one net `VCC`, all GND symbols one net `GND`, as on a real board; net ids
  of existing circuits change from `PWR1.Y` to `VCC` (net ids carry no state across recompiles).
- "The only pin on its net" no longer means "connected to nothing": open pins are found by what
  touches them (`Connectivity.openPins`).
- Labels get designators (`NL1`) because every component has one; they are never drawn.
- The simulator doesn't know labels, so their live color comes from the net at their point
  (`DrawContext.pinColor`), not from `PartLive`.
- R10b's bus labels and rippers and R11's ports can be schematic-only parts the same way.

## Alternatives considered

- **Labels as a third document object** (KiCad's model: `labels: [{ name, at, rotation }]`) —
  no designators, but schema v2 and a third selectable kind in hit-testing, selection, moves,
  clipboard, undo and Properties, for no difference the user sees.
- **The compiler recognizing the label type** — simpler at first, but `circuit` would depend on
  a `library` type id, and the VCC/GND symbols would need a second special case.
- **Labels in the netlist as parts with an unconnected pin** — no new definition flag, but every
  label edit would recompile the simulator's netlist, and test benches would see `NL` parts.
- **VCC and GND kept as separate sources** — simpler, but unlike the breadboard, and a lone
  `VCC` label would have nothing to join.

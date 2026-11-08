# 0023. Subcircuits: flattened instances, ports, local labels

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** R11a (`feat/subcircuits`)

## Context

A breadboard computer is built from modules — Ben Eater's clock, registers, ALU are separate
boards on one bus — and the SAP-1 build (R16) and its test benches (R15) need each module
designed and tested on its own, then placed. Documents already held a list of circuits ("the
first is used"), the resolver reserved `/` for paths, and every tool (memory inspector, probes,
watches, breakpoints) went through one resolver over one compiled circuit. The kernel simulates a
flat netlist and carries a run over edits by component id (ADR-0010).

## Decision

- **Flatten, don't nest.** The compiler expands the top circuit's instances into one flat netlist
  (`compileDesign`): inner parts by instance path (`A1/U3`, `A1/A2/U1`), nets joined through
  ports. The kernel, the parts, carry-over and rewind don't change; every circuit is compiled
  once on its own (its scene, its checks) and cached.
- **The first circuit is the top** and is what simulates; another circuit open is drawn without
  levels (R11b goes into an instance). Set as Top Circuit reorders.
- **Instances are parts of type `sub/<circuit id>`** served by a document registry that
  generates a definition per circuit — pins from its ports, a box symbol — so layouts, drawing,
  hit-testing and the panels treat an instance like any part. Circuit ids are slugs (schema v4),
  following the name until the circuit is placed. Designators `A1`, `A2` (IEEE 315 assembly).
- **Ports** are a schematic-only part (`net/port`) joining the net or bus of their name inside,
  with a direction (the flag's shape, the default side, the checks) and a side; electrically a
  plain connection, as a connector is. A bus port joins the outer bus bit by bit by name.
- **The symbol is generated**, the pins on each side in the order the ports are drawn, so the
  designer arranges the symbol by arranging the ports.
- **Labels are local, power is global.** Net and bus labels join within their circuit; the names
  a simulated part's pin joins (`VCC`, `GND`) join everywhere. Flat nets are called by their
  outermost member (a top-level net keeps its id).
- **The resolver takes paths** (`A1/U3.Q0`, `A1/CLK`, `A1/U5[1F]`), so the tools reach inside
  without knowing the hierarchy; probes are the top circuit's.
- **One undo history per document**; renames are expanded to the design's parts (every instance,
  every part of a renamed instance) for carry-over.

## Consequences

- R15 can compile any circuit as the top and drive its ports by name; R16a's modules are
  circuits of one document.
- Each instance has its own state but one definition: a ROM inside a subcircuit has one image
  for every instance; per-instance parameters are future work.
- Two instances of a module can't short each other's internal nets by a shared label name; a
  signal shared across modules goes through ports (or the power names).
- A change of ports moves the pins of every instance; the design checks report what came loose.
- Flattening multiplies: deep, wide hierarchies cost linear time in the flattened size (16
  instances of a 50-part cell: ≈ 0.65 ms).

## Alternatives considered

- **A hierarchical kernel** (instances as composite components) — touches every kernel path,
  breaks carry-over and snapshots, and buys nothing a flat netlist can't simulate.
- **A stored definition per instance** (a copy of the circuit inside each instance) — no shared
  edits, larger files, diverging copies.
- **Global labels** (every name joins across the hierarchy, as before) — two instances of one
  module would short their internal nets; global labels as a separate part are in the backlog.
- **Simulating the open circuit** (Logisim's per-circuit state) — switching circuits loses the
  top's state; testing a module alone is R15's bench.
- **A drawn symbol editor** — more work than the generated box needs now; in the backlog.

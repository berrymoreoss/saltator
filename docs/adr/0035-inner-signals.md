# 0035. Inner signals: a view on the part, named like nets inside a subcircuit, sampled at instants

- **Status:** accepted
- **Date:** 2026-11-11
- **Roadmap item:** HDL-4 (feat/hdl-inspection)

## Context

A Verilog module runs as one part ([ADR-0030](0030-hdl-modules.md)): its registers and wires
live in the interpreter's bit planes, not on nets. Debugging a state machine meant bringing its
state out to pins. The IR keeps the module's named signals (`state`, a flattened submodule's
`u_core.count`) with their bits, so the values are there. The tools that show values — probes in
the waveforms ([ADR-0019](0019-waveforms.md)), watches and breakpoints
([ADR-0020](0020-debugger.md)), test benches ([ADR-0025](0025-test-benches.md)) — all name what
they show through the resolver and, for anything recorded, through recorder channels on nets.
Forces:

- Inside one `evaluate` the planes are written many times: combinational loops settle, clocks made
  by logic run in rounds. Intermediate values are not what a board shows.
- The kernel runs 10M+ events a second; a module evaluation is already the hot path (HDL-10 is
  about making it faster).
- Nets have no identity across compiles; neither does a signal's index in a recompiled module.
- Rewind restores state into the same objects; Reverse Continue replays in a replica with its own
  states.
- A module's port is a pin outside (after its delay) and a value inside (at once): two things
  with one name.

## Decision

- **A view on the definition** (`ComponentDefinition.signals`, `SignalsDef` in core), as memories
  (`memory`) and CPUs (`cpu`) show their contents: the names, Verilog indices and source lines of
  the signals, and `level(state, signal, bit)` reading an instance's state — no copy, no
  allocation. The library's module part implements it from the IR's named signals over its
  planes. It is generic: a hand-written part (the 6502's registers, R17b) may show its own.
- **Named like nets inside a subcircuit** (Q1): a module is a circuit written in Verilog, so its
  signals are its nets — `state` in the module's own scope (its own benches), `A1/state` from
  the circuit that places it, `S1/A1/state` through a subcircuit, `A1/u_core.count` with the
  flattened name's `.`. The resolver tries them in a module's circuit only after pins, nets, buses
  and parts, so no reference changes meaning; `A1.q` stays the pin. Slices by the signal's own
  indices (Q2): `count[3:0]` as in the source, `count[3..0]` as the app writes buses, `count[2]`.
- **Sampled at the end of each instant**: a recorder channel's source is a net's index or a bit
  inside a part (`InnerBit`: part, signal, bit); the recorder reads such bits at `onInstant`,
  listening for instants only while it has them, and a trigger has it sample first. The record
  is the same one level per instant a net's channel keeps; rewinds confirm it as for nets.
  Watches and benches read the view when asked. Each bit's reference (`A1/state[0]`) is the
  channel's identity across compiles; the resolver re-resolves it to an index after each.
- **Picked in the module's view** (Q3): its Signals list shows the open instance's values while
  simulating, with Probe and Watch; every reference box and the bench editor suggest them.
- **Read, never driven**: a bench setting one is refused ("read it, or drive a pin of the
  module"); Step Clock can't step by one (nothing is queued on it to look ahead at).

## Consequences

- No cost until something inside is probed or broken on: the kernel is unchanged, a recorder of
  nets doesn't listen for instants. Recording 16 bits inside the 1 024-cell benchmark module:
  12.0k against 12.3k evaluations/s (≈ 2 %).
- The waveforms show a register change at its clock edge and the module's pins its delay later,
  as a logic analyzer on a board's test points would — a module's timing made visible.
- A signal Yosys optimized away (or merged into another name) can't be inspected; the command
  doesn't change for it. Aliases are separate signals reading the same bits.
- A signal no longer there after a Compile shows unresolved, as a probe on a removed net does.
- R17b can show the 6502's registers through the same view and channels.
- HDL-6 adds memories inside modules through the part's `memory` view, beside this one.

## Alternatives considered

- **Inner signals as hidden nets** the part drives with zero delay — every register change an
  event, nets that aren't in the circuit, the kernel's cost on every module whether probed or not.
- **A per-change hook inside the interpreter** — a call per plane write, and the intermediate
  values of loops and rounds that a board never shows.
- **`A1.state`** (Verilog's hierarchical name, with the pins) — `A1.q` would be the pin or the value
  inside, and a flattened name's `.` would read as a separator (Q1).
- **`A1/U1.state`** (a pin of the module's part) — exact, but shows the user the internal `U1`
  they never placed (Q1).
- **Only completion in the reference boxes, no list** — no live values anywhere but watches (Q3).

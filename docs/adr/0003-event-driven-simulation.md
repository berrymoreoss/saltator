# 0003. Event-driven simulation with real delays and 4-state logic

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R00 (foundation); implemented in R01

## Context

The goal is "test before fab": a design that works in the simulator should work on a breadboard.
Real 74HC builds fail because of propagation delays and races, glitches, tri-state bus contention,
floating CMOS inputs, missing resets and setup/hold violations. Zero-delay (Logisim-style) or
unit-delay simulation hides most of these.

## Decision

- **Event-driven** kernel with a priority queue ordered by `(time, seq)`.
- **Time in integer picoseconds**; part delays come from datasheets (typical at 5 V).
- **4-state levels** `0, 1, X, Z` with **drive strengths** (`none`, `weak`, `strong`) and a
  resolution function; strong conflicts raise a `contention` diagnostic.
- **Inertial delays**: pulses shorter than a gate's delay are swallowed.
- **Delta cycles** for zero-delay elements, with an oscillation guard.
- **Determinism**: stable ordering, no wall-clock or unseeded randomness in the kernel.
- Floating inputs read as unknown and raise a `floating-input` diagnostic when consumed.

Full spec: [docs/simulation.md](../simulation.md).

## Consequences

- Faithful behavior for the bugs that matter; good teaching value (X propagation shows missing
  resets).
- More events per clock cycle than a cycle-based simulator. A 6502 system at 1 MHz may not run in
  real time at full fidelity; mitigations (Web Worker, fast mode for synchronous parts) are in the
  backlog. Debugging rarely needs real-time speed.
- Every part definition must carry timing data.

## Alternatives considered

- **Zero-delay, levelized (Logisim-like)** — simplest and fastest, but hides timing bugs.
- **Unit delay** — simpler, still hides real timing relationships between parts.
- **Analog/SPICE-level** — out of scope; far too slow and complex for whole computers.

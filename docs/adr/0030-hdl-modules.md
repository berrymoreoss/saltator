# 0030. HDL modules: Yosys synthesizes, an interpreter of its netlist runs them as parts

- **Status:** proposed
- **Date:** 2026-11-08
- **Roadmap item:** HDL-1 (feat/hdl-modules); proposed in docs/programmable-logic-track, accepted
  in HDL-1 after its benchmark

## Context

Hand-written TypeScript serves 74xx chips well: the behavior is the small part of a chip, next to
its pinout, function table, timing and tests. It serves badly where the logic itself is large or
belongs to the user: controllers with many registers and modes, a design the user will put into
an FPGA or a CPLD, a soft core such as PicoRV32. Such logic is written in a hardware description
language — Verilog first — and should run in the simulator as a part, with everything parts
have: inertial pin delays and timing checks ([ADR-0003](0003-event-driven-simulation.md),
[ADR-0014](0014-timing-checks.md)), 4-state values with a pessimistic `X` and strict edges,
snapshots of plain structured-clone-able state a few KiB each ([ADR-0021](0021-rewind.md)),
carry-over across recompiles, diagnostics, test benches, determinism, and the pure layers
([ADR-0005](0005-layered-architecture.md)).

## Decision

- **Yosys is the front end.** Yosys (ISC license), packaged for WebAssembly by YoWASP, compiles
  Verilog outside the pure layers: in scripts for the library's modules, in a Web Worker in the
  app for the modules of a document (HDL-1). Only synthesizable Verilog is accepted — what Yosys
  synthesizes, which is what the user's FPGA or CPLD flow will get. Passes: `read_verilog
  -specify`, `hierarchy -top`, `proc`, `flatten`, `opt -keepdc` (don't-care bits are not
  optimized away, so `X` behaves as written), memories kept as memory cells; output: Yosys's
  JSON netlist.
- **The IR is plain data.** A pure converter in `src/library/hdl/` turns Yosys's JSON into the
  IR: ports, signals with widths, word-level cells (logic, arithmetic, comparisons, multiplexers,
  shifts, flip-flops, latches, memories), 4-state constants, specify paths and timing checks. It
  is JSON-serializable, so it can be stored, shared and loaded without running anything.
- **One interpreter runs every module.** A generic `Behavior` in `src/library/hdl/`: state in
  typed arrays (a value and an unknown bit plane per signal), so snapshots and carry-over work as
  for any part; combinational cells evaluated in topological order at zero delay within one
  `evaluate`, no events inside a module; flip-flops and latches on the kernel's strict edges, an
  edge from `X`/`Z` making the stored bits `X`; outputs driven through the kernel (inertial, like
  every part) with the delays of the module's `specify` paths, or with one delay set on the part
  where the module has none (a document's module, until HDL-2); `specify` timing checks run by
  `TimingChecks`.
- **A module is a black box with pin to pin timing**, as data sheets describe chips: delays in
  the code (`#5`) are not simulated, as synthesis ignores them. A library part is a module plus
  its data sheet metadata (pinout, pin descriptions, function table); a document's module is
  placed like a subcircuit; a programmable device (HDL-5) holds a module and times its pins by
  the device's data sheet instead.

## Consequences

- A part made from Verilog is an ordinary part: waveforms, debugger, rewind, test benches and
  design checks work with it unchanged, and a Verilog 74HC00 can be held to the hand-written
  74HC00's tests.
- What is simulated is what Yosys synthesizes — the front end of the open-source FPGA flows
  (iCE40, ECP5) — not a separate reading of the language.
- Yosys in WebAssembly is large: the app loads it lazily in a worker, only for documents with
  modules; library modules are compiled ahead of time, so running them never needs Yosys.
- Speed: the interpreter evaluates a module's cells on every input change. Fine for chips;
  for a soft core of thousands of cells it is measured in HDL-1 and HDL-7, and HDL-10 makes it
  fast (the IR compiled to JavaScript or WebAssembly).
- `X` is pessimistic by design, so results can differ from a Verilog simulator where the source
  relies on Verilog's optimistic `X` (an `always @(posedge clk)` firing on `X → 1`).
- Testbench Verilog (`initial` stimulus, `$display`, delays) is not supported: test benches are
  the simulator's own ([ADR-0025](0025-test-benches.md)).
- The converter depends on Yosys's JSON format and cell library: the Yosys version is pinned
  and the converter tested on fixtures. VHDL is not covered (GHDL is written in Ada and hard to
  run in a browser).

## Alternatives considered

- **Icarus Verilog's `vvp` in WebAssembly, co-simulated with the kernel** — two schedulers that
  both own time (`vvp` would need patching to run up to a time and return), a `vvp` instance per
  chip instance with megabytes of memory each, snapshots as copies of that memory instead of a
  few KiB, Icarus's timing checks reported not to fire, Verilog's optimistic edges from `X`, a
  crossing between JavaScript and WebAssembly on every input change, and a GPL runtime shipped
  inside the app.
- **TypeScript generated per module** — fast and fine for library parts, but a user's module
  would be generated code in a document, run through `eval` or the test bench sandbox
  ([ADR-0026](0026-test-bench-sandbox.md)); one data path for both is simpler and safe to share.
- **Our own Verilog front end** — small and fully ours, but elaborating Verilog (parameters,
  `generate`, functions, `always` semantics) is a compiler project, and its semantics would drift
  from the synthesis tools'. Kept as the fallback if Yosys proves too heavy in the browser.
- **The synthesized gate netlist as `prim/*` parts in the kernel** — no new runtime, but
  thousands of components and events per clock, glitches inside a chip that the black-box data
  sheet model doesn't have, and delays per internal gate that nobody specifies.

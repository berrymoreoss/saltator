# 0030. HDL modules: Yosys synthesizes outside the app, an interpreter runs its netlist as parts

- **Status:** proposed
- **Date:** 2026-11-08
- **Roadmap item:** HDL-1 (feat/hdl-modules); proposed in docs/programmable-logic-track, amended
  when HDL-1 started (Yosys outside the app), accepted in HDL-1 after its benchmark

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

- **Yosys is the front end, and it runs outside the app.** Yosys (ISC license) compiles
  Verilog on the user's computer, as their FPGA or CPLD flow does anyway, with a command the app
  shows: `read_verilog` (`-specify` from HDL-2), `hierarchy -auto-top`, `proc`, `flatten`,
  `opt -keepdc` (don't-care bits are not optimized away, so `X` behaves as written), `check`,
  `write_json`; memories stay memory cells. The user pastes the JSON netlist into a module of
  the document or imports it from a file. The repo's scripts run the system `yosys` for the
  converter's fixtures, the examples and the library's modules; `pnpm check` never does. Only
  synthesizable Verilog runs — what Yosys synthesizes, which is what the device will get.
- **The IR is plain data, and it is what the document keeps.** A pure converter in
  `src/library/hdl/` turns Yosys's JSON into the IR: ports, named signals, word-level cells
  (logic, arithmetic, comparisons, multiplexers, shifts, flip-flops, latches, memories), 4-state
  constants, specify paths and timing checks, each cell with its source location for messages.
  It is JSON-serializable: a module of a document is its IR (not its `.v`, which stays with the
  user), so a document opens, simulates and runs its benches without Yosys. Its types live in
  `core`, which both `circuit` (storing it) and `library` (making and running it) may import.
- **One interpreter runs every module.** A generic `Behavior` in `src/library/hdl/`: state in
  typed arrays (a value and an unknown bit plane per signal), so snapshots and carry-over work as
  for any part; combinational cells evaluated in topological order at zero delay within one
  `evaluate`, no events inside a module; flip-flops and latches on the kernel's strict edges, an
  edge from `X`/`Z` making the stored bits `X`; outputs driven through the kernel (inertial, like
  every part) with the delays of the module's `specify` paths, or with one delay set on the part
  where the module has none (a document's module, until HDL-2); `specify` timing checks run by
  `TimingChecks`. A part whose definition changed (a module compiled again) starts from power-on
  when the running simulation carries over, as one whose props changed.
- **A module is a black box with pin to pin timing**, as data sheets describe chips: delays in
  the code (`#5`) are not simulated, as synthesis ignores them. A library part is a module plus
  its data sheet metadata (pinout, pin descriptions, function table); a document's module is a
  circuit of the document whose content is the IR, placed like a subcircuit, its vector ports bus
  pins; a programmable device (HDL-5) holds a module and times its pins by the device's data
  sheet instead.

## Consequences

- A part made from Verilog is an ordinary part: waveforms, debugger, rewind, test benches and
  design checks work with it unchanged, and a Verilog 74HC00 can be held to the hand-written
  74HC00's tests.
- What is simulated is what Yosys synthesizes — the front end of the open-source FPGA flows
  (iCE40, ECP5) — not a separate reading of the language.
- The app ships no compiler: nothing large is downloaded, but the user needs Yosys installed
  and one more step after editing (run the command, paste or import, Compile). Errors in the
  Verilog are Yosys's, in the user's terminal and editor; the app reports what it can't run, at
  the source location the JSON gives.
- A JSON made with other passes (not flattened, `proc` not run, a gate-level `synth`) is refused
  with the command to use; the user's Yosys version is kept with the IR and an older one than the
  tested one gives a warning, as Yosys's cell library changes over time.
- Speed: the interpreter evaluates a module's cells on every input change. Fine for chips;
  for a soft core of thousands of cells it is measured in HDL-1 and HDL-7, and HDL-10 makes it
  fast (the IR compiled to JavaScript or WebAssembly).
- `X` is pessimistic by design, so results can differ from a Verilog simulator where the source
  relies on Verilog's optimistic `X` (an `always @(posedge clk)` firing on `X → 1`).
- Testbench Verilog (`initial` stimulus, `$display`, delays) is not supported: test benches are
  the simulator's own ([ADR-0025](0025-test-benches.md)).
- The converter depends on Yosys's JSON format and cell library: it is tested on fixtures made
  by the system Yosys and committed. VHDL could come the same way (GHDL's Yosys plugin writes
  the same JSON) but is not planned.

## Alternatives considered

- **Yosys in the app**, packaged for WebAssembly by YoWASP and run in a Web Worker, the `.v` kept
  in the document and edited in the app with errors at their lines — the first plan of HDL-1.
  Rejected when HDL-1 started: a 69 MB WebAssembly module (≈ 16 MB to download) and a compile
  service for what the user's own Yosys does natively, and the user's FPGA flow needs that Yosys
  anyway. Kept as a track idea for users without Yosys; the IR doesn't care who made it.
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
  from the synthesis tools'.
- **The synthesized gate netlist as `prim/*` parts in the kernel** — no new runtime, but
  thousands of components and events per clock, glitches inside a chip that the black-box data
  sheet model doesn't have, and delays per internal gate that nobody specifies.

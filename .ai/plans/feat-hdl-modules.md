# Plan: feat/hdl-modules

| Field      | Value                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Branch     | `feat/hdl-modules`                                                                                            |
| Roadmap    | HDL-1 — Verilog modules in the document, track [Programmable logic](../../docs/roadmap/programmable-logic.md) |
| Status     | in-progress                                                                                                   |
| Depends on | — (builds on R11a subcircuits, R15a/R15b test benches, R14b snapshots)                                        |
| Created    | 2026-11-09                                                                                                    |

## Goal

The user writes logic in Verilog — the address decoder of a 6502 system, glue logic, a counter,
a state machine — instead of wiring it from 74HC chips, synthesizes it with Yosys on their own
computer, brings Yosys's JSON netlist into the app, places the module in a circuit as a part,
and runs and tests it there; the same `.v` goes on to the FPGA's or CPLD's tools. The app never
runs Yosys (Q5): a pure converter turns the JSON into an IR (plain data) stored in the document,
and one interpreter in the library runs the IR as an ordinary part — 4-state values, strict
edges, one output delay, snapshots and test benches like every other part. The track's later
items (tri-states, the full cell set, inspection, memories, speed, library parts, devices) grow
this same pipeline.

## Scope

**In scope**

- The IR (types, validation) and the converter from Yosys's JSON, with every refusal at its
  source line (`decoder.v:12`, from Yosys's `src` attributes).
- The interpreter for the cells a decoder, a counter and a state machine need: bitwise and
  reduction logic, logic operators, comparisons, `$mux`/`$pmux`, `$add`/`$sub`/`$neg`/`$pos`,
  `$shl`/`$shr`/`$sshl`/`$sshr`, flip-flops (`$dff`, `$dffe`, `$adff`, `$adffe`, `$sdff`,
  `$sdffe`, `$sdffce`), latches (`$dlatch`, `$adlatch`); unsigned operands, at most 32 bits.
- Modules in the document: a circuit whose content is a compiled IR (Q1), placed as a part with
  bus pins (Q2) and a `delay` (Q4), with its own test benches and design issues.
- The module view: a JSON editor (paste, or Import from a file), **Compile** (JSON → IR into the
  document), the module's ports, cells and messages, the Yosys command to copy.
- `scripts/` running the system `yosys` (Q7) for the converter's fixtures and the examples'
  modules; `pnpm check` never runs Yosys.
- Examples (the decoder with its bench; a counter; a state machine), e2e test, benchmark
  baseline for HDL-10; the track and ADR-0030 re-scoped to Yosys outside the app, ADR-0030
  accepted.

**Out of scope** (and where it goes instead)

- Yosys inside the app, an in-app Verilog editor → a track idea ("Yosys in the browser"), not
  scheduled (Q5).
- The `.v` source in the document → not kept (Q6); it lives with the user (and in git).
- Tri-state outputs, `inout` ports (refused with an error) → HDL-8.
- Signed operands, `$mul`/`$div`/…, `$bmux`/`$demux`, `$eqx`, other
  flip-flop flavours, values over 32 bits, clocks made inside the module, combinational loops,
  `init` power-up values (refused, or for `init` a warning) → HDL-9.
- Gate-level netlists (`$_AND_`, `$_DFF_P_`, … from `synth`/`techmap`; refused with the
  command to use) → a track idea.
- Carrying a module's state over a recompile (by signal name) → HDL-3 (re-scoped, task 1).
- Internal signals in waveforms, watches, benches → HDL-4.
- Memories (`$mem_v2`, refused) → HDL-6.
- Speed beyond a measured baseline → HDL-10.
- `specify` timing, library parts in Verilog → HDL-2. Device timing and pin assignment → HDL-5.

## Context

- [docs/roadmap/programmable-logic.md](../../docs/roadmap/programmable-logic.md) — HDL-1 and
  the items after it.
- [ADR-0030](../../docs/adr/0030-hdl-modules.md) (proposed) — the pipeline; amended (Yosys
  outside the app) and accepted here.
- [ADR-0023](../../docs/adr/0023-subcircuits.md), [circuit.md#subcircuits](../../docs/circuit.md#subcircuits)
  — how a document's circuit is placed, flattened and given a generated definition
  (`src/circuit/subcircuit.ts`, `design.ts`).
- [ADR-0025](../../docs/adr/0025-test-benches.md), [ADR-0026](../../docs/adr/0026-test-bench-sandbox.md)
  — benches per circuit, the Tests tab, CodeMirror (`src/ui/ScriptEditor.tsx`).
- [ADR-0010](../../docs/adr/0010-running-simulations.md),
  [simulation.md#editing-while-running-carry-over](../../docs/simulation.md) — carry-over
  (`src/core/simulator.ts`), which matches parts by type and props only.
- [ADR-0021](../../docs/adr/0021-rewind.md) — part state must be plain data in typed arrays.
- [components.md#edge-triggered-chips](../../docs/components.md#edge-triggered-chips) — the
  library's rule for uncertain edges, which modules follow.
- Yosys's JSON backend (`write_json`): modules with `ports` (direction, bits), `cells` (type,
  parameters as binary strings, connections as bit lists, `src` attributes), `netnames`; bits
  are integers from 2 or the constants `"0"`, `"1"`, `"x"`, `"z"`; `creator` names the version.

## Design

### Yosys, outside the app (Q5, Q7)

- **The command** — one pass script, shown in the module view with a copy button and in the
  docs:

  ```sh
  yosys -q -p 'read_verilog decoder.v; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; check; write_json decoder.json'
  ```

  `proc -norom`: plain `proc` turns a `case` with constant outputs (a decoder written as a
  table) into a ROM (`$memrd_v2` + `$meminit`), which modules can't hold before HDL-6; the
  converter recognizes that ROM and asks for the command.

  No `-specify` yet (HDL-2); SystemVerilog through `read_verilog -sv` works as far as the cells
  it produces are supported. Several files, `` `include ``, the top module — the user's command
  line, not the app's concern.
- The converter accepts what this command produces and refuses anything else with the reason
  and the command: no module marked `top`, cells of user module types (not flattened),
  processes left (`proc` not run), gate-level cells (`synth`/`techmap` run).
- **Version**: the JSON's `creator` is kept with the IR and shown; no version warning — the
  converter refuses any cell it doesn't know, which is the real safety net (an old Yosys without
  `proc -norom` fails on the command itself).
- **The repo** uses the system `yosys` on `PATH` (`brew install yosys`): `scripts/yosys.ts`
  runs the command; `pnpm hdl:fixtures` regenerates the converter's fixtures, `pnpm
  hdl:examples` the examples' modules, both from `.v` files kept next to them. Neither is part
  of `pnpm check`, which uses what they committed.

### IR

- Types and validation in **core** (`src/core/hdl-module.ts`): `circuit` stores and validates
  it in documents, `library` produces and runs it, and both may import only `core`.
- Shape (format 1, `src/core/hdl-module.ts`): `{ format: 1, top, creator, bitCount, ports:
  [{ name, dir, lsb, bits, init?, src? }], signals: [{ name, lsb, bits, init?, src? }], cells:
  [{ type, src, ports: { A: bits, … }, params: { CLK_POLARITY: 0|1, ARST_VALUE: bits, … } }] }`
  — Yosys's port names, every connection a list of bit indices (renumbered from 0, no gaps) or
  the constants `'0'`, `'1'`, `'x'`, each cell with its first source location. Polarity
  parameters are numbers, reset values bits least significant first; widths come from the
  connections. A later format change gets a document migration like any schema change.
- `hdlModuleProblems` (core) checks the shape for loading documents; the semantics — one driver
  per bit, flip-flop clocks and asynchronous resets from inputs or constants, no combinational
  loop — are `analyzeHdlModule`'s (library), which also gives the evaluation order and the
  warnings (an inferred latch, an `init` value).
- **Converter** (`src/library/hdl/from-yosys.ts`): Yosys JSON (text or value) → IR and messages,
  at the cell's or port's source location. Refuses: cells outside HDL-1's set, signed operands,
  word operands over 32 bits, memories (and a ROM `proc` made of a `case`), `inout` ports and
  `z`, a hierarchy not flattened, a gate-level netlist, and what the analysis refuses. Word cells
  (arithmetic, comparisons, shifts) take operands up to 32 bits; bitwise cells, multiplexers,
  flip-flops, latches and ports have no width limit. `$shift`/`$shiftx` (a variable bit or part
  select, `v[i]`, `v[i +: 2]`) are in HDL-1, their amount may be signed.
- Ports: plain identifiers (no `$`), vector indices 0–99 (bus names); an ascending vector
  (`[0:3]`) is refused — its numeric value would read reversed against the app's buses.
  Outputs may be input bits or constants; bits nothing drives become `x` with a warning.
- Dropped: `$scopeinfo` (hierarchy information `flatten` leaves) silently; `$print`
  (`$display`) and `$check`/assertions with a warning.
- Tested on committed fixtures (`.v` sources and the `.json` Yosys made of them), so `pnpm test`
  never needs Yosys.

### Interpreter

- `src/library/hdl/module-part.ts`: `hdlPart(type, name, ir) → AnyComponentDefinition`. Pins:
  one per port bit (`addr0`…`addr15` for `addr[15:0]`), inputs then outputs, in declaration
  order. Props: `delay` (Q4: default 15 ns, an ATF22V10C-15's tPD). `create` → a behavior whose
  state is two `Uint8Array` planes (value, unknown) over the IR's bits plus the flip-flops'
  previous clock levels — plain data, so snapshots, replicas and rewind work unchanged.
- `evaluate` (`module-part.ts`, cells compiled once per module in `cells.ts`): first the
  flip-flops whose clock had an edge (`clockEdge` of the 74xx helpers: strict edges, an uncertain
  one makes `X` only the bits a load would change — and `0 → X → 1` is two uncertain edges, as
  for the library's chips) compute their next states **from the planes as they were before this
  delta**, then all load at once (a shift chain shifts by one); then the input pins are read
  into the planes; asynchronous resets apply (level-sensitive, an unknown one merges); the
  combinational cells and latches (as combinational cells: `Q = EN ? D : Q`) run once each in
  topological order; every output bit is driven with `delay`. A data input changing in the
  same delta as the clock edge is therefore sampled before the change — a race on real
  hardware anyway, which HDL-2's timing checks will report.
- `X` semantics: bitwise cells per bit (`0 & X = 0`, `1 | X = 1`); reductions, comparisons and
  logic operators known when the known bits decide; arithmetic `X` from the lowest unknown bit
  up; a `$mux` with an unknown select gives the bits where both inputs agree, else `X`;
  `$pmux` likewise over the possible cases.
- Registry hook: core's `ComponentRegistry` gets an optional `hdlPart(type, name, ir)`; the
  library registry (`createDefaultRegistry`) implements it, so the circuit layer can make a
  module's part without importing the library.

### Modules in the document (Q1–Q4, Q6)

- A module is **a circuit written in Verilog** (Q1): `Circuit.verilog = { module?: HdlModule }`
  — the object marks it (`{}` before the first Compile: `hdl-not-compiled`, a warning, nothing
  to place), `module` is the IR; no components or wires (left out of the file; a load error if
  any); `probes` and `testScript` as any circuit. An object rather than a bare `module`, so later
  items can add to it (HDL-5's pin assignment).
  The `.v` source is not kept (Q6). Schema v6; the migration changes nothing. It is in the
  Circuits list (with a Verilog mark), placed as `sub/<id>` with designator `A`, opened in its
  instances, deleted, duplicated and renamed like a drawn circuit.
- **Its instance's pins** come from the IR's ports (`circuitPorts` of a module): inputs left,
  outputs right, in declaration order; a vector port is a **bus pin** (`addr[15..0]`, Q2)
  joined to the outer bus member by member exactly as a subcircuit's bus port; the same box
  symbol as subcircuits.
- **Compiled on its own** (`compileCircuit` of a module, `src/circuit/verilog.ts`): one
  simulated part — id `U1` (the chip on the module's board), type `hdl/<circuit id>` — and a net
  per port bit named after its pin (`addr12`, `cs_rom_n`). Flattening then needs one thing more:
  the instance's props (its `delay`) go to the part inside; the part becomes `A1/U1`, its port
  nets join the outer nets and buses member by member, benches with the module as the top drive
  its port nets. `HDL_FAMILY`, `hdlPartType`, `HDL_DEFAULT_DELAY` and `hdlDelayProp` are core's
  (the instance needs the prop even when the module has no part).
- `DocumentRegistry` asks the library's `hdlPart` once per IR object and name (so unrelated
  edits keep the part's definition and the simulator its state) and serves `hdl/<id>` to the
  kernel; `CompileCache` recompiles a module when its part changes. Issues carry the source
  location (`DesignIssue.src`) and have it in front of the message.
- **Compile** is an ordinary edit (`Editor.setModule`): one undo step that replaces the IR; a
  JSON that doesn't convert changes nothing and shows its messages. Warnings of the IR in the
  document (latch, `init`, old Yosys) are design issues of the module's circuit (`hdl-warning`,
  with the source location in the message); errors never reach the document.
- The DocumentRegistry keeps a module's generated definitions while its IR is the same object,
  so unrelated edits keep the simulator.

### Running and recompiling

- **Carry-over by definition**: the kernel keeps a carried part's state only when its definition
  is the same object, not just the same type and props — otherwise it starts like a part whose
  props changed (power-on state and `init`, outputs driving what they drove). So a Compile
  while running restarts the module's instances from power-on and the rest of the circuit runs
  on (HDL-3 carries the module's state over by signal name).

### UI

- **Circuit ▸ Add Verilog Module** (and in the Circuits list): `Module N`, opened, empty.
- Opening a module shows the **module view in place of the canvas** (`ModuleView.tsx`):
  - a JSON editor (CodeMirror with the Tests tab's setup, no new package) where Yosys's output
    is pasted; **Import JSON…** (also File ▸ Import Yosys JSON…) reads a file into it; a parse
    error shows at its line;
  - **Compile**: converts it, and on success writes the IR into the document; the converter's
    errors and warnings are listed with their source locations (`decoder.v:12: memories aren't
    supported yet (HDL-6)`). The editor's text is a draft of the session, not the document;
  - the compiled module: top name, Yosys version, ports (name, direction, width), cell counts by
    type, warnings, the instances placed;
  - the Yosys command with a copy button.
- Breadcrumbs, Properties of the open circuit (name, ports), Messages, the Tests tab (the
  module's own benches) work as for drawn circuits.

### Proof

- `examples/verilog-address-decoder.logic.json`: the BE6502 memory map in Verilog (RAM
  `$0000–$3FFF`, VIA `$6000–$7FFF`, ROM `$8000–$FFFF`, chip selects active LOW), its `.v` next
  to it, with its own bench over every region boundary, and a top circuit with switches and
  LEDs.
- `examples/verilog-counter-fsm.logic.json`: a decade counter with enable and reset, and a
  state machine (a traffic light), each with a bench.
- `tests/e2e/hdl.spec.ts`: add a module, paste a decoder's JSON, Compile, place it, wire it,
  run, LEDs follow; a JSON with a memory shows the error; run the module's benches in the app.
- `tests/bench/hdl.bench.ts`: evaluate cost per cell, a counter clocked for 1 ms simulated, a
  synthetic ≈ 1 000-cell module — the baseline HDL-7 and HDL-10 compare against.

## Tasks

- [x] 1. Roadmap and ADR: HDL-1's section (Yosys outside the app, the JSON imported and
  compiled to IR), HDL-3 re-scoped (what remains without an in-app Yosys: state carried
  over a recompile), ideas ("Yosys in the browser", gate-level netlists); ADR-0030 amended
  (still proposed until task 13). `pnpm check`; commit.
- [x] 2. `scripts/yosys.ts` with the system `yosys`; fixtures (`.v` + `.json`) for the decoder,
  counter, FSM, a latch, and each refusal; `pnpm hdl:fixtures`.
- [x] 3. IR types and validation in core (`hdl-module.ts`); converter
  `src/library/hdl/from-yosys.ts`: ports and bit naming, refusals and warnings at their
  source locations, the "not made by the command" checks.
- [x] 4. Interpreter, combinational: cell evaluators with `X` rules, topological order, the part
  definition (pins per bit, `delay`); tests per cell and a decoder function table.
- [x] 5. Interpreter, sequential: flip-flops and latches on strict edges, asynchronous and
  synchronous resets, enables, uncertain edges; counter and FSM tests; snapshot/restore and
  determinism tests.
- [x] 6. Core: carry-over by definition identity (+ regression test); `ComponentRegistry.hdlPart`
  hook implemented by the library registry.
- [x] 7. Document schema v6: `Circuit.verilog` (`{ module? }`), migration, validation,
  serialization (a line per port, signal and cell), round trip; examples re-saved as v6.
- [x] 8. Circuit layer: modules in `DocumentRegistry` (ports, bus pins, symbol), `compileCircuit`
  of a module, flattening, issues (`hdl-not-compiled`, `hdl-warning`), benches with a
  module as the top, resolver references; a scenario test of the decoder in a circuit.
- [ ] 9. Editor: `setModule` (one undo step), Add Verilog Module, carry-over on Compile while
  running.
- [ ] 10. UI: the module view (JSON editor, Import JSON…, Compile, messages, summary, the
  command), the Circuits list's mark, File ▸ Import Yosys JSON…; looked at in the browser.
- [ ] 11. Examples (decoder; counter and state machine) with `.v` sources, `pnpm hdl:examples`,
  benches passing in the app and headless; `tests/e2e/hdl.spec.ts`.
- [ ] 12. Benchmark `tests/bench/hdl.bench.ts`; the baseline recorded here and in the docs.
- [ ] 13. Docs: circuit.md (modules, schema v6, issues), components.md (`hdl/*` parts, the
  interpreter's rules, the command), simulation.md (carry-over by definition), editor.md
  (the module view), architecture.md, glossary; ADR-0030 accepted; lessons; the track's
  HDL-1 section.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green; `pnpm e2e` passes `hdl.spec.ts`.
- [ ] In the browser: Add Verilog Module, paste the decoder's JSON (made by the shown command),
  Compile; place it in the top circuit, wire it to switches and LEDs, run — the LEDs follow
  the decoder. A Compile of a changed JSON while running restarts the module and the rest of
  the circuit runs on; Undo brings the previous IR back.
- [ ] The decoder example's bench passes in the Tests tab and with `pnpm test:circuits`, with no
  Yosys involved.
- [ ] The counter and the state machine run and pass their benches (in the app and headless).
- [ ] JSONs with a memory, a combinational loop, a signed operand, a 33-bit addition, an `inout`
  port, an unflattened module and a gate-level netlist are refused with the reason and the
  source location (or the command); an inferred latch is a warning with its location.
- [ ] A module's state rewinds (the rewind property test covers the examples).
- [ ] The benchmark's baseline is recorded; ADR-0030 is accepted.

## Open questions

- [x] Q1. Where a module lives and where it is edited — _proposed:_ a circuit written in Verilog:
  in the Circuits list, placed like a subcircuit (`A1`), opened in place of the canvas, with
  its own benches — **answer:** as proposed.
- [x] Q2. Vector ports on the instance — _proposed:_ one bus pin per vector port
  (`addr[15..0]`), joined bit by bit like a subcircuit's bus port — **answer:** as proposed.
- [x] Q3. The compiled IR in the document — _proposed:_ yes, as a cache next to the source —
  **answer:** yes; after Q5 the IR is the module's only content, not a cache.
- [x] Q4. The module's delay — _proposed:_ a property of each instance, `delay`, default 15 ns
  (an ATF22V10C-15's tPD) — **answer:** as proposed.
- [x] Q5. Yosys in the browser (≈ 16 MB gzip, a 69 MB wasm) — **answer** (the user's proposal):
  no. The loop is independent of the app: the `.v` stays on the user's computer, they run
  Yosys themselves, and paste its JSON into the module's editor or import it from a file;
  Compile turns it into the IR kept in the document. No link to the file, no reload.
- [x] Q6. The `.v` source in the document — _proposed:_ no, only the IR — **answer:** as
  proposed.
- [x] Q7. Which Yosys the repo's scripts use for fixtures and examples — _proposed:_ the system
  `yosys` (`brew install yosys`), no npm dependency — **answer:** as proposed.

## Progress log

- 2026-11-09 — plan drafted with Yosys in a worker (YoWASP); Q1–Q4 answered as proposed.
- 2026-11-09 — the user proposed keeping Yosys out of the app (Q5): JSON pasted or imported,
  compiled to IR in the document. Plan rewritten: no worker, no wasm, no in-app Verilog editor;
  Q6, Q7 answered as proposed.
- 2026-11-09 — the user approved the plan and installed Yosys 0.70+post (Homebrew); started.
- 2026-11-09 — tasks 1–3: track and ADR re-scoped; fixtures from the system Yosys (21 sources);
  IR in core, converter and analysis in the library. Found: plain `proc` makes a ROM of a
  decoder's `case` (the command uses `proc -norom`); `v[i +: 2]` gives a `$shiftx` with a signed
  amount (accepted); `init` sits on output ports too.
- 2026-11-09 — tasks 4–5: the interpreter (cells compiled to steps over byte planes, flip-flops
  in two phases); tests per cell against JavaScript (seeded) and per module through the core
  bench (decoder table and delay, counter, traffic light, every flip-flop flavour, latches,
  wires, shifts, a shift chain, snapshot/restore).

## Handoff

- **State:** plan approved, started; no task done yet.
- **Next step:** task 1 (track and ADR re-scope). Task 2 needs `yosys` on `PATH` (installed:
  0.70+post, Homebrew).
- **Watch out:** the kernel's carry-over matches by type and props only (task 6 before a module
  is recompiled while running). `pnpm test` must never run Yosys (fixtures).
- **Verify with:** `pnpm check`.

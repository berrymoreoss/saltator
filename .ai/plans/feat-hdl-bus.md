# Plan: feat/hdl-bus

| Field      | Value                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Branch     | `feat/hdl-bus`                                                                                 |
| Roadmap    | HDL-8 — Modules on a bus, track [Programmable logic](../../docs/roadmap/programmable-logic.md) |
| Status     | in-progress                                                                                    |
| Depends on | — (builds on HDL-1 `feat/hdl-modules`, R12a bidirectional memory pins, R15a test benches)      |
| Created    | 2026-11-10                                                                                     |

## Goal

A Verilog module shares a bus with other parts, as an I/O port, a GAL's glue logic or a
peripheral does on a homebrew computer's data bus: `assign d = oe ? q : 8'bz` releases its pins,
an `inout` port drives the bus and reads it back, two drivers at once are the kernel's
`contention`, and a floating bus reads `X`. HDL-1 refused all of it. The command gains
`tribuf -logic`, the IR gains `inout` ports, the constant `z` and the `$tribuf` cell, and the
interpreter drives `Z`; everything else of the pipeline (ADR-0030) stays as it is. Taking and
releasing the bus use the module's one `delay` until HDL-2 brings per-path timing.

## Scope

**In scope**

- The command: `tribuf -logic` after `flatten`, before `opt -keepdc` (what Yosys 0.70 does with
  it is below); fixtures and examples regenerated with it.
- IR: `dir: 'inout'`, the constant `'z'` in output and inout port bits, the `$tribuf` cell
  (`A`, `EN` → `Y`); the shape check; document schema v7 (the migration changes nothing).
- Converter and analysis: accept them; refuse what still can't run (two inout ports joined
  inside the module, a `z` made without `tribuf`) with the reason at the source line.
- Interpreter: tri-state outputs (`tristate` pins), inout ports (`bidir` pins read back), an
  unknown enable driving `X`, `Z` read as `X`, floating inputs reported as Q1 decides.
- Circuit layer: inout ports as bidirectional (bus) pins of the instance; the inner part's pins
  `tristate`/`bidir`, so modules sharing a bus are no `shorted-outputs`; benches driving and
  releasing a module's inout port.
- Proof (Q2: no example): an I/O port on a data bus, written and read through it by a test
  bench; two drivers at once reported as `contention` (scenario tests); e2e on a fixture; no
  slowdown of HDL-1's benchmark.
- Docs: components.md, circuit.md, editor.md, simulation.md (if Q1 adds to `EvalContext`),
  ADR-0030 amended, the track's section as built, lessons.

**Out of scope** (and where it goes instead)

- Per-path timing (`tPZH`, `tPHZ`, … from `specify`) → HDL-2.
- Pin keepers / bus hold (an ATF22V10C or ATF1504 holds a floating pin's last level) → HDL-5,
  as a property of the device.
- Two tri-state drivers of one pin inside a module are merged by `tribuf -logic` into one
  driver: both enabled drive `X` without a `contention` (one driver to the kernel). Documented;
  a diagnostic for it would need Yosys's `tribuf -formal` assertions → the track's idea
  "Messages and assertions from a module".
- Whether the 6502's peripherals are written in Verilog → R18 (MOS 6502).
- An example document (Q2: none in this item) — the I/O port lives in fixtures and tests.
- Open-drain outputs with a pull-up (`assign irq_n = irq ? 1'b0 : 1'bz`) work as a side effect
  (`$tribuf` with `A = 0`) and get a test, but no example of their own.

## Context

- [docs/roadmap/programmable-logic.md](../../docs/roadmap/programmable-logic.md) — HDL-8 and its
  neighbours (HDL-9 semantics, HDL-2 timing).
- [ADR-0030](../../docs/adr/0030-hdl-modules.md) — the pipeline; amended here (the command,
  tri-states).
- [.ai/plans/feat-hdl-modules.md](feat-hdl-modules.md) — HDL-1's design: the IR, the converter,
  the interpreter's two-phase flip-flops, modules in the document.
- [docs/simulation.md#reading-inputs](../../docs/simulation.md) — "only floating values that are
  actually consumed are reported, so idle bidirectional buses don't produce noise";
  power-on: `tristate`/`bidir` pins start released.
- [docs/components.md](../../docs/components.md) — 3-state buffers (unknown enable drives `X`),
  the 74HC245 ("only the input port is read"), memories ("the address is read only while the
  outputs drive"), Verilog modules.
- [docs/circuit.md](../../docs/circuit.md) — subcircuit ports (`in`/`out`/`bidir`), flattening,
  `shorted-outputs`, test benches (`b.set({ d: 'Z' })` releases a port, contention fails a bench).
- `src/core/hdl-module.ts`, `src/library/hdl/{from-yosys,analyze,cells,module-part,command}.ts`,
  `src/circuit/verilog.ts`, `src/circuit/subcircuit.ts`, `src/circuit/checks.ts`
  (`shortedOutputs`), `src/core/simulator.ts` (`readPin`, `reportFloating`).

## Design

### What Yosys makes of tri-states (0.70+post, tried on 2026-11-10)

- Without `tribuf`, `oe ? a : 4'bz` stays a `$mux` with `"z"` inputs, and two drivers of one
  net stop Yosys itself ("already driven"). `tribuf` turns such muxes into `$tribuf` cells
  (`A`, `EN`, `Y`); `-logic` (which implies `-merge`) merges several drivers of one net into one
  `$tribuf` fed by a `$pmux` (default `x`) with `EN` = the OR of the enables, and turns tri-states
  that drive no output port into logic. So: one driver per bit, the analysis's "driven twice"
  holds.
- An `inout` port's bits are driven by a `$tribuf` and read by the cells that use the port
  (`q <= d` reads the inout's bits). An inout only read has no driver; an inout assigned plain
  logic (`assign w = a`) shares the driver's bits (here an input's).
- `-logic` may leave a merged `$tribuf` with `EN = "1"` on internal bits when some of its bits
  also reach an output port (`assign y = bus ^ 4'b0101`): a `$tribuf` can drive internal bits.
- `assign y = 2'bz` leaves constant `"z"` port bits; `assign io[0] = 1'bz` makes the cells that
  read `io[0]` read the constant `"z"`, not the pin (Yosys loses the connection).
- `read_verilog` prints "Yosys has only limited support for tri-state logic at the moment" for
  every tri-state: harmless, said in the docs next to the command.

### The command

`read_verilog …; hierarchy -auto-top; proc -norom; flatten; tribuf -logic; opt -keepdc; check;
write_json …` — after `flatten`, so tri-states from submodules merge and those left inside become
logic. A JSON made without it (a `$mux` with `z` inputs) is refused with the command to use.

### IR (format stays 1, additive; document schema v7)

- `HdlPort.dir`: `'in' | 'out' | 'inout'`.
- `HdlBit` gains `'z'`, allowed only in `out` and `inout` port bits (a bit the module never
  drives). In cell inputs the converter makes it `'x'` (a released net reads `X`), with a warning
  where an inout bit was assigned `z` and read ("leave it unassigned to read the pin").
- `$tribuf`: kind `tribuf`, inputs `A`, `EN` (one bit), output `Y`, no parameters.
- Schema v7: the IR may hold them; the migration changes nothing (as v2, v3, v6). An older app
  says "saved by a newer version" instead of "not a cell HDL-1 runs".

### Analysis

- Who drives a bit: inputs; an `inout` bit not driven by a cell other than a `$tribuf` — the pin
  (read back, like an input); cells as before. A `$tribuf`'s `Y` bits that are inout bits are
  not drivers of the planes: the tribuf drives the pin, the planes hold what the pin reads.
- Refused: two inout ports sharing bits (a wire between two pins can't be a one-way part); an
  inout bit driven twice (can't happen after `-logic`, checked anyway).
- Clocks and asynchronous resets may come from inout bits read from the pin (`posedge c` on an
  inout works in Yosys).

### Interpreter

- Pins: `in` → `in`; an `out` port bit driven by a `$tribuf` or `'z'` → `tristate`, else `out`;
  `inout` → `bidir` (an inout bit driven by plain logic is a `bidir` pin that always drives).
- `$tribuf` is a combinational step: into the planes (internal and `out` bits) `EN ? A : X`
  (a released net reads `X`); for its port bits it also sets the pin's drive: `A` when `EN` is 1,
  released when 0, strong `X` when unknown ("it might be driving", as the library's 3-state
  buffers).
- Each `evaluate`: flip-flop edges (from the planes before the delta, as in HDL-1); then input
  **and inout** pins read into the planes (`Z` → `X`); resets; combinational steps; every output
  driven with `delay` — `Z` too (inertial, so a bit released and taken again within `delay` never
  floats). Power-on: `tristate` and `bidir` pins start released, as the kernel does for every
  part.
- An `output` port's tri-state bits read inside the module as the module drives them (`X` when
  released): Verilog's `output` doesn't look outside; an `inout` does (the pin's level).
- A module driving its inout while another part drives the same net: the kernel's `contention`
  on that net; its own read-back then reads `X`.

### Floating inputs (Q1: as proposed)

HDL-1 reads every input pin on every evaluation, so a floating one is reported each time the
module evaluates. With bidirectional buses that is the noise simulation.md promises not to make:
a data bus floats between bus cycles in every 6502 system. _Proposed:_ report only floating values
the module uses, by the library's rule ("read only while it matters"):

- pins are read without reporting (`Z` → `X` in the planes; which pins are floating is kept in the
  state, plain data);
- the analysis gives every consumer the input/inout pins in its combinational fan-in: each driven
  output bit, each flip-flop (`D`, `EN`, `SRST`), each latch, each asynchronous reset;
- a floating pin is reported (`floating-input`, once until the net changes, as now) when a
  consumer it feeds comes out `X` — an output driven `X` (not released), a flip-flop loading an
  `X` at its edge, an open latch holding `X`, an asynchronous reset at `X`;
- the clock pins stay as they are (read by `clockEdge`: a floating clock is always reported);
- when no read pin is floating (most evaluations) none of this runs.
- Core gains two `EvalContext` methods: `level(pin)` (the level without reporting) and
  `reportFloating(pin)` (what `read` of a `Z` records). The over-approximation: a consumer that is
  `X` for another reason too (a register still `X` after power-on) also names the floating pin.

The same rule then applies to HDL-1's `in` pins (an unused, unconnected input is still the
static `undriven-input` warning).

### Circuit layer

- `modulePorts`: an inout port is a `bidir` port on the right, with the outputs (a vector a bus
  pin, as HDL-1's).
- `compileModule`: the inner part's placed pins carry `tristate`/`bidir`, so two modules (or a
  module and a 74HC245) on one bus are no `shorted-outputs`; their conflicts are `contention` at
  run time.
- Benches: a module's inout port is a bench input (`b.set({ d: 0x5A })`, `b.set({ d: 'Z' })` to
  release it) and readable (`b.get('d')`, `b.expect`); contention fails the bench, as for any
  circuit.

### Proof (Q2: no example)

- `src/library/hdl/*.test.ts`: every tri-state shape above from Yosys's own JSON (fixtures),
  `Z`/`X` on enable 0/1/`X`, read-back, floating reported only where used, snapshot/restore.
- `tests/scenarios/verilog-bus.test.ts`: an I/O port module written and read through its data bus
  by a bench; two modules driving one bus → `contention`; a module and a 74HC244 handing the bus
  over.
- The I/O port (fixture `io_port.v`): an 8-bit output register and an 8-bit input port behind
  one data bus (`cs_n`, `rw`, a strobe); its bench writes `$A5`, releases the bus, reads the
  input port and expects it on the bus.
- `tests/e2e/hdl.spec.ts`: paste the I/O port's JSON into a module, Compile — the inout port is
  listed and placed as a bus pin; its bench passes in the Tests tab.

## Tasks

- [x] 1. Command (`tribuf -logic`); fixtures for the tri-state shapes (tri-state output, I/O
  port, two drivers merged, internal bus, a 74HC574 in Verilog, `always @*` with `z`, open
  drain, constant `z`, inout only read, inout of plain logic, a clock from an inout, two inouts
  joined, `z` without `tribuf`); every fixture and example regenerated (HDL-1's unchanged
  otherwise — checked).
- [x] 2. IR in core: `inout`, `'z'`, `$tribuf`; shape check and its tests; schema v7 with a
  no-op migration, round trip.
- [x] 3. Converter and analysis: accept and refuse as above (messages at source lines); drivers
  with pins read back; fan-in cones of the consumers (if Q1 as proposed).
- [x] 4. Core (if Q1 as proposed): `EvalContext.level`, `EvalContext.reportFloating`; kernel tests
  (once until the net changes, snapshots and replicas).
- [x] 5. Interpreter: pin directions, `$tribuf` steps and drives, inout read-back, floating rule;
  tests per shape through the core bench, snapshot/restore, determinism, carry-over property.
- [x] 6. Circuit layer: inout ports as `bidir` (bus) pins, inner pins' directions, flattening,
  benches; `tests/scenarios/verilog-bus.test.ts` (bench writes and reads, contention, a 74HC244).
- [x] 7. UI: the module view lists inout ports and shows the new command; looked at in the
  browser.
- [x] 8. e2e (`hdl.spec.ts`): the I/O port fixture compiled, placed, its bench passing in the
  Tests tab.
- [x] 9. Benchmark: `pnpm bench tests/bench/hdl.bench.ts` — HDL-1's numbers hold (no floating
  pin, no extra work); a bus case added.
- [x] 10. Docs: components.md (command, IR, cells, pins, the floating rule), circuit.md (schema
  v7, inout ports), editor.md (command), simulation.md (`level`, `reportFloating`),
  ADR-0030 amended, glossary if needed, the track's HDL-8 section as built, lessons.

## Acceptance criteria

- [x] `pnpm check` and `pnpm build` are green; `pnpm e2e` passes `hdl.spec.ts` — check 3333
  tests, build green, e2e 96 passed (2026-11-10).
- [x] A module with `assign d = oe ? q : 8'bz` releases its pins (`Z`) while `oe` is 0, drives
  `q` after `delay` when it becomes 1, drives `X` while `oe` is unknown — `module-part.test.ts`
  (15 ns measured both ways).
- [x] An I/O port module on a data bus is written and read through it by a test bench, headless
  (scenario test) and in the app (e2e), no Yosys involved — `verilog-bus.test.ts`,
  `hdl.spec.ts`.
- [x] Two drivers on one bus (two modules, or a module and a bench or a 74HC244) give the
  kernel's `contention`; a design with tri-state modules on one bus compiles without errors
  (`shorted-outputs` never looks into instances — found in task 6, R11a's, not this branch's) —
  `verilog-bus.test.ts` (a bench, two modules, a 74HC244), `module-part.test.ts`.
- [x] A floating bus the module doesn't use reports nothing; one it latches or drives out is a
  `floating-input` (per Q1) — `module-part.test.ts` (idle bus, a write, an output, an enable, a
  reset, a latch, not past a flip-flop), mutation-checked.
- [x] JSONs with two inouts joined and with `z` made without `tribuf` are refused with the reason
  and the source location (or the command) — `from-yosys.test.ts` on Yosys's own output.
- [x] HDL-1's examples, benches and benchmark are unchanged (within noise) — the examples came
  out the same with the new command, `pnpm test:circuits` 21 of 21, the benchmark in task 9.

## Open questions

- [x] Q1. When does a module report a floating input? — _proposed:_ only where it uses the value
  (fan-in cones, `EvalContext.level`/`reportFloating`), for `in` and `inout` pins alike — **answer:**
  as proposed (the user left it to the agent).
- [x] Q2. The proof beyond tests — _proposed:_ example Verilog I/O Port with a hand-operated
  board — **answer:** no example: unit, scenario and e2e tests on fixtures.

## Progress log

- 2026-11-10 — plan drafted; Yosys 0.70's handling of tri-states tried on 14 small sources.
- 2026-11-10 — Q1 as proposed (left to the agent), Q2 no example; the user approved the plan;
  started.
- 2026-11-10 — tasks 1–6: the command with `tribuf -logic` (HDL-1's fixtures and examples come
  out the same); IR `inout`/`z`/`$tribuf`, schema v7 (examples re-saved); converter and
  analysis (pins read back, joined inouts refused, cones); `ctx.level`/`reportFloating`; the
  interpreter (tests mutation-checked: 11 mutations, all caught); `hdlPinDirs` in core for the
  circuit layer; `tests/scenarios/verilog-bus.test.ts`. Found: a bus turned round at once
  floats for the module's delay (and an output passing it on reports it); a 74HC244 enabling
  as a module releases fights it for a few ns; `shorted-outputs` never looks into instances
  (subcircuits or modules) — R11a's, left as is.
- 2026-11-10 — tasks 7–8: the module view lists inout ports (task 2), the command shows
  `tribuf -logic`; looked at in the browser (Playwright screenshots: the module view, an
  instance with `d[7..0]` a bidirectional bus pin on the right); `hdl.spec.ts` 4 passed.
- 2026-11-10 — task 9: `pnpm bench tests/bench/hdl.bench.ts`, `main` (a worktree) against the
  branch, twice each, same machine: decoder 1.83–1.86 M vs 1.87–1.90 M evaluations/s, counter
  2.53–2.59 M vs 2.54–2.55 M, synthetic 12.8–13.0 k vs 12.2–15.0 k — within noise. New case,
  the I/O port written and read through its bus (the bus floating for the module's delay at
  each turn): ≈ 0.96 M evaluations/s, 6 a cycle.
- 2026-11-10 — task 10: components.md, circuit.md, editor.md, simulation.md, glossary, READMEs,
  ADR-0030 amended (the command, a module on a bus, the floating rule), the track's HDL-8
  section as built, lessons. Acceptance verified: check 3333 tests, build, e2e 96 passed,
  `pnpm test:circuits` 21 of 21.

## Handoff

- **State:** all tasks done and acceptance verified (check, build, e2e 96, `test:circuits`);
  the branch is ready for the finish-branch workflow (close the plan and the track item, then
  merge with the user's approval; no remote: `git merge --no-ff`).
- **Next step:** `/finish-branch` — plan `done`, HDL-8 `done`, the track's next item (HDL-9)
  `next`.
- **Follow-ups:** `shorted-outputs` never looks into subcircuit or module instances (R11a's
  design; a candidate for the Platform track if wanted).
- **Watch out:** `tribuf -logic` implies `-merge`; reading an inout assigned `z` reads a constant
  in Yosys's netlist, not the pin.
- **Verify with:** `pnpm check`; `pnpm e2e tests/e2e/hdl.spec.ts`; `pnpm bench
  tests/bench/hdl.bench.ts`; `pnpm hdl:fixtures` / `pnpm hdl:examples` need `yosys`.

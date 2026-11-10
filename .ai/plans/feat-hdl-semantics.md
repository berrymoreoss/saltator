# Plan: feat/hdl-semantics

| Field      | Value                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Branch     | `feat/hdl-semantics`                                                                                       |
| Roadmap    | HDL-9 — All of synthesizable Verilog, track [Programmable logic](../../docs/roadmap/programmable-logic.md) |
| Status     | in-progress                                                                                                |
| Depends on | — (builds on HDL-1 `feat/hdl-modules` and HDL-8 `feat/hdl-bus`)                                            |
| Created    | 2026-11-10                                                                                                 |

## Goal

A design written elsewhere runs as written: every cell the command's `proc` and `opt` leave in a
netlist, signed and of any width, flip-flops clocked and reset from inside the module,
combinational loops, and power-up values from `init`. HDL-1 refused all of these, and some come
from ordinary code: `d[sel] = 1'b1` makes a signed `$neg` and a signed `$shift`, `2 ** n` a
signed `$shl`, `wire [63:0]` arithmetic a 64-bit cell, `reg div = 0` a clock divider with an
`init`. The IR gains the cells and their signedness, the interpreter gains words of any width,
rounds of clock edges inside one `evaluate` and fixed points for loops. Where the board's result
would depend on which of two simultaneous changes wins (data at its clock's edge, a gated or
derived clock sampling the domain it comes from), the module loads `X` and says why, instead of
picking a winner as a Verilog simulator does (Q1). Proof: differential tests against Yosys's own
`sim` on the same netlists, and a UART as an example.

## Scope

**In scope**

- Cells: `$mul`, `$div`, `$mod`, `$divfloor`, `$modfloor`, `$pow`, `$eqx`, `$nex`, `$bmux`,
  `$demux`, `$bwmux`; the flip-flops and latches HDL-1 lacks — `$dffsr`, `$dffsre`, `$aldff`,
  `$aldffe`, `$sr`, `$dlatchsr`. (`$bmux`, `$demux`, `$bwmux`, `$divfloor`, `$modfloor`, `$sr`
  and `$dlatchsr` don't come out of Verilog through the command — read from other front ends'
  RTLIL, or a cell instantiated by name — and are tested on such fixtures.)
- Signed operands on every cell that has them (`A_SIGNED`, `B_SIGNED`): sign extension, signed
  comparisons, arithmetic shifts, signed division and powers.
- Any width: arithmetic, comparisons, shifts and multiplexers on words wider than 32 bits (a
  64-bit counter, a 32 × 32 multiplier).
- Flip-flops clocked, and asynchronously reset, set or loaded, from inside the module (a clock
  divider, a ripple counter, a gated clock, a reset made by logic).
- Races (Q1): a data pin changing in the same delta as its clock, and a flip-flop on a clock
  made by logic whose data changes at the same instant, load `X` and are reported
  (`setup-violation`, `race-violation`).
- Combinational loops iterated to a fixed point; `X` and an `oscillation` diagnostic where they
  don't settle; a warning when compiled.
- Power-up values from `init` (`reg q = 0`, `output reg q = 1`), `X` without one.
- Document schema v8 (new cells and parameters; the migration changes nothing).
- Differential tests against Yosys's `sim`: random expressions and small sequential designs, run
  by `pnpm hdl:differential` (system Yosys) and committed, checked by `pnpm check`.
- Example: a Verilog UART transmitter and receiver (Q2).
- Docs: components.md, circuit.md (schema v8), ADR-0030 amended (Q1), the track's section as
  built, lessons.

**Out of scope** (and where it goes instead)

- Memories (`$mem*`, `$readmemh`) → HDL-6.
- Carrying state over a recompile → HDL-3; signals by name in probes → HDL-4.
- Speed (32 bits at a time, only what changed, compiled IR) → HDL-10. This branch keeps HDL-1's
  benchmark for modules without the new features and measures the new ones.
- `specify` timing and timing checks → HDL-2.
- A device's own power-up (a GAL's registers reset at power-on, an iCE40's flip-flops at 0
  whatever the `init`) → HDL-5; here `init` is loaded as written, as an FPGA's bitstream does.
- Cells of a full synthesis or other passes: gate-level `$_*_`, `$lut`, `$sop`, `$alu`, `$macc`,
  `$fa`, `$lcu`, `$fsm`, `$concat`, `$slice`, `$buf` → the "Gate-level netlists" idea; formal
  cells (`$ff` on the global clock, `$anyconst`, `$initstate`, …) stay refused.
- `$print` and `$check` as log lines and diagnostics → the "Messages and assertions" idea.

## Context

Read before starting:

- [docs/components.md#verilog-modules-hdl](../../docs/components.md#verilog-modules-hdl) — the
  IR, cells, interpreter, floating rule as HDL-1 and HDL-8 built them.
- [ADR-0030](../../docs/adr/0030-hdl-modules.md) — the pipeline; this branch amends its
  interpreter paragraph (Q1).
- [feat-hdl-modules.md](feat-hdl-modules.md), [feat-hdl-bus.md](feat-hdl-bus.md) — earlier
  decisions and what was tried on Yosys.
- `src/core/hdl-module.ts` (IR, `HDL_CELLS`, shape check), `src/library/hdl/` (`from-yosys.ts`,
  `analyze.ts`, `cells.ts`, `module-part.ts`), `src/circuit/document.ts` (schema),
  `scripts/hdl-fixtures.ts`, `scripts/hdl-examples.ts`, `scripts/yosys.ts`,
  `tests/bench/hdl.bench.ts`.
- `.ai/lessons.md` (HDL-1, HDL-8: try a construct on the real Yosys before designing for it).

## Design

### What Yosys 0.70 makes (tried on 2026-11-10, the command as it is)

- `a * b` → `$mul` (Y as declared: 8 × 8 → 16); `/` `%` → `$div` `$mod`; `a ** n` → `$pow`;
  `2 ** n` → a signed `$shl` of a 32-bit 1; `===` `!==` → `$eqx` `$nex`.
- `signed` operands: `A_SIGNED = B_SIGNED = 1` on `$add`, `$lt`, `$mul`, `$div`, `$mod`, and a
  signed `$add` of 8 + 8 bits into 9 sign-extends. Unsigned code makes signed cells too:
  `d[sel] = 1'b1` → `$neg` (`A_SIGNED`) and `$shift` (`B_SIGNED`); `a[n +: 4]` → `$shiftx`
  (`B_SIGNED`, a 32-bit amount).
- 64-bit expressions → 64-bit `$mul`; integer constants make 32-bit operands everywhere
  (`cnt + 1` is a 32-bit `$add`).
- Two asynchronous controls → `$dffsr` (per-bit `SET`/`CLR` vectors), with an enable `$dffsre`;
  `if (load) q <= ad` → `$aldff`/`$aldffe` (`AD`, `ALOAD`); a latch with set and reset stays a
  `$dlatch` behind muxes; an `ARST_VALUE` may hold `x` bits (`4'b10x1`).
- A derived clock (`always @(posedge div)`, a ripple chain on `negedge rip[0]`, a gated
  `clk & en`) is a plain `$dff` whose `CLK` a cell drives. `reg div = 0` puts `init` on the
  wire.
- An SR latch from two NANDs, and `y = a ? ~y : y`, stay loops; `check` warns ("found logic
  loop"), the JSON is written.
- `case` into a constant table stays `$pmux` + `$eq` (with `-norom`); `$bmux`/`$demux` never
  appear. A cell instantiated by name needs `read_verilog -icells` (without it `$bmux` is a
  black box `\$bmux` whose outputs nothing drives): `by_name.v` overrides the command so.
- `opt` folds `~~x`: a "ring of three inverters" (`loops.v`) becomes one loop
  `r3 = ~(r3 & en)` — still oscillating while `en` is 1.
- Yosys's own evaluation: division by zero is all `x`; `-7 / 2 = -3`, `-7 % 2 = -1`
  (truncation, as Verilog); any `x` operand of `$mul`/`$div` makes all of `Y` `x`.
- `sim -r stim.yw -vcd out.vcd` replays a Yosys witness file (JSON: input bits per step, the
  clocks) on the JSON netlist and writes every port per step, `init` values included: the
  reference for the differential tests.

### IR (schema v8, `HDL_FORMAT` stays 1)

- `HDL_CELLS` gains the cells above. Kinds: `binary` for the arithmetic and `$eqx`/`$nex`;
  `bmux` (`A`, `S` → `Y`), `demux` (`A`, `S` → `Y`), `bwmux` (`A`, `B`, `S` → `Y`, `S` as wide
  as `Y`); `flip-flop` for `$dffsr` `$dffsre` (`SET`, `CLR` as wide as `Q`) and `$aldff`
  `$aldffe` (`ALOAD`, `AD`); `latch` for `$dlatchsr` and a new `sr` kind for `$sr` (`SET`,
  `CLR` → `Q`, no clock).
- Signedness: `A_SIGNED` and `B_SIGNED` as optional flags on the cells where they matter
  (absent: unsigned), so HDL-1 and HDL-8 documents load unchanged; the converter keeps them only
  where 1.
- `HDL_WORD` goes: no width limit anywhere (the shape check keeps the width relations).
- Schema v8 with a no-op migration (as v2, v3, v6, v7): an older app says "saved by a newer
  version" instead of "not a cell modules run".

### Words of any width

- Word cells read their operands into scratch words made once per cell: up to 32 bits a number
  (as now), wider an array of 32-bit limbs (`Uint32Array`, preallocated), so nothing is
  allocated per evaluation. Operands are extended to the cell's width by the sign bit's plane
  index when signed, the constant 0 when not — at compile time, by index.
- `$add` `$sub` `$neg`: carries across limbs; `$mul`: schoolbook on 16-bit halves, low `Y` bits;
  `$div` `$mod` (truncating) and `$divfloor` `$modfloor` (floor): long division over the bits,
  signs handled outside; `$pow`: square-and-multiply modulo 2^width, Verilog's rules for a
  negative exponent (`0 ** -n` is `x`, `1 ** -n` 1, `-1 ** -n` ±1, otherwise 0); comparisons
  signed by flipping the sign bit; shifts by an amount of any width (out of range: all shifted
  out).
- Rejected: `BigInt` (allocates on every operation, against the hot-path rule), bit-serial on
  the planes for every width (slows down HDL-1's ≤ 32-bit cells).

### `X` in the new cells (sound, never more optimistic than hardware)

- `$mul`: unknown from the lowest unknown bit of either operand up (a product's bit depends on
  the bits at and below it — HDL-1's rule for `$add`, more precise than Yosys's all-`x`).
- `$div` `$mod` `$divfloor` `$modfloor` `$pow`: any unknown bit, or a zero divisor, makes all of
  `Y` `X` (Verilog's and Yosys's division by zero; the hardware's value depends on the
  synthesis).
- `$eqx` `$nex`: as `$eq` `$ne` — an unknown bit makes the result unknown unless known bits
  already differ. Verilog's `===` compares `X` literally (`X === X` is 1), but a board has no
  `X` to compare: two unknown registers are equal or not by chance (Q1's principle). Equal to
  Yosys's `sim` wherever the inputs are known.
- `$bmux`: the slices the select could pick, merged; `$demux`: `A` where the select surely
  points, 0 where it surely doesn't, `X`-merged where unknown; `$bwmux` per bit as `$mux`.
- Signed comparisons: the range the unknown bits allow, in signed order.

### Sequencing: races are `X`, rounds inside one `evaluate` (Q1)

HDL-1 loaded flip-flops on pin clocks from the planes before the delta — a data input changing
in the same delta as the clock was sampled before the change — and refused every clock, set,
reset or load made inside the module. Q1's answer is a principle: test before fab, as close to
the real board as possible. A module is a black box without delays inside, so where the
hardware's result depends on which of two simultaneous changes wins, no order is the board's:
**a race loads `X` in the bits it decides, and is reported**, as the library's chips make a
setup violation `X`. Where the data didn't change at the edge's instant, the result is the one
every synchronous design relies on (clock-to-output longer than hold on one clock net):

- **A pin clock** (as HDL-1): an edge's next state comes from the planes before the delta, and
  the flip-flops load before the pins are read, so a shift chain shifts by one. New: when a pin
  in the flip-flop's cone (`D`, `EN`, `SRST`, …) changed in the same delta, its next state is
  computed again after the pins are read and the logic settles (with no flip-flop loaded yet),
  merged with the first: the bits that differ load `X`, and the module reports a
  `setup-violation` ("d changed at the clock edge of q") — what the library's chips report for
  the same input. Test benches pulse a clock at ¼ of a step, after the inputs, so no bench or
  example changes; HDL-1's unit test of "before the change" changes to `X`.
- **A clock made by logic** (a divider, a ripple stage, a gated `clk & en`): edges are found by
  the value each flip-flop last saw (kept in the state; strict and uncertain as `clockEdge`'s).
  Inside one `evaluate` everything is one instant, so its data is merged between the start of
  the `evaluate` and its edge: what changed in that instant (a register on another clock loaded
  at the same edge, a pin of this delta) loads `X` where it matters, and the module reports a
  `race-violation` ("q2 is clocked by logic and q changes at the same edge — use a clock
  enable"). Data that changes only at this clock's own edges (a divider's own counter, a ripple
  stage's own `~q`, a shift chain on one derived clock) is certain. Verilog simulators and
  Yosys's `sim` give a value here (old or new by their scheduling); on a board it depends on the
  gating and routing delays — the reason FPGA tools warn about gated clocks.
- **Rounds:** after the pins are read, the logic settles (loops iterated, below), asynchronous
  controls apply (reset, set, clear, load — level-sensitive, `X` merged), internal edges are
  found; every flip-flop with an edge computes its next state, then all load at once; another
  round runs while one loaded or changed a flip-flop (a ripple chain of n stages takes n
  rounds). Past a bound the flip-flops still changing go `X` and the module reports
  `oscillation` at its source line.
- A module without internal clocks or asynchronous controls made by logic runs one round, as
  HDL-1 (its speed); the start-of-`evaluate` copy of the planes is made only in modules with
  internal clocks.

_Rejected:_ Verilog's order for all (a gated clock silently loads old values, a derived clock
new ones — the hazards pass unseen); HDL-1's "before the delta" for pin clocks with no check (a
same-delta data change silently loads the old value, where a board has a setup violation).

### Power-up values

`init` bits (ports and signals) set the planes in `createState`; the flip-flops' and latches'
last-seen clocks start from them, so `reg div = 0` makes no edge at power-on. A module gets an
`init` hook that evaluates once at t = 0, so a power-up value is driven from the start (after
`delay`). Bits without `init` start `X`; `init` on a bit logic drives is overwritten by it (as
Yosys).

### Combinational loops

- The analysis finds strongly connected components of the combinational cells (Tarjan); the rest
  keeps its topological order, each loop a group in it. The compile-time error becomes a warning
  naming a signal on the loop ("a combinational loop through q: iterated until it settles").
- A group is evaluated repeatedly from the planes' current values until no bit of it changes, at
  most 2 × its cells + 2 passes: an SR latch of NANDs holds its state, starts `X` without one,
  sets and resets.
- Not settled (a ring of inverters, `y = a ? ~y : y` with `a = 1`): its changing bits become
  `X`, it is evaluated again until settled, and the module reports `oscillation` (the kernel's
  kind, once per source line, merged by the log) — the simulation goes on, unlike a loop of
  parts with no delay, which the kernel halts.

### Converter and analysis

- Accept the new cells, signed parameters and any width; drop the HDL-9 refusals (signed, wider
  than 32, other cells, internal clocks and asynchronous controls, loops) and the `init`
  warning. Still refused with the reason: memories (HDL-6), the cells listed out of scope.
- Cones (HDL-8's floating rule) include `SET`, `CLR`, `ALOAD`, `AD` and internal clocks.

### Differential tests (`pnpm hdl:differential`)

- `scripts/hdl-differential.ts`, the system Yosys (not in `pnpm check`, like `hdl:fixtures`):
  a seeded generator writes random expressions — every word cell, signed and unsigned operands,
  widths 1 to 80, nested — a few dozen to a module, and runs the command on them; for each
  module a seeded witness of input vectors (no `X`), replayed by Yosys's `sim`, gives every
  output per step. The small sequential designs (`src/library/hdl/differential/*.v`: a clock
  divider, a ripple counter, a gated clock, an LFSR, a 64-bit counter, a signed accumulator, a
  multiply-accumulate, every flip-flop flavour with resets and loads made by logic, the UART)
  get a clock in their witness. They are free of races (Q1): where Yosys's `sim` picks a winner
  of a race, the interpreter gives `X` on purpose — those cases are unit tests.
- Committed: the IR of each module (not Yosys's JSON: smaller, the converter is tested
  elsewhere), its input vectors and Yosys's outputs. `differential.test.ts` runs each module
  through the core test bench and compares every output bit per step: equal, `x` included (a
  zero divisor gives `X` on both sides).

### Example (Q2: a loop with switches)

`examples/verilog/uart_tx.v` and `uart_rx.v` (8N1, a baud-rate counter, a shift register, the
receiver sampling mid-bit), generated into an example document by `pnpm hdl:examples`: the
transmitter's line wired to the receiver's on the canvas, eight switches for the byte and a
button to send it, the received byte on eight LEDs (and its `valid`), a bench sending several
bytes and checking each one received.

## Tasks

- [x] 1. Probe fixtures (`src/library/hdl/fixtures/`): arithmetic, signed, wide, every
  flip-flop flavour, internal clocks, loops, `init`, cells instantiated by name; `pnpm
  hdl:fixtures`; HDL-1's and HDL-8's fixtures unchanged otherwise.
- [x] 2. Core IR: the new cells and kinds, optional `A_SIGNED`/`B_SIGNED`, no word limit; shape
  check and its tests; schema v8 with a no-op migration, round trip.
- [x] 3. Words of any width in `cells.ts`: scratch words, sign extension, `$add` `$sub` `$neg`,
  comparisons, shifts ported to any width and signedness; tests against `BigInt` on seeded
  values, with `X`.
- [ ] 4. New combinational cells: `$mul`, `$div` `$mod` `$divfloor` `$modfloor`, `$pow`,
  `$eqx` `$nex`, `$bmux` `$demux` `$bwmux`; tests against `BigInt` and per `X` rule.
- [ ] 5. Converter: accept the cells, signedness and widths; refusals and warnings updated;
  tests on the fixtures.
- [ ] 6. Power-up values: planes from `init`, the `init` hook; tests (`reg q = 1`, a counter from
  5, an output register).
- [ ] 7. Rounds and races (Q1): internal clocks by last-seen values, asynchronous controls from
  logic, the new flip-flops and latches (`$dffsr` `$dffsre` `$aldff` `$aldffe` `$sr`
  `$dlatchsr`), the bound and its diagnostic; a pin race (`setup-violation`) and an internal
  race (`race-violation`) loading `X`; analysis without the refusals; cones; tests (a divider,
  a ripple counter, a shift chain on a derived clock — all certain; a gated clock and a divider
  sampling the fast domain — `X` and reported; a same-delta data change; a reset by logic; every
  flavour; snapshots), each race test mutation-checked.
- [ ] 8. Loops: components, fixed points, `X` and `oscillation`, the warning; tests (an SR latch
  of NANDs, a ring of inverters, a latch feeding itself).
- [ ] 9. Differential tests: the script, the designs, the committed vectors,
  `differential.test.ts`; mutation-checked (a wrong cell fails it).
- [ ] 10. Example (Q2): the UART sources, `pnpm hdl:examples`, its benches in the app and
  headless (`pnpm test:circuits`); looked at in the browser.
- [ ] 11. Benchmark: HDL-1's numbers for its module (one round), and the new costs (a 64-bit
  counter, a 32 × 32 multiplier, a divider chain) recorded.
- [ ] 12. Docs: components.md (cells, signedness, widths, rounds, loops, power-up), circuit.md
  (schema v8), ADR-0030 amended (Q1), the track's HDL-9 section as built, roadmap, lessons.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green; `pnpm e2e` passes.
- [ ] Every cell of the scope runs, signed and unsigned, at widths 1 to 80 bits; the
  differential tests agree with Yosys's `sim` on every output bit of every step.
- [ ] `d[sel] = 1'b1`, `2 ** n`, a 64-bit counter and a 32 × 32 multiplier compile and run
  (HDL-1 refused them).
- [ ] A clock divider, a ripple counter and a shift chain on a derived clock count as Yosys's
  `sim` does; a reset made by logic clears its register; `$dffsr`, `$aldff` and the other
  flavours follow Yosys's cell library.
- [ ] Races load `X` and are reported, never a silent winner: a data pin changing in the same
  delta as its clock (`setup-violation`), a gated clock sampling a register of its source clock
  and a derived clock sampling the faster domain at the same edge (`race-violation`); a bench
  over such a design fails with the message.
- [ ] An SR latch of NANDs sets, resets and holds; a ring of inverters gives `X` and an
  `oscillation` diagnostic without stopping the simulation.
- [ ] `reg q = 1` is 1 at power-on and driven from t = 0; without `init` it is `X`.
- [ ] The UART example's benches pass in the app and headless.
- [ ] HDL-1's and HDL-8's examples, benches and benchmark unchanged (within noise).

## Open questions

- [x] Q1. When does a flip-flop sample — after the inputs and logic settle, for every clock
  (Verilog's order), or HDL-1's "before the delta" kept for pin clocks? — _proposed:_ after,
  for every clock. — **answer (2026-11-10):** "test before fab: as close as possible to a real
  hardware bench". Neither order is the board's where data and clock change at one instant, so:
  a race loads `X` and is reported (`setup-violation` at the pins, `race-violation` for clocks
  made by logic); otherwise HDL-1's order (Design, "Sequencing"). The same principle makes
  `$eqx`/`$nex` pessimistic.
- [x] Q2. What the UART example shows — _proposed:_ transmitter and receiver modules wired in a
  loop on the canvas, switches for the byte and a button to send, the received byte on LEDs, a
  bench sending several bytes. — **answer (2026-11-10):** as proposed.

## Progress log

- 2026-11-10 — plan drafted; Yosys 0.70 tried on arithmetic, signed, wide, flip-flop flavours,
  internal clocks, loops, `init` and `sim` replay of a witness.
- 2026-11-10 — Q1 answered with a principle (closest to a real board): races load `X` and are
  reported; `$eqx`/`$nex` pessimistic. Q2 as proposed.
- 2026-11-10 — plan approved; branch started.
- 2026-11-10 — task 1: probe fixtures `arith`, `signed_ops`, `wide_ops`, `ff_flavours`, `clocks`,
  `races`, `loops`, `inits`, `by_name` (`-icells`); the old fixtures unchanged (`hdl:fixtures`
  now normalizes the pointer in a `$display` cell's name, which changed on every run).
- 2026-11-10 — task 2: `HDL_CELLS` holds the 17 new cells (kinds `bmux`, `demux`, `bwmux`, `sr`),
  `signedness` optional flags on unary and binary cells (the converter keeps them only where 1,
  so `$shiftx`'s `B_SIGNED: 0` is dropped), no word limit in the shape; schema v8, examples
  re-saved. The analysis now refuses what the interpreter can't run yet (`PENDING` cells, signed
  operands other than a shift's amount, words over 32 bits) — moved from the converter, so
  `hdlPart` is guarded too; each later task shrinks it.
- 2026-11-10 — task 3: `words.ts` (32-bit limbs: add, sub, negate, mul on 16-bit digits,
  restoring division; no allocation), `planes.ts` (the planes' primitives, `extend` by sign,
  `signedOperands` — both flags for two operands, as `simlib.v`), `word-cells.ts` (`$add` `$sub`
  `$neg`, comparisons, shifts at any width and signedness; ≤ 32 bits on numbers as before). Shifts
  per `simlib.v`: A extended to max(A, Y) by its signedness, `$shiftx` from A as is. The analysis
  no longer refuses signed operands or wide words (only `PENDING` cells); `signed.v` and `wide.v`
  run. Tests against BigInt, mutation-checked (a surviving mutation — an unknown bit 0 in wide
  arithmetic — got its test). Benchmark unchanged: synthetic 12.0k evaluations/s on the branch,
  11.7–13.2k on main in three runs (noise); decoder 1.85 M/s, counter 2.5 M/s, I/O port 0.96 M/s.

## Handoff

- **State:** tasks 1–3 done (fixtures; IR with every cell, signedness, any width, schema v8;
  word cells of any width and signedness in `word-cells.ts` on `words.ts` limbs). The analysis's
  `PENDING` (analyze.ts) refuses the cells not built yet.
- **Next step:** task 4 — `$mul`, `$div` `$mod` `$divfloor` `$modfloor`, `$pow`, `$eqx` `$nex`
  (pessimistic, as `$eq`), `$bmux` `$demux` `$bwmux` in `word-cells.ts`/`cells.ts`; tests against
  BigInt; remove them from `PENDING`.
- **Watch out:** Yosys's `sim -r` takes no `-clock` with a witness file (the clocks are in it).
- **Verify with:** `pnpm check`; `pnpm bench tests/bench/hdl.bench.ts` against main (a
  worktree with `node_modules` symlinked, `./node_modules/.bin/vitest bench --run …` there).

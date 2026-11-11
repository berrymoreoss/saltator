# 0038. Timing from `specify`: paths by the chips' rule, checks through `TimingChecks`, library parts as committed modules

- **Status:** accepted
- **Date:** 2026-11-12
- **Roadmap item:** HDL-2 (feat/hdl-library)

## Context

Until HDL-2 a Verilog module drove every output with one delay (`delay`, 15 ns), took and
released a bus with it, and checked no set-up or hold time: fine for an address decoder, not for
a chip of the library, whose data sheet gives a delay per path, an enable and a disable time and
the minima its timing checks hold the circuit to ([ADR-0014](0014-timing-checks.md)). Verilog
says this in a module's `specify` block, and Yosys reads it (`read_verilog -specify`) — but only
part of it (tried on Yosys 0.70, plan of HDL-2): simple, full, edge-sensitive and conditional
paths with rise and fall at `min:typ:max`, and the checks `$setup`, `$hold`, `$setuphold`,
`$recovery`, `$removal`, `$recrem`, `$skew` with `&&&` conditions. It refuses `$width` and
`$period` ("unsupported specify rule type"), `specparam`, `ifnone`, a list of sources and
attributes on paths; it drops the third and later delays of a path (`(r, f, z)`: `tPZH`, `tPHZ`,
… with a warning) and keeps only the typical value of a lone triple (`(6:7:8)` is 7:7:7). Three
choices outlive the branch: how a module's outputs pick their delay, how its checks act, and how
a library part written in Verilog reaches the app without Yosys.

## Decision

- **The command reads `specify`** (`read_verilog -specify`); a module without one converts as
  before. The IR (schema v10) gains `specify`: paths (input bits → output bits, full or
  parallel, an edge, a condition bit, rise and fall at min, typ and max in picoseconds — the
  source's numbers are nanoseconds, `timescale` is ignored as Yosys ignores it) and checks
  normalized to `setup`, `hold`, `recovery`, `removal` and `width`, each measured from a clock
  event. A path or check not between the top's pins (a submodule's, inside it), a negative limit
  and the checks the simulator doesn't run (`$skew`, `$nochange`, …) are dropped with a warning.
- **Conventions for what Yosys can't read**, both standard Verilog that means the same in any
  simulator: a **pulse width** is a `$hold` between opposite edges of one pin
  (`$hold(posedge CP &&& armed, negedge CP, tW)`: the HIGH phase), recognized by the converter;
  **enabling and disabling a 3-state output** are two paths from the enable conditional on its
  level after the change (`if (!OEn) (OEn *> Q) = ten; if (OEn) (OEn *> Q) = tdis;`). A
  library source writes delays as `(t:t:max, t:t:max)`.
- **Delays by the chips' rule**: each output is driven with the longest typical delay among its
  paths whose source changed in this delta (an edge path with that edge, uncertain ones too; a
  conditional path unless its condition is known 0 after the change) — the rule of `pathDelays`
  for hand-written chips ("the output settles after its slowest cause"), not Verilog's "the most
  recent input", so a Verilog chip times like the hand-written one. Rise for a new 1, fall for a
  new 0, the longer for `X` and a release. Nothing among its paths changed: its longest path. An
  output no path reaches takes the part's `delay`; a library part must have a path to every one.
- **Checks through core's `TimingChecks`**, on the part's pins, armed unless their `&&&`
  condition is known 0, with the chips' diagnostics and ADR-0014's `X` made generic: a late data
  pin's flip-flops merge their next state with the one "what if the pin were `X`" gives (a
  settled copy of the words — exact per bit, so a 74HC574's late `D3` makes only `Q3` unknown),
  and the race of the same instant stands down (one report, the check's); a hold violation makes
  `X` where the pin may have changed the load; a recovery violation makes the edge uncertain; a
  short pulse, or a control released too soon after an edge (removal, reported as a hold of the
  release), makes `X` what changed since the pulse (the edge) began, from snapshots of the `Q`
  words the pin drives.
- **A library part written in Verilog is a committed module**: its source in
  `src/library/verilog/`, compiled by `pnpm hdl:library` with the system Yosys into
  `modules.ts` — the IR and the source's SHA-256 — and a test fails when a source changed since.
  `hdlLibraryPart` runs it on the data sheet's pins (the `ChipSpec` of the chip: numbers,
  descriptions, power pins, units, function table, through a port map), its timing shown from the
  IR (`hdlTiming`). The 74HC00, 74HC74 and 74HC574 prove the path: they pass the hand-written
  chips' tests, every timing check included, and are dev parts only (`dev/*`), next to the
  hand-written ones.

## Consequences

- A document's module can say how fast it is: its outputs take their paths' delays, it takes and
  releases a bus with `ten` and `tdis`, and its checks report a marginal design as the chips do;
  the Part tab of its instance shows its paths and checks.
- Controllers can be written in Verilog with their data sheet timing (the VIA, the ACIA, video
  and sound chips): the track's "Library controllers in Verilog" idea no longer waits.
- The numbers of a library part written in Verilog live in its `.v`; changing them needs Yosys
  (`pnpm hdl:library`), as the examples do. `pnpm check` never runs it.
- The engine is generic, so a Verilog chip runs slower than a hand-written one: the 74HC00 at
  ≈ 57 %, the 74HC574 at ≈ 54 % of their events a second (`pnpm bench`, HDL-2's plan). Modules
  without `specify` run as before.
- A hold violation of a flip-flop whose data depends on its own state (a counter's enable) can
  make more bits `X` than the chip would: the "what if" runs on the state after the edge. The
  data sheet's typical value of a requirement (often negative) has no place in the source: only
  the limit is written.
- Synthesizable Verilog has no asynchronous load of `x`: the 74HC74's "set and reset released at
  once leave it unknown" takes a second flip-flop in its source.

## Alternatives considered

- **Verilog's rule for several paths** (the most recent input's delay, the shortest on a tie) —
  the language's, but a Verilog 74HC00 would then time differently from the hand-written one at
  simultaneous inputs, and a module's two rules would differ from the library's.
- **Pulse widths as port attributes** (`(* tw_high = 20 *) input CP`) — readable and kept by
  Yosys, but not Verilog's meaning and without a condition (a clock under a held reset would
  report); **in the TypeScript metadata** — library parts only, the numbers in two places.
- **Enable and disable as `(ten, ten, tdis)`** — the proper Verilog, which Yosys drops.
- **`X` on every flip-flop a violating pin reaches** (by cones) — cheaper, but a 74HC574's late
  `D3` would make all eight bits unknown, where the chip and its test make one.
- **Library parts compiled in the app** — Yosys isn't in the app (ADR-0030); a document's
  `.v` files aren't either.
- **Replacing the hand-written 74HC chips** with the Verilog ones — they would be slower and gain
  nothing; the Verilog ones are the proof, the hand-written ones stay in the palette.

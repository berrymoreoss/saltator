# Plan: feat/hdl-library

| Field      | Value                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Branch     | `feat/hdl-library`                                                                                     |
| Roadmap    | HDL-2 — Library parts in Verilog, track [Programmable logic](../../docs/roadmap/programmable-logic.md) |
| Status     | in-progress                                                                                            |
| Depends on | HDL-1, HDL-8, HDL-9, HDL-10 (IR, converter, generated engine), R09a (timing checks, ADR-0014), R06/R08 |
| Created    | 2026-11-12                                                                                             |

## Goal

Chips of the library can be written in Verilog with their data sheet timing, so controllers (a
VIA, an ACIA, a video or sound chip) can later be modules instead of TypeScript. A module's
`specify` block gives its pin-to-pin delays and its timing checks: each output is driven with
the delay of the path that caused the change, not one delay for the whole module, and set-up,
hold, pulse-width and recovery violations are reported and make the bits that may have loaded
`X` — exactly as the hand-written chips do (ADR-0014). A library part is such a module plus its
data sheet metadata, compiled ahead of time by the repo's scripts and committed as IR. The proof:
a 74HC00, a 74HC74 and a 74HC574 written in Verilog pass the hand-written ones' tests, timing
checks included, and a benchmark compares the Verilog 74HC00 with the hand-written one.

## Scope

**In scope**

- The command reads `specify` (`read_verilog -specify`); the converter turns Yosys's `$specify2`,
  `$specify3` and `$specrule` cells into the IR's paths and checks; schema v10.
- Per-path delays in the module part: each output bit driven with the delay of its paths whose
  cause happened in this delta (simple, full, edge-sensitive and conditional paths; rise and
  fall; enable and disable of 3-state outputs).
- Timing checks in the module part through core's `TimingChecks`: set-up, hold, set-up/hold,
  recovery, removal (if cheap), pulse width; the same diagnostics and the same `X` rules as the
  chips.
- Library parts in Verilog: sources and committed IR in `src/library/`, a script that compiles
  them, a staleness check in `pnpm check`, a definition built from a module plus a `ChipSpec`
  (pinout, units, function table) and a port map.
- Proof: Verilog 74HC00, 74HC74, 74HC574; the hand-written chips' tests run on both; a benchmark.
  They appear in the palette of dev builds only (Q3), next to the hand-written ones.
- `specify` in a document's own modules too (Q2): the command gains `-specify`, the `delay` prop
  covers the outputs without a path, the Part tab shows a module's paths and checks.
- Docs: a new ADR (timing from `specify`), ADR-0030 amended, specs, track, lessons.

**Out of scope** (and where it goes instead)

- Replacing the hand-written 74HC chips (Q3) — they stay; the Verilog ones prove the path, in dev
  builds only.
- A new example (Q4: tests and benchmark only).
- The VIA, the ACIA, video and sound chips in Verilog → the track's ideas ("Library controllers
  in Verilog"), R18.
- A device's pin-to-pin timing by speed grade (GAL, CPLD, FPGA) → HDL-5.
- `$period`, `$skew`, `$timeskew`, `$fullskew`, `$nochange`, negative limits: refused or warned
  (no proof chip needs them; the kernel has a cycle check, a later item may map `$period`).
- Path skew inside a chip, glitches, worst-case (max) delays → as for the hand-written chips: not
  modeled (`timing.max` recorded for a future worst-case mode).
- Parameters per instance (one IR per parameter set) → track idea.

## Context

- [docs/roadmap/programmable-logic.md](../../docs/roadmap/programmable-logic.md) — HDL-2, HDL-8
  ("taking and releasing the bus use the module's delay until HDL-2"), HDL-5.
- [ADR-0030](../../docs/adr/0030-hdl-modules.md) — "outputs driven … with the delays of the
  module's `specify` paths, or with one delay set on the part where the module has none";
  "`specify` timing checks run by `TimingChecks`"; "a library part is a module plus its data sheet
  metadata".
- [ADR-0014](../../docs/adr/0014-timing-checks.md) — guaranteed minima, `X` on violation, armed
  checks; [ADR-0037](../../docs/adr/0037-hdl-generated-code.md) — the generated engine;
  [ADR-0011](../../docs/adr/0011-real-chips.md) — typical delays, Nexperia sheets.
- [docs/components.md](../../docs/components.md) — Timing (delays with several paths: the longest
  among the paths whose input changed), Timing checks, Edge-triggered chips, Verilog modules.
- `src/core/hdl-module.ts` (IR), `src/core/timing-checks.ts`, `src/library/74xx/{chip,paths,
  pinout,gates,flip-flops,registers,edge-triggered,hc-timing}.ts` and their tests,
  `src/library/hdl/{command,from-yosys,analyze,module-part,flip-flops,settle}.ts`,
  `scripts/{yosys,hdl-fixtures,hdl-examples}.ts`, `tests/bench/kernel.bench.ts`.

## Design

### What Yosys gives (tried on Yosys 0.70, 2026-11-12)

`read_verilog -specify` keeps a `specify` block as cells that survive `proc`, `flatten`,
`tribuf -logic`, `opt -keepdc` and `write_json`:

- `$specify2` — a simple path: `SRC`, `DST` (bits), `EN` (the condition of `if (…)`: a signal bit,
  logic made by Yosys for an expression, or `1`), `FULL` (`*>` 1, `=>` 0), polarity flags
  (`+=>`, informative), `T_RISE_{MIN,TYP,MAX}`, `T_FALL_{…}`.
- `$specify3` — an edge-sensitive path `(posedge CP => (Q +: D))`: as above plus `EDGE_EN`,
  `EDGE_POL` (1 posedge), `DAT` (the data source, informative).
- `$specrule` — a timing check: `TYPE` (`$setup`, `$hold`, `$setuphold`, `$recovery`, `$removal`,
  `$recrem`, `$skew`, …), `SRC`/`DST` with their edges (`*_PEN`, `*_POL`) and conditions
  (`SRC_EN`, `DST_EN` from `&&&`), `T_LIMIT_{MIN,TYP,MAX}`, `T_LIMIT2_…` (hold of `$setuphold`).
- `flatten` keeps a submodule's paths, joined to the top's ports where its ports are wired to
  them: a 74HC00 is one NAND gate module with its `specify`, placed four times.
- **Not read** (syntax errors or ignored): `$width` ("unsupported specify rule type") and
  `$period`; a list of sources `(A, B *> Y)` (write one path per source; a vector source is
  fine); `specparam`; `ifnone`; attributes on paths; **3- and 6-value delays** (`(r, f, z)`,
  `tPZH`…: Yosys warns "beyond rise/fall not currently supported" and keeps rise and fall).
- Numbers carry no unit (`timescale` is ignored); decimals come as strings (`"9.500000"`);
  negative values as 32-bit two's complement.
- Port attributes (`(* tw_high = 20 *) input CP`) survive in the netnames.

### Writing timing in Verilog (the conventions)

- **Units:** nanoseconds. Integers or decimals. The **typical** value of a `min:typ:max` triple
  drives the simulation (ADR-0011), `max` is recorded as `timing.max`, `min` ignored for delays.
- **Paths:** `(A => Y) = (tPLH, tPHL);` (rise, fall), `(S *> Y) = …` (every bit to every bit),
  `(posedge CP => (Q +: D)) = …`, `if (cond) (A => Y) = …`.
- **Enable and disable of 3-state outputs** (Yosys drops the third value): two conditional paths
  from the enable, which mean the same in any Verilog simulator —
  `if (!OEn) (OEn *> Q) = ten;` and `if (OEn) (OEn *> Q) = tdis;` (the condition is read after the
  change, so taking the bus uses `ten`, releasing it `tdis`).
- **Checks:** `$setup(D, posedge CP &&& cond, tsu)`, `$hold(posedge CP &&& cond, D, th)`,
  `$setuphold(…)`, `$recovery(posedge RDn, posedge CP, trec)`. The limit is the data sheet's
  **guaranteed minimum** (ADR-0014), written as the typical value; `&&&` conditions arm a check
  (the hand-written chips' "armed": not while set/reset holds the flip-flop).
- **Pulse width** (Q1): `$hold(posedge CP &&& cond, negedge CP, tW)` (the HIGH
  phase: a falling edge less than `tW` after the rising one), `$hold(negedge SDn, posedge SDn,
  tW)` (a LOW pulse). Standard Verilog meaning, read by Yosys; the converter recognizes a `$hold`
  between opposite edges of one pin as a pulse-width check and reports `pulse-width-violation`
  with the chips' message (`1CP was HIGH for only 19 ns (pulse width ≥ 20 ns)`).

### IR (schema v10)

`HdlModule.specify?: { paths: HdlPath[]; checks: HdlCheck[] }` in `src/core/hdl-module.ts`:

- `HdlPath`: `from` (input bits), `to` (output bits), `full`, `edge?` (`rise`/`fall`), `when?`
  (a signal bit; absent: always), `rise`/`fall` (typ and max, in ps), `src`.
- `HdlCheck`: `kind` (`setup`, `hold`, `recovery`, `removal`, `width`), the data/reference bits
  with their edges, `when?` per side, `limit` (ps), `src`.
- Shape check: paths start at input or inout bits and end at output or inout bits; widths of
  parallel paths match. Documents v9 → v10: nothing to migrate (no `specify` = no paths).
- The converter: `$specify2/3` → paths, `$specrule` → checks; a path or check not between the
  top's ports (a submodule's path whose ports are inside) is dropped with a warning; unsupported
  rules (`$skew` family, `$nochange`) and negative values warn and are dropped; library sources
  must convert without warnings.

### Delays in the module part

- Per output bit, its paths (flattened into typed arrays at compile time, as `pathDelays`). When
  the bit is driven: among the paths whose source pin changed in this delta (an edge path: that
  edge, strict, or an uncertain edge; a conditional path: its condition bit 1 or `X` after the
  change), the **longest** typical delay — the project's rule for chips with several paths
  (docs/components.md#timing), so a Verilog chip times like the hand-written one. Rise for a new
  1, fall for a new 0, the longer of the two for `X` and `Z`.
- Nothing among its paths changed (the forced evaluation, a change through a path not written):
  the bit's longest path — `pathDelays`' rule; re-driving a pending value keeps it (inertial).
- A bit with no path: the part's `delay` prop (a document's module, Q2). A library part
  needs a path to every output (checked when its definition is built).
- Modules without `specify` run exactly as today (one delay, no per-bit work).

### Timing checks in the module part

- Declared once per definition from the IR's checks with core's `TimingChecks` (pins by the
  part's pin list), the times in the part's state (snapshots, carry-over); run at the start of
  `evaluate`, observing pins (`changed`, `prev`), never reading them.
- **Effects** (ADR-0014's table, made generic):
  - set-up violation of pin P at an edge of clock C: the flip-flops on C whose data cone holds P
    compute their next state a second time with P read as `X`, merged with the first — `X`
    exactly where P could matter (bit by bit: a 574's `1D` makes only `1Q` unknown). HDL-9's race
    merge, with `X` in place of "the pins after the change".
  - hold violation (P changed within `th` after the edge): those flip-flops recompute their next
    state from the words now with P read as `X`, `X` where it differs from what they hold —
    exact for registers and D flip-flops; for a flip-flop whose data also depends on its own
    state (a counter's enable) it may make more bits `X` than the chip would (documented).
  - a short inactive clock phase, a recovery violation: the edge is uncertain — the existing
    rule, `X` only the bits a load would change.
  - a short active clock phase: `X` what the edge before it changed (each clock keeps, per
    flip-flop, the bits its last edge changed).
  - a short asynchronous pulse (set, reset): `X` what the pulse changed.
- Diagnostics on the pin at fault with the chips' messages and kinds.

### Library parts in Verilog

- Sources in `src/library/verilog/` (`74hc00.v`, `74hc74.v`, `74hc574.v`): a unit (a NAND gate, a
  D flip-flop) with its `specify`, placed per section by the chip's module. `pnpm hdl:library`
  runs the system Yosys with the command and writes `*.ir.ts` next to each source: the IR as a
  typed constant, the source's SHA-256 and the Yosys version. A test in `pnpm check` hashes each
  `.v` and fails when the IR is stale ("run `pnpm hdl:library`") — no Yosys needed.
- `verilogChip(spec, module, ports, info)`: the `ChipSpec`'s pinout (DIP, numbers, descriptions,
  power pins), units and function table; `ports` maps each data sheet pin to a port bit (`1A` →
  `A[0]`; Verilog names can't start with a digit, active-low pins end in `n`); `info` gives the
  data sheet URL, conditions and source. Its `timing` is made from the IR (keys from the paths
  and checks, `tpd(CP↑ → Q)`), so the numbers live in one place: the `.v`.
- The module part is generalized to take its pin list and the port-bit → pin map from outside
  (today `hdlPins(module)`).
- Where they appear (Q3): in the palette of dev builds only, as the renderer's `DEV_PARTS` are
  (`App.tsx` adds them under `import.meta.env.DEV`): types `dev/74hc00-verilog`, … (never in the
  default registry, so no saved document depends on them), named like the chip, titled
  `… (Verilog)`. The library exports them as `verilogChips`; tests and the benchmark use them.

### Proof

- The hand-written chips' tests for the 74HC00 (gates), 74HC74 (flip-flops) and 74HC574
  (registers, 3-state) run on both definitions (`describe.each` over hand-written and Verilog),
  expected delays taken from the hand-written chip's timing.
- Benchmark: a chain of Verilog 74HC00s against the same chain of hand-written ones
  (`tests/bench/kernel.bench.ts`), numbers in the track; a module without `specify` unchanged
  (HDL-1's benchmarks).

## Tasks

- [x] 1. Yosys probes as fixtures: `pnpm hdl:fixtures` gains `specify` designs (simple, full,
  edge, conditional, rise/fall, decimals, the enable trick, checks, the pulse-width idiom, a
  flattened submodule, an internal path, unsupported rules); the command gains `-specify`
  (examples and fixtures regenerate unchanged otherwise — checked).
- [x] 2. IR: `specify` paths and checks in core, shape check, schema v10, round trip.
- [x] 3. Converter: `$specify2/3`, `$specrule` → IR; units, decimals, idioms; warnings and
  refusals with source locations; fixture tests.
- [ ] 4. Module part: pin list and port map from outside; per-bit path delays; the `delay` prop
  only where an output has no path; unit tests (each path kind, rise/fall, enable/disable,
  forced evaluation, carry-over unchanged).
- [ ] 5. Timing checks in the module part: declaration from the IR, arming by conditions,
  reports; effects (set-up merge, hold recompute, uncertain edges, short phases and pulses);
  unit tests against hand-built modules.
- [ ] 6. Library sources and tooling: `src/library/verilog/`, `pnpm hdl:library`, the `.ir.ts`
  files with hash and version, the staleness test, `verilogChip`.
- [ ] 7. Verilog 74HC00 and its proof: the gate tests on both definitions.
- [ ] 8. Verilog 74HC74: the flip-flop tests on both, timing checks included.
- [ ] 9. Verilog 74HC574: the register and 3-state tests on both.
- [ ] 10. Benchmark: Verilog vs hand-written 74HC00 chain; HDL-1's benchmarks unchanged.
- [ ] 11. App: the command shown with `-specify`; the Part tab shows a module's paths and checks;
  the `delay` prop says it covers outputs without a path; e2e (a module with `specify` pasted
  in the browser). The Verilog chips in the dev palette (Q3), looked at in `pnpm dev`.
- [ ] 12. Docs: ADR (timing from `specify`), ADR-0030 amended, components.md (Verilog modules,
  library parts in Verilog), circuit.md (schema v10), editor.md, simulation.md if touched,
  track (HDL-2 built), lessons.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green; `pnpm e2e` green.
- [ ] A module with a `specify` block drives each output with the delay of the path that caused
  the change (simple, edge, conditional; rise and fall; `ten`/`tdis` by the enable idiom).
- [ ] Its `$setup`, `$hold`, `$setuphold`, `$recovery` and pulse-width checks report the chips'
  diagnostics on the pin at fault and make `X` what the chips make `X`.
- [ ] The Verilog 74HC00, 74HC74 and 74HC574 pass the hand-written ones' function table, timing
  and timing check tests (the same test code, both definitions).
- [ ] A library `.v` changed without `pnpm hdl:library` fails `pnpm check`.
- [ ] Benchmark: the Verilog 74HC00 measured against the hand-written one, recorded in the track;
  HDL-1's benchmarks no slower.
- [ ] Every existing example, fixture and document runs as before (no `specify` = today's
  behavior).
- [ ] A document's module with `specify` (pasted in the app) times its outputs by its paths and
  shows them in the Part tab (e2e); the Verilog chips are in the dev palette only.
- [ ] Docs, ADR, track and lessons updated.

## Open questions

- [x] Q1. Pulse width: Yosys reads neither `$width` nor `$period`. How is a pulse width written?
  — _proposed:_ `$hold` between opposite edges of one pin (standard meaning, read by Yosys,
  conditions with `&&&`), recognized by the converter. Alternatives: port attributes
  (`(* tw_high = 20 *)`, no conditions, not Verilog's meaning); the library's TypeScript
  metadata (library parts only, numbers in two places). — **answer (2026-11-12):** `$hold`
  between opposite edges of one pin, as proposed.
- [x] Q2. `specify` in a document's own modules too, or only in library parts? — _proposed:_ in
  every module (HDL-8's promise; the `delay` prop for outputs without a path). —
  **answer:** every module, as proposed.
- [x] Q3. Where do the Verilog 74HC00/74/574 appear? — _proposed:_ only in tests and the
  benchmark; the hand-written chips stay in the palette; the first Verilog library part
  people place is a real one (VIA, ACIA). — **answer:** in the palette of dev builds (like
  `DEV_PARTS`), next to the hand-written chips; not in the default registry.
- [x] Q4. Proof: tests and benchmark only, or also an example? — _proposed:_ tests and benchmark
  (as HDL-6 and HDL-8). — **answer:** tests and benchmark only, as proposed.

## Progress log

- 2026-11-12 — plan drafted; Yosys's `specify` support probed (what it reads and drops above).
- 2026-11-12 — Q1–Q4 answered: `$hold` idiom for pulse widths, `specify` in every module, the
  Verilog chips in the dev palette, tests and benchmark only.
- 2026-11-12 — plan approved; status in-progress (plan, track).
- 2026-11-12 — task 1: the command reads `-specify`; fixtures `spec_paths`, `spec_tristate`,
  `spec_checks`, `spec_flattened`, `spec_unsupported`; every other fixture and example
  regenerated byte-identical.
- 2026-11-12 — task 2: `HdlModule.specify` (paths with `{min, typ, max}` rise/fall in ps, checks
  normalized to setup/hold/recovery/removal/width with `clock`/`data` events), shape check,
  serializer (a line per path and check), schema v10 (migration changes nothing), examples bumped.
- 2026-11-12 — the user left for the night: "finish the branch yourself"; merge waits for them.
- 2026-11-12 — task 3: `specify.ts` (`readSpecifyCell`, `placeSpecify`, `picoseconds`) wired into
  `fromYosys`; paths not between the top's pins and unchecked rules dropped with warnings. Found:
  Yosys keeps only the typical value of a lone triple `(6:7:8)` (min = typ = max = 7), while
  `(r, f)` with triples keeps all three — library sources write `(t:t:max, t:t:max)` (lesson).

## Handoff

- **State:** tasks 1–3 done (command, fixtures, IR v10, converter); modules with `specify` convert
  but still run with the one `delay`.
- **Next step:** task 4 — per-bit path delays in `module-part.ts` (pin list and port map from
  outside too).
- **Watch out:** Yosys drops `$width`, `$period`, 3/6-value delays, `specparam`, `ifnone`, source
  lists — the conventions above work around them; try a construct on the real Yosys first.
- **Verify with:** `pnpm check`; `pnpm hdl:fixtures` and `pnpm hdl:library` need `yosys`.

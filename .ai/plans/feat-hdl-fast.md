# Plan: feat/hdl-fast

| Field      | Value                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Branch     | `feat/hdl-fast`                                                                                |
| Roadmap    | HDL-10 — Fast evaluation, track [Programmable logic](../../docs/roadmap/programmable-logic.md) |
| Status     | in-progress                                                                                    |
| Depends on | HDL-1, HDL-8, HDL-9, HDL-4, HDL-6 (the IR and the interpreter), HDL-7 (the target's benchmark) |
| Created    | 2026-11-11                                                                                     |

## Goal

Modules fast enough for soft cores and video: the Verilog PicoRV32 example's module at **1 M
cycles a second** headless (`pnpm bench`; ≈ 10.6 k today, ≈ 94×) — a 1 MHz core in real time —
with HDL-1's benchmarks no slower and every result the same. The IR is compiled once per module
into code that works on 32-bit words instead of a byte per bit, and only the cells downstream of
what changed are evaluated. Nothing outside the part changes: the same pins, delays, `X` rules,
races, reports, snapshots, inner signals and memories.

## Scope

**In scope**

- A word layout of a module's bits (value and unknown masks, 32 bits a word, limbs beyond) in
  place of the byte planes; inner signals, memory views, snapshots and carry-over read it.
- Code generated once per module from its IR (Q1): the combinational cells and latches in
  topological order, the flip-flops' next states and loads, the memories' ports; uncommon cells
  through helpers made from today's tested semantics.
- Activity: dirty flags per cell; pins and flip-flops that changed mark what reads them, so a
  clock's falling edge in a design clocked on rising edges evaluates nothing.
- The safety of generated code from a shared file (ADR-0037, amending ADR-0030's alternative):
  only integers from the IR enter the source.
- The interpreter's orchestration (pin edges, races, rounds of internal clocks, loops,
  asynchronous controls, the floating rule, pokes) on words, its rules unchanged.
- Proof: every existing HDL test, the differential tests against Yosys's `sim`, the examples'
  benches headless and in the app, a differential test of the new engine against the current
  interpreter (Q2); `tests/bench/hdl.bench.ts` at the target.

**Out of scope** (and where it goes instead)

- The app's run loop at Max (chunks of 20 000 events between frame-budget checks, the achieved
  rate over a capped wall time) → `fix/run-loop-chunks`, pre-drafted; this branch measures the app
  and says whether it is still needed.
- Recompiling a running module with its state → HDL-3.
- Gate-level netlists, synchronous read ports in the IR, other track ideas → stay ideas.
- A faster kernel: measured (≈ 2 % of PicoRV32's time today) and left alone unless the profile at
  the target says otherwise.

## Context

Read before starting:

- [docs/roadmap/programmable-logic.md](../../docs/roadmap/programmable-logic.md) — HDL-10's
  section: the target and where the time goes.
- [ADR-0030](../../docs/adr/0030-hdl-modules.md) — the interpreter's rules; "TypeScript generated
  per module" among the rejected alternatives (why it is safe now: D4).
- [ADR-0026](../../docs/adr/0026-test-bench-sandbox.md) — the bench sandbox: an opaque-origin
  worker with `'unsafe-eval'`, where modules run too.
- [ADR-0035](../../docs/adr/0035-inner-signals.md), [ADR-0036](../../docs/adr/0036-memories-in-modules.md)
  — inner signals and memories read from the instance's state.
- [example-picorv32.md](example-picorv32.md) — the target's measurement (Q4) and profile.
- `src/library/hdl/` — `module-part.ts` (orchestration), `cells.ts`, `word-cells.ts`,
  `words.ts`, `memory-cells.ts`, `planes.ts`, `analyze.ts`.
- `tests/bench/hdl.bench.ts` — every number this branch is held to.
- `.ai/lessons.md` — HDL-9: benchmark against `main` alternately in one sitting (±8 % drift);
  small phase functions beat one big `evaluate`. R01: benchmark on native imports only.

## Design

### Where the time goes (PicoRV32, 2026-11-11)

577 cells: 456 combinational steps in order (156 `$mux` over 1 950 bits, 38 `$pmux` over 532,
76 `$logic_and`, 37 `$eq`, 21 `$ne`, …), 116 flip-flops (`$dffe`, `$sdffe`, `$dff`, `$sdff`), 2
memories, 3 864 bits. 568 of the 577 cells have their output bits numbered in a row. Profile of
the board: ≈ 45 % `$mux`/`$pmux` bit by bit, ≈ 14 % gathering word operands bit by bit, ≈ 18 %
flip-flop edges, ≈ 2 % the kernel. Every evaluation runs every combinational cell — the falling
clock edge's too, where nothing changes. At ≈ 21 k evaluations a second that is ≈ 47 µs each;
the target leaves ≈ 0.5 µs.

### D1. Compilation target (Q1)

- **A. JavaScript generated from the IR, made into functions with `new Function`**
  (recommended). Synchronous (`hdlPart` stays as it is), runs wherever modules run (the page —
  the app has no CSP —, the bench sandbox, which already allows `'unsafe-eval'`, and Node), state
  stays plain typed arrays, V8 compiles straight-line integer code well. Safe by construction of
  the generator (D4).
- **B. WebAssembly emitted by our own encoder.** Sandboxed by its nature, but Chrome refuses a
  synchronous compile over 4 KB on the main thread, so a part would be asynchronous to make; state
  in linear memory makes snapshots, rewind, inner signals and the Memory tab copy in and out; pin
  reads and drives cross the boundary every evaluation; an encoder to write and keep. Its gain
  over JIT-compiled integer JavaScript is small for this kind of code.
- **C. No code generation**: word-level closures with activity. Simplest and nothing to argue
  about, but every cell stays a call through an array of closures with its operands gathered by
  loops; expected 10–30×, not 94×.

### D2. Words instead of byte planes

Each signal bit gets a slot (word, bit): a cell's output gets its own words from bit 0 (limbs
past 32 bits), an input port its own; constants are folded into the code, undriven bits are
`X`. State: `v` and `u` (`Int32Array`, a word each; `u` 1 where unknown, `v` 0 there) — what
the byte planes said, 32 bits at a time. An operand is a list of runs (a word's bits shifted and
masked, or a constant) found at compile time; most are one whole output. 4-state rules become
word algebra (`and`: known 0 wins; a mux with an unknown select: `u = ua | ub | (va ^ vb)`),
arithmetic takes a 2-state path when no operand bit is unknown and today's rules otherwise.
Inner signals (`level`), memory views (memories already keep 32-bit limbs), snapshots and
carry-over read the words; nothing outside the part sees the change.

### D3. Generated code and activity

Per module, generated once and shared by its instances (they pass their state in): `settle` —
the combinational cells and latches in topological order, each behind its dirty flag, a changed
output marking the cells that read it; `next`/`load` per flip-flop group — next states from the
words before the edge, then loads that mark the readers of what changed; the memories' read and
write ports. Pins read into the words mark their readers only when they changed, so PicoRV32's
falling clock edge marks nothing and settles in a check. Uncommon or wide cells (`$div`, `$pow`,
`$bmux`/`$demux`, arithmetic past 32 bits, a `$pmux` whose select is unknown) call helpers made
from today's `word-cells`/`words` semantics; a combinational loop stays one block iterated until
it settles.

### D4. Generated code from a shared file (ADR-0037)

A document's module is data from whoever wrote the file; ADR-0030 rejected generated code
because it would run that file through `eval`. Here the document still holds only the IR, and the
generator is ours: the source is made from fixed templates whose only variables are integers it
formats itself (`Number.isSafeInteger` asserted, else the module is refused) — slots, masks,
shift amounts, widths, polarities. No name, source location, parameter string or other text from
the IR ever enters it. A test feeds hostile IRs (code in names, parameters, constants, `src`) and
checks the module is refused or its source is made only of the generator's tokens. The functions
take everything they use as parameters.

### D5. What stays

The orchestration's rules — strict edges, two phases, races (`setup-violation`,
`race-violation`), rounds of clocks made by logic, asynchronous controls, loops and oscillation,
the floating rule by cones, power-up values, memories, pokes, `X` merges and limits — move to
words unchanged. Their tests stay as they are and are the oracle: `module-part.test.ts`, the
cells' and memories' tests (ported to the new steps), the differential tests against Yosys's
`sim`, the examples' benches, `tests/e2e/hdl.spec.ts`. During the branch the current interpreter
is a second oracle (Q2): every fixture and example module under seeded random pin stimulus
(including `X` and `Z`), every pin's drive, report and inner signal compared at every step.

### D6. Measuring

Baseline on `main` (2026-11-11, `pnpm bench tests/bench/hdl.bench.ts`): decoder 1 955 k
evaluations/s, decade counter 2 436 k, synthetic 1 024 cells 11.4 k (10.7 k with 16 inner bits
recorded), wide words 70.8 k, internal clocks 617 k, I/O port 963 k, register file 733 k, RAM
4K × 32 399 k; PicoRV32 10.7 k cycles/s, on its board 10.6 k. Small modules spend ≈ 0.5 µs an
evaluation: the new engine must add nothing per evaluation that they don't use.

`pnpm bench` (native imports), every HDL benchmark against `main` alternately in one sitting; a
CPU profile (`node --cpu-prof`) at each checkpoint. A checkpoint after the combinational code
(task 3): PicoRV32's numbers with the new `settle`, projected to the target; short of it, the
branch goes on and ends with what it reaches (Q3), the rest a track idea with the profile.

## Tasks

- [x] 1. Layout: slots for every bit (`layout.ts`), operands as runs, words read and written by
  runs; tests on fixtures (every bit has one slot, runs reproduce the bits).
- [x] 2. Code generator for combinational cells (`codegen.ts`): bitwise, reductions, logic,
  `$mux`, `$pmux`, comparisons, `$add`/`$sub`/`$neg`/`$mul` up to 32 bits, shifts, `$tribuf`,
  latches; helpers for the rest; the integer-only rule and the hostile-IR test (D4). Each cell's
  generated step tested against today's step on random 4-state inputs, over every fixture's cells.
- [x] 3. Activity and the checkpoint: dirty flags, fanout, `settle`; PicoRV32's combinational
  settle measured; numbers and the projection into this plan (Q3: no stop either way).
- [x] 4. Flip-flops: next states and loads generated (every flip-flop cell: enables, synchronous
  and asynchronous resets, sets and clears, `$aldff`, `$sr`), loads marking their readers.
- [x] 5. Memories on words: read ports as steps, write ports' samples and stores, pokes, views.
- [x] 6. The behavior on words: pins, edges, races, internal rounds, loops, floating rule, inner
  signals; `hdlPart` switched; every existing test green unchanged.
- [x] 7. Differential test against the current interpreter (Q2), mutation-checked.
- [ ] 7b. The interpreter's leftovers removed (`reference-part.ts`, the byte-plane steps no
  longer used, their tests ported), after task 8 so the tuning stays checked by the oracle.
- [ ] 8. Benchmarks and profile to the target; HDL-1's numbers no slower; numbers into the plan.
- [ ] 9. The app: the examples in the browser, PicoRV32 at Max measured; the example's clock
  (Q4); whether `fix/run-loop-chunks` is still needed.
- [ ] 10. Docs: ADR-0037 (and ADR-0030 amended), components.md (speed, how modules run), the
  `src/library` README, the track (HDL-10 built), lessons.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green; `pnpm e2e` passes.
- [ ] `pnpm bench`: the PicoRV32 module at 1 M cycles a second (a clock cycle running its
  program, n = 255) — or, short of it (Q3), the speed reached recorded in the track with its
  profile and the rest of the way an idea; its results unchanged (the example's benches pass,
  headless and in the app).
- [ ] HDL-1's benchmarks (decoder, counter, synthetic 1 024 cells) and the other HDL benchmarks
  no slower than on `main`, measured alternately in one sitting.
- [ ] Every existing HDL unit, scenario and differential test passes unchanged in what it
  asserts; the new differential test against the current interpreter passes on every fixture and
  example module and fails under a mutation.
- [ ] The hostile-IR test: no text from the IR reaches generated source.
- [ ] Snapshots, rewind, carry-over, inner signals, the Memory tab and pokes work as before
  (their tests and the e2e test).

## Open questions

- [x] Q1. Compilation target? — _proposed:_ A, JavaScript generated from the IR with `new
  Function`, integers only (D1, D4). — **answer:** as proposed.
- [x] Q2. The current interpreter? — _proposed:_ replaced; kept during the branch as a
  differential oracle and removed at its end (one engine to maintain; the existing tests stay). —
  **answer:** as proposed.
- [x] Q3. If the checkpoint projects short of 1 M cycles a second? — _proposed:_ stop at the
  checkpoint with the profile and decide then. — **answer:** accept what is reached: finish the
  engine, record the speed, and the rest of the way to 1 M becomes a track idea with the profile.
- [x] Q4. The PicoRV32 example's clock after the speed-up? — _proposed:_ decided after measuring
  the app (task 9): raised to the highest round rate the app keeps in real time at 1×, its
  benches re-timed. — **answer:** as proposed.

## Progress log

- 2026-11-11 — plan drafted; `main` green (3 543 tests); baseline benchmarks in D6.
- 2026-11-11 — Q1–Q4 answered (Q1, Q2, Q4 as proposed; Q3: accept what is reached); plan
  approved; started.
- 2026-11-12 — task 1: `layout.ts` (a cell's output from bit 0 of its own words, ports' pin bits
  theirs, operands as runs per limb: bits, fills, constant masks), tests over every fixture and
  differential design (`sample-modules.ts`). Task 2: `codegen.ts` — common cells as word
  operations, the rest through an adapter to `compileStep` on small byte planes; `int` the only
  way a number enters source; each cell's code against `compileStep` on random 4-state words over
  every sample module's cells and 60 random shapes of every type (mutation-checked: 7 of 7).
  Task 3: `settle.ts` — a step per cell (a loop's cells one step), a mark bit per step, marks only
  to later steps, the code in functions of ≈ 24 k characters (V8 won't optimize one of a whole
  core) behind a dispatcher; shifts as closures over limbs (`limb-cells.ts`, a 32-bit window),
  operand readers generated (`source.ts`). **Checkpoint** (PicoRV32's 456 steps, memory reads
  stubbed, Node 24, M3 Pro): a full settle 2.9 µs against 29 µs for today's steps (≈ 10×); a
  settle with nothing marked 0.014 µs (the falling edge); after 5–20 random flip-flop words change
  3.2–4.1 µs (random changes reach most of the core). Generated cells ≈ 1–6 ns each; the three
  shifts ≈ 90 ns each. Projection: ≈ 5 µs a cycle with flip-flops and the kernel, ≈ 200 k cycles/s
  — short of 1 M; per Q3 the branch goes on and task 8 profiles the whole engine.
- 2026-11-12 — task 4: `flip-flops.ts` — next states and loads per group (one pin and edge, or
  one flip-flop clocked by logic), asynchronous controls in one function; against `nextState`,
  `load`, `applyAsync` over every sample module and 40 random shapes of every type (4 of 4
  mutations caught). The random shapes keep asynchronous inputs off the flip-flop's own Q: the old
  `applyAsync` applies them bit by bit in place, an order a board doesn't have. Words keep their
  unused bits 0 (`usedBits`), so whole words compare. Task 5: memories on words —
  `readClosure` (a memory word's limbs copied, merged over an unknown address), write ports'
  samples read from words (`compileWordWritePorts`, `sampleWriteWords`), the store functions on a
  `WriteShape` (by width); closures get the instance's memories (`M`); a wide-address test.
  Task 6: `module-part.ts` on words (the old one kept as `reference-part.ts`, the oracle of
  task 7): the same phases and messages; one `clockEdge` per group; the floating rule's loads
  checked only while a pin floats; a pin read marks its readers when it changed; a write or a
  poke marks its memory's read ports. Every existing test passes unchanged (4 006), the examples'
  34 benches too. `pnpm bench`: PicoRV32 250 k cycles/s (×23), on its board 252 k; decoder
  2 170 k evaluations/s (main 1 955 k), counter 3 533 k (2 436 k), internal clocks 1 339 k
  (617 k), wide words 81.6 k (70.8 k), register file 806 k (733 k), I/O port 955 k (963 k), RAM
  4K × 32 384 k (399 k: to check alternately). The synthetic 1 024-cell module reads 1 853 k
  (11.4 k): its flip-flops have no reset, so it is all `X` and nothing changes — the benchmark
  measures nothing now (task 8).
- 2026-11-12 — task 7: `tests/scenarios/verilog-engine.test.ts` — every sample and example
  module (77), the same seeded stimulus on both parts (0, 1, `X`, released; one pin or several
  at an instant; 1 or 40 ns apart), pins, diagnostics, inner signals and memories compared at
  every step; 1.9 s. Mutations caught: a pin's change not marking (55 fail), races off (24), the
  floating rule's loads off (19), a write not marking its memory's reads (7), internal races off
  (1). The removal of the old interpreter waits for task 8 (7b).
- 2026-11-12 — task 8 (first round): `generated()` in `source.ts`, the one `new Function`, names
  each function (`hdl/settle-3.js`) for profiles; pins read a word at a time; the floating count
  kept in state; the constants a word of their own (a bit read without a branch). The synthetic
  benchmark's lanes get `init` values (all `X` before: nothing changed, nothing measured). Against
  the old interpreter in one sitting (`tests/bench/hdl-reference.bench.ts`, untracked): decoder
  2 140–2 200 k vs 1 880–2 000 k, counter 2 980–3 530 k vs 2 470–2 540 k, synthetic 1 450–1 620 k
  vs 11.1–11.7 k, wide words 74–81 k vs 73–75 k, internal clocks 1 140–1 350 k vs 615–640 k,
  register file 776–806 k vs 737–768 k, RAM 4K × 32 398–408 k vs 398–407 k, I/O port 952–961 k
  vs 973–977 k (−2 %; measured directly the same, 5.39–5.44 vs 5.40–5.42 µs a cycle: the
  kernel's reads and drives are ≈ 80 % of it), PicoRV32 232–247 k cycles/s (direct: 280–294 k).
  PicoRV32's profile: ≈ 145 of its 456 steps run a cycle (≈ 7 ns each); the settle ≈ 35 %, the
  edge's phases (`pinEdges`: the 5 write ports sampled bit by bit) ≈ 17 %, next states and loads
  of all 116 flip-flops ≈ 11 %, pins ≈ 9 %, `clockEdge` 3 %, memory stores 4 %. Further speed
  (a 2-state path, activity for flip-flops, write samples by limbs) → a track idea (Q3).

## Handoff

- **State:** tasks 1–7 and a first round of 8 done: the part runs on words; every test green;
  PicoRV32 ≈ 240 k cycles/s (×23); the old interpreter still in `reference-part.ts`.
- **Next step:** 7b — remove `reference-part.ts`, `tests/scenarios/verilog-engine.test.ts`,
  the byte-plane flip-flop functions in `cells.ts` (their model moves into
  `flip-flops.test.ts`) and the plane memory ports in `memory-cells.ts`; keep `compileStep`
  (the adapter's and generated code's reference); then task 9 (app), task 10 (docs).
- **Watch out:** `tests/bench/hdl-reference.bench.ts` is an untracked copy of the bench on the
  old part, for alternate measurements; delete it with 7b.
- **Watch out:** benchmark against `main` alternately in one sitting; native imports only.
- **Verify with:** `pnpm check`; `pnpm bench tests/bench/hdl.bench.ts`.

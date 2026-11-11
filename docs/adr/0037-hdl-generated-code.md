# 0037. HDL modules run as JavaScript generated from their IR, on 32-bit words, with activity

- **Status:** accepted
- **Date:** 2026-11-12
- **Roadmap item:** HDL-10 (feat/hdl-fast); amends [ADR-0030](0030-hdl-modules.md)

## Context

ADR-0030's interpreter ran a module's IR over byte planes — a byte per bit for its value, one for
"unknown" — and evaluated every combinational cell on every evaluation. Fine for decoders and
state machines; HDL-7 measured PicoRV32 at ≈ 10.6 k cycles a second, where soft cores and video
controllers (the track's goal) need megahertz: HDL-10's target was 1 M cycles a second
headless. Half the time went to `$mux` and `$pmux` bit by bit, a seventh to gathering word
operands bit by bit, and the falling clock edge evaluated all ≈ 520 cells to change nothing.

ADR-0030 had rejected "TypeScript generated per module": a user's module is a document from a
shared file, and generated code would run that file through `eval`. The roadmap left the choice
— JavaScript functions or WebAssembly — to this item, with the test bench sandbox
([ADR-0026](0026-test-bench-sandbox.md)) in mind. Everything else a part has must stay:
snapshots of plain data, rewind, carry-over, inner signals and the Memory tab reading the
instance's state, the same `X` rules, races, reports and pin timing, determinism, the pure layers.

## Decision

- **Words** (`src/library/hdl/layout.ts`): an instance's bits live in two `Int32Array` planes of
  32-bit words, values (0 where unknown) and unknowns. Each cell's output has words of its own
  from bit 0 (32-bit limbs past 32 bits), each port's pin bits theirs, the constants one word
  after the rest; bits no signal uses stay 0, so whole words compare. What a cell reads is found
  once as an operand: per limb, runs of a word's bits shifted into place, a bit repeated (a signed
  operand's extension), constant ones and unknowns. The 4-state rules become word algebra (`and`:
  a known 0 wins; a multiplexer with an unknown select merges: `u = ua | ub | (va ^ vb)`).
- **Generated JavaScript** (`codegen.ts`, `flip-flops.ts`, `settle.ts`): the common cells, the
  latches and the tri-state buffers as blocks of word operations, written only where their
  output changed; the flip-flops' next states and loads per group (the flip-flops of one pin and
  edge share a function: a core's registers are one call per edge) and their asynchronous
  controls in one function. Shifts run as closures over limbs (`limb-cells.ts`, a 32-bit window
  of the operand); uncommon cells (divisions, powers, `$bmux`, `$demux`, `$sr`, `$dlatchsr`,
  arithmetic and orders past 32 bits) run `cells.ts`' bit-by-bit semantics through an adapter.
  The generated code is held to those semantics cell by cell (every sample module's cells and
  random shapes of every type, 4-state inputs); the orchestration — strict edges, two phases,
  races, rounds of clocks made by logic, loops, the floating rule, memories, pokes — keeps its
  rules and messages, on words.
- **Activity** (`settle.ts`): the combinational cells are steps in topological order (a loop's
  cells one step), a mark bit each. A step runs only when marked, and marks the steps reading its
  output where that changed; a pin read, a flip-flop's load, an asynchronous control, a memory
  write or a poke marks the readers of what it changed. Marks only go to later steps, so a settle
  leaves none and the words always are the settled function of the pins, the flip-flops and the
  memories — plain data a snapshot or a carry-over keeps as it is. A falling clock edge in a
  design clocked on rising edges runs nothing.
- **Generated code from a shared file is safe by construction**: the document keeps the IR —
  data — never code; the source is made from the generators' templates alone, and the only
  values from the IR that enter it are integers (word indices, positions, masks, widths,
  polarities), each through `int`, which refuses anything but a safe integer. No name, location,
  parameter text or other string of a document ever does. One function (`generated` in
  `source.ts`) turns source into functions (`new Function`, strict mode, a `sourceURL` naming it
  for profiles), and the functions take everything they use as parameters. It runs wherever
  modules run: the page (the app has no Content Security Policy), the bench sandbox (whose
  policy already allows `'unsafe-eval'`), Node.
- **Size**: the settle's code is split into functions of ≈ 24 k characters behind a dispatcher
  that calls one only when a step of it is marked — V8 doesn't optimize one function of a whole
  core.

## Consequences

- PicoRV32 runs at ≈ 230–250 k cycles a second in `pnpm bench` (≈ 280–290 k measured directly),
  ≈ 23× HDL-7's ≈ 10.6 k — short of the 1 M target; per the plan's Q3 the speed reached is the
  result, the rest a track idea with its profile: ≈ 145 of the core's 456 steps run a cycle,
  ≈ 7 ns each; the edges' phases (five memory write ports sampled bit by bit, the next states
  and loads of all 116 flip-flops) and the kernel's pin reads and drives take most of the rest.
- HDL-1's benchmarks run faster (a decoder ≈ +10 %, a counter ≈ +20–40 %, the 1 024-cell
  synthetic module ≈ 140×: eight-bit word operations instead of bits); clocks made by logic
  ≈ 2×; the others as before within the noise (an I/O port, where the kernel's reads and drives
  are ≈ 80 % of the time, ≈ 2 % either way).
- A benchmark of a module without a reset now measures nothing: its state stays `X`, so nothing
  changes and nothing runs (the synthetic module got power-up values).
- Compiling a module costs ≈ 10 ms for PicoRV32 (layout, analysis, source, V8's parse); the
  functions are shared by its instances.
- The semantics live in two forms: the generated templates and `cells.ts`' plain steps (the
  adapter's cells and the generated code's reference); the flip-flops' bit-by-bit model lives in
  their test. A change to a cell's meaning changes both, and the tests say where they differ.
- A Content Security Policy for the app, should it get one, needs `'unsafe-eval'` in
  `script-src` for modules to run.

## Alternatives considered

- **WebAssembly from our own encoder** — sandboxed by its nature, but Chrome refuses a
  synchronous compile over 4 KB on the main thread, so making a part would turn asynchronous;
  state in linear memory would be copied in and out for snapshots, rewind, inner signals and the
  Memory tab; every pin read and drive would cross the boundary; and an encoder to write and
  keep — for a small gain over JIT-compiled integer JavaScript.
- **No code generation** — word-level closures with activity: nothing to argue about, but every
  cell a call through an array of closures and its operands gathered in loops; expected 10–30×.
- **Keeping the interpreter as a fallback** (where `new Function` isn't allowed) — every later
  change (HDL-2's timing, HDL-3's recompiles) made twice; it served as the differential oracle
  during HDL-10 and was removed (the plan's Q2).

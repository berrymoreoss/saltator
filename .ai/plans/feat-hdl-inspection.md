# Plan: feat/hdl-inspection

| Field      | Value                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| Branch     | `feat/hdl-inspection`                                                                         |
| Roadmap    | HDL-4 — Inside a module, track [Programmable logic](../../docs/roadmap/programmable-logic.md) |
| Status     | in-progress                                                                                   |
| Depends on | HDL-1, HDL-8, HDL-9 (the IR keeps named signals; the interpreter's planes)                    |
| Created    | 2026-11-11                                                                                    |

## Goal

Debug a Verilog module without bringing its state out to pins. The named signals of a module
instance — registers and wires by their source names (`state`, `shift`, `count[3:0]`, a flattened
submodule's `u_core.state`), kept through synthesis in the IR — become references the whole
toolset already takes: probes in the waveforms ([ADR-0019](../../docs/adr/0019-waveforms.md)),
watches and breakpoint conditions ([ADR-0020](../../docs/adr/0020-debugger.md)), and reads from
test benches ([ADR-0025](../../docs/adr/0025-test-benches.md)), headless and in the app. A state
machine is then debugged as it is written: a breakpoint when `A1/state` becomes `2`, the shift
register of a UART in the timing diagram next to its `tx` pin.

When the item started (2026-11-11) the user moved HDL-3 (recompiling a running module) to the end
of the track: a restart on Compile is enough until then.

## Scope

**In scope**

- A core view of a part's inner signals on its definition (like `memory` and `cpu`), implemented
  by the Verilog module part over its planes.
- References to inner signals in the resolver: names, slices, paths through instances; errors
  that say what is there.
- Recorder channels sampled from a part's state (not a net), so waveforms, triggers and
  breakpoints take them unchanged; replicas (Reverse Continue) and rewind included.
- Watches, test bench reads (`get`, `expect`, `row` outputs), VCD export.
- Suggestions of inner signals in every reference box (Waveforms, Debug) and in the bench editor.
- A way to pick them in the module's view (Q3).
- Proof in examples (Q4), a cross-layer scenario, an e2e test, a benchmark.

**Out of scope** (and where it goes instead)

- Writing or forcing an inner signal from a bench or the UI (`force`, deposit) — a board can't
  either; a track idea if wanted.
- Memories inside modules in the memory inspector → HDL-6.
- Keeping state across a Compile → HDL-3.
- Inner signals of hand-written parts (the 6502's registers through `CpuDef`) → R17b (MOS 6502)
  may implement the same view; not built here.
- Signals Yosys optimized away: only what the IR keeps (`hide_name` 0 netnames whose bits all
  survive) can be inspected; the command doesn't change.

## Context

- [docs/roadmap/programmable-logic.md](../../docs/roadmap/programmable-logic.md) — HDL-4, its
  neighbours (HDL-6's memory view, HDL-3 now last).
- [ADR-0019](../../docs/adr/0019-waveforms.md), [ADR-0020](../../docs/adr/0020-debugger.md),
  [ADR-0025](../../docs/adr/0025-test-benches.md), [ADR-0030](../../docs/adr/0030-hdl-modules.md),
  [ADR-0023](../../docs/adr/0023-subcircuits.md), [ADR-0024](../../docs/adr/0024-instance-navigation.md).
- [docs/circuit.md](../../docs/circuit.md) (references, ≈ lines 510–560),
  [docs/components.md](../../docs/components.md#verilog-modules-hdl),
  [docs/simulation.md](../../docs/simulation.md), [docs/editor.md](../../docs/editor.md#verilog-modules).
- Code:
  - `src/core/hdl-module.ts` — `HdlSignal` (name, lsb, bits, init, src), kept "for HDL-4".
  - `src/library/hdl/module-part.ts` — `HdlState` (`val`/`unk` byte planes, one byte per bit,
    constants at `bitCount..+2`, `planeIndex`/`tri` in `planes.ts`); `hdlPart` (409–427);
    `bitName` in `analyze.ts` (a bit → name map).
  - `src/core/memory.ts` (`MemoryDef.view`), `src/core/cpu.ts` (`CpuDef.view`) — the pattern.
  - `src/circuit/resolve.ts` — `Resolver`, `Target` (21–39), `ProbeTarget` (58–63), grammar in
    `resolve`/`#resolveIn` (155–228), `signal`/`probe` (273–301).
  - `src/core/recorder.ts` (`attach` 170–195, `#links` 402–409, `attachChannel`,
    `removeChannel`), `src/core/trigger.ts` (`#instant` 162–189), `onInstant` in
    `simulator.ts` (529–535, 811–818).
  - `src/editor/analyzer.ts` (`#rebuild` 709–766, `#attach` 694–706), `src/editor/debugger.ts`
    (`#buildTerms` 944–985, `#rebuild` 890–942, `#hitSearch` 623–675, watches 1093–1146).
  - `src/circuit/bench/bench.ts` (`get` 324, `#findOutput` 687–705, `#findInput` 639–663).
  - `src/ui/waveforms-view.ts` (`referenceSuggestions` 118–138), `src/ui/script-completions.ts`
    (`scriptReferences` 61–111), `src/ui/ModuleView.tsx`, `src/ui/module-view.ts`.

## Design

### Where the values are

An instance is one flat part (`A1/U1`, type `hdl/<circuit id>`); every IR bit's present value is
in its state's `val`/`unk` planes — a flip-flop's or latch's state is its `Q` bits, there is no
separate store. A signal's value is `bits.map(b => tri(val, unk, planeIndex(b, bitCount)))`.

**Core: `ComponentDefinition.signals?: SignalsDef`** (new, like `memory`, `cpu`):

```ts
/** A named signal inside a part (HDL-4): a register or wire of a module's source. */
interface InnerSignal {
  readonly name: string;
  readonly lsb: number;
  readonly width: number;
  readonly src?: string;
}
interface SignalsDef {
  readonly list: readonly InnerSignal[];
  /** Bit `bit` (0 = least significant) of signal `index`, in a state of this part, now. */
  level(state: unknown, index: number, bit: number): Level;
}
```

The library's `hdlPart` implements it from `module.signals` and the planes (no copy, no
allocation). Generic on purpose: R17b can expose the 6502's registers the same way.

### References (the resolver)

The spelling (Q1) is **`A1/state`**: a module is a
circuit written in Verilog, so its signals are named as the nets inside a subcircuit are —
`state` in the module's own scope (its own benches), `A1/state` from the circuit that places it,
`S1/A1/state` through a subcircuit, `A1/u_core.state` for a flattened submodule's register. Slices
(Q2): Verilog's `[3:0]` and `[2]` with the signal's own indices, `..` accepted too, shown as
Verilog.

- New target kind `inner`: `{ part: 'A1/U1', type, signal: index, name: 'A1/state', lsb, width,
  bits: number[] }`, the bits least significant first. Looked up in a module's scope (its one
  part `U1` of type `hdl/…`, `Scope.module`) **after** what resolves today (pins, port nets,
  buses, parts), so no existing reference changes meaning (`#resolveIn` wraps `#resolveNamed`).
- `ProbeTarget` is `{ bits, keys, vector }`: `bits` a net id, an `InnerBit` (`{ part, signal,
  bit }`) or `undefined`; `keys` each bit's reference (`D0`, `A1/state[0]`), the channels'
  identity — the analyzer and the debugger used to compute them from the text (`bitKeys`).
  `channelSource(sim, bit)`, `signalBitLevel(sim, bit)`, `sameSignalBit` map bits for any
  simulator (the replica too).
- Errors: `no part, net or signal named hold in A1 (signals: and_y, held, u1.word)`,
  `A1/u1.word is u1.word[6:4]: no bit 3`, `… in A1: it keeps no named signals`; a module with
  errors has no part, so nothing resolves inside it.
- `renameReference` already follows `A1/…`; a probe whose signal is gone after a Compile shows
  unresolved, as a probe on a removed net does.

### Recording (core)

Values inside a module change inside `evaluate`, written many times per call (loops, rounds);
the recorder keeps one level per instant anyway. So inner channels are **sampled at the end of
an instant** (`onInstant`), not reported per change:

- `Recorder.attach(sim, sources)` takes per channel a `ChannelSource`: a net index **or an
  `InnerBit`** (plain data); the recorder keeps the live channels' sources (`#sources`, which
  replaced `#links()`), reads inner bits through `innerReader` (the state looked up by part id on
  every read: a restore that changes a state's shape replaces it) and subscribes to `onInstant`
  only while it has any.
- Order: `Recorder.sample()` (reading again at one instant changes nothing) and the `Trigger`
  calls it first, so a breakpoint never reads a stale inner level whatever the listener order.
- Rewind: `restore` writes into the same planes, the recorder's `seek` already truncates.
  Replicas (Reverse Continue): the debugger maps the same bits on the replica (`channelSource`).
- Core: `Simulator.definitionOf(id)` (inspection: the part's views).
- Cost: nothing without inner channels (kernel unchanged); measured with them.

Timing, documented: an inner register changes at its clock edge's instant; the module's pins
follow `delay` later (15 ns by default) — the waveforms show both, as on a board with a logic
analyzer on an internal test point.

### Reading elsewhere

- **Watches**: a signal watch whose bits are inner reads them through the view at each stop.
- **Benches**: `#findOutput` gains the inner kind; `get`, `expect`, `row` outputs read it at call
  time (headless and in the sandbox: both build their own simulator from the same code). A drive
  of an inner signal is refused: "A1/state is inside a module: read it, or drive a pin".
- **VCD**: inner channels are channels; named by their reference.

### Picking them in the UI

- `referenceSuggestions` (Waveforms, Debug) and `scriptReferences` (bench editor) offer the inner
  signals of the module instances placed in the open circuit (`A1/state`), and bare names while a
  module itself is open.
- The module's view (Q3): a **Signals** section — name, range, source line on hover, the open
  instance's live value while simulating (`signalRows`) — with **Probe** (`Editor.toggleProbe`)
  and **Watch** (`Editor.watch`, a new `watched` request that shows the Debug tab) on each row.
- Step Clock refuses a signal inside a module (nothing queued on it for `stopBefore`).

### ADR

ADR-0035 "Inner signals: a view on the part, named like nets inside a subcircuit, sampled at
instants" (written): the view, the reference spelling, sampling vs. per-change notification vs.
inner signals made nets, the timing consequence.

Rejected (for the ADR):

- **Inner signals as hidden nets** the part drives with zero delay — every register change an
  event, nets that aren't in the circuit, the kernel's cost on every module.
- **A per-change hook inside the interpreter** — intermediate values of loops and rounds, a call
  per plane write.
- **`A1/U1.state`** (a pin of the internal part) — exact, but shows the module's internal `U1`.

## Tasks

- [x] 1. Core: `SignalsDef` on `ComponentDefinition` (registry check); the module part
  implements it. Tests: `uart_tx`'s `shift`/`left`/`tick` through a send, aliases of a port,
  constant bits, `X` before power-up values.
- [x] 2. Resolver: the `inner` target, sources in `ProbeTarget`, names with `.`, slices (Q2),
  errors, paths through subcircuits, the module's own scope. Tests in `resolve.test.ts`.
- [x] 3. Recorder: sampled channels (`attach`, `attachChannel`, `removeChannel`, `#links`),
  `sample()` per instant, the trigger sampling first. Tests: one level per instant, a trigger on
  an inner channel, rewind.
- [x] 4. Waveforms (`analyzer.ts`): probes on inner signals, the trigger on them, VCD.
- [x] 5. Debugger: breakpoints on inner signals (incl. Reverse Continue's replica), watches.
- [x] 6. Benches: inner outputs for `get`/`expect`/`row`, drives refused; `pnpm test:circuits`.
- [x] 7. Suggestions: Waveforms/Debug boxes and the bench editor.
- [x] 8. Module view: the Signals section (Q3).
- [x] 9. Proof (Q4): examples, `tests/scenarios/verilog-inspection.test.ts`,
  `tests/e2e/hdl.spec.ts`, a benchmark of inner channels.
- [x] 10. Docs: ADR-0035, circuit.md (references), simulation.md (recorder), components.md (the
  view), editor.md (module view, suggestions), glossary; the roadmap's HDL-4 "Built"; lessons.

## Acceptance criteria

- [x] `pnpm check` and `pnpm build` are green; `pnpm e2e` passes; `pnpm test:circuits` passes.
  (2026-11-11: 3462 tests, 98 e2e, 28 example benches.)
- [x] A probe on `A1/shift` in the UART example draws the shift register next to `tx`, changing
  at the clock edge, `tx` the module's delay later. (The UART opens with it, e2e; the edge and
  the pin 15 ns later: `analyzer.test.ts`, on the `clocks` module.)
- [x] A breakpoint on a value inside a module pauses at the instant it loads; Reverse Continue
  finds it. (`debugger.test.ts`: `A1/rip = 3`, `A1/rip[1:0] = 2`, Reverse Continue in a replay.)
- [x] A watch on `A1/left` shows its value at each stop, marked when changed. (e2e adds it from
  the Signals list; changed marks: `debugger.test.ts`.)
- [x] A bench reads a module's signal with `get` and checks it in `expect` and a `row`, headless
  and in the app; driving it is refused with the reason. (`verilog-inspection.test.ts`; in the
  app the traffic light's benches with their `state` column pass in the sandbox, e2e.)
- [x] Inner signals in the suggestions of every reference box and in the bench editor.
  (`waveforms-view.test.ts`, `script-editor.test.ts`.)
- [x] (Q3) the module view lists the signals with live values; Probe/Watch from there work.
  (e2e; looked at in the browser.)
- [x] Names with `.` (a flattened submodule) and slices resolve; wrong ones say what exists.
  (`resolve.test.ts`.)
- [x] No cost without inner probes (HDL-1's benchmark unchanged); the cost with them measured.
  (≈ 2 % for 16 bits, progress log.)

## Open questions

- [x] Q1. How is an inner signal named? — _proposed:_ `A1/state` (like a net inside a
  subcircuit; `state` in the module's own scope) — **answer:** as proposed: `A1/state`,
  `A1/u_core.state`, `S1/A1/state`, `state` in the module's own benches; `A1.q` stays the pin.
- [x] Q2. Slices of a vector signal? — _proposed:_ Verilog's `[3:0]`, `[2]` with the signal's
  own indices; the app's `[3..0]` accepted too; shown as Verilog — **answer:** as proposed.
- [x] Q3. Where are inner signals picked in the UI? — _proposed:_ a Signals section in the
  module's view (live values, Probe and Watch) plus suggestions in every reference box —
  **answer:** as proposed; no canvas menu on instances.
- [x] Q4. Proof? — _proposed:_ the existing UART example ships probes on its registers (`A1/shift`,
  `A1/left`, `A2/shift`) and its bench reads inner signals; Traffic Light's bench checks `state`
  — **answer:** as proposed (no new example).

## Progress log

- 2026-11-11 — plan drafted; HDL-3 moved to the end of the track (the user's choice).
- 2026-11-11 — Q1–Q4 answered (all as proposed); started.
- 2026-11-11 — tasks 1–10 done, a commit each, `pnpm check` green after every one: the view
  (core + library), the resolver, the recorder, waveforms, debugger, benches, suggestions, the
  module view's Signals, the examples (UART probes and a bench through both modules' registers,
  the traffic light's `state` column), the e2e test, the benchmark, the docs. Benchmark
  (`pnpm bench tests/bench/hdl.bench.ts`, Apple M3 Pro): synthetic 1 024 cells 12.3k
  evaluations/s (≈ 6.1k cycles/s, HDL-1's baseline unchanged), with 16 inner bits recorded
  12.0k (≈ 2 %); decoder 2.0M, counter 2.5M, wide words 75.7k, internal clocks 632k evaluations/s.
  Looked at in the browser (dev server, Playwright screenshots): the UART's probes, the
  transmitter's Signals in A1 with live values and the Probe/Watch icons.

## Handoff

- **State:** every task done and committed on `feat/hdl-inspection` (local only: the user asked
  for no push). Plan status `in-progress`, the track's HDL-4 `in-progress` with its Built
  section written.
- **Next step:** the finish-branch workflow — verify the acceptance criteria one by one (most are
  covered by tests: `src/editor/analyzer.test.ts`, `debugger.test.ts`,
  `tests/scenarios/verilog-inspection.test.ts`, `tests/e2e/hdl.spec.ts`), `pnpm build`, the full
  `pnpm e2e`, then ask the user before merging.
- **Watch out:** resolvers need `design.registry` to see modules' parts (lessons); the
  UART's board bench timings assume its 100 Hz clock rising at 5 ms, 15 ms, ….
- **Verify with:** `pnpm check`, `pnpm test:circuits`, `pnpm e2e tests/e2e/hdl.spec.ts`,
  `pnpm bench tests/bench/hdl.bench.ts`.

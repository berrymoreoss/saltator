# Plan: feat/debugger

| Field      | Value                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| Branch     | `feat/debugger`                                                                              |
| Roadmap    | R14a — Breakpoints, stepping, watches ([roadmap](../../docs/roadmap.md))                     |
| Status     | done                                                                                         |
| Depends on | R05 (simulator host), R12b (resolver, memory views), R13 (break request, triggers, recorder) |
| Created    | 2026-11-07                                                                                   |

## Goal

Stop a running circuit where something interesting happens and walk through it, as a debugger
does with a program: **breakpoints** on signal and bus conditions (the trigger's terms, on any
signal of the circuit) and on the errors the simulation reports (contention, timing
violations); **stepping** by clock cycle and by time besides the existing step to the next
event; a **watch list** of signals, buses and memory cells that marks what changed since the
last stop; and **run statistics**. It is the third design tool of phase 3 (M2 "Tools": "a run
stopped at a breakpoint and stepped"). R14 is split at its start (Q1): snapshots and rewind —
stepping backwards — become R14b (`feat/rewind`), which builds on this branch's stepping and
breakpoints.

## Scope

**In scope**

- `core`: a run option that stops **before** the instant at which a net is due to change to a
  level (`stopBefore`: Step Clock's lookahead, Q3); `io/clock` scheduling each edge ahead as a
  pending change, so its next edge is visible; `DiagnosticLog.onOccurrence` (every report,
  repeats included); a repeating `Trigger` (`repeat: true`) for breakpoints.
- `circuit`: memory-cell references in the resolver (`U5[0x1F]`, `U5[0x10..0x1F]`), a rename
  helper for any reference.
- `editor`: the host's stepping goals (run at Max until a time or until right before a clock
  edge, then pause), pause requests that win over a trigger's run-on, the reason it paused; a
  `Debugger` model (`editor.debug`, DOM-free): breakpoints, break on errors/warnings, Step
  Clock, Run For, Run To, watches, statistics.
- `ui`: the **Debug** tab (sixth bottom-dock tab: stepping toolbar, breakpoints, watches), run
  statistics in the Simulation tab, Simulate-menu commands, shortcuts and a toolbar button,
  canvas and Memory-tab context-menu entries, the pause reason in the status bar; the debug
  setup kept with the session (Q2).
- Browser tests; docs (simulation.md, editor.md, circuit.md, components.md, architecture.md,
  glossary, READMEs), ADR-0020, roadmap (the split), lessons.

**Out of scope** (and where it goes instead)

- Snapshots, rewind, Step Back, Reverse Continue → R14b `feat/rewind` (Q1).
- Stepping one delta cycle inside an instant: zero-delay deltas are kernel bookkeeping, not
  something a real chip does (the recorder collapses them too) → not planned.
- Breakpoints on memory accesses (break when `U5[0x0F]` is written) and on a CPU's program
  counter → R17/R19 (backlog until then).
- Log points (report instead of stopping), breakpoint and watch marks on the canvas → backlog.
- Signals inside subcircuits → R11 (instance paths in the resolver).
- Assertions that fail a run → R15's test benches.

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md) — running, `requestBreak`, `onInstant`,
  observability, recorder, triggers, carry-over.
- [docs/editor.md](../../docs/editor.md) — Simulation (run control, breaks, `pauseAt`, pacing,
  stores), Memory inspector, Waveforms (trigger dialog, analyzer lifecycle), Commands.
- [docs/circuit.md#resolver](../../docs/circuit.md#resolver) — references.
- [ADR-0010](../../docs/adr/0010-running-simulations.md) (host),
  [ADR-0012](../../docs/adr/0012-files-and-sessions.md) (file vs session),
  [ADR-0019](../../docs/adr/0019-waveforms.md) (break request, triggers).
- `src/core/simulator.ts` (`run`, `scheduleDrive`, `carryOver`), `src/core/trigger.ts`,
  `src/core/recorder.ts`, `src/core/diagnostics.ts`, `src/library/io/clock.ts`,
  `src/editor/simulation.ts`, `src/editor/analyzer.ts` (a model per tool on the host),
  `src/circuit/resolve.ts`, `src/ui/WaveformsPanel.tsx` (Trigger dialog),
  `src/ui/SimulationPanel.tsx`, `src/ui/workbench-commands.ts`, `src/ui/autosave.ts`.

## Design

### Breakpoints

A **breakpoint** is a trigger condition that pauses the run every time it holds, instead of
once:

- **Condition**: the trigger's terms (`rises`, `falls`, `changes`, `is 0/1/X/Z` on a 1-bit
  signal; `=`/`≠` a hex value with `X` digits on a bus or group), ANDed, at most one edge —
  but on **any reference** the resolver takes (`CLK`, `U3.QA`, `D[0..7]`, a group of 1-bit
  references), not only on probes. Without an edge term it fires when the pattern **becomes**
  true (`PC = 0F` stops once per arrival, not at every instant it stays there).
- **Evaluation**: the debugger keeps its own small `Recorder` (budget 64K changes) with a
  channel per breakpoint bit, and one core `Trigger` per breakpoint with `repeat: true` (fires
  at every instant the condition holds anew, stays armed). So breakpoints are exactly the
  trigger's conditions (R13 said so), glitches inside an instant never stop the run, and a
  carry-over only re-resolves and re-attaches (as the analyzer does).
- **Hits**: each breakpoint counts its hits since power-on; an optional **hit count** N makes
  it stop from the N-th hit on ("the 5th time the counter wraps"). A disabled breakpoint
  neither stops nor counts. Disable all / enable all.
- **Break on errors / warnings**: two toggles (off by default) — every occurrence of an error
  (contention, timing violations: the Simulation tab's error kinds) or a warning (floating
  input, …) pauses at the end of its instant, repeats of a merged entry included
  (`DiagnosticLog.onOccurrence`). Oscillation already halts.
- References that stop resolving (a renamed net label, a deleted part) keep the breakpoint,
  shown struck through with the reason; part renames rewrite them.

### Stopping and why (host)

Today a `break` from the kernel pauses the host unless a trigger asked to run on (`pauseAt`).
A breakpoint during a trigger's post-trigger time would then be ignored, so the host gets
`requestPause(reason)`: it asks the kernel to break and pauses at that instant whatever
`pauseAt` says (a pending `pauseAt` is dropped). The status gets the **reason** it paused —
`Breakpoint 2: D[0..7] = 2B`, `Error: setup violation on U3.D0`, `Trigger`, `Step Clock`,
`Run For 1 µs` — shown in the status bar and the Debug tab until the next run.

### Stepping

- **Step** (`F10`, as now): to the next instant with events.
- **Step Clock** (`F8`): one clock cycle of the **step clock** — a reference (default: the net
  named `CLK`, else the output of the first clock part, `io/clock` Y or `timer/ne555` OUT) and
  its active edge (rising by default, or falling). It runs through the clock's next active
  edge and pauses **right before the one after** (Q3): the cycle has settled, the registers
  show what the last edge loaded and their inputs what the next edge will load — as Ben Eater's
  manual clock shows it, the LEDs show the new count. `F10` from there steps into the edge.
  From stopped it powers on and pauses before the first edge.
- **Run For** Δt (`Shift+F8`; a duration in the Debug toolbar, `1 µs` by default) and **Run To**
  a time: pause exactly then.
- Steps are jumps: they run at **Max** whatever the speed setting, across as many frames as
  they take (the status says `Stepping to CLK ↑…`), stop early at a breakpoint or an error
  break, and Pause cancels them; Run turns a step into a normal run.

**Lookahead** (core): `runUntil`/`settle` take `stopBefore: { net, level }` and return the new
status `before` without processing the next instant when the net's drivers have pending
changes due then that resolve it to `level` (`now` stays at the last instant processed). The
kernel keeps each driver slot's pending change time (`slotPendingTime`); the check costs
nothing when the option is absent. Changes made with zero delay inside the instant itself
can't be seen ahead, so `io/clock` schedules each edge as a pending drive one phase ahead
(today it drives at its wake with zero delay; the levels at every instant stay the same — a
trace test). Gates and 74HC parts all have delays, so a clock gated through them (the Clock
Module's 74HC32, a halt line) is seen one gate delay ahead. The host's Step Clock: run with
`stopBefore` the active level; if it stopped without processing anything (it was already right
before an edge), process that instant and run again.

### Watches

A **watch list** for the values a debugger shows at a stop:

- Entries: a net, pin or bus by reference, a group of 1-bit references read as one value, or
  memory cells — `U5[0x1F]` or a range up to 16 cells `U5[0x10..0x1F]` (the address as the
  Memory tab's Go to takes it: `1F`, `0x1F`, `$1F`, `1Fh`; a memory designator before `[`
  makes it a memory reference, otherwise it is a bus). A name and a radix (`hex`, `dec`, `bin`,
  `ascii`) per entry, as probes have.
- Values **now** (refreshed on the host's `ticks` while running, at once after a step), and
  **changed**: differs from its value at the last stop — highlighted as debuggers do, so after
  a Step Clock the registers that loaded stand out. Unknown bits as `X` nibbles; a watch that
  doesn't resolve shows the resolver's reason.
- Separate from the probes (Q4): watches aren't recorded (no cost while running), can show
  memory cells, and later CPU registers (R17) and assembler symbols (R19).

### Run statistics

In the Simulation tab, beside the diagnostics (it is about the run): since power-on and for
the last run (since the last Run/step): simulated time, wall time spent running, events, delta
cycles, evaluations, events per second and simulated time per second; the **most active nets**
(top 10 by changes, with the frequency it makes, `changes / 2 / time`) — a forgotten fast
clock or a ring that oscillates shows at the top. Activity is measured on request (Measure
activity: counts from then on, through an `onNetChange` listener, carried over by net id),
not by the kernel: a counter in the kernel's net update cost ≈ 3 % on gate chains for every
simulation (task 3).

### The debug setup (session)

Breakpoints, watches, the step clock and its edge, the Run For duration and the break-on
toggles are the **debug setup**: kept with the session (Q2) — autosaved per browser tab with
the view, restored after a reload — not in the file and not undoable (as an IDE keeps
breakpoints in its workspace, not in the source). New and Open clear it. Part renames rewrite
its references.

### UI

- **Debug** tab (`DebugPanel.tsx`, pure pieces in `debug-view.ts`):
  - toolbar: Step Clock, the step clock (a reference box with completion) and ↑/↓, Run For
    with its duration, Run To with a time, Break on errors, Break on warnings, the pause reason;
  - **Breakpoints**: one row each — enabled checkbox, condition text (`CLK ↑ · D[0..7] = 2B`),
    hits (and the hit count), edit, remove; Add… and edit open the condition dialog — the
    Trigger dialog's term editor, shared, on references typed with completion; Disable all;
  - **Watches**: name, value, radix, changed mark, remove; Add with completion; rename by
    double-click.
- **Commands**: Simulate ▸ Step Clock (`F8`), Run For (`Shift+F8`), Run To…, Add
  Breakpoint…, Disable All Breakpoints, Break on Errors; a Step Clock toolbar button next to
  Step; the shortcuts dialog. (`F6`/`F7`/`F11` are taken by browsers or the OS.)
- **Context menus**: over a wire, pin, net label or bus (the Probe tool's hit rules,
  `probeSpotAt`) — Break when `ref` rises / falls / changes, Add Breakpoint on `ref`…, Watch
  `ref`; over a cell of the Memory tab — Watch `U5[0x1F]`.
- Status bar: `Paused · 1.234 µs · Breakpoint 2: D[0..7] = 2B`.

### ADR-0020

"Debugger: breakpoints are repeating trigger conditions that pause; Step Clock stops before the
next edge by kernel lookahead; the debug setup lives in the session; rewind split off":
breakpoints on any reference through a recorder of their own vs on probes only, vs a separate
evaluator on nets; pausing before the next edge vs at the edge vs a settle time (Q3); the
session vs the document vs memory only (Q2); watches apart from probes (Q4); `requestPause`
winning over `pauseAt`; R14 split into R14a/R14b (Q1).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `core`: `stopBefore` run option and status `before` (pending change times per driver
  slot; resolved with the pending drives due; a cancelled change, several drivers resolving to
  the same level, a zero-delay change not seen); tests; kernel benchmark unchanged.
- [x] 2. `library`: `io/clock` schedules its edges ahead (auto and manual mode); a trace test
  (same levels at every instant), the carry-over property green; `stopBefore` sees the edges
  of `io/clock`, the NE555 and a gated clock (scenario).
- [x] 3. `core`: `DiagnosticLog.onOccurrence`, `Trigger` with `repeat`; tests. (A kernel
  `netChanges` counter was tried and dropped: ≈ 3 % on gate chains.)
- [x] 4. `circuit`: memory references in the resolver (cells, ranges, address forms, the bus
  ambiguity) and `renameReference`; tests.
- [x] 5. `editor`: host — stepping goals (`runTo`: a time, before a clock edge) at Max across
  frames, `requestPause(reason)`, the pause reason in the status, breaks during steps, Pause /
  Run during a step; fake-clock tests with exact instants at every speed.
- [x] 6. `editor`: `Debugger` — breakpoints (resolve, own recorder, repeating triggers, hits,
  hit count, enable, problems, renames, carry-over, power-on), break on errors/warnings, Step
  Clock (default clock, edge), Run For / Run To, watches (values, changed since the last
  stop), statistics; headless tests; mutation-checked.
- [x] 7. `ui`: the Debug tab — toolbar, breakpoints list and condition dialog (the term editor
  shared with the Trigger dialog), watches; commands, menu, shortcuts, toolbar button, status
  reason; context-menu entries (canvas, Memory tab); looked at in both themes.
- [x] 8. `ui`: run statistics in the Simulation tab; looked at on Ring Oscillator.
- [x] 9. `ui`: the debug setup in the session (autosave, restore after reload, cleared by
  New/Open); tests.
- [x] 10. e2e: SAP-1 Program Counter — Step Clock advances the count by one per press, a
  breakpoint on the count stops a run there, Run For moves time by exactly Δt; RAM by Hand —
  a watched cell changes after a write; break on an error; the setup survives a reload.
- [x] 11. Docs: simulation.md, editor.md (Debugger), circuit.md (memory references),
  components.md (`io/clock` edges ahead), architecture.md, glossary, READMEs, ADR-0020;
  roadmap (R14 split into R14a done and R14b next; backlog: memory-access breakpoints, log
  points, canvas marks); lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [x] `pnpm check` (2143 tests), `pnpm build` and `pnpm e2e` (70) are green.
- [x] A breakpoint on an edge, a level pattern or a bus value pauses the run at the first
  instant it holds, at every speed, with the reason shown; Run goes on to the next hit; a hit
  count delays it; a disabled breakpoint doesn't stop (`debugger.test.ts` breakpoints: edges,
  a group value at 1 µs/s and Max, ANDed terms, hit counts, enable/disable, Reset; e2e: `= 5`
  on the program counter, "Breakpoint 1: … = 5" in the status bar).
- [x] Break on errors pauses at each contention and timing violation, repeats included (unit:
  contention twice, a merged repeat; e2e: the 74HC161's recovery violation).
- [x] Step Clock pauses right before the step clock's next active edge, from stopped, paused
  at an edge or mid-cycle, with `io/clock`, a 555 and a gated clock (host tests on `io/clock`:
  the edge is the next instant from stopped, at an edge and mid-cycle; `step-clock.test.ts`:
  a 74HC08-gated clock with the count settled at every stop, an NE555); on SAP-1 Program
  Counter — a manual clock — the count goes up by exactly one per press (e2e: 1, 2, 3).
- [x] Run For Δt pauses at exactly `now + Δt`, Run To at its time; a breakpoint stops either
  early (host and debugger tests; e2e: `4.25 s · Run For 250 ms`).
- [x] Watches show nets, pins, buses, groups and memory cells, live while running, and mark
  what changed since the last stop (unit: signals, a group, ROM and RAM cells, radixes, marks
  across stops and a poke; e2e: the count group marked after each press, a RAM cell `0x05`).
- [x] Run statistics show the counters and rates; the most active net of Ring Oscillator is
  its ring (looked at: U1.5Y, U1.6Y, U2.1Y, 37 changes in 1 µs, 18.5 MHz; e2e: the table).
- [x] The debug setup survives a reload, New/Open clears it, part renames rewrite it (e2e
  reload; `autosave.test.ts`; the rename test in `debugger.test.ts`).
- [x] Kernel benchmark: no change without debugger features; the cost of breakpoints and of
  measuring activity recorded here (ring oscillator 12.75M events/s, 10.90M with a breakpoint,
  11.90M measuring activity; `stopBefore` and the `io/clock` change within noise).

## Open questions

- [x] Q1. Split R14? — _proposed:_ yes: R14a `feat/debugger` (breakpoints, stepping, watches,
  statistics — this plan) and R14b `feat/rewind` (snapshot/restore of the whole simulator, a
  bounded history with a log of user actions, Step Back, Reverse Continue, rewind to a time
  from the waveform's ruler) — **answer:** split (2026-11-07).
- [x] Q2. Where does the debug setup (breakpoints, watches, step clock) live? — _proposed:_ in
  the session (autosaved per tab, survives a reload; not in the file, not undoable) —
  alternatives: in the document like probes (schema v4, saved, undoable, examples can ship
  breakpoints); memory only — **answer:** in the session (2026-11-07).
- [x] Q3. Where does Step Clock pause? — _proposed:_ right before the next active edge (the
  cycle settled: the LEDs show the new count; needs the kernel lookahead and `io/clock`
  scheduling edges ahead) — alternatives: at the edge, after its instant (outputs change only
  after their delays, the LEDs still show the old count); a fixed settle time after the edge —
  **answer:** before the next edge (2026-11-07).
- [x] Q4. Watches: a list of their own, or values of the probes? — _proposed:_ their own list
  (not recorded, memory cells, later CPU registers) — alternative: a "now" column in the
  Waveforms list, memory cells added to probes (the recorder records nets only) — **answer:** their
  own list (2026-11-07).

## Progress log

- 2026-11-07 — plan drafted; `main` green (2088 tests). Q1–Q4 answered as proposed: R14 split
  (R14b `feat/rewind`), the debug setup in the session, Step Clock pauses before the next edge,
  watches as a list of their own.
- 2026-11-07 — plan approved; branch started; roadmap: R14 split into R14a and R14b.
- 2026-11-07 — task 1: `RunOptions.stopBefore` and run status `before` (`slotPendingTime` per
  driver slot, set where drives are scheduled and carried; `dueLevel` resolves the net with the
  drives due at the next instant). Mutation-checked (5 mutations; a `due` flag turned out
  equivalent and was removed). Benchmark: noise (three runs: ring oscillator 12.4–13.2M
  events/s vs 13.2M on `main`, the 74HC574 pipeline 5.25–5.43M vs 5.52M, the others ±1 %).
- 2026-11-07 — task 2: `io/clock` schedules each edge as a drive a phase ahead, with a timer at
  the edge (tokens `HIGH`/`LOW`) scheduling the next; every existing test (edges, carry-over
  property, examples) passes unchanged, a new one stops right before its edges in both modes
  (fails on the old code). Scenario `step-clock.test.ts`: an `io/clock` gated by a 74HC08 into
  a 74HC161 stops 1 gate delay ahead of each CLK rise with the count settled (0, 1, 2, 3); an
  astable NE555 is seen ahead (its OUT has `tpd`).
- 2026-11-07 — task 3: `DiagnosticLog.onOccurrence` (every report, before it is counted);
  `Trigger` option `repeat` (fires at every instant the condition holds anew, stays armed,
  `fired` stays undefined). Found while testing: a carry-over at the instant a trigger fired
  processes that instant again (the new simulator's forced evaluation calls `onInstant`), so a
  repeating edge trigger fired twice — a trigger now never fires twice at one instant.
  A kernel `netChanges` counter (one increment in `updateNet`) cost ≈ 3 % on gate chains (two
  runs each: 74HC04 chain 7.9–8.0M events/s vs 8.24–8.26M without it, 74HC595 chain 5.5–5.7M vs
  5.9–6.0M): dropped; the debugger measures activity on request instead. Mutation-checked.
- 2026-11-07 — task 4: `Target` kind `cells` (`U5[1F]`, `U5[10..1F]`, either way round; a
  memory's designator wins over a bus name, another part's is refused unless the text is a bus
  name); `parseAddress` moved from `ui/memory-view.ts` to `circuit` (the resolver and the
  Memory tab share it); `renameReference` (pins only — `U5` and `D1[0..7]` stay: a net or a bus
  may look like a designator), so watches keep a memory reference as data (part, from, to)
  that a rename rewrites, not as text.
- 2026-11-07 — task 5: `Simulation.runTo(StepGoal)` — `time` (until) and `edge` (net id,
  level: through the next instant, then `settle` with `stopBefore`), at Max, the first frame
  run at once (short steps end synchronously, like Step), spread over frames otherwise;
  `requestPause(reason)` (first of an instant wins, beats `pauseAt` and steps); `status.reason`
  and `status.goal`; `pauseAt(time, reason)` (the analyzer says `Triggered at …`). Found while
  testing: Run during a step kept the step's wall time, so the first normal frame jumped
  (`#lastWall` reset). Mutation-checked (19 mutations; three survivors were equivalent code —
  removed: a speed override the step chunk made moot, a `budget` after an hour without an
  edge, a pass-phase `pauseAt` guard that pausing makes dead).
- 2026-11-08 — task 6: `editor/debugger.ts` (`editor.debug` — `debugger` is a reserved word):
  `setup` store (`DebugSetup`: breakpoints, watches, clock, edge, Run For, break-on toggles;
  `load`, cleared by `setCircuit`), breakpoints on debug signals (one reference, or several
  1-bit references bit 0 first as a group) evaluated by repeating core `Trigger`s on a recorder
  of their own; hits since power-on, hit counts, enable/disable, problems; break on
  errors/warnings through `onOccurrence` (`diagnosticSeverity` moved from the Simulation panel
  to core); Step Clock (default clock: the net `CLK`, else the first `io/clock`/`timer/ne555`
  output), Run For, Run To; watches of signals, groups and memory cells (`formatCells`),
  `changed` against the stop before (stops noted on status and ticks; the state before the
  power-on instant is no stop); `stats()` (since power-on, last run, wall time running);
  `measureActivity`/`activity()` (an `onNetChange` counter, carried by net id). The host got
  `netOf(sceneNetId)` (through the signal map's pins: a kept simulator may name nets
  otherwise), used by steps, breakpoints and watches. Found while testing: a carry-over at a
  breakpoint's instant made rebuilt triggers fire there again — a trigger is now kept while
  its condition is the same. Mutation-checked (16 mutations; renaming the recorder's keys on a
  part rename was equivalent and was removed; dropping unused channels is cleanup only).
  Benchmark: ring oscillator 12.75M events/s, 10.90M with a breakpoint (every event of the
  ring is an instant of its own: the trigger's end-of-instant look is the cost), 11.90M
  measuring activity.
- 2026-11-08 — tasks 7–8: the Debug tab (`DebugPanel.tsx`: Step Clock with the clock box and
  edge, Run For with its duration, Run To, Break on errors/warnings, the reason; Breakpoints —
  enable, text, hits, edit, remove, Add…, Disable all; Watches — add with completion, value
  with the changed mark, radix, rename by double-click, remove) and the breakpoint dialog
  (typed signals, conditions shared with the Trigger dialog in `condition-terms.ts`, hit
  count); `debug-view.ts` (drafts, counts, frequencies, the statistics rows); commands
  `debug.stepClock` (F8, toolbar), `debug.runFor` (Shift+F8), `debug.runTo`,
  `debug.addBreakpoint`, `debug.disableAll`, `debug.breakOnErrors` in the Simulate menu; the
  item context menu's Break When `ref` Rises, Add Breakpoint on `ref`…, Watch `ref`; a Watch
  `U1[0x05]` button in the Memory tab (a button for the cell at the cursor, not a context menu
  over cells: the hex view has none); the status bar says why it paused or what a step runs
  to; run statistics and Most active nets beside the diagnostics; disabled dialog buttons look
  disabled (the Trigger dialog's Arm didn't either). Looked at in the browser on SAP-1 Program
  Counter, dark and light.
  Design addition found there: the example's clock is a manual `io/clock` (Ben Eater's step
  button), which has no edge coming. Step Clock on a manual clock now gives it one pulse (its
  `step` action) and runs one period of its props (from stopped: power-on and the low time);
  first written as "pulse, then settle", which made the next press start at the instant the
  last pulse ended — the 74HC161 rightly reported "CP was LOW for only 0 ps" and went `X`.
  A `NaN` duty (a document leaving the default out: resolve props) then hung the tests:
  `runUntil(NaN)` looped forever in the kernel — fixed with a regression test (throws), and
  the host refuses a non-finite `time` goal. A host goal `settle` (until nothing is left)
  stays for that use.
- 2026-11-08 — task 9: `StoredSession.debug` (left out while it is the empty setup), written
  on every setup change like the view, restored after the document (`documents.show` →
  `setCircuit` clears it, then `debug.load`); `parseDebugSetup` keeps only well-formed
  entries, so a stored setup from another version never breaks a restore. New and Open
  start without one.
- 2026-11-08 — task 10: `tests/e2e/debugger.spec.ts` — SAP-1 Program Counter: Step Clock (F8)
  powers on, CLR pulsed with Run For (Shift+F8, 250 ms), three presses count 1, 2, 3 (the
  watch of `U1.Q0 … U1.Q3` marked changed, unmarked after a Run For), a breakpoint `= 5` from
  the dialog stops the press that makes it 5, the setup survives a reload; Break on errors
  stops at the recovery violation of a clock press at the instant CLR is released; RAM by Hand:
  a watched cell shows the byte written. `pnpm e2e`: 70 passed.
  Found by the error test: the violation happened in the press's own instant (the `step`
  action runs it at once while paused), its pause was taken there and then overwritten by the
  step's run — the host now counts taken pauses (`breaks`) and Step Clock stops at the press.
  And a breakpoint added while paused never saw an edge at that same instant: its new recorder
  channel's first level and the change merged (one instant). A fresh channel now records its
  first level 1 ps before the instant it is attached at (R13's test updated: a late probe
  starts at 14.999 ns, not 15 ns); mutation-checked.
- 2026-11-08 — task 11: editor.md (shell, shortcuts, the Debugger section: tab, breakpoints,
  steps, watches, setup, model; autosave; Editor API), simulation.md (host steps, the recorder's
  first level, R14b), ADR-0020 and its index row, architecture.md, glossary (breakpoint, debug
  setup, Step Clock, watch, run statistics), the layers' READMEs, the roadmap's R14a entry and a
  backlog item "Debugger follow-ups (R14a)", lessons.
- 2026-11-08 — finished. Acceptance criteria checked (above). R14a delivered the Debug tab:
  breakpoints on any signal (repeating triggers, hit counts) and breaks on errors/warnings that
  pause with a reason; Step Clock (right before the next edge but one by a kernel lookahead,
  `stopBefore`; a manual clock's pulse and period), Run For, Run To; watches of signals, groups
  and memory cells marked when changed; run statistics and the most active nets; the setup
  kept with the session; ADR-0020. Fixes on the way: `runUntil(NaN)` hung; triggers fired twice
  at a carry-over's instant; an edge made while paused was invisible to a new channel; the
  Trigger dialog's disabled Arm looked enabled. Follow-ups: backlog "Debugger follow-ups
  (R14a)"; R14b `feat/rewind` is next.

## Handoff

- **State:** done; waiting for the user's approval to merge into `main`.
- **Next step:** merge (`git merge --no-ff`), then R14b `feat/rewind`.
- **Watch out:** R14b should build on `Simulation.runTo`/`requestPause`/`status.reason` and the
  debugger's breakpoints (Reverse Continue = the last hit before now); the recorder and the
  watches' stops must follow a rewind; actions while paused happen at the paused instant.
- **Verify with:** `pnpm check`, `pnpm e2e tests/e2e/debugger.spec.ts`.

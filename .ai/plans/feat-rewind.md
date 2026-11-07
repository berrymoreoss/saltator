# Plan: feat/rewind

| Field      | Value                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------- |
| Branch     | `feat/rewind`                                                                               |
| Roadmap    | R14b — Snapshots & rewind ([roadmap](../../docs/roadmap.md))                                |
| Status     | in-progress                                                                                 |
| Depends on | R05 (host, carry-over), R13 (recorder, triggers), R14a (steps, breakpoints, `requestPause`) |
| Created    | 2026-11-08                                                                                  |

## Goal

Step **backwards** through a simulation, as a time-travel debugger does with a program: back to
the previous instant something happened (**Step Back**), back one clock cycle (**Step Back
Clock**), back to the previous breakpoint hit or error (**Reverse Continue**), or to any time
picked on the waveform's ruler — and the canvas, the Memory tab, the waveforms, watches and
breakpoint hits all show the circuit as it was then. It completes the debugger of phase 3 (M2
"Tools"): "what happened just before it went wrong" is the question every breadboard bug
starts with, and the waveforms only show the signals that were probed.

## Scope

**In scope**

- `core`: snapshot and restore of the whole simulator — levels, drives, contention, pending
  changes, the event queue, timers, component states, statistics, diagnostics — into the
  simulator it came from or another one built from the same netlist; large typed arrays in a
  component's state (a 62256's cells and access stamps) stored in pages shared with the
  previous snapshot. The recorder keeps its record across a rewind (a cursor at `now`, the rest
  confirmed while a run goes through it again, cut where the run diverges); a trigger re-synced
  to the instant it is rewound to.
- `editor`: the **timeline** — checkpoints (snapshots) taken while running, a log of the user's
  actions, positions, bounded by a memory budget — and the host's rewinds: reach any position
  since the last power-on or structural edit by restoring the checkpoint before it and
  re-running deterministically (in a scratch simulator); Step Back; backward searches spread
  over frames (Step Back Clock, Reverse Continue); forward runs that replay the recorded
  future until the user acts (Q1). The debugger, the analyzer and the memory inspector follow.
- `ui`: commands, toolbar buttons and shortcuts (Q4), the Debug tab's back steps, the status bar
  (how far behind the present), Run To a past time, the waveform's ruler (click or drag goes
  to a time; the recorded future drawn dimmed).
- Property tests (rewind = straight run, over every example, with seeded actions), benchmarks,
  browser tests; docs (simulation.md, editor.md, architecture.md, glossary, READMEs), ADR-0021,
  roadmap, lessons.

**Out of scope** (and where it goes instead)

- Snapshots the user takes and names (bookmarks kept beyond the history's reach) → backlog (Q3).
- Re-running the past with an edited circuit ("fix the wire, replay from power-on with the same
  inputs") → backlog; R15's test benches cover replaying inputs on a changed design (Q2).
- Saving the timeline with the file or the session: a reload starts stopped, as today.
- Rewinding inside a subcircuit → nothing extra: R11 instances are part of the same simulator.
- Breakpoints on memory accesses, log points → backlog (R14a follow-ups).

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md) — running, carry-over (what a component's
  state is), observability, recorder, triggers; "Planned extensions" (snapshot/restore).
- [docs/editor.md](../../docs/editor.md) — Simulation (run control, steps, pause requests,
  actions while paused), Waveforms (model, drawing, the ruler), Debugger (steps, breakpoints,
  watches, model), Memory inspector (access stamps).
- [ADR-0010](../../docs/adr/0010-running-simulations.md) (host),
  [ADR-0019](../../docs/adr/0019-waveforms.md) (recorder, triggers),
  [ADR-0020](../../docs/adr/0020-debugger.md) (steps, breakpoints; the R14 split).
- `.ai/plans/feat-debugger.md` — Handoff: build on `runTo`/`requestPause`/`status.reason`;
  actions while paused happen at the paused instant.
- `src/core/simulator.ts` (runtime arrays, `run`, `carryOver`), `src/core/event-queue.ts`,
  `src/core/diagnostics.ts`, `src/core/recorder.ts`, `src/core/trigger.ts`,
  `src/library/mem/memory.ts` (the largest states), `src/editor/simulation.ts`,
  `src/editor/debugger.ts`, `src/editor/analyzer.ts`, `src/editor/memory-inspector.ts`,
  `src/ui/workbench-commands.ts`, `src/ui/WaveformsPanel.tsx`, `src/editor/waveforms.ts`,
  `tests/scenarios/carry-over.test.ts` (the property test to mirror).

## Design

### Snapshots (core)

`sim.snapshot(base?)` → `SimulatorSnapshot` (opaque; `time`, `bytes`), taken between runs only;
`sim.restore(snapshot)` puts the simulator back exactly there. What a snapshot holds:

- **Time and flags**: `now`, statistics, `started` (a snapshot before the power-on instant
  processes it again), `halted` (rewinding out of an oscillation halt works: the run oscillates
  again at the same instant).
- **Nets**: `levels`, `drives`, `contended`, `floatingReported` (a floating input is reported
  once until the net changes). Per-delta scratch (`prevLevels`, the stamp arrays) is not: the
  delta id keeps counting up across a restore, so no stale stamp can equal a future delta.
- **Driver slots**: drive, pending change (seq, drive, time).
- **Event queue**: its arrays and counters as they are (seqs stay valid, the FIFO order of
  same-time events with them).
- **Component states**: a frozen copy of each state (plain data — the rule `createState`
  already states: "structured-clone-able, for state preservation and snapshots"); a typed array
  of 4 KiB or more is kept in pages, and a page equal to the same page of `base` (the previous
  snapshot) is shared, so a 62256 whose cells didn't change costs nothing. Restore copies into
  the existing state objects where the shape is the same (views onto them — the memory
  inspector's, the indicators' samples — stay valid), and replaces them otherwise. Anything
  else in a state (a `Map`, a function) throws: a part bug, as the carry-over property catches
  `evaluate` that counts.
- **Diagnostics**: the log's entries are only ever appended and counted, so a snapshot keeps the
  entry count, each entry's `count`/`lastTime` and `dropped`; restore truncates and resets in
  place (entry objects keep their identity: the Simulation tab's "cleared" marks still work).

`restore` takes a snapshot of the simulator itself or of another one built from the same
netlist (checked: same component, net and slot counts and types), so replays and backward
searches run in a **scratch simulator** whose listeners are its own — the tools attached to the
live one never see a replay. Listeners are not part of a snapshot.

### The timeline (editor)

`Timeline` (`src/editor/timeline.ts`, DOM-free) is the history of one simulator:

- **Checkpoints**: a snapshot at power-on (before the first instant), then whenever 200K events
  ran since the last one (checked between the host's kernel calls; the number is tuned by
  measurement: ≤ 3 % on the kernel benchmarks at Max, a rewind ≤ ≈ 20 ms of replay).
- **The action log**: every action the host delivers (Interact tool, Step Clock's manual pulse,
  pokes from the Memory tab) with its time and whether the kernel ran since the previous one,
  so a replay applies it at exactly the same point: actions happen after every event up to
  their instant was processed, and two actions without a run between them stay that way.
- **Positions**: a time and how many logged actions are applied — "1.5 µs as it ended" (every
  action at 1.5 µs applied) or "where the breakpoint paused at 1.5 µs" (before the actions
  taken there afterwards). **Reaching** a position: restore the last checkpoint at or before it
  into the scratch simulator, re-run applying the logged actions in between, then restore the
  result into the live simulator.
- **Present**: the furthest position the run reached. Behind it, the recording is the future.
- **Bounded**: a byte budget (default 64 MB, `snapshot.bytes` summed). Past it, every other
  checkpoint in the older half is dropped (gaps double, rewinds there replay longer), up to a
  maximum gap (≈ 1.6M events); then the oldest go and the history's **start** moves forward.
  The action log is small and kept back to the start.
- **Reset** at every power-on (Run from stopped, Reset), Stop, and every structural edit
  (carry-over: the new simulator's history starts at the edit's instant, Q2).

### Rewinding (host)

- `rewindTo(time)`: to "time as it ended", paused; a time before the history's start is
  refused with the reason. **Step Back** (`Alt+F10`, Q4): back to the previous instant with
  events — the one before the last instant with events at or before now (so Step Back then
  Step returns). Run To a past time rewinds. All of them are jumps: the reason says it
  (`Step Back`, `Rewound to 1.5 µs`).
- **Backward searches** — find the last instant before now where something held — run the
  segments between checkpoints in the scratch simulator from the newest backwards, spread over
  frames (the status says `Searching back…`; Pause cancels and stays put), then reach the
  instant found: Step Back's previous instant (usually within one segment), Step Back Clock,
  Reverse Continue. Nothing found: the history's start, saying so.
- **Forward after a rewind** (Q1): while there is a recorded future, every forward run — Run,
  Step, Step Clock, Run For, Run To, the ruler — **replays** it: logged actions are applied again
  at their positions (a run pauses at a breakpoint before the actions taken there, as the
  original did), so it comes back to the same present and the waveforms' future stays valid.
  Step Clock on a manual clock replays the next recorded pulse instead of pressing again. The
  user's own **action** (a click with the Interact tool, a poke) at a rewound position starts a
  new future from there: later checkpoints, logged actions and the recorded future are dropped.
- **Edits while rewound**: as now, the run continues in the recompiled netlist (carry-over) from
  the rewound instant — "go back, fix the wire, run again" — and the history starts there.
- The canvas, Properties and the status follow at once (lights' brightness samples restart,
  `revision`, `ticks`); `status.reason` and a `timeline` store (start, present, now) for the UI.

### Tools follow

- **Recorder** (analyzer's and debugger's): `seek(t)` puts a cursor per channel at its last
  change at or before `t`; the record past it stays (the future). While a forward run is
  behind the record's end, changes are **confirmed** (the cursor moves on) rather than
  appended; past the end it appends as before; `cut(t)` drops everything after `t` (a new
  future). `lastChange` answers at the cursor (triggers ask "did it change at this instant?").
  Queries (`level`, `nextChange`, …) see the whole record; `end` is the present.
- **Triggers**: `resync(t)` takes the pattern at `t` from the recorder (a breakpoint without an
  edge fires when the pattern becomes true again later). The analyzer's single-shot trigger
  stays triggered if it fired after the rewind point (its capture is in the record).
- **Debugger**: hits follow the timeline — each breakpoint keeps its hit times; at a rewind the
  count is those at or before now, a new future drops the later ones. Reverse Continue builds a
  **scanner** for the backward search: fresh repeating triggers for the enabled breakpoints (hit
  counts ignored going back) on a scratch recorder, plus the break-on-errors/warnings toggles
  through `onOccurrence`. **Step Back Clock** (`Alt+F8`): back to right before the step clock's
  last active edge at or before now — the inverse of Step Clock (from a Step Clock stop, the
  stop before). Watches: a rewind is a stop (changed marks compare with where it came from).
  Activity measurement restarts at a rewind (it counts forward).
- **Waveforms**: the recorded future drawn dimmed past the `now` mark; a click or drag in the
  ruler goes to that time (backward: rewind; forward within the record: replay at Max; past it:
  Run To), the region before the history's start not clickable.
- **Memory inspector**: cells and stamps come back with the states; read/write highlights
  restart at a rewind (nothing lit until the next frame).

### UI

- **Commands** (Simulate menu; shortcuts dialog): Step Back (`Alt+F10`, toolbar next to Step),
  Step Back Clock (`Alt+F8`), Reverse Continue (`Alt+F5`), Go to Present (replays to the
  present). "Alt + the forward key goes backwards": Shift+F10 opens the browser's context menu,
  Shift+F8 is Run For (Q4).
- **Debug tab** toolbar: Reverse Continue and Step Back Clock beside Step Clock.
- **Status bar**: `Paused · 1.200 µs · Step Back · 300 ns behind the present`.

### ADR-0021

"Rewind: whole-simulator snapshots, a log of the user's actions, deterministic replays in a
scratch simulator; forward runs replay the recording until the user acts; the history starts
at power-on and at every structural edit": snapshots of the kernel vs reverse execution
(impossible for inertial delays and timers) vs recording every net (the waveforms' job, too
costly); checkpoints + replay vs a snapshot per instant; replays in a scratch simulator vs
muting the live one's listeners; page-shared typed arrays vs plain clones; the replay vs a
fresh future (Q1); the history at edits (Q2).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `core`: frozen state copies (plain data; typed arrays ≥ 4 KiB in pages shared with a
  base; thaw into existing objects, replace on another shape; unsupported values throw);
  tests.
- [x] 2. `core`: `Simulator.snapshot`/`restore` (with `EventQueue` and `DiagnosticLog`), into
  the same or a same-netlist simulator; tests: a restored run repeats the trace (pending
  inertial changes, timers, before power-on, halted, floating inputs reported once, diagnostic
  counts); property test `tests/scenarios/rewind.test.ts` over every example with seeded
  actions (restore at random instants = the straight run: levels, drives, states,
  diagnostics); snapshot bytes and time measured on the examples and a 62256 circuit.
- [x] 3. `core`: Recorder `seek`/confirm/`cut` and `lastChange` at the cursor (same-instant
  merges, the budget trimming with cursors), `Trigger.resync`; tests; recorder benchmark
  unchanged.
- [x] 4. `editor`: `Timeline` — checkpoints, action log, positions, reaching a position in a
  scratch simulator, the present, divergence, budget with thinning and the maximum gap; tests
  with a real simulator (a tiny budget).
- [x] 5. `editor`: host — checkpointing between kernel calls (cost measured at Max), forward runs
  that replay logged actions, `rewindTo`, Step Back, backward searches over frames (Pause
  cancels), divergence on actions, resets on power-on/Stop/edits, `timeline` store and
  reasons; fake-clock tests.
- [x] 6. `editor`: the tools follow — analyzer (recorder seek/confirm/cut, trigger state),
  debugger (hits by time, triggers resynced, Step Back Clock, Reverse Continue scanner,
  watches' stops, activity), memory inspector (highlights); headless tests; mutation-checked.
- [x] 7. `ui`: commands, shortcuts, toolbar and Debug tab buttons, status bar, Run To a past
  time; Waveforms: the future dimmed, ruler click/drag; looked at in both themes.
- [ ] 8. e2e: Clock Module / Data Bus — Step Back and Step return to the same state, a ruler
  click rewinds and the waveform keeps its future; SAP-1 Program Counter — Step Back Clock
  counts 3, 2, 1 and Step Clock replays 2, 3; Reverse Continue stops at the previous breakpoint
  hit; a switch toggled while running happens again on replay, a click at a rewound point
  drops the future.
- [ ] 9. Docs: simulation.md (snapshots, recorder cursor, the planned marker), editor.md
  (Simulation: timeline and rewinds; Debugger: back steps; Waveforms: ruler, future),
  architecture.md, glossary (checkpoint, timeline, present, rewind, Step Back, Reverse
  Continue), READMEs, ADR-0021; roadmap (R14b done, R11 next; backlog: bookmarks, re-running
  the past with an edited circuit); lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] Reaching any position since the last power-on or structural edit gives exactly the state
  a straight run had there — levels, drives, component states, diagnostics — on every example,
  with seeded actions (property test), and a replay forward repeats the trace.
- [ ] Step Back goes to the previous instant with events and Step comes back to the same state;
  Step Back Clock undoes Step Clock with `io/clock`, a manual clock and a gated clock; Reverse
  Continue stops at the previous breakpoint hit or error (Continue returns to the same hit),
  else at the history's start.
- [ ] After a rewind, forward runs replay the recording: logged actions happen again, the
  waveforms' future stays and is confirmed, breakpoint hits count the same; an action at a
  rewound position drops the future; an edit continues from the rewound instant.
- [ ] The waveform's ruler goes to the time clicked; the canvas, Memory tab, watches and hits
  show that time.
- [ ] The history stays within its budget (thinning, then the start moves; tested with a tiny
  budget); a rewind replays at most the maximum gap.
- [ ] Kernel benchmark unchanged; the host's checkpointing at Max and the snapshot sizes (a
  62256 sharing its pages) recorded here.

## Open questions

- [x] Q1. Forward after a rewind: replay the recording, or a fresh run? — _proposed:_ replay —
  logged actions are applied again and the waveforms' future stays until the user acts (a
  click or poke at a rewound position starts a new future) — alternative: a rewind discards
  everything after it (record, actions); running forward is a fresh run without the old inputs
  — **answer:** replay the recording (2026-11-08).
- [x] Q2. Rewinding across an edit? — _proposed:_ no: every structural edit (wires, parts, props,
  a ROM byte) starts the history anew at its instant (the past ran on another circuit); "re-run
  the past with the edited circuit" goes to the backlog — **answer:** the history starts at the
  edit; re-running the past on an edited circuit → backlog (2026-11-08).
- [x] Q3. Snapshots the user takes and names (bookmarks)? — _proposed:_ backlog: any instant in
  the history is reached by time already; bookmarks matter only beyond its reach — alternative:
  in this branch (a Mark command, marks on the ruler, kept from thinning) — **answer:** backlog
  (2026-11-08).
- [x] Q4. Shortcuts? — _proposed:_ Alt + the forward key: Step Back `Alt+F10`, Step Back Clock
  `Alt+F8`, Reverse Continue `Alt+F5` — alternatives: other keys; menu and buttons only —
  **answer:** Alt + the forward key (2026-11-08).

## Progress log

- 2026-11-08 — plan drafted; `main` green (2143 tests). Q1–Q4 answered as proposed: forward
  runs replay the recording until the user acts, the history starts at every structural edit,
  bookmarks to the backlog, Alt + the forward key.
- 2026-11-08 — plan approved; branch started.
- 2026-11-08 — task 1: `core/state-copy.ts` — `freezeState(value, base?)`, `thawState(frozen,
  target)`, `stateBytes(frozen, relativeTo?)`. Every typed array in 4 KiB pages (not only large
  ones: one rule), a page equal byte for byte to the base's page at the same index shared
  whatever the base array's type or length was (two such checks were equivalent code, found by
  mutation). Thaw writes into the live objects of the same shape, replaces the rest, drops
  keys the copy didn't have; anything not plain data (a `Map`, a class, an object reached
  twice) throws with its path. Mutation-checked (10 mutations).
- 2026-11-08 — task 2: `Simulator.snapshot(base?)` (between runs only: a `busy` flag around
  `run`), `restore`, `replica()` (same netlist, own listeners; a layout token shared with its
  replicas is what `restore` checks), `snapshotBytes(s, relativeTo?)`; `EventQueue`
  `snapshot`/`restore` (live events in heap order, the seq counter — a replica's lower counter
  would break same-time FIFO and the delta boundary), `DiagnosticLog` `snapshot`/`restore`
  (entries shared, counts copied; an entry for the same report keeps its identity). Not
  restored: the per-delta stamps (the delta id keeps counting). Tests: traces repeat, pending
  changes confirmed and seen ahead, cancelled ones stay cancelled, states in place, before
  power-on, out of an oscillation halt, diagnostics and contention, replicas, refusals, page
  sharing. Property `tests/scenarios/rewind.test.ts`: every example (3 seeds, switches,
  buttons, DIP switches, manual clocks, RAM pokes, two acts at one instant) and every registered
  part on clocks and drivers — rewound through a replica to ≈ 14 targets each, the fingerprint
  (levels, drives, contention, queue head, stats, diagnostics, states) equals the straight run's,
  and a replay from a rewound instant ends where the straight run did. Mutation-checked (17 +
  7 mutations; the property alone misses `halted`, `floatingReported`, `slotPendingTime` and
  in-place thawing — the unit tests catch those). Measured (M3 Pro, after 1 ms): examples 0.7–
  4.4 KiB a snapshot, 3–31 µs, restore 1–8 µs; a 62256 + 28C256: 1154 KiB alone, 1.7 KiB against
  its base, 0.26 ms, restore 35 µs.
- 2026-11-08 — task 3: `Recorder.seek(t, present)` (the present is the caller's: after a
  restore the simulator's `now` no longer says how far the record reached), `replaying`, `cut(t)`;
  per track a cursor (`past`) and `until`, meaningful only while replaying; changes at or before
  `until` move the cursor over the record (the instant's collapsed level is already there),
  later ones — a channel added while replaying — append; past the present the replay ends;
  `lastChange` answers at the cursor; `end` is the present while replaying; a trim never
  reaches past the simulator's `now`; `detach` keeps the record to the present.
  `Trigger.resync(now)`: the pattern as at `now`, and a fire after `now` no longer blocks
  firing there again. Mutation-checked (14 + 2; three survivors were equivalent code and went:
  cursor resets outside a replay, a `max` with an earlier present). Benchmark (branch vs `main`
  in a worktree, same session): within noise — ring oscillator 12.2–12.8M vs 12.7M events/s,
  recording 1001 nets 7.7–7.9M vs 7.7–8.0M (the replay check sits outside the per-change call).
- 2026-11-08 — task 4: `editor/timeline.ts` — `Timeline(sim, { budget, interval, maxGap })`:
  checkpoints (the first where the simulator is; then in `ran()` after a kernel call once
  `interval` events passed since the newest — behind the present the newest is ahead, so none
  is taken there), the action log (`acted`: time, payload, `afterRun`; behind the present it
  drops the recorded future first), positions (`{ time, actions }`, `comparePositions`,
  `asEnded`), `present`, `hasFuture`, `pending`/`applyPending` (a forward run delivers the
  recorded actions again; consecutive ones of one frame back to back), `reach(position)` (the
  checkpoint before it restored into the replica, re-run with the log, the result restored
  into the live simulator), `segmentsBefore`/`replaySegment` for backward searches, the budget
  (thin every other one of the older half within `maxGap`, then drop the oldest; the bytes of
  the checkpoint after a dropped one recounted against the one before). Mutation-checked (17;
  survivors removed as equivalent code: a frontier guard, a guard in `dropOldest`, a `present`
  reset that `acted` repeats; picking an earlier checkpoint on a tie is only slower). Found by
  the mutations: "same final levels" hid a replay that ran between two same-frame actions —
  the tests compare the queue's head and the event count too.
- 2026-11-08 — task 5: the host keeps a `Timeline` per simulator (`#build`: power-on and every
  carry-over; dropped on Stop; `SimulationOptions.history` for tests). Every forward kernel
  call goes through `#advance(sim, limit, run)`: the recorded actions due now are delivered
  first, the call is capped at the next one's instant (`'action'`: go on, no lag reported), an
  `idle` before it jumps there (Max, where nothing happens between actions). `action` logs the
  user's action (`acted`) and, behind the present, tells the tools first (`onDiverge`), as an
  edit continuing from a rewound instant does. `rewindTo(time, reason?)` (back, or forward within
  the record), `toPresent`, Run To a past time rewinds, `stepBack` (`previousInstantSearch`: the
  instants with events, distinct times, stale-only ones skipped), `searchBack(BackSearch)` — the
  history's segments replayed in the replica newest first, the first at once and the rest over
  frames (`status.goal` "Step Back…"; Pause cancels and stays put), the found position reached,
  else the history's start. `#reach`: the lights resampled, diagnostics refreshed, `onRewind`
  listeners told (`{ time, present }`) before the status says paused. `history` store (start,
  present, behind). Found by mutation: Step Clock behind the present with a recorded action
  before the next edge — the action is delivered, then the edge passed. Mutation-checked (22;
  two equivalent: a separate "already at the start" case, a remembered first-instant time).
  Benchmark (host chunks of 20K events, a checkpoint every 200K): ring oscillator 12.45–12.76M
  vs 12.57–12.89M events/s without; 16 × 6116 swept 7.42–7.52M vs 7.56–7.61M.
- 2026-11-08 — task 6: the tools follow `onRewind`/`onDiverge`. Analyzer: `recorder.seek`, an
  armed trigger `resync`ed, `cut` on divergence, `now` beside `end` (the present) for the
  drawing. Debugger: its recorder seeks and cuts the same way, triggers resync, hits are hit
  times (a rewind forgets those after it; the replay counts them again), activity restarts,
  "last run" counters restart; `stepBackClock()` (`edgeSearch`: the newest edge at or before
  the start, then the last instant with events before it, across segments), `reverseContinue()`
  (a scanner per segment in the replica: the enabled breakpoints' conditions as fresh repeating
  triggers on a recorder numbered like the debugger's, the break-on toggles through
  `onOccurrence`; hit counts aside; the reason names the breakpoint — `BackSearch.reason`).
  Step Clock on a manual clock behind the present replays the next recorded press of that
  clock (to its time + one period). Memory inspector: a rewind clears the access clock with
  the rewound instant as "forgotten", so restored stamps light nothing. Found on the way: a
  time goal ending exactly at a recorded action delivered it (the original run had stopped
  before it) — it is done first now; `Recorder.replaying` is false once the run is at the
  present. Mutation-checked (21; one equivalent removed: a separate `found` in the hit search).
- 2026-11-08 — task 7: commands `sim.stepBack` (Alt+F10, toolbar between Run and Step),
  `debug.stepBackClock` (Alt+F8), `debug.reverseContinue` (Alt+F5), `sim.toPresent` (Go to
  Present, enabled while behind), all in Simulate between the forward steps and Stop; the
  Debug tab's Reverse Continue and Step Back Clock beside Step Clock; Run To a past time goes
  back (`runToTime` refuses only now itself and times before the history); the status bar
  says `· 11 µs behind the present` while paused behind it (`simulationSummary(status,
  history)`); a search's `status.goal` is its label (the summary adds the `…`). Waveforms: the
  recorded future veiled past the `now` mark (`WaveformScene.now`, theme `future`); a click
  or drag in the ruler goes to that time (`Analyzer.goTo`: back or forward within the record,
  Run To past its end, the history's start at most; one go per animation frame while
  dragging), the pointer `ew-resize` over the ruler. Looked at in the browser (Data Bus, dark
  and light): the veil, the now mark, the status, the Debug tab's buttons.

## Handoff

- **State:** plan approved, branch started; no code yet.
- **Next step:** task 1 (frozen state copies in `core`).
- **Watch out:** the kernel's per-delta stamps must not be restored (the delta id keeps
  counting); actions must replay at the same point relative to the kernel's runs; the
  recorder's same-instant merging while confirming; R14a lessons on carry-over instants.
- **Verify with:** `pnpm check`; `pnpm test tests/scenarios/rewind.test.ts`.

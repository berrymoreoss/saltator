# Plan: feat/logic-analyzer

| Field      | Value                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------- |
| Branch     | `feat/logic-analyzer`                                                                    |
| Roadmap    | R13 — Waveforms & probes ([roadmap](../../docs/roadmap.md))                              |
| Status     | in-progress                                                                              |
| Depends on | R05 (simulator host, carry-over), R10b (buses), R12b (resolver, bottom-dock tab pattern) |
| Created    | 2026-11-07                                                                               |

## Goal

See signals over time, as a designer at the bench does with a logic analyzer: **probe** nets,
pins and buses of the circuit, **record** their levels while the simulation runs, and look at
them in a **Waveforms** tab — a timing diagram with zoom and pan, two cursors measuring Δt (and
the frequency it makes), buses shown as values (hex, decimal, binary, ASCII; `X` nibbles), groups
of signals read as one value, a **trigger** that catches the moment a condition holds and stops
there, and **VCD export** for GTKWave and friends. It is the second design tool of phase 3
(M2 "Tools": "a bus captured in the waveform view with a trigger and exported"), and its pieces
are built for what follows: the kernel's break request and the trigger conditions become R14's
breakpoints, the recorder and the VCD writer run headless for R15's test benches.

## Scope

**In scope**

- `core`: a **recorder** (`Recorder`: channels of net levels over simulated time, bounded, fed by
  `onNetChange`, queries by time with binary search, a summary for zoomed-out drawing); a
  **break request** in the kernel (`requestBreak()`, honored after the current instant: run
  status `break`), so a trigger stops at its instant; **trigger conditions** (terms on channels
  ANDed: edges, levels, bus values) evaluated on recorded changes; a **VCD writer** (1 ps
  timescale, 1-bit and vector variables, a time range).
- `circuit`: the probe list in the circuit document (`Circuit.probes`, schema v3 with an
  identity migration, Q1), undoable, with part renames followed; the resolver's references
  (`CLK`, `U5.A0`, `D[0..7]`) are what a probe names.
- `editor`: an `Analyzer` model (`editor.analyzer`, pure, headless-tested with the fake clock):
  channels from the probes through the resolver, the recorder's lifecycle across power-on,
  carry-over, Reset and Stop; the view (time window, follow now, zoom, pan), cursors and
  snapping to edges, the trigger (arm, fire, run on for the post-trigger time, stop); a Canvas2D
  waveform renderer (level colors of the theme, `X` and `Z` drawn as on the wires, bus segments
  with their values, dense stretches as blocks, a time ruler, cursors, the trigger mark, where
  the capture begins).
- `ui`: the **Waveforms** tab (fifth bottom-dock tab): channel list (name, value at the cursor,
  radix, remove, reorder, group into a bus, expand a bus into bits), the waveform canvas, a
  toolbar (Add signal by reference, Trigger, zoom, Export VCD…), cursor readout (A, B, Δt,
  1/Δt); canvas commands to probe what is under the pointer or selected (context menu "Add to
  Waveforms", the Probe tool `P` — Q4); settings (the tab, row height).
- Browser tests on the examples (Clock Module: the clock's period measured with the cursors;
  Data Bus: the bus captured with a trigger on its value, exported as VCD and the file checked);
  examples saved with probes where they help (Q1).
- Docs: editor.md (Waveforms), simulation.md (break, recorder, triggers), circuit.md (probes,
  schema), components.md if probes touch `io/probe`, architecture.md, glossary, READMEs,
  ADR-0019, roadmap, lessons.

**Out of scope** (and where it goes instead)

- Breakpoints, stepping by clock edge, watches, snapshots and rewind → R14 (it reuses the break
  request and the trigger conditions).
- Signals inside subcircuits (`U5/D0`) → R11 (the resolver gets instance paths there).
- Waveforms as stimulus or expected values of a test bench → R15 (it reuses the recorder and the
  VCD writer headless).
- Serial protocol decoders (UART, SPI, I²C) → backlog (with R18's ACIA at the earliest);
  automatic measurements (period, duty cycle, pulse count over a range) → backlog; VCD import
  (looking at a dump from another simulator) → backlog; printing/SVG of the diagram → backlog
  with the schematic export.
- Drive strength in the diagram (a weakly pulled level drawn paler, as on the wires): the
  listener reports levels only → backlog, if missed.

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md) — observability (`onNetChange`, `levels`),
  running (`runUntil`, run status), carry-over (nets have no identity across compiles).
- [docs/editor.md](../../docs/editor.md) — Simulation (run control, pacing, stores, editing
  while running, live drawing colors), Memory inspector (the tab pattern, `MemoryInspector`
  model on the host's `revision`/`status`), Commands, Settings.
- [docs/circuit.md#resolver](../../docs/circuit.md#resolver) — references and their reasons.
- [ADR-0010](../../docs/adr/0010-running-simulations.md) (host, carry-over),
  [ADR-0016](../../docs/adr/0016-buses.md) (bus members by name),
  [ADR-0018](../../docs/adr/0018-memory-inspector.md) (resolver, a model per tool on the host),
  [ADR-0012](../../docs/adr/0012-files-and-sessions.md) (what is in the file vs the session).
- `src/core/simulator.ts` (listeners, `run`), `src/core/testing/trace.ts` (the test recorder),
  `src/editor/simulation.ts`, `src/editor/memory-inspector.ts`, `src/circuit/resolve.ts`,
  `src/circuit/document.ts`, `schema.ts`, `migrations.ts`, `src/ui/Workbench.tsx`,
  `MemoryPanel.tsx`, `workbench-commands.ts`, `ContextMenu.tsx`, `src/editor/theme.ts`.

## Design

### Probes

A **probe** names what a channel shows by a resolver reference, so it survives recompiles and
carry-overs (nets have no identity across compiles) and gets R11's instance paths for free:

- a **net**: by its name (`CLK`), or — for an unnamed net — by a pin on it (`U1.Y`, preferring a
  driving pin), since unnamed net ids change with the wiring;
- a **pin**: `U5.A0` (its net);
- a **bus**: `D[0..7]` (its members, bit 0 first, as the resolver lists them);
- a **group**: an ordered list of the above 1-bit references read as one value (`U3.Q0`…
  `U3.Q3` as the program counter's value), with a name.

Each probe has an optional display name and a radix (`hex` default for buses and groups, `dec`,
`bin`, `ascii`). Renaming a part rewrites the references that name it (`U5.A0` → `U7.A0`, through
the edit's renames, as the simulator host gets them). A reference that stops resolving (its net
label renamed, its part deleted) stays in the list, greyed, with the resolver's reason.

The probe list lives **in the circuit document** (Q1): `Circuit.probes`, an ordered list of
`{ ref, name?, radix?, members? }` (`members`: a group's 1-bit references, `ref` then its name),
document schema v3 with an identity migration (v2 files load unchanged; the parser stays strict
about unknown keys). So a file and the examples open with their signals ready, adding,
removing, reordering, renaming or regrouping probes are undoable edits (`Add CLK to
Waveforms`) that mark the document unsaved, and R15's benches can name the same signals. The
probes are no part of the netlist: a probe edit has the same netlist structure, so a running
simulator goes on untouched (only the analyzer's channels change). Copy and paste leave probes
out (they belong to the circuit, not to a selection).

### Recorder (core)

`src/core/recorder.ts`, pure, no editor knowledge (R15 records headless with it):

- `new Recorder({ budget })` with channels added by key; `attach(sim, nets)` (key → net index)
  subscribes to `onNetChange` and records each channel's current level at that instant (if it
  differs from the last one recorded); `detach()`. The host attaches every new simulator
  (power-on, carry-over) with net indices re-resolved from the references.
- Per channel: changes as `(time, level)` in chunked typed arrays (`Float64Array` times,
  `Uint8Array` levels), appended in time order. Changes at one instant (delta cycles) collapse
  into the instant's last level — the kernel's zero-delay deltas are not pulses a real circuit
  makes; a change back to the previous level within one instant leaves nothing.
- **Bounded**: a total budget of changes across channels (default 4M ≈ 36 MB); when it is used
  up the oldest chunks are dropped, and `start` (the earliest time every channel still knows)
  moves forward — the view hatches what lies before it, as a real analyzer's memory depth ends.
- Queries: `levelAt(ch, t)`, `changes(ch, t0, t1)` (index range by binary search),
  `nextChange`/`prevChange(ch, t)` (cursor snapping, edge navigation), `busValueAt(members, t)`;
  `summary(ch, t0, t1, buckets)` for drawing: per pixel bucket the level at its start and
  whether it changed inside (a fast clock zoomed out is a block, not a million lines).
- Cost: nothing when no channel is recorded (no listener); with probes, one listener call per
  changed net that filters by an `Int32Array` net → channel map (benchmark: the kernel
  benchmark with 16 probed nets, recorded in the plan).

Only the **probed signals** are recorded (Q2), from power-on; a signal probed while running
starts at that instant. To see the past of a newly probed signal, Reset and run again — the
simulation is deterministic (user actions at other instants aside).

### Break request (core)

`sim.requestBreak()` — called from a net-change listener (or between runs) — makes the current
`runUntil`/`settle` return after the instant being processed has finished its delta cycles,
with the new run status `break` (`now` = that instant; the next run goes on normally). The host
pauses on it. R13's trigger uses it to stop exactly at its instant; R14's breakpoints and step
by clock edge reuse it. The hot loop checks one boolean per timestamp.

### Trigger (core + editor)

`src/core/trigger.ts`: a **condition** is an AND of terms on channels — `rise`, `fall`, `edge`
(either), `is 0`, `is 1`, `is X`, `is Z` on a 1-bit channel; `== value`, `!= value` (hex, with
`X` digits as don't-care) on a bus or group. At most one edge term (an analyzer's "pattern + one
edge"); without one, the condition fires when the pattern **becomes** true. It is evaluated by
the recorder on each recorded change of a channel it names, at the end of the instant (after
the delta cycles), so a zero-delay glitch never fires it.

The analyzer's trigger (editor): **Arm** (Single shot) → at the first instant after arming
where the condition fires, mark it (`T`, the time origin of the readout), let the simulation run
on for the **post-trigger time** (default: what the visible window has to the right of the
trigger position, 10 % from the left by default), then **pause** and show the window with the
trigger at its position ("Triggered at 1.234 567 µs") — the simulation **pauses** (Q3), so the
canvas, Properties and the Memory tab show the circuit right after the trigger and F10 steps on
from there; Run continues (the trigger is then disarmed until armed again). Disarm cancels. The
trigger is view state, not saved.

### Analyzer model (editor)

`src/editor/analyzer.ts` (`editor.analyzer`), DOM-free like `MemoryInspector`:

- **Channels** from the probes, resolved against the scene's compile result; their recorder
  keys and live status (resolved, reason).
- **Lifecycle**: Run from stopped and Reset clear the capture and start recording at t = 0; a
  structural edit (carry-over) re-resolves and re-attaches, the capture goes on; Stop keeps the
  last capture to look at until the next power-on; a probe added while simulating starts at
  that instant, one removed drops its channel.
- **View**: the visible window (`start`, ps per pixel); **follow** (while running the window's
  right edge tracks `now`; panning back turns it off, End or Follow turns it on); zoom in/out
  about the pointer or a cursor, zoom to fit (the whole capture), zoom to the cursors.
- **Cursors** A and B: placed by click (A) and Shift-click (B) or dragged; they snap to the
  nearest change of the channel under the pointer within a few pixels; readout A, B, Δt = B − A
  and 1/Δt (`2.5 µs · 400 kHz`); each channel's value at A (or at `now` when A isn't set);
  next/previous edge of the selected channel moves A (as GTKWave's edge search).
- Redraws on the host's `revision` (as the canvas), at most once per animation frame.

### Waveform view (editor + ui)

- Renderer (`src/editor/waveforms.ts`, Canvas2D, HiDPI, on a `SymbolGraphics`-like surface for
  recording tests): per row a 1-bit trace (high and low lines in the level colors of the canvas
  theme: `1` bright green, `0` dark green, `Z` a blue mid-line, `X` a red band — as the wires
  are drawn), a bus or group as hexagon segments with their values (text where it fits,
  `X` nibbles in the `X` color, all-`Z` blue), dense stretches as filled blocks; a time ruler
  (`formatTime` ticks), the cursors, `T`, `now`, and the hatch before the capture's start.
- The **Waveforms** tab (`WaveformsPanel.tsx`): a toolbar (Add signal: a reference box with
  completion from the circuit's net names, parts and buses; Trigger…; zoom buttons; Follow;
  Export VCD…), the channel list on the left (name with the reference, value at the cursor,
  radix menu, remove, drag to reorder, Group selected, a bus expands into its bits), the
  canvas on the right, the cursor readout in the toolbar. Empty state: "Probe signals to see
  them here: right-click a wire, pin or bus and choose Add to Waveforms."
- Keys inside the tab are handled there and kept from the shortcuts (lesson R12b): `+`/`-`
  zoom, arrows pan, `[`/`]` previous/next edge, Delete removes the selected channel.
- Canvas side: "Add to Waveforms" in the context menu over a wire (its net), a net label (its
  net), a bus line or bus label (its bus), a pin (its net) and a part (its signal pins, as one
  entry per pin); "Remove from Waveforms" when it is probed. Probed wires keep their look
  (marking them on the canvas → backlog if missed).
- The **Probe tool** (`P`, Q4; a probe-tip pointer), stopped or simulating: hovering highlights
  what a click would probe (the wire's net with its wires, a pin, a bus); a click adds it — or
  removes it when it is already probed — and opens the Waveforms tab, without touching the
  selection; a drag pans, Escape goes back to Select (or to Interact while simulating). Its hit
  rules are the context menu's, on plain `PointerInput`s (headless tests, lesson R04b).

### VCD export (core + ui)

`src/core/vcd.ts`: `writeVcd(recorder, channels, { from, to, date, version })` →
text: `$timescale 1ps $end`, one `$scope module <circuit> $end`, `$var wire 1 ! CLK $end`, buses
and groups as vectors (`$var wire 8 " D[7:0] $end`, `b0011xxzz "`), `$dumpvars` with the levels
at `from`, then `#time` blocks; identifiers from printable ASCII; names made VCD-safe (`~{RD}`
→ `RD_n`, spaces → `_`). `date` and `version` come from the caller (core never reads the
clock). Export VCD… saves the whole capture or the range between the cursors
(`<circuit>.vcd`), through the binary file access of R12b (`saveBytes`).

### ADR-0019

"Waveforms: probes by reference in the document, a bounded recorder of probed nets, triggers
that break the run": probes by reference in the document (vs the session only, vs probe parts on
the schematic — Q1; vs net ids, which don't survive a recompile); recording probed signals only
vs every net in a bounded buffer (Q2); a kernel break request shared with R14 vs stopping
between frames; a trigger that pauses the simulation vs a capture that freezes while the circuit
runs, vs a setting for both (Q3); the Probe tool next to the context menu (Q4); VCD as the
export format (vs CSV, vs a JSON capture).

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. `core`: `requestBreak()` and run status `break` (from a listener, from a component;
  honored after the instant's delta cycles; the next run goes on; `settle` too); tests;
  benchmark unchanged.
- [ ] 2. `core`: `Recorder` — channels, attach/detach across simulators, instant collapsing,
  chunked storage with the budget and `start`, queries (`levelAt`, `changes`, next/prev,
  `busValueAt`, `summary`); tests (incl. a carry-over scenario re-attaching by reference);
  mutation-checked; kernel benchmark with 16 probed nets.
- [ ] 3. `core`: trigger conditions (terms, AND, one edge, "becomes true", end-of-instant
  evaluation, bus values with don't-care digits) on the recorder; tests.
- [ ] 4. `core`: VCD writer (header, vectors, `$dumpvars`, ranges, safe names and identifiers);
  tests against hand-checked dumps; a scenario dumping a counter.
- [ ] 5. `circuit`: `Circuit.probes` — schema v3 with the identity migration, parse (strict) and
  serialize (canonical, one probe a line), rename rewriting, edits that keep the netlist
  structure; the resolver resolving a probe (net, pin, bus, group with reasons); tests.
- [ ] 6. `editor`: `Analyzer` — channels, lifecycle (power-on, carry-over, Reset, Stop, probes
  added/removed while running), view (follow, zoom, pan, fit), cursors with snapping, edge
  navigation, the trigger (arm, fire, post-trigger run, pause); headless tests with the fake
  clock.
- [ ] 7. `editor`: waveform renderer — 1-bit rows, buses/groups with values, dense blocks, ruler,
  cursors, trigger and capture start; recording-graphics tests; both themes.
- [ ] 8. `ui`: the Waveforms tab — toolbar, channel list (radix, remove, reorder, group, expand),
  canvas with mouse and keys, cursor readout, Add signal with completion, Trigger dialog,
  settings; canvas context menu entries; unit tests for the pure pieces; looked at in both
  themes.
- [ ] 8b. `editor` + `ui`: the Probe tool (`P`): hover highlight, click to add or remove, pan,
  Escape; headless gesture tests; command, toolbar button, shortcuts dialog.
- [ ] 9. `ui`: Export VCD… (whole capture or between the cursors); test of the file model.
- [ ] 10. e2e: Clock Module — the clock probed with the Probe tool, run, the period measured with
  the cursors; Data Bus — `D[0..7]` captured with a trigger on its value, the run paused at it,
  exported VCD read back; probes saved, reopened and undone; a structural edit while recording
  keeps the capture.
- [ ] 11. Docs: editor.md, simulation.md, circuit.md, architecture.md, glossary, READMEs,
  ADR-0019; examples with probes where they help (Q1); roadmap (R13 done, R14 next; backlog:
  protocol decoders, measurements, VCD import, drive strength, probed-wire marks); lessons.

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [ ] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [ ] Nets, pins, buses and groups can be probed from the canvas and by typed reference; the
  Waveforms tab shows them over simulated time while running, following `now`, and after Stop.
- [ ] Zoom and pan reach from single gate delays (ps–ns) to the whole capture; a 1 MHz clock
  zoomed out over 10 ms draws as a block without slowing the frame (redraw time recorded).
- [ ] Two cursors measure Δt and 1/Δt, snapping to edges: the Clock Module's period read off the
  cursors matches its 555's frequency (e2e).
- [ ] A bus shows its value per segment in hex, decimal, binary and ASCII, `X` nibbles where
  bits are unknown; a group of single nets reads as one value.
- [ ] A trigger on a bus value stops the simulation at its instant plus the post-trigger time,
  with the trigger marked (unit with exact times; e2e on Data Bus).
- [ ] VCD export of the capture or of the cursor range opens in a VCD reader: the file matches
  a hand-checked dump (unit) and the exported Data Bus capture parses back (e2e).
- [ ] Recording survives structural edits while running (carry-over) and part renames; Reset
  clears it.
- [ ] Probes are saved in the file (schema v3; v2 files still open), and adding or removing one
  is one undo step that doesn't restart a running simulation.
- [ ] The Probe tool adds and removes nets, pins and buses with one click, while stopped and
  while running.
- [ ] Kernel benchmark: no change without probes; the cost with 16 probed nets recorded here.

## Open questions

- [x] Q1. Where does the probe list live? — _proposed:_ in the circuit document (schema v3,
  undoable, saved, examples open with signals ready) — **answer:** in the document (2026-11-07).
- [x] Q2. What is recorded? — _proposed:_ the probed signals only, from power-on (a signal
  probed while running starts then) — **answer:** the probed signals only (2026-11-07).
- [x] Q3. What happens at a trigger? — _proposed:_ the simulation runs on for the post-trigger
  time, then pauses with the trigger in view — **answer:** pause the simulation (2026-11-07).
- [x] Q4. A Probe tool (`P`: click wires, pins, buses to add or remove them) besides the context
  menu and the reference box? — _proposed:_ yes — **answer:** yes, the Probe tool `P`
  (2026-11-07).

## Progress log

- 2026-11-07 — plan drafted; `main` green (1998 tests). Q1–Q4 answered as proposed: probes in
  the document (schema v3), only probed signals recorded, a trigger pauses the simulation after
  the post-trigger time, a Probe tool `P`.
- 2026-11-07 — plan approved; branch started.
- 2026-11-07 — task 1: `Simulator.requestBreak()` and run status `break` (honored after the
  instant's delta cycles, from a listener or between runs; `settle` too); the host pauses on it
  at any speed. Mutation-checked. Kernel benchmark unchanged (inverter chain 14.07M events/s vs
  13.55M on `main`, ring oscillator 13.38M vs 13.76M: noise). Component callbacks don't get a
  break of their own (nothing needs one yet).

## Handoff

- **State:** task 1 done (kernel break request).
- **Next step:** task 2 (`Recorder` in core).
- **Watch out:** nets have no identity across compiles — channels are references, re-resolved
  on every carry-over; the kernel's listener reports levels only.
- **Verify with:** `pnpm check`.

# Plan: feat/sim-ui

| Field      | Value                                                                      |
| ---------- | -------------------------------------------------------------------------- |
| Branch     | `feat/sim-ui`                                                              |
| Roadmap    | R05 — Running simulations in the editor ([roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                                                |
| Depends on | R01, R03, R04a, R04b                                                       |
| Created    | 2026-11-07                                                                 |

## Goal

Make the drawn circuit run. A simulator host paces the kernel against the wall clock (speed
control, run/pause/step/stop/reset), the canvas shows every wire's level, switches, buttons, DIP
switches and a manual clock are operated on the canvas, LEDs and displays light up with their
real average brightness, runtime diagnostics (contention, floating inputs, oscillation) are
listed and located, and editing while running recompiles the circuit while carrying the state
of every unchanged part across — renames included. After this branch the M1 circuits run in the
browser; R06 brings the 74HC00, R07 saves them.

## Scope

**In scope**

- `core`: carrying a running simulation into a recompiled netlist (state, output drives,
  pending changes and timers, time) keyed by component id with renames (Q1); contention exposed
  per net; the "evaluate is idempotent" contract written down.
- `circuit`: the inverse placement transform (a click on the canvas → the part's local cell).
- `editor`: the simulator host (`Simulation`: run states, pacing with a frame budget, speed,
  step, recompile on edit, accumulated diagnostics, light samples); level colors in both canvas
  themes; wires and junctions colored by level; live part drawing (lights with brightness from
  on-time, switch/button/DIP positions, clock phase, hex digit, probe level); interaction with
  parts on the canvas (Q2); redraw only when something changed.
- `ui`: Simulate menu, toolbar group (run/pause, step, stop, reset, speed), shortcuts, status bar
  (state, simulated time, speed, actual speed when lagging), runtime diagnostics with
  click-to-locate (Q4), live levels in Properties.
- Tests: kernel carry-over (unit + an invariance property), host pacing headless, interaction
  gestures headless, live drawing scenario, browser tests running Hello LED; docs, ADR-0010.

**Out of scope** (and where it goes instead)

- The 74HC00 for the full M1 circuit → R06. Save/load, keeping the speed in the file → R07.
- Waveforms and probes on nets → R13. Step by clock edge / by time, breakpoints, watches,
  snapshot & rewind → R14 (R05 steps to the next event).
- Simulation in a Web Worker, fast mode → backlog. Contact bounce, keyboard keys bound to
  buttons → backlog.
- Setup/hold checks → R09.

## Context

Read before starting:

- [docs/simulation.md](../../docs/simulation.md) — kernel API (`runUntil`, `settle`, `action`,
  `levels`, `drives`, `stateOf`, diagnostics), power-on, inertial delays, "host outside core".
- [docs/components.md](../../docs/components.md#io-parts-io) — IO actions and states (the
  renderer's contract), `LightsState` and `onTimeAt`.
- [docs/editor.md](../../docs/editor.md) — scene, renderer, tools and gestures, `PointerInput`,
  stores, commands, Messages; R05 placeholders in Symbol drawing and Settings and themes.
- [ADR-0006](../../docs/adr/0006-circuit-document-and-connectivity.md) (ids are designators —
  carry state across renames), [ADR-0007](../../docs/adr/0007-io-electrical-model.md) (contacts,
  LEDs, on-time), [ADR-0009](../../docs/adr/0009-editing-model.md) (edits, renames recorded).
- `src/core/simulator.ts`, `event-queue.ts`, `diagnostics.ts`; `src/library/io/*`;
  `src/editor/editor.ts`, `renderer.ts`, `scene.ts`, `theme.ts`, `symbols/io.ts`,
  `history.ts`; `src/ui/Workbench.tsx`, `workbench-commands.ts`, `MessagesPanel.tsx`,
  `StatusBar.tsx`, `PropertiesPanel.tsx`; `src/app/App.tsx`, `examples.ts`.
- `.ai/lessons.md`.

## Design

### Run states and controls (Q3)

`SimState = 'stopped' | 'running' | 'paused' | 'halted'`.

- **Stopped**: no simulator; the canvas looks as in R04 (no levels). This is where a session
  starts.
- **Run** (stopped → running): power-on — a fresh `Simulator` at t = 0 from the scene's compiled
  netlist — and time starts moving. From paused it continues.
- **Pause**: time stops; parts still take actions (a switch flipped while paused takes effect at
  the current instant: the host runs the zero-delay consequences with `runUntil(now)`, gate
  delays wait for time to move).
- **Step** (paused or stopped): runs to the next timestamp that has events, with all its delta
  cycles — one "moment" of change, so propagation can be followed gate delay by gate delay.
  Nothing pending → nothing happens (status hint says so). Disabled while running. Step by
  clock edge or time comes in R14.
- **Stop**: discards the simulator; back to the plain drawing.
- **Reset**: power-on again at t = 0 (a new simulator, diagnostics and light samples cleared),
  keeping running or paused.
- **Halted**: the kernel stopped on an oscillation; Reset (or Stop) gets out, an edit
  recompiles and continues.
- Design errors don't block running: parts the compiler left out (unknown type, invalid props)
  are simply missing, as on a breadboard with an empty socket; Messages shows why.

Commands (Simulate menu, toolbar, shortcuts — debugger conventions, the browser's F5 reload is
prevented):

| Command              | Shortcut       | Toolbar            |
| -------------------- | -------------- | ------------------ |
| Run / Pause (toggle) | `F5`           | play / pause       |
| Step                 | `F10`          | step               |
| Stop                 | `Shift+F5`     | stop               |
| Reset                | `Mod+Shift+F5` | reset (rotate-ccw) |
| Interact tool        | `I`            | pointer (tools)    |
| Speed ▸ presets      | —              | speed select       |

The simulation commands are `global` (they work while a text field has focus), so F5 never
reloads the page and loses the unsaved circuit.

### Pacing and speed

The host maps wall-clock time to simulated time once per animation frame:

- **Speed** = simulated time per wall second, from presets: 1 ns/s, 10 ns/s, 100 ns/s, 1 µs/s,
  10 µs/s, 100 µs/s, 1 ms/s, 10 ms/s, 100 ms/s, **1 s/s (real time, default)**, and **Max** (as
  much as fits in the frame budget). Session state (R07 may store it in the file).
- Per frame: `target = now + min(wallΔ, 100 ms) × speed` (a background tab doesn't cause a
  jump); the kernel runs `runUntil(target, { maxEvents: chunk })` in chunks until the target is
  reached or the **frame budget** (~8 ms of wall time) is spent. Behind schedule, the backlog is
  dropped (no catching up later), and the status bar shows the **actual speed** (simulated time
  advanced per wall second, smoothed) in the warning color: "1 s/s · actual 0.31 s/s".
- The wall clock and the frame scheduler are injected (`now()`, `requestFrame`), so pacing is
  tested headless with a fake clock; the kernel stays wall-clock free.
- Redraw only when something changed: events were processed, a light's brightness changed, or a
  contention flash is due. An idle running circuit costs one cheap rAF callback per frame.

### Editing while running: carry-over (Q1)

Every committed edit (and undo/redo) already recompiles the circuit for the scene (design checks
need it). What the host does with the new netlist depends on whether the edit changed the
circuit's **structure**:

- **Same structure → keep the simulator** (the user's point at Q1). Moving, rotating or flipping
  parts with their wires, relabelling, rerouting a wire: if the netlist has the same components
  (id, type, resolved props) and the same partition of pins into nets, the simulator goes on
  untouched; only the scene's wire → net index map is rebuilt. Net ids are not compared (a
  wire-only net may get another wire's id after normalization): each new net is mapped to the
  simulator's net through any of its pins, and pinless nets (wires touching no pin) simply read
  `Z`. Cheap: no kernel work at all.
- **Structure changed → rebuild with carry-over**: a new part, a removed one, a new or deleted
  connection, a rename, a prop change.

When the structure changed, the host builds the new simulator from the old one's carry-over
(`sim.carryOver()` →
`new Simulator(netlist, registry, { carry, renames, diagnostics })`) and the simulation goes on
at the same time `now`. Per component, by id (old ids mapped through the edit's `renames`):

| Component in the new netlist                | What it gets                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **kept** — same id, type and resolved props | its state object, output drives, pending output changes (same time, same order) and timers; `init` is not run               |
| **changed** — same id and type, other props | power-on state and `init` (now = the carried time), but its outputs start from their old drives (by pin name), not from `X` |
| **new** — id not in the old simulator       | power-on, as at t = 0                                                                                                       |
| _gone_                                      | dropped                                                                                                                     |

Then, as at power-on, every component with `evaluate` is evaluated once at the carried time:
parts whose inputs changed (a new wire, a removed driver) react; everything else recomputes what
it already drives, which schedules nothing (inertial rule). Hence the invariant, tested as a
property: **recompiling an unchanged netlist at any instant doesn't change the event trace**. A
latch built from two NANDs keeps its value when you move an LED; a clock keeps its phase; a
renamed switch keeps its position. Changing a part's props "replaces the chip" without an `X`
glitch on its outputs. Nets have no identity across compiles; their levels follow from the
carried drives.

Contract this relies on (written into components.md): `evaluate` with nothing changed must be
idempotent — it may only re-drive what the inputs imply (already true for every part; edge
logic uses `rose`/`fell`). Kernel diagnostics continue in the same `DiagnosticLog` (repeats are
merged). The old simulator is consumed (its state objects move to the new one).

During a gesture (drag, wire, paste) the simulation keeps running on the committed circuit; the
preview colors existing wires by their committed net and draws new wires as ghosts.

### Interaction with parts (Q2)

A new **Interact tool** (`I`, a pointing-hand icon) operates parts; **Run switches to it**
(from stopped) and **Stop returns to Select**. Pressing `V` while running edits as usual (and
`I` comes back). In the Interact tool:

| Part                    | Press                              | Release / leave | Action sent                 |
| ----------------------- | ---------------------------------- | --------------- | --------------------------- |
| `io/switch`             | toggles                            | —               | `{ type: 'toggle' }`        |
| `io/button`             | presses                            | releases        | `press`, `release`          |
| `io/dip-switch`         | toggles the switch under the press | —               | `{ type: 'toggle', index }` |
| `io/clock`, manual mode | one pulse                          | —               | `{ type: 'step' }`          |

- The pointer's world point goes through the inverse placement into local cells, so the DIP
  switch row is found whatever the rotation or flip. The click→action mapping is a table keyed
  by `symbol.kind` next to the drawers (`src/editor/symbols/interact.ts`), so new interactive
  parts (keypads, R18) add a row there.
- A press elsewhere selects (Properties shows the part and its live levels) and a drag pans; the
  pointer becomes a hand over interactive parts.
- A button held when the pointer is cancelled, the window blurs or the tool changes is released.
- While stopped the Interact tool does nothing but select and pan (hint: "Run to operate
  parts").
- Actions go to the kernel at its `now`; while paused the host applies their zero-delay effects
  right away (see run states).

### Live drawing

- **Wire levels** (`CanvasTheme` gains level colors for both themes): 1 bright green, 0 dark
  green, Z blue, X red; a weakly driven level (pull resistor only) in a paler tint of its color;
  contention (two strong drivers disagree, `sim.contended`) flashes red ~2× per second. Junction
  dots take their wire's color. Pin stubs keep the part color. Wires are batched into one path
  per color, as today.
- Wire → net index is resolved once per (scene, simulator) pair; each frame reads `sim.levels`,
  `sim.drives` and `sim.contended` without allocating.
- **Parts** get `DrawContext.live` (absent when stopped — the idle look stays):
  - LED, LED bar, 7-segment: per light the **brightness over the last frame** =
    `(onTimeAt(t1) − onTimeAt(t0)) / (t1 − t0)` from the host's per-light samples (while paused:
    the light's current state). Lit lights fill with the LED color and a glow, alpha from
    brightness; an unknown light (`X` could mean forward bias) is drawn in the X color.
  - Switch, button, DIP switch: lever, plunger and sliders from their state.
  - Clock: the waveform drawn in the level color of its output (high/low).
  - Hex display: the digit from `hexDigit` of its pin levels (unknown → `X`); probe: `0`, `1`,
    `X` or `Z` in the level color.
- Brightness samples live in the host keyed by component id; they survive a recompile (the
  carried states keep their on-time) and are cleared on Reset.

### Runtime diagnostics (Q4)

- The bottom dock gets a second tab, **Simulation**, next to Messages: one row per distinct
  kernel or part diagnostic — kind, message, where (`U1.A`, net `U1.Y`), first time, count and
  last time — newest problems visible without scrolling; badges with the count on the tab and
  in the status bar. Click locates (component and pin → the part; net → its wires, all
  selected), double-click zooms. Cleared on Reset and Stop; a Clear button too.
- Messages stays the design checks. The active tab is a settings field (remembered).

### Live values in Properties

While a simulator exists: a selected part's pins show their net's level (`0`, `1`, `X`, `Z`,
weak in a paler badge), a selected wire its net's level, and interactive parts their state
(`on`, `pressed`). Refreshed at most a few times per second, not per frame. Browser tests read
levels here instead of sampling canvas pixels.

### Where the host lives

`src/editor/simulation.ts` — `class Simulation`, owned by the `Editor` (`editor.simulation`),
because the canvas needs its levels every frame and the Interact tool sends it actions; the UI
reaches it through stores (`state`, `time`, `speed`, `actualSpeed`, `diagnostics`) like the
rest of the editor. Not a new layer. Core stays wall-clock free; moving the kernel into a worker
later changes only this class.

### Testing

- core: carry-over unit tests (kept / changed / new / gone, renames, pending drives and wakes in
  order, time continues, contention exposed); scenario property test — for the R01–R04 example
  circuits and random small netlists, a run with no-op recompiles at random instants has the
  same `Trace` as a run without; SR latch keeps its value when an unrelated part is added; a
  clock keeps its edge times across an edit.
- editor: `simulation.test.ts` with a fake clock and frames (pacing, frame budget and actual
  speed, max speed, pause, step to the next event, stop, reset, halted; a move, relabel or
  reroute keeps the same simulator instance; structural edits rebuild with renames; undo while
  running, diagnostics across recompiles, light samples); interaction in
  `gestures.test.ts` (each part, rotated and flipped DIP switch, button released on leave and
  tool change); live drawing in `tests/scenarios/symbol-drawing.test.ts` (every part draws
  inside its layout with live states too).
- e2e `tests/e2e/simulation.spec.ts`: Hello LED — Run, the clock LED's level toggles over time,
  flipping SW1 drives D1; button held/released; Pause/Step/Stop/Reset and the status bar; edit
  while running keeps the switch position; a contention diagnostic located from the Simulation
  tab; F5 doesn't reload.
- Performance: run the stress schematic and record frame times (redraw with level colors, events
  per frame) in the plan.

## Tasks

Small, ordered, each committable on its own with its tests (`pnpm check` green).

- [x] 1. core: `sim.contended`; pending-drive times per slot; `EventQueue` iteration over live
  events; `carryOver()` and `SimulatorOptions.carry/renames/diagnostics` with the kept /
  changed / new rules and the start at the carried time; unit tests; the invariance property
  and latch/clock scenarios; simulation.md and components.md (idempotent `evaluate`).
- [x] 2. circuit: `inverseTransformPoint` (world → local) + tests.
- [x] 3. editor: `Simulation` host — run states, run/pause/step/stop/reset, speed presets,
  pacing with frame budget and actual speed; on edit: same structure keeps the simulator (net
  mapping through pins), otherwise rebuild with carry-over and renames; accumulated
  diagnostics, stores; injected clock and frames; headless tests; `window.logicEditor` exposes
  it in dev builds.
- [x] 4. editor: level colors in both canvas themes; wires and junctions by level (weak tint,
  contention flash); preview during gestures; redraw only on change.
- [x] 5. editor: live part drawing (`DrawContext.live`, light samples and brightness, switch /
  button / DIP / clock / hex / probe); drawing scenario with live states.
- [x] 6. editor: Interact tool and the click→action table; Run arms it, Stop leaves it; button
  release on leave/cancel/blur/tool change; gesture tests.
- [x] 7. ui: Simulate menu, toolbar group with the speed select, shortcuts (global, F5 reload
  prevented), status bar (state, time, speed, actual speed), status hints.
- [x] 8. ui: Simulation tab (runtime diagnostics, locate, clear), tab setting; live levels in
  Properties.
- [x] 9. Tests: `tests/e2e/simulation.spec.ts`; look at it in the browser in both themes (lit
  LEDs, level colors, displays); measure the stress schematic while running.
- [x] 10. Docs: simulation.md, editor.md (Simulation section, shortcuts, API, testing),
  components.md, architecture.md (data flow, editor overlay), circuit.md (planned extension
  done), ADR-0010, glossary, `src/*` READMEs, lessons; roadmap R05 done, R06 next (at finish,
  after the user's review).

## Acceptance criteria

Checkable statements; verified one by one in the finish-branch workflow.

- [x] `pnpm check`, `pnpm build` and `pnpm e2e` are green — 771 unit/scenario tests, 26 e2e (12
  workbench, 8 editing, 6 simulation), run twice in a row without a flake; kernel benchmark
  unchanged (11.9M / 13.8M events/s).
- [x] Hello LED runs in the browser: after Run the clock LED blinks at 1 Hz in real time and
  flipping SW1 on the canvas turns D1 on and off — e2e `Hello, LED runs…` (drawn by hand; D1's
  level follows the switch through the NAND, the lit LED sampled on the canvas, D2's anode goes
  1 and 0 within a period); `simulation.test.ts` (1 kHz clock, D1 brightness).
- [x] Run, Pause, Step (to the next event), Stop and Reset work from menu, toolbar and
  shortcuts; F5 never reloads the page; the status bar shows state, simulated time and speed —
  e2e `Step, Pause, Stop and Reset…` (F10 → `Paused · 0 ps`, `1 ns`; toolbar Run; F5 from the
  search field; Reset back under a second; Shift+F5 twice; no reload), `simulation.test.ts`,
  `commands.test.ts` (disabled global commands still keep F5 from the browser).
- [x] Speed presets from 1 ns/s to real time and Max; when the kernel can't keep up the actual
  speed is shown — `simulation.test.ts` (1 µs/s, the 100 ms frame cap, a 100 MHz clock with a
  slow fake clock: lagging + measured speed; Max), e2e speed select (1 ms/s → µs after 0.5 s),
  `format.test.ts` (status line).
- [x] Wires show 0, 1, Z, X (and weak levels) in both themes; contention flashes —
  `renderer.test.ts` (colors per style, halo, ghost, both flash phases), `simulation.test.ts`
  (styles from drives, weak pull-up, contention flashing and redraws), screenshots in both
  themes.
- [x] Switches, buttons (held), DIP switches (any orientation) and a manual clock are operated
  with the Interact tool; LEDs, LED bars and 7-segment displays show their average brightness
  (a fast clock at 50 % duty lights an LED at half brightness); hex display and probe show their
  inputs — `gestures.test.ts` (Interact tool, DIP switch rotated 90° and flipped), e2e held
  button, `simulation.test.ts` (0.5 brightness at 1 MHz, instant while paused, unknown),
  `symbol-drawing.test.ts` (every part with live state; digit, probe level, positions).
- [x] Editing while running carries state: moving parts with their wires doesn't touch the
  simulator; recompiling an unchanged netlist doesn't change the trace (property test); a gate
  latch keeps its value and a clock its phase across structural edits; renamed parts keep their
  state; undo while running works — `carry-over.test.ts` (IO bench at 9 instants, 40 random
  networks, latch, clock phase across a rename), `simulation.test.ts` (same instance after a
  nudge, carry-over after placing a part, rename/undo/redo), e2e edit + rename while running.
- [x] Runtime diagnostics are listed with time and count, located by click, cleared on Reset —
  e2e short circuit (row, status count, click selects the wires, Clear), `simulation.test.ts`
  (diagnostics, Clear and recurrence, cleared on Stop/Reset, `wiresOfNet`, `locateNet`).
- [x] docs, ADR-0010 and the roadmap describe what was built — editor.md (Simulation section),
  simulation.md, components.md, circuit.md, architecture.md, glossary, READMEs, lessons, ADR-0010;
  the roadmap is set to `done` at finish.

## Open questions

Asked at branch start (2026-11-07); all answered.

- [x] Q1. Editing while the simulation runs: what is carried into the recompiled circuit? —
  _proposed:_ everything of unchanged parts (state, output drives, pending changes, timers;
  time goes on), changed parts power on without an `X` glitch. Alternatives: component state
  only (outputs restart at `X`: gate latches lose their value on every edit); restart from
  power-on on every edit. — **answer:** the agent's call (full carry-over), with the user's
  point: an edit that doesn't change the structure (moving a part with its wires) must not
  rebuild the simulator at all — same netlist, nothing to recompile. See the design above.
- [x] Q2. How are switches and buttons operated on the canvas? — _proposed:_ an Interact tool
  (`I`, Logisim's "poke"), armed by Run, `V` to edit while running. Alternatives: clicks act
  in the Select tool while simulating (click vs drag ambiguity; buttons can't be dragged);
  editing locked while running (Proteus/Digital; no live edits). — **answer:** Interact tool.
- [x] Q3. Does a circuit run as soon as it is opened? — _proposed:_ no — stopped until Run (the
  power switch), Stop returns to the plain drawing. Alternative: always live (Logisim), only
  Pause/Reset. — **answer:** stopped until Run.
- [x] Q4. Where do runtime diagnostics go? — _proposed:_ a second bottom-dock tab "Simulation"
  next to Messages (time, count, locate). Alternative: one Messages list with design checks
  and runtime diagnostics together. — **answer:** a separate Simulation tab.

## Progress log

- 2026-11-07 — branch created; plan drafted.
- 2026-11-07 — Q1–Q4 answered (Q2–Q4 as proposed; Q1 full carry-over plus the user's
  addition: structurally unchanged edits keep the simulator); design updated.
- 2026-11-07 — plan approved by the user; status in-progress.
- 2026-11-07 — task 1 done: `carryOver()` / `SimulatorOptions.carry` (kept / changed / new),
  `sim.contended`, `EventQueue.forEach`, `sameNetlistStructure` (for the host's "same structure
  keeps the simulator"); `tests/scenarios/carry-over.test.ts` checks the invariance on a bench of
  IO parts and 40 random gate networks (mutation-checked: shifting carried timers or re-running
  `init` fails it).
- 2026-11-07 — task 3 done: `src/editor/simulation.ts` (`Simulation`, owned by the `Editor` and
  synced from `editor.state`; `revision` store redraws the canvas synchronously inside the
  host's frame); core got `nextEventTime` for Step. Status refreshes ≤ 10×/s; diagnostics
  snapshot when counts change. 17 headless tests with a fake clock. Note for task 7: opening an
  example or File ▸ New must `stop()` first, or ids of the new document would pick up state
  from the old one.
- 2026-11-07 — tasks 4–7 done: level colors (`SignalStyle`, `CanvasTheme.levels`, renderer
  `SignalView` with a recording-context unit test); live drawers (`DrawContext.live`,
  `LivePart`, light samples quantized to 1/32 so jitter doesn't redraw); Interact tool
  (`symbols/interact.ts` table, `hold` gesture released on up/cancel/blur/tool change, Run arms
  it, Stop leaves it); UI: Simulate menu, toolbar group + `SpeedSelect` (`widget:speed` entries
  in `TOOLBAR`), `SimulationStatus` in the status bar, `Command.stateIcon`, global commands keep
  F-keys from the browser even when disabled, `open()` stops the simulation. Looked at it in the
  dev build (headless screenshots, both themes): colors readable, F5 doesn't reload.
- 2026-11-07 — tasks 8–9 done: bottom-dock tabs (Messages, Simulation; `Settings.bottomTab`),
  `SimulationPanel` (locate a net through its wires: `Editor.locateNet`), Clear, live level
  badges in Properties (`LiveLevel`, refreshed by `Simulation.ticks`); e2e
  `tests/e2e/simulation.spec.ts` (6 tests; helpers moved to `tests/e2e/support.ts`), full e2e 26
  green twice. Measured on the 3 600-part stress schematic (dev build, headless Chromium, Apple
  M3 Pro): redraw at fit 4.4 ms median running vs 3.9 ms stopped (p90 6.1 / 5.2); `run()` (new
  simulator + signal map) 46 ms; Reset 13 ms; a structural edit while running 39 ms (compile,
  scene, carry-over); a nudge 47 ms and keeps the same simulator. Seen in both themes: lit LEDs
  with glow, hex digit, probes, DIP sliders, level badges. Possible follow-ups (not in scope): a
  dim yellow LED is hard to see on the light theme's cream; a wire toggling faster than the
  frame rate flickers between 0 and 1 (Logisim does too) — a "toggling" style could show it.
- 2026-11-07 — task 10 done (docs, ADR-0010, glossary, READMEs, lessons). Acceptance criteria
  verified: check (771), build, e2e 26 (three runs), bench 11.9M / 13.8M events/s. Waiting for
  the user's review.

## Handoff

- **State:** all tasks done and committed; acceptance criteria verified (check, build, e2e ×3,
  bench). Waiting for the user's review before finish-branch (roadmap R05 `done`, R06 `next`,
  merge with `--no-ff`).
- **Next step:** after approval, follow `.ai/workflows/finish-branch.md`.
- **Watch out:** possible follow-ups noted in the progress log (dim yellow LED on the light
  theme; wires toggling faster than the frame rate flicker) — not in scope, could go to the
  backlog.
- **Verify with:** `pnpm check && pnpm build && pnpm e2e`.

# 0010. Running simulations in the editor: a host, live edits with carry-over, an Interact tool

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R05 (`feat/sim-ui`)

## Context

R05 makes the drawn circuit run: real-time pacing of a kernel that has no wall clock, controls,
live levels on the canvas, switches and buttons operated on the canvas, indicators lit from their
on-time, runtime diagnostics, and editing while the circuit runs. ADR-0006 made designators the
component ids, so a rename changes identity; ADR-0009 records renames with every edit for this
branch. Questions decided at branch start (plan Q1–Q4): what an edit while running keeps, how
parts are operated, whether a circuit runs as soon as it opens, where runtime diagnostics go.

## Decision

- **A simulator host in the editor layer** (`Simulation`, owned by the `Editor`): states
  stopped / running / paused / halted; Run, Pause, Step (to the next event), Stop, Reset; speed
  presets from 1 ns/s to real time, and Max; a wall-clock frame budget, with the speed actually
  reached shown when the kernel can't keep up and the backlog dropped rather than caught up. The
  clock and the frame scheduler are injected. Core stays pure and wall-clock free.
- **Stopped until Run.** A circuit opens as a plain drawing; Run is the power switch, Stop goes
  back to the drawing. Design errors don't block running: broken parts are simply missing.
- **Editing while running keeps the simulation.** An edit that keeps the circuit's structure
  (same components and props, same pins connected — moving parts with their wires) keeps the
  simulator untouched. Any other edit continues the run in the recompiled netlist
  (`Simulator.carryOver`): unchanged parts keep their state, output drives, pending changes and
  timers, matched by id through the edit's renames; parts with other props power on without an
  `X` glitch on their outputs; then every part is evaluated once. Recompiling an unchanged
  netlist is therefore invisible (a property test); latches built from gates keep their value,
  clocks their phase. Contract: `evaluate` with nothing changed is idempotent.
- **An Interact tool** (`I`) operates parts: a click flips a switch or a DIP switch (the one
  under the pointer, in any orientation), a held press holds a push button, a click steps a
  manual clock; elsewhere a click selects and a drag pans. Run arms it, Stop leaves it, `V`
  edits while running. The press → action mapping is a table keyed by symbol kind next to the
  drawers.
- **Live drawing**: wires and junctions take level colors (1, 0, Z, X, weakly pulled 0/1;
  contention flashes); drawers get the part's live state; indicators show their average
  brightness over the last frame from on-time samples. The canvas redraws only when events
  happened, a brightness step changed or a flash is due.
- **Runtime diagnostics in their own tab** ("Simulation", next to Messages) with time, count and
  click-to-locate; Properties shows live levels of pins and wires.

Details: [editor.md](../editor.md#simulation), [simulation.md](../simulation.md#editing-while-running-carry-over).

## Consequences

- The circuit stays alive while it is edited — the "test before fab" loop doesn't restart a long
  run after every tweak — at the price of a kernel API (`carryOver`) that must keep the
  invariance property as the kernel grows (R14 snapshots can build on it).
- Moving a part costs no kernel work at all; a structural edit on 3 600 parts costs ≈ 40 ms.
- An extra tool to switch to; Run selects it, so the common path needs no extra step.
- Wires toggling faster than the frame rate flicker between 0 and 1 (as in Logisim); a
  "toggling" style is a possible follow-up. Waveforms (R13) and stepping by clock edge (R14)
  build on the host.
- F-key shortcuts (F5, F10) follow debugger conventions and are kept from the browser even while
  disabled, so F5 never reloads an unsaved circuit.

## Alternatives considered

- **Keep only component state across an edit** (outputs restart at `X`) — simpler, but every
  edit would reset latches built from gates. **Restart on every edit** — simplest, but a long run
  resets whenever an LED moves.
- **Clicks act in the Select tool while simulating** — no tool switch, but click vs drag is
  ambiguous and a held button can't also be dragged. **Lock editing while running**
  (Proteus/Digital) — no live edits at all, contrary to the roadmap.
- **Always live** (Logisim) — immediate, but a circuit being drawn is a sea of `X` and
  diagnostics; no plain drawing for screenshots.
- **Runtime diagnostics in the Messages list** — one place to look, but static design checks
  and timed, counted runtime events mixed in one list.
- **The host in core or in a new layer** — core must stay wall-clock free; a new layer (and its
  ADR) for one class that the canvas needs every frame anyway.

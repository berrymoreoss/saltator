# 0019. Waveforms: probes by reference in the document, a bounded recorder, triggers that break the run

- **Status:** accepted
- **Date:** 2026-11-07
- **Roadmap item:** R13 (feat/logic-analyzer)

## Context

Designing a computer needs what a logic analyzer gives at the bench: several signals over time,
side by side, with the delays between them measured, a moment caught by a condition, and the
capture taken to other tools. The simulator already knows every level at every instant, but
only for an instant: the canvas shows the present. Several forces:

- Nets have no identity across compiles: an edit while running continues in a recompiled
  netlist (ADR-0010) whose net indices and unnamed net ids differ.
- The kernel runs 10M+ events a second; recording costs memory and speed on every change.
- At real time a frame covers milliseconds of simulated time and thousands of instants; a
  condition seen inside a frame must stop the run at its instant, not at the frame's end.
- Delta cycles make zero-delay glitches that no real circuit makes.
- R14 (breakpoints, stepping by clock edge) and R15 (test benches, headless) need the same
  pieces: stopping at an instant, conditions on signals, a recorded run, a dump format.

## Decision

- **Probes are references, saved in the document** (Q1): `Circuit.probes` lists the resolver's
  references (`CLK`, `U1.Y`, `D[0..7]`) and groups of single signals read as one value, with a
  name and a radix, in schema v3 (identity migration). A file and the examples open with their
  signals; probe edits are undo steps that don't touch the simulator; part renames rewrite them;
  an unnamed net is probed by a (driving) pin on it, since its id changes with the wiring.
- **Only probed signals are recorded** (Q2), by a core `Recorder` of channels the caller
  attaches to net indices per simulator (re-resolved after every carry-over), one level per
  instant (a change undone within an instant leaves nothing), bounded by a budget of changes
  whose oldest are dropped. Signals probed while running start then; deterministic runs make
  "Reset and run again" the way to see a new signal's past.
- **The kernel can break at an instant**: `requestBreak()` from a listener ends the run after the
  instant's delta cycles (status `break`); `onInstant` tells listeners when an instant has
  settled. A **trigger** — terms on channels ANDed, at most one strict edge, evaluated at the end
  of instants where its channels changed — breaks there; the host runs on for the post-trigger
  part of the capture window (`pauseAt`) and **pauses** (Q3), the window fixed when armed.
- **Probing from the canvas** with a **Probe tool** (Q4) and the context menu, next to the
  tab's reference box.
- **VCD** is the export format, written by core from the recorder.

## Consequences

- No cost without probes; ≈ 3 % with 16 recorded nets (37 % recording all 1001 nets of the
  ring oscillator benchmark — why Q2 records the probes only).
- The waveforms show what was probed since power-on; a new signal's past takes a rerun.
- Saving probes makes probe edits "unsaved changes"; examples ship with their signals.
- R14 builds breakpoints and edge stepping on `requestBreak`, `onInstant` and the trigger's
  conditions; R15 records and dumps headless with `Recorder` and `writeVcd`, and names signals
  as probes do; R11 adds instance paths in the resolver, which probes go through.
- A trigger pauses the simulation: the canvas, Properties and the Memory tab show the circuit
  right after it, and stepping goes on from there; a capture that freezes while the circuit
  runs on (a real analyzer) isn't offered.
- Drive strengths aren't recorded (the listener reports levels): weak levels look strong in the
  diagram (backlog if missed).

## Alternatives considered

- **Probes in the session only** (like the camera) — the file wouldn't change on probing, but
  examples couldn't show their signals and test benches couldn't share them (Q1).
- **Probe parts on the schematic** (Digital, Proteus) — what is traced is visible, but every
  probe needs a wire or label and clutters the drawing (Q1).
- **Net ids or indices as the probe's identity** — they change with every recompile.
- **Recording every net in a bounded buffer** — a signal probed later would have a past, at the
  cost of memory, ≈ 37 % of the kernel's speed and drawing channels out of a shared log (Q2).
- **Stopping between frames** — a frame at real time covers milliseconds: the trigger would
  overshoot by up to a frame and the view couldn't show its instant.
- **Evaluating conditions on every net change** — delta glitches would fire them; deferring to
  the next instant would break one instant late.
- **A capture that freezes while the circuit runs on**, or a setting for both — the circuit's
  state at the trigger would be gone from the canvas (Q3).
- **CSV or a JSON capture** — VCD is what waveform viewers and HDL tools read.

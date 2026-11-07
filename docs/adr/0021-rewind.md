# 0021. Rewind: whole-simulator snapshots, an action log, replays in a replica; forward runs replay the recording

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** R14b (feat/rewind)

## Context

R14a stops a run where something interesting happens and steps it forward. Debugging a
breadboard design almost always asks the opposite question too: what happened just before it
went wrong? The waveforms answer it only for the probed signals; the canvas, the Memory tab and
the watches show only now. Forces:

- An event-driven simulation can't run backwards: inertial delays cancel pending changes, timers
  wake parts, contention and floating inputs are reported once — the past is not a function of
  the present.
- It is deterministic: the same netlist and the same actions at the same points give the same
  run (the carry-over property test holds it to that, R05). So any instant can be reached again
  by running forward from an earlier state.
- Users act while the circuit runs (switches, buttons, a manual clock, pokes into a RAM); a
  re-run must deliver the same actions at exactly the same points — two clicks within one frame
  are delivered with no run between them, and an instant may be processed several times (once
  for its events, again for an action's zero-delay effects while paused).
- Memories hold up to 32 K cells with two time stamps each (≈ 576 KB a chip); a BE6502 has two.
- The tools that watch the kernel (the waveform recorder, breakpoints, activity counters,
  break-on-errors) must not see a re-run as new events, and must show the rewound instant.
- Edits continue a run in another netlist (carry-over); the past ran on another circuit.

## Decision

- **Snapshots of the whole kernel** (`Simulator.snapshot`/`restore`, core): time, statistics,
  levels, drives, contention, floating-input marks, driver slots with their pending changes,
  the event queue in heap order with its seq counter, every component's state (plain data, as
  `createState` always promised) and the diagnostic log's counts. Per-delta stamps are not
  saved: the delta id keeps counting, so no stale stamp can match. Component states are frozen
  copies whose typed arrays are kept in 4 KiB pages **shared with the previous snapshot** where
  equal, and restored **into the live objects** (views stay valid).
- **Replicas**: a snapshot restores into its simulator or a replica built from the same netlist
  (`replica()`). Every replay — reaching a position, a backward search — runs in the replica,
  and the result is restored into the live simulator; the tools attached to the live one never
  see a replay.
- **The timeline** (editor): checkpoints every 200 000 events between kernel calls, a log of the
  user's actions (with whether the kernel ran since the previous one), positions as a time and
  a count of delivered actions, a 64 MiB budget (older checkpoints thinned within a maximum gap,
  then the oldest dropped). Reaching a position: the checkpoint before it, re-run with the log.
- **Forward runs replay the recording** (Q1): behind the present, every forward run delivers
  the recorded actions again at their positions (a breakpoint at an instant still pauses before
  the actions taken there), so it returns to the same present and the waveforms' future stays;
  the user's own action behind the present starts a new future (the rest is dropped, the tools
  are told first). Step Clock on a manual clock replays the next recorded press.
- **The history starts at power-on and at every structural edit** (Q2); an edit at a rewound
  instant continues from there ("go back, fix the wire, run again").
- **Tools follow by time, not by replay**: the recorder keeps its record past the rewound
  instant as the future (`seek`: a cursor; a forward run confirms it instead of writing it
  again; `cut` on divergence); triggers re-sync their condition; breakpoint hits are hit times;
  the memory inspector's highlights restart.
- **Backward steps are searches**: Step Back (the instant with events before the last one),
  Step Back Clock (before the step clock's last active edge), Reverse Continue (the last
  instant a breakpoint held anew, or an error or warning was reported) replay the history's
  segments in the replica newest first, over frames, then reach what they found.
- Shortcuts: Alt + the forward key (Q4): Step Back Alt+F10, Step Back Clock Alt+F8, Reverse
  Continue Alt+F5. User-named snapshots (bookmarks) go to the backlog (Q3).

## Consequences

- Any instant since the last power-on or edit is reachable in ≈ 20 ms of replay at most at the
  default interval; checkpoints cost within noise on the kernel benchmarks (a ring oscillator
  12.5–12.8M vs 12.6–12.9M events/s; 16 × 6116 7.4–7.5M vs 7.6M), and a snapshot of a 62256 and
  a 28C256 that didn't change costs 1.7 KiB.
- A part whose state isn't plain data, or that keeps mutable state in its closure, breaks
  rewinding: `freezeState` throws on the first, the rewind property test over every example and
  every registered part catches the second.
- Hit counts count forward; Reverse Continue ignores them. A breakpoint that fires during the
  re-processing of an instant after an action is seen by a replay at the same position.
- Test benches (R15) can use snapshots to run vectors from a set-up state.
- Follow-ups (backlog): bookmarks kept beyond the history's reach; re-running the past with an
  edited circuit and the same inputs.

## Alternatives considered

- **Reverse execution** (undoing events) — impossible with inertial delays, timers and
  once-per-change reports: the information is gone.
- **Recording every net** (the waveforms' way) — shows levels, not part states, memories or
  pending changes; and costs every change of every net (≈ 35 % on a ring oscillator, R13).
- **A snapshot per instant** — memory explodes on fast circuits; checkpoints plus replay bound
  it.
- **Replaying in the live simulator with its listeners muted** — the tools would need to be
  rewound to each checkpoint and replay along; a replica keeps them out of it entirely.
- **Plain structured clones of states** — 1.1 MB a snapshot for a 62256 and a 28C256; shared
  pages make an unchanged memory free.
- **A rewind discards the future** (Q1, the alternative) — simpler, but a click in the ruler
  would erase everything to its right, and actions taken while running would be lost on the
  way forward.
- **Snapshots restored into the edited netlist** (Q2) — "what if" runs; a different feature
  (backlog), and R15's test benches replay inputs on a changed design.

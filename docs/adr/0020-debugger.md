# 0020. Debugger: repeating trigger conditions that pause, Step Clock before the edge, the setup in the session

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** R14a (feat/debugger)

## Context

R13 caught one moment of a run with a trigger and looked at it in a timing diagram. Debugging
a design needs more: stop wherever a condition holds, every time, or wherever the simulation
reports a mistake; walk through the run one clock cycle or one stretch of time at a time; see
chosen values — signals, buses, memory cells — and what each step changed. Forces:

- The kernel can already break at the end of an instant (`requestBreak`, `onInstant`) and the
  trigger evaluates "pattern and one edge" there, glitch-free (ADR-0019). Probes are only what
  the Waveforms tab records; breakpoints should not depend on probing a signal first.
- A trigger's `pauseAt` makes the host run on past a break; a breakpoint during that time must
  still stop.
- "One clock cycle" has to show a settled circuit: right after an edge, registers have sampled
  but their outputs change only after their propagation delay, so LEDs still show the old
  value. Stopping right before the next edge needs to know that the edge is coming, which an
  event-driven kernel only knows if the change is already queued.
- Ben Eater's modules are clocked by hand (a manual clock): there is no next edge to find.
- Breakpoints and watches change constantly while debugging; the document's undo history and
  "unsaved" mark are for the design.
- R14 as written also included snapshots and rewind, which need the whole kernel state saved
  and restored and user actions replayed — a layer of its own.

## Decision

- **Split R14** into R14a (this: breakpoints, stepping, watches, run statistics) and R14b
  (snapshots and rewind), which builds on R14a's steps and breakpoints.
- **Breakpoints are repeating triggers**: the trigger's terms on any signal the resolver
  knows (one reference, or several 1-bit references read as a value), evaluated by a core
  `Trigger` with `repeat: true` on a `Recorder` of the debugger's own; a hit count; they ask the
  host to pause with `requestPause(reason)`, which wins over a pending `pauseAt` and over a
  step. **Break on errors / warnings** pauses at every diagnostic report of that severity
  (`DiagnosticLog.onOccurrence`, `diagnosticSeverity` in core).
- **Step Clock pauses right before the step clock's next active edge but one** (Q3): the
  kernel gets a lookahead, `stopBefore: { net, level }`, which stops a run before an instant
  at which the drives pending on the net make it change to the level; `io/clock` schedules
  each edge a phase ahead so its edges are visible; a manual `io/clock` gets one pulse and one
  period of its props instead. Steps (Step Clock, Run For, Run To) run at Max as jumps; the
  host reports why it paused (`status.reason`).
- **Watches are a list of their own** (Q4): signals, groups and memory cells, not recorded,
  marked when they differ from the last stop.
- **The debug setup lives in the session** (Q2): autosaved per browser tab with the view, not
  in the file, not undoable; New and Open start without one.
- **Run statistics** come from the kernel's counters; per-net activity is measured on request
  by a listener, not counted by the kernel.

## Consequences

- Debugging costs nothing until used: no lookahead check without `stopBefore`, no recorder or
  trigger without breakpoints, no listener without measuring activity. A breakpoint costs
  ≈ 15 % on the ring oscillator benchmark, where every event is an instant of its own
  (12.75M → 10.90M events/s); measuring activity ≈ 7 %.
- Step Clock shows what Ben Eater's manual clock shows: after a press the registers hold the
  new value. It only sees ahead what is already queued: a part that drives a clock with zero
  delay from a timer must schedule its edges as delayed drives instead (documented for parts).
- The trigger never fires twice at one instant, and a fresh recorder channel records its first
  level 1 ps before the instant it is attached at, so a change made at that instant (an
  action while paused) is an edge (the R13 recorder changed for it).
- Breakpoints and watches don't travel with the file: an example can't ship them, and another
  tab or a re-opened file starts without them.
- R14b has the steps, breakpoints and pause reasons to build Step Back and Reverse Continue on.

## Alternatives considered

- **Breakpoints on probes only** — needs every signal in the Waveforms list (and recorded)
  before it can stop a run.
- **A separate evaluator on nets** — a second implementation of the same conditions; the
  recorder's one-level-per-instant record is what makes them glitch-free.
- **Step Clock at the edge** — simpler (a breakpoint on the edge), but stops before the
  registers' outputs change: the LEDs show the old count. **A settle time after the edge** —
  depends on choosing it per design.
- **The setup in the document** (schema v4, like probes) — undo steps and an unsaved mark for
  every breakpoint toggled; examples could ship breakpoints. **Memory only** — lost on reload.
- **Watches as a "now" column of the probes** — memory cells would have to be recorded.
- **A per-net change counter in the kernel** — ≈ 3 % on gate chains for every simulation.
- **One branch for R14** — doubles the branch with a kernel snapshot layer M2 doesn't need.

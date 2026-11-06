# Simulation model

Specification of the kernel in `src/core`. Rationale: [ADR-0003](adr/0003-event-driven-simulation.md).

> Status: **draft**, written in R00 as the target for R01 (feat/engine-core). R01 must update
> this document to match what was actually built (names, signatures, defaults).

## Goals

- Catch the bugs real breadboard builds hit: propagation delays and races, glitches, bus
  contention, floating CMOS inputs, missing resets, oscillation.
- Deterministic: same netlist + same stimulus ⇒ identical event trace.
- Fast enough to run 74HC-based computers interactively (target: ≥ 5M events/s on a modern laptop
  for simple gate circuits; measured by the kernel benchmark).
- Pure TypeScript with no platform dependencies, ready to move into a Web Worker.

## Time

- Simulation time is an integer number of **picoseconds**, stored in a JS `number`
  (exact up to 2^53 ps ≈ 2.5 hours of simulated time, far beyond any session).
- Helpers: `ps(n)`, `ns(n)`, `us(n)`, `ms(n)` convert to picoseconds; `formatTime(t)` renders a
  human-readable value.
- Timing data comes from datasheets (typical values at VCC = 5 V, 25 °C unless a part says
  otherwise). A future "worst case" mode may switch to max values.

## Signal values

### Levels (what readers see)

| Level | Meaning                                                                     |
| ----- | --------------------------------------------------------------------------- |
| `0`   | logic low                                                                   |
| `1`   | logic high                                                                  |
| `X`   | unknown: uninitialized, conflicting drivers, or derived from unknown inputs |
| `Z`   | high impedance: nothing drives the net (floating)                           |

### Drives (what outputs produce)

A driver contributes a level **and a strength**:

| Strength | Produced by                                                |
| -------- | ---------------------------------------------------------- |
| `none`   | disabled tri-state output, open input, `Z`                 |
| `weak`   | pull-up / pull-down resistors                              |
| `strong` | push-pull CMOS outputs, switches tied to a rail, constants |

Drives are encoded as small integers for speed (exact encoding is an implementation detail of
`logic.ts`):

```
Z, WEAK_0, WEAK_1, WEAK_X, STRONG_0, STRONG_1, STRONG_X
```

### Resolution

Each net resolves its drivers to one drive:

1. Take the maximum strength present among all drivers.
2. If every driver at that strength has the same level, the net gets that level at that strength.
3. Otherwise the net is `X` at that strength.
4. If no driver contributes (all `Z`), the net is `Z`.

Consequences:

- A strong 0 overrides a pull-up (correct: a pressed button pulls the line low).
- Two pull resistors in opposite directions yield weak `X`.
- Two strong drivers with opposite known levels yield strong `X` **and** a `contention`
  diagnostic (that's a short circuit on real hardware). A strong `X` meeting a strong 0/1 yields
  `X` without a contention diagnostic.

### Reading inputs

Components read `Level`s. CMOS inputs treat `Z` as unknown. When a component reads a floating
(`Z`) net through the context, the engine records a `floating-input` diagnostic for that net
(deduplicated until the net changes). This flags only floating values that are actually consumed,
so idle bidirectional buses don't produce noise.

Power-on state: all drivers start at `Z`; components initialize their outputs in `init`. Sequential
parts without a reset start at `X` (realistic and educational: "your latch has no reset").
Optional power-on randomization is a possible later setting.

## Netlist

The kernel consumes a flat, serializable **netlist**:

```ts
interface Netlist {
  components: { id: string; type: string; props?: Record<string, unknown> }[];
  nets: { id: string; pins: { component: string; pin: string }[] }[];
}
```

- Produced by the circuit compiler (R02) or, in tests, by a `NetlistBuilder` that connects pins
  directly (union-find; connecting a pin twice merges nets).
- Unconnected pins get an implicit private net (inputs read it as floating).
- The simulator compiles the netlist into index-based runtime arrays (nets, driver slots, reader
  lists) so the hot loop uses integers and typed arrays only.

## Components at runtime

A component definition (see [components.md](components.md)) provides a behavior factory. The
runtime contract:

```ts
interface Behavior<State> {
  /** Called once at t = 0, before any events. Set initial outputs here. */
  init?(ctx: EvalContext<State>): void;
  /** Called when one or more nets this component reads changed (at most once per delta cycle). */
  evaluate(ctx: EvalContext<State>): void;
  /** Called when a timer scheduled with ctx.wakeAfter() fires. */
  wake?(ctx: EvalContext<State>, token: number): void;
  /** Called for external actions from the UI or a test bench (press button, flip switch). */
  action?(ctx: EvalContext<State>, action: unknown): void;
}

interface EvalContext<State> {
  readonly now: Time;
  readonly state: State; // per-instance mutable state
  read(pin: PinRef): Level; // current resolved level of the pin's net
  changed(pin: PinRef): boolean; // did this pin's net change in the triggering delta?
  rose(pin: PinRef): boolean; // changed and went 0 → 1 (edge detection)
  fell(pin: PinRef): boolean; // changed and went 1 → 0
  drive(pin: PinRef, drive: Drive, delay: Time): void;
  wakeAfter(delay: Time, token?: number): void;
  report(diagnostic: ComponentDiagnostic): void; // e.g. setup/hold violation
}
```

`PinRef` is a pin index resolved once at instantiation (definitions expose pin name → index), so
evaluation does no string lookups.

## Delays: inertial model

Every driver slot (an output-capable pin) has a current drive and at most one pending change.
`ctx.drive(pin, value, delay)`:

1. If a change is pending and its value equals `value` → keep the pending change (do not push it
   later).
2. Otherwise cancel any pending change; then, if `value` differs from the current drive, schedule
   `value` at `now + delay`.

Effect: input pulses shorter than a gate's delay are swallowed (inertial delay), as in real CMOS
gates; a re-evaluation that confirms an already-pending output doesn't postpone it. Per-transition
delays (tPLH ≠ tPHL) are supported by passing a different `delay` per call.

## Event loop

Events live in a min-heap ordered by `(time, seq)`; `seq` is a global insertion counter, so
same-time events are processed in FIFO order (determinism). Cancelled events are skipped lazily.

For each timestamp `t`, the engine runs **delta cycles** until no events remain at `t`:

1. Pop all events scheduled for `t` that existed when the delta started.
2. Apply driver changes; re-resolve each touched net once.
3. For each net whose resolved level changed: record it (listeners, waveforms), mark every reader
   component dirty.
4. Collect timer wake-ups.
5. Call `evaluate` (or `wake`) on each dirty component once, in ascending component index order.
   Zero-delay drives schedule new events at `t` → next delta cycle.
6. If the number of delta cycles at one timestamp exceeds `maxDeltaCycles` (default to be fixed in
   R01, proposed 1000), report an `oscillation` diagnostic and halt.

Initialization: at `t = 0` every component's `init` runs, followed by the normal delta loop.

## Running

Core is driven explicitly; it has no notion of wall-clock time:

- `runUntil(t, { maxEvents? })` — process events up to and including time `t` (or until the event
  budget is used up); returns a status (`idle`, `reached`, `budget`, `halted`).
- `runFor(dt)` — `runUntil(now + dt)`.
- `settle({ maxTime? })` — run until the queue is empty (combinational settling) or a limit hits.
- `action(componentId, payload)` — deliver an external action at the current time.

A **simulator host** outside core maps wall-clock to simulation time (speed factor, frame budget,
"can't keep up" reporting) and offers debugger conveniences (step to next clock edge, run until
breakpoint) _(R05, R14)_.

## Observability

- **Levels snapshot**: a `Uint8Array` with one resolved level per net, read by the renderer each
  frame without copying (SharedArrayBuffer-ready).
- **Change listeners**: `onNetChange((time, net, level) => …)` for probes and the logic analyzer;
  zero cost when nobody listens.
- **Diagnostics**: `{ time, kind, net?, component?, message }` with kinds `contention`,
  `floating-input`, `oscillation`, and component-reported ones (`setup-violation`,
  `hold-violation`, …). Capped and deduplicated.
- **Stats**: events processed, delta cycles, current time.
- **Inspection** _(R12+)_: components may expose typed views of internal state (memory arrays,
  CPU registers) for UI panels, plus debug read/write that bypasses simulated timing.

## Test bench

`src/core/testing` provides utilities used by every part test:

- Build a bench around one part: every input pin gets a controllable driver, every output is
  observable.
- `set({ A: 1, B: 0 })`, `settle()`, `get('Y')`, `expect({ Y: 1 })`.
- Table-driven helper for datasheet function tables.
- Timing helpers: measure the delay between an input change and an output change, assert it equals
  the datasheet `tpd`.

## Planned extensions

- Setup/hold checking helpers for edge-triggered parts _(R09)_.
- Snapshot/restore of full simulator state (for "rewind" in the debugger) _(R14)_.
- Web Worker host with SharedArrayBuffer levels _(backlog)_.
- Fast mode for large synchronous designs (levelized/cycle-based evaluation) _(backlog)_.

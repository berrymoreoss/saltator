# Simulation model

Specification of the kernel in `src/core` (implemented in R01). Rationale:
[ADR-0003](adr/0003-event-driven-simulation.md). Part definitions: [components.md](components.md).

## Goals

- Catch the bugs real breadboard builds hit: propagation delays and races, glitches, bus
  contention, floating CMOS inputs, missing resets, oscillation.
- Deterministic: same netlist + same stimulus ⇒ identical event trace.
- Fast enough to run 74HC-based computers interactively: ≥ 5M events/s for simple gate circuits
  (measured by `pnpm bench`; R01: ≈ 12–13.5M events/s on an Apple M3 Pro).
- Pure TypeScript with no platform dependencies, ready to move into a Web Worker.

## Time

- Simulation time (`Time`) is an integer number of **picoseconds** in a JS `number` (exact up to
  2^53 ps ≈ 2.5 hours of simulated time). `TIME_MAX` means "no limit".
- `ps(n)`, `ns(n)`, `us(n)`, `ms(n)` convert to picoseconds, rounding to an integer
  (`ns(0.3)` = 300). `formatTime(t)` renders `'1.5 ns'`, `'16 ms'`.
- Timing data comes from datasheets (typical values at VCC = 5 V, 25 °C unless a part says
  otherwise). A future "worst case" mode may switch to max values.

## Signal values

### Levels (what readers see)

| `Level`    | Meaning                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `Level.L0` | logic low (value `0`)                                                       |
| `Level.L1` | logic high (value `1`)                                                      |
| `Level.X`  | unknown: uninitialized, conflicting drivers, or derived from unknown inputs |
| `Level.Z`  | high impedance: nothing drives the net (floating)                           |

### Drives (what outputs produce)

A driver contributes a level **and a strength** (`Strength.NONE`, `WEAK`, `STRONG`):

| Strength | Produced by                                                |
| -------- | ---------------------------------------------------------- |
| none     | disabled tri-state output, released pin (`Z`)              |
| weak     | pull-up / pull-down resistors                              |
| strong   | push-pull CMOS outputs, switches tied to a rail, constants |

`Drive` values pack both as `strength << 2 | level`:

```
Drive.Z = 3, WEAK_0 = 4, WEAK_1 = 5, WEAK_X = 6, STRONG_0 = 8, STRONG_1 = 9, STRONG_X = 10
```

Helpers: `strong(level)`, `weak(level)` (both map `Z` to `Drive.Z`), `levelOf(drive)`,
`strengthOf(drive)`, `levelChar(level)` (`'0' | '1' | 'X' | 'Z'`), `driveName(drive)`.

### Resolution

Each net resolves its drivers to one drive (`resolve(drives)`):

1. Take the maximum strength present among all drivers.
2. If every driver at that strength has the same level, the net gets that level at that strength.
3. Otherwise the net is `X` at that strength.
4. If no driver contributes (all `Z`), the net is `Z`.

Consequences:

- A strong 0 overrides a pull-up (a pressed button pulls the line low).
- Two pull resistors in opposite directions yield weak `X`.
- Two strong drivers with opposite known levels yield strong `X` **and** a `contention`
  diagnostic (that's a short circuit on real hardware; `isContention(drives)`). A strong `X`
  meeting a strong 0/1 yields `X` without a contention diagnostic.

Internally the simulator ORs each driver's `driveBits(drive)` into a small bit set and resolves
it with `resolveBits`; nets with a single driver skip resolution entirely.

### Level operators

`and`, `or`, `xor`, `not` implement 4-state logic; CMOS inputs treat `Z` as unknown
(`toInput(level)` converts `Z` to `X`):

- AND: any 0 → 0; all 1 → 1; otherwise X. OR is the dual.
- XOR: any X/Z input → X. NOT: X/Z → X.

They are associative, so N-input gates fold them over their inputs.

### Reading inputs

Components read `Level`s and may see `Z` (a bidirectional part may care). When a component reads
a `Z` net through an `in` or `bidir` pin, the engine records a `floating-input` diagnostic for
that net — once, until the net changes. This flags only floating values that are actually
consumed, so idle bidirectional buses don't produce noise. Pins marked `sense` (LEDs, displays,
probes) only observe their net: reading `Z` through them is not a floating input.

### Power-on

- Push-pull (`out`) pins start driving **strong `X`**: a real output always drives something,
  and at power-on nobody knows what. `tristate` and `bidir` pins start released (`Z`).
- Every behavior's `init` runs when the `Simulator` is constructed (drives scheduled there land
  at t = 0; with a carry-over, at the carried time — see below).
- At t = 0, after the t = 0 events from `init` and from actions were applied, **every component
  with `evaluate` is evaluated once**. So a gate with an unconnected input reads it (and reports
  it), and gate outputs become defined after their delay.
- Sequential and feedback circuits without a set/reset therefore start — and stay — at `X`
  (realistic and educational: "your latch has no reset"). A loop that starts at `X` stays `X`
  (`not X = X`): a plain inverter ring never starts oscillating; a NAND with an enable does.
  Seeded random power-on is a possible later option.

## Netlist

The kernel consumes a flat, serializable **netlist**:

```ts
interface Netlist {
  components: { id: string; type: string; props?: Record<string, unknown> }[];
  nets: { id: string; pins: { component: string; pin: string }[] }[];
}
```

- Produced by the circuit compiler ([circuit.md](circuit.md#compiler)) or, in code, by a
  `NetlistBuilder`:

  ```ts
  new NetlistBuilder()
    .add('U1', 'prim/nand', { inputs: 2 })
    .add('U2', 'prim/not')
    .connect('U1.Y', 'U2.A') // union-find: connecting a pin twice merges nets
    .net('CLK', 'U1.A') // named net; the same name again joins it (like a net label)
    .build();
  ```

  Net ids default to the first pin connected (`U1.Y`). Component ids may not contain `.`.
- `resolveNetlist(netlist, registry)` validates and resolves it to indices. It reports **all**
  problems at once in a `NetlistError` (`problems: string[]`): duplicate component or net ids,
  unknown types, invalid props, unknown pins, a pin on two nets.
- Unconnected pins (except `power`/`nc`) get an implicit private net with id `component.pin`
  (inputs read it as floating).
- The simulator compiles the resolved netlist into index-based runtime arrays: per net the
  resolved level, previous level and change stamp; driver slots and reader components in CSR
  form (`start` + `items` typed arrays); per pin its net and driver slot. The hot loop uses only
  integers and typed arrays.

## Components at runtime

A component definition (see [components.md](components.md)) provides `create(props)`, which
returns one instance's `Behavior`:

```ts
interface Behavior<State> {
  /** Initial state; plain structured-clone-able data (for state preservation and snapshots). */
  createState?(): State;
  /** Called once when the simulator is built, before any events. */
  init?(ctx: EvalContext<State>): void;
  /** Called when nets this component reads changed (at most once per delta cycle). */
  evaluate?(ctx: EvalContext<State>): void;
  /** Called when a timer scheduled with ctx.wakeAfter() fires. */
  wake?(ctx: EvalContext<State>, token: number): void;
  /** External action from the UI or a test bench (press a button, flip a switch). */
  action?(ctx: EvalContext<State>, action: unknown): void;
}

interface EvalContext<State> {
  readonly now: Time;
  readonly state: State; // per-instance mutable state
  readonly id: string; // instance id, for messages
  read(pin: PinRef): Level; // current resolved level of the pin's net
  prev(pin: PinRef): Level; // level before the change in the triggering delta (= read if unchanged)
  changed(pin: PinRef): boolean; // did this pin's net change in the triggering delta?
  rose(pin: PinRef): boolean; // changed from exactly 0 to exactly 1
  fell(pin: PinRef): boolean; // changed from exactly 1 to exactly 0
  drive(pin: PinRef, drive: Drive, delay: Time): void;
  wakeAfter(delay: Time, token?: number): void;
  report(diagnostic: ComponentDiagnostic): void; // e.g. setup/hold violation
}
```

- `PinRef` is the index of a pin in the instance's pin list, so evaluation does no string
  lookups. An out-of-range index, driving a pin that has no driver (`in`, `power`, `nc`) or a
  negative delay throws — those are part bugs.
- **Edges are strict**: `X → 1` or `Z → 1` is not `rose`. Edge-triggered parts check
  `prev(clk)` to detect uncertain edges and should then drive `X` (pessimistic), so an
  undefined clock never hides.
- The simulator reuses **one** context object for all components; never keep it after the
  callback. Closures from `create(props)` may hold only immutable configuration; all mutable
  state lives in `ctx.state`.
- In `init` and `action` nothing counts as changed (`changed` is false, `prev` = `read`).

## Delays: inertial model

Every driver slot (an output-capable pin) has a current drive and at most one pending change.
`ctx.drive(pin, value, delay)`:

1. If a change is pending and its value equals `value` → keep the pending change (do not push it
   later).
2. Otherwise cancel any pending change; then, if `value` differs from the current drive, schedule
   `value` at `now + delay`.

Effect: input pulses shorter than a gate's delay are swallowed (inertial delay), as in real CMOS
gates; a pulse at least as long as the delay passes, shifted by it. A re-evaluation that confirms
an already-pending output doesn't postpone it. Per-transition delays (tPLH ≠ tPHL) are supported
by passing a different `delay` per call. Cancellation is lazy: the queue keeps the stale event and
the simulator skips it when popped.

## Event loop

Events live in a min-heap ordered by `(time, seq)`; `seq` is a global insertion counter, so
same-time events are processed in FIFO order (determinism). The heap is a struct of typed arrays
with recycled record ids: no allocation per event.

For each timestamp `t`, the engine runs **delta cycles** until no events remain at `t`:

1. Pop all events scheduled for `t` that were queued before the delta started.
2. Apply driver changes; re-resolve each touched net once.
3. For each net whose resolved level changed: record it (listeners), mark every reader component
   dirty.
4. Collect timer wake-ups.
5. Run callbacks once per affected component, in **ascending component index** order: first
   `wake(token)` for each timer that fired (in event order), then `evaluate` if a net it reads
   changed. Zero-delay drives schedule new events at `t` → next delta cycle.
6. If more than `maxDeltaCycles` (default **1000**, a `Simulator` option) delta cycles run at one
   timestamp, report an `oscillation` diagnostic and halt.

## Running

Core is driven explicitly; it has no notion of wall-clock time:

```ts
const sim = new Simulator(netlist, registry, { maxDeltaCycles: 1000, maxDiagnostics: 1000 });
```

- `runUntil(t, { maxEvents? })` — process events up to and including `t`; then `now = t`.
  Throws if `t < now`.
- `runFor(dt, options?)` — `runUntil(now + dt)`.
- `settle({ maxTime?, maxEvents? })` — run until the queue is empty (combinational settling);
  `now` is then the time of the last event. Limits default to 1 ms of simulated time and 1M
  events.
- `action(componentId, payload)` — deliver an external action at `now`; throws if the part has
  no `action` handler.
- `nextEventTime` — time of the earliest queued event (`Infinity` if none), for stepping to the
  next event; it may be a cancelled change, after which `stats.events` hasn't moved.
- `carryOver({ renames? })` — hand the simulation over to a recompiled netlist
  ([below](#editing-while-running-carry-over)).

Run status (`RunStatus`): `idle` (nothing left to do), `reached` (time limit reached, events
still pending — e.g. a clock), `budget` (event budget used up; checked between timestamps),
`halted` (oscillation; final for this simulator, every later run returns `halted`).

A **simulator host** outside core maps wall-clock to simulation time: the editor's `Simulation`
(R05, [editor.md](editor.md#simulation)) with speed presets, a frame budget and "can't keep up"
reporting, run/pause/step to the next event/stop/reset. Debugger conveniences (step to the next
clock edge, run until a breakpoint) come in R14 _(planned)_.

## Editing while running: carry-over

When the circuit is edited while it runs, the host compiles a new netlist and continues the
simulation in it (R05):

```ts
const next = new Simulator(netlist, registry, { carry: sim.carryOver({ renames }) });
```

The new simulator starts at the old one's `now`, keeps its statistics and continues the same
`DiagnosticLog`. Components are matched by id; `renames` (old id → new, from the editor) maps
parts that were renamed:

| Component in the new netlist     | Starts with                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| same id, type and resolved props | its state object, output drives, pending output changes (same times, same order) and timers; no `init` |
| same id and type, other props    | power-on state and `init`, but its outputs drive what they drove before (no `X` glitch)                |
| anything else                    | power-on                                                                                               |

Then, as at power-on, every component with `evaluate` is evaluated once at that time, so parts
react to changed connections. For an unchanged netlist this schedules nothing — `evaluate` with
nothing changed only re-drives what its outputs already drive or have pending
([components.md](components.md#behavior-guidelines)) — so **recompiling an unchanged netlist at
any instant doesn't change the run** (a property test in `tests/scenarios/carry-over.test.ts`).
A latch built from gates keeps its value, a clock its phase, a renamed switch its position. Nets
have no identity across compiles: their levels follow from the carried drives. State objects are
moved, not copied: the old simulator must not run afterwards.

An edit that doesn't change the structure (moving parts with their wires) needs no new
simulator at all: `sameNetlistStructure(a, b)` is true when both netlists have the same
components in the same order (id, type, props) and the same pins connected together, whatever
the net ids.

## Observability

- **Levels**: `sim.levels` is a `Uint8Array` with one resolved level per net (by net index),
  updated in place; read it every frame without copying. `sim.drives` holds the resolved drive
  (level + strength), e.g. to draw weakly pulled wires differently.
- **Lookups**: `netIndex(id)`, `netId(index)`, `netCount`, `componentIndex(id)`,
  `componentCount`, `pinNet(component, pin)`, `level(netIdOrIndex)`, `pinLevel(component, pin)`,
  `stateOf(component)` (inspection only).
- **Change listeners**: `onNetChange((time, net, level) => …)` returns an unsubscribe function;
  zero cost when nobody listens.
- **Diagnostics**: `sim.diagnostics` is a `DiagnosticLog`. Each entry is
  `{ time, kind, message, net?, component?, pin?, count, lastTime }` with kinds `contention`,
  `floating-input`, `oscillation` (`KernelDiagnosticKind`) and component-reported ones
  (`setup-violation`, `hold-violation`, …). Repeats with the same kind/net/component/pin are
  merged (`count`, `lastTime`); at most `maxDiagnostics` distinct entries are kept, the rest are
  counted in `dropped`. `subscribe(listener)` is called for each new entry.
  `contention` is reported when a net starts to conflict and again (merged) after it cleared.
- **Contention**: `sim.contended` is a `Uint8Array` with 1 for each net on which two strong
  drivers disagree right now (a short on real hardware), so a renderer can tell contention from
  an `X` that is merely unknown.
- **Stats**: `sim.stats` = `{ events, deltaCycles, evaluations }`; `sim.now`, `sim.halted`.
- **Inspection** _(planned, R12+)_: components may expose typed views of internal state (memory
  arrays, CPU registers) for UI panels, plus debug read/write that bypasses simulated timing.

## Test bench

`src/core/testing` provides utilities used by every part test (pure: failures are thrown as plain
`Error`s, no test-framework imports):

- `new Bench(definition, props?, options?)` wraps one part: every `in`/`bidir` pin gets a
  tri-state test driver (`test/driver`, released until set), and every net is named after its
  pin.
- `set({ A: 1, B: 0, OE: 'Z' })`, `settle()` (throws if halted), `run(dt)`, `get('Y')`,
  `levels()`, `expect({ Y: 1 })`, `mismatches(...)`, `expectNoDiagnostics()`, `action(payload)`.
  Values are `0`, `1`, `'X'`, `'Z'` (or `Level` constants).
- `measure({ A: 1 }, 'Y')` applies a stimulus and returns the delay until `Y` changes.
- `functionTable(bench, { inputs, outputs, rows }, pins?)` checks a datasheet function table
  written with datasheet letters: `H`, `L`, `X` = **don't care** (expanded to both levels), `Z`
  (outputs only; `X` in outputs is rejected). `pins` maps the columns (inputs, then outputs) to
  the bench's pins, so a part's generic table (`nA nB | nY`) checks each unit. All failing rows
  are reported together.
- `truthTable(bench, inputs, outputs, rows)` checks rows of simulator values, where `X` means
  unknown — for X/Z propagation tests.
- `new Trace(sim)` records every net change (`lines()`, `of(net)`, `hash()` for determinism
  checks).

## Planned extensions

- Setup/hold checking helpers for edge-triggered parts _(R09)_.
- Snapshot/restore of full simulator state (for "rewind" in the debugger) _(R14)_.
- Web Worker host with SharedArrayBuffer levels _(backlog)_.
- Fast mode for large synchronous designs (levelized/cycle-based evaluation) _(backlog)_.

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
- Timing data comes from datasheets: typical values at 25 °C under the conditions the part
  states (74HC: VCC = 4.5 V, CL = 50 pF; docs/components.md#timing). A future "worst case" mode
  may switch to max values.

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

- Flat: subcircuits never reach the kernel. The compiler expands them (R11a,
  [circuit.md](circuit.md#flattening)); an inner part's id is its instance path (`A1/U3`), which
  carry-over, actions, snapshots and the tools use like any id.
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
  level(pin: PinRef): Level; // the same, a Z not reported (see below)
  reportFloating(pin: PinRef): void; // a floating value read with level() was used
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
- `rose`/`fell` read the pin's current level like `read` does (a floating net is recorded as a
  `floating-input`); `changed` and `prev` don't. Code that only observes a pin uses those.
- `level` reads like `read` without reporting a `Z`, for a part that knows only afterwards
  whether it used the value — a Verilog module (HDL-8) reads every pin with it and calls
  `reportFloating(pin)` when a floating pin's `X` reached what it drives or stores. That records
  the `floating-input` as `read` would have (once until the net changes, never through a `sense`
  pin), even if the net is driven by now: a flip-flop samples the values from before its edge.
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
  events; a negative `maxTime` counts as 0 (time never runs backwards).
- `action(componentId, payload)` — deliver an external action at `now`; throws if the part has
  no `action` handler.
- `nextEventTime` — time of the earliest queued event (`Infinity` if none), for stepping to the
  next event; it may be a cancelled change, after which `stats.events` hasn't moved.
- `carryOver({ renames? })` — hand the simulation over to a recompiled netlist
  ([below](#editing-while-running-carry-over)).
- `requestBreak()` (R13) — stop the run in progress once the instant it is processing has
  finished all its delta cycles (status `break`, `now` at that instant; the next run goes on
  from there). Called from a net-change listener — a trigger (R13), a breakpoint (R14) — so a
  condition seen in the middle of an instant still lets the instant settle; asked between
  runs, the next run stops after the first instant it processes. The hot loop checks one flag
  per timestamp.
- `stopBefore: { net, level }` (R14, a `runUntil`/`settle` option) — stop **before** the
  instant at which the changes pending on the net's drivers make it change to `level`
  (status `before`, `now` at the last instant processed): a lookahead to a clock's next edge,
  for the debugger's Step Clock. The kernel keeps each driver's pending change time; the
  drives due then are resolved with the others, so a change that keeps the level is none. Only
  changes queued before the instant count — one a part makes with zero delay during the
  instant itself can't be seen ahead (a gate's output is seen one delay ahead). The power-on
  instant is always processed. Without the option the loop checks nothing.

Run status (`RunStatus`): `idle` (nothing left to do), `reached` (time limit reached, events
still pending — e.g. a clock), `budget` (event budget used up; checked between timestamps),
`break` (`requestBreak()` was called; the editor's host pauses on it), `before` (stopped
before the `stopBefore` change), `halted` (oscillation; final for this simulator, every later
run returns `halted`).

A **simulator host** outside core maps wall-clock to simulation time: the editor's `Simulation`
(R05, [editor.md](editor.md#simulation)) with speed presets, a frame budget and "can't keep up"
reporting, run/pause/step to the next event/stop/reset, the debugger's steps (Step Clock by
`stopBefore`, Run For, Run To) and breakpoints (R14, [editor.md](editor.md#debugger)), and
rewinding through a history of [snapshots](#snapshots) (R14b,
[editor.md](editor.md#rewinding)).

## Timing checks

`TimingChecks` (`src/core/timing-checks.ts`, R09a) checks an edge-triggered part's inputs
against the data sheet minima in its `timing.min` ([components.md](components.md#timing)):

```ts
const checks = new TimingChecks(pins, min); // in the definition's closure
const data = checks.setupHold({
  data: 'D0, D1',
  clock: 'CP',
  edge: 'rise',
  setup: 'tsu(Dn to CP)',
  hold: 'th(Dn to CP)',
});
const width = checks.pulseWidth({ pin: 'CP', level: 'both', width: 'tW(CP)' });
const recovery = checks.recovery({
  pin: 'MR',
  active: 'low',
  clock: 'CP',
  edge: 'rise',
  recovery: 'trec(MR to CP)',
});
// createState: { …, times: checks.createTimes() }
// evaluate: const late = data.setup(ctx, times, armed); …; checks.track(ctx, times);
```

| Check              | Fires when                                                                 | Returns                   |
| ------------------ | -------------------------------------------------------------------------- | ------------------------- |
| `setup`            | at the active edge, a data input changed less than `tsu` before it         | bit mask of the data pins |
| `hold`             | a data input changes less than `th` after the last active edge             | bit mask of the data pins |
| `pulseWidth.check` | the pin ends a HIGH and/or LOW phase shorter than `tW`                     | true                      |
| `recovery.check`   | the active edge comes less than `trec` after the pin left its active level | true                      |
| `cycle.check`      | the pin makes its active edge less than `tcyc` after its previous one      | true                      |

- Each reports a diagnostic (`TimingViolation`: `setup-violation`, `hold-violation`,
  `pulse-width-violation`, `recovery-violation`, `cycle-violation` — the LCD's `tcycE`, later a
  CPU's `tCYC`; `isTimingViolation(kind)`) on the pin at fault
  and returns what failed, so the part can make the bits it may have loaded `X`
  ([ADR-0014](adr/0014-timing-checks.md)). Data and clock changing at the same instant is one
  set-up violation.
- A Verilog module declares its checks from its `specify` block (HDL-2; `module-checks.ts`, keys
  `limit0`, `limit1`, …), and the kernel merges repeats of one kind on one pin into one
  diagnostic (`count`): two hold checks failing on one pin are one entry
  ([components.md](components.md#timing-from-specify)).
- The per-instance state is a `Float64Array` (`PinTimes`) of each watched pin's last change and
  of when it last left LOW and HIGH — absolute times, so a carry-over keeps them. `track` records
  them from `changed`/`prev` only (it observes, it doesn't read), after the checks.
- A phase counts from the pin leaving the opposite level: one that began from `Z`/`X` only
  (power-on) is not a pulse.
- `armed` (`false` skips the check) lets a part ignore requirements of a clock it ignores: held
  in reset, loading disabled.
- Variants of `setupHold` (R09b): `dataEdge` counts only that transition of a data pin, for a
  requirement between two edges (74HC595 `tsu(SHCP to STCP)`: SHCP rising to STCP rising;
  message `SHCP rose 8 ns before STCP rose …`); `sameInstantAllowed` exempts a change at the
  same instant as the edge, for a documented mode (the 595's clocks tied together); `setup` may
  be omitted when the data sheet gives only a hold time (the 74HC193's other clock must stay
  HIGH after the counting edge).
- The forced evaluation (power-on, recompile) changes nothing, so it neither fires a check nor
  records a time: the carry-over property holds with the checks (the property test compares the
  timing violations of the plain and recompiled runs too).
- Cost: a 74HC574 pipeline runs at ≈ 5.5M events/s with the checks, ≈ 6.7M without (R09a,
  `pnpm bench`).

## Editing while running: carry-over

When the circuit is edited while it runs, the host compiles a new netlist and continues the
simulation in it (R05):

```ts
const next = new Simulator(netlist, registry, { carry: sim.carryOver({ renames }) });
```

The new simulator starts at the old one's `now`, keeps its statistics and continues the same
`DiagnosticLog`. Components are matched by id; `renames` (old id → new, from the editor) maps
parts that were renamed:

| Component in the new netlist                 | Starts with                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| same id, type, definition and resolved props | its state object, output drives, pending output changes (same times, same order) and timers; no `init` |
| same id and type, other props or definition  | power-on state and `init`, but its outputs drive what they drove before (no `X` glitch)                |
| anything else                                | power-on                                                                                               |

The definition is compared as an object: a part's definition is the same as long as its
registry serves the same one — always for the library's parts; a Verilog module compiled again
(HDL-1) is a new definition under the same type, whose state has another shape, so its
instances start from power-on while the rest of the circuit runs on.

Then, as at power-on, every component with `evaluate` is evaluated once at that time, so parts
react to changed connections. For an unchanged netlist this schedules nothing — `evaluate` with
nothing changed only re-drives what its outputs already drive or have pending
([components.md](components.md#behavior-guidelines)) — so **recompiling an unchanged netlist at
any instant doesn't change the run** (a property test in `tests/scenarios/carry-over.test.ts`).
A latch built from gates keeps its value, a clock its phase, a renamed switch its position. Nets
have no identity across compiles: their levels follow from the carried drives. State objects are
moved, not copied: the old simulator must not run afterwards.

An edit that doesn't change the structure (moving parts with their wires) nor any part's
definition needs no new simulator at all (the editor's host checks both, HDL-1):
`sameNetlistStructure(a, b)` is true when both netlists have the same components in the same
order (id, type, props) and the same pins connected together, whatever the net ids.

## Snapshots

`sim.snapshot(base?)` (R14b) takes the whole state of a simulation between runs, and
`sim.restore(snapshot)` puts the simulation back there, so it runs on exactly as it did from
that point ([ADR-0021](adr/0021-rewind.md)):

```ts
const snap = sim.snapshot();
sim.runUntil(us(50));
sim.restore(snap); // back at the snapshot's time; the same run follows
const copy = sim.replica(); // the same netlist, its own listeners, at power-on
copy.restore(snap); // replays run here, unseen by whatever watches `sim`
sim.restore(copy.snapshot());
```

- **What a snapshot holds**: time, statistics, whether power-on was processed (a snapshot
  before it processes it again), `halted` (rewinding out of an oscillation halt works; it comes
  back at the same instant), every net's level, drive, contention and floating-input mark,
  every driver slot's drive and pending change, the event queue (in heap order, with its seq
  counter: same-time events keep their FIFO order and later ones get the seqs they got), every
  component's state and the diagnostic log's entries and counts. Not the per-delta stamps: the
  delta id keeps counting across a restore, so no stale stamp can match a later delta.
  Listeners are not part of it, and a restore calls none of them (whoever watches catches up).
- **Component states** are frozen copies (`freezeState` in `state-copy.ts`): plain data —
  objects, arrays, primitives, typed arrays — as `createState` promises; a `Map`, a class
  instance, a function or an object reached twice throws, naming where. Typed arrays are kept
  in 4 KiB pages, and a page equal to the one at the same place in `base` (the snapshot before)
  is shared: a 62256 and a 28C256 whose cells and stamps didn't change cost 1.7 KiB instead of
  1.1 MB. Restore writes into the live state objects where the shape is the same (views onto
  them — the memory inspector's, the indicators' samples — stay valid). `snapshot.bytes` is
  what a snapshot holds of its own; `snapshotBytes(s, relativeTo)` recounts it against
  another (a history dropping the one between).
- **Replicas**: a snapshot restores into the simulator it came from or a `replica()` of it
  (same netlist, same layout token); anything else throws. Taking or restoring one during a run
  (from a listener) throws.
- **Diagnostics**: entries are only ever appended and counted, so a snapshot shares the entry
  objects and copies the counts; restore truncates and resets in place, keeping an entry for
  the same report as the same object.
- **Cost** (M3 Pro): 0.7–4.4 KiB and 3–31 µs a snapshot for the examples, a restore 1–8 µs.
- **The property** (`tests/scenarios/rewind.test.ts`): on every example with seeded actions
  (switches, buttons, DIP switches, manual clocks, RAM pokes, two actions at one instant) and
  on every registered part, a simulation rewound through a replica to an instant is the
  straight run's there — levels, drives, contention, the queue's head, statistics, diagnostics,
  part states — and runs on to the same end.

## Observability

- **Levels**: `sim.levels` is a `Uint8Array` with one resolved level per net (by net index),
  updated in place; read it every frame without copying. `sim.drives` holds the resolved drive
  (level + strength), e.g. to draw weakly pulled wires differently.
- **Lookups**: `netIndex(id)`, `netId(index)`, `netCount`, `componentIndex(id)`,
  `componentCount`, `pinNet(component, pin)`, `level(netIdOrIndex)`, `pinLevel(component, pin)`,
  `stateOf(component)` (inspection only).
- **Change listeners**: `onNetChange((time, net, level) => …)` returns an unsubscribe function;
  zero cost when nobody listens. `onInstant((time) => …)` (R13) is called after each instant
  has finished all its delta cycles, before a run checks for a break: a condition on several
  nets sees the instant's final levels there and can still `requestBreak()` at it.
- **Diagnostics**: `sim.diagnostics` is a `DiagnosticLog`. Each entry is
  `{ time, kind, message, net?, component?, pin?, count, lastTime }` with kinds `contention`,
  `floating-input`, `oscillation` (`KernelDiagnosticKind`) and component-reported ones
  (`setup-violation`, `hold-violation`, `pulse-width-violation`, `recovery-violation`
  from the [timing checks](#timing-checks); a Verilog module's `setup-violation`,
  `race-violation` and `oscillation`, HDL-9, …). Repeats with the same kind/net/component/pin are
  merged (`count`, `lastTime`); at most `maxDiagnostics` distinct entries are kept, the rest are
  counted in `dropped`. `subscribe(listener)` is called for each new entry.
  `diagnosticSeverity` makes `contention`, `oscillation`, every kind ending in `-violation`
  (the timing checks', an LCD's `busy-violation`, a module's `race-violation`) and `cpu-lost`
  (a CPU acting on unknown bits, R17a) errors, the rest warnings.
  `contention` is reported when a net starts to conflict and again (merged) after it cleared.
  `onOccurrence(listener)` (R14) is called for every report — repeats of a merged entry and
  dropped ones included — so a debugger can break on each.
- **Contention**: `sim.contended` is a `Uint8Array` with 1 for each net on which two strong
  drivers disagree right now (a short on real hardware), so a renderer can tell contention from
  an `X` that is merely unknown.
- **Stats**: `sim.stats` = `{ events, deltaCycles, evaluations }`; `sim.now`, `sim.halted`.
- **Inspection** (R12a, R12b): a memory part's definition has `memory` (`MemoryDef`: words,
  width, volatile, `addressPins`, `view(state)` → `{ data, unknown, readAt, writtenAt }`), a view
  of the instance's cells and of when each was last read and written (simulated time, stamped
  by the part), read through `sim.stateOf(id)` without copying; RAMs take a debug write, the
  action `{ type: 'poke', address, data }` (`PokeAction`), that bypasses their timing
  ([components.md](components.md#memories-mem)). A Verilog module lists its memories as
  `memories` (HDL-6, [ADR-0036](adr/0036-memories-in-modules.md)): named, words up to 32 bits, a
  first address (`offset`), `powerUp` contents; its pokes carry the memory's name. The editor's Memory tab is built on them
  ([editor.md](editor.md#memory-inspector)); parts and nets are found by reference through the
  resolver ([circuit.md](circuit.md#resolver)). A CPU part's definition has `cpu` (`CpuDef`,
  R17a: its registers — name, width, a status register's flag letters `NV-BDIZC` — the program
  counter's name, the address and data pins, and `view(state)` → register values with their
  unknown bits, the mode `running` / `reset` / `waiting` / `stopped` / `unknown`, and the
  instruction under way: where its opcode was fetched, the opcode, the cycle in it); the
  registry checks it (`cpuProblems`). The CPU tab and watches on registers come with R17b
  _(planned)_.
- **Reproducible randomness**: `SeededRandom` (mulberry32) and `hashString` (FNV-1a) in core;
  parts seed it from what identifies them (a RAM's random power-on contents from its
  designator), never from `Math.random`.

## Recorder

`Recorder` (`src/core/recorder.ts`, R13) keeps the levels of chosen nets — and bits inside parts
(HDL-4, [below](#inner-signals)) — over simulated time, the data behind the waveform view
([editor.md](editor.md#waveforms)) and the debugger's breakpoints (R14):

```ts
const recorder = new Recorder({ budget: 4_000_000 }); // changes kept across every channel
const clk = recorder.addChannel();
recorder.attach(sim, new Map([[clk, sim.netIndex('CLK')]])); // channel → net index or InnerBit
sim.runUntil(ms(1));
recorder.level(clk, us(500)); // Level at that instant (undefined where there is no data)
recorder.nextChange(clk, us(500)); // time of the next edge
```

- **Channels**, not nets: nets have no identity across compiles, so after a carry-over the
  caller re-resolves what each channel shows and attaches the new simulator; the record goes
  on. A channel left out of an `attach` gets no data from that instant (`NO_DATA`), one given a
  net again resumes; `attachChannel` adds one while running; `detach` ends the record at `now`
  (Stop); `clear` forgets it (power-on). Several channels may show one net. A fresh channel
  attached at an instant after 0 records its first level 1 ps before it (R14): the level going
  into the rest of the instant, so a change still made then — an action while paused — is an
  edge a trigger sees, not merged into the first level.
- **One instant, one level**: changes at the same instant (delta cycles) collapse into its last
  level, and a change back to the level before the instant leaves nothing — a zero-delay delta
  is not a pulse a real circuit makes.
- **Bounded**: past the budget the oldest changes are dropped (down to three quarters of it),
  each channel keeping the last change before the cut, and `start` moves forward: the earliest
  instant every channel still knows.
- **Queries**: `level(channel, t)`, `indexAt`, `nextChange`/`prevChange` (and `…Of(channels)`
  for a bus or a group), `lastChange` (O(1)), raw access (`changeCount`, `changeTime`,
  `changeLevel`). The waveform view draws from them one pixel column at a time
  (`rowSegments`), a few binary searches a column, so a fast clock zoomed out costs no more
  than a slow one.
- **Cost**: no listener without channels; with them, one call per changed net that looks the net
  up in an `Int32Array`. Ring oscillator benchmark: 13.7M events/s, 13.2M recording 16 of its
  1001 nets, 8.7M recording all of them (R13).
- **Bits inside parts** (HDL-4): a channel's source (`ChannelSource`) is a net's index or an
  `InnerBit` (`{ part, signal, bit }`: a bit of a part's named signal, [below](#inner-signals)).
  Such a bit changes inside its part's evaluation, not on a net, so it is **sampled at the end of
  each instant** (`onInstant`; `sample()`, which reading again at one instant leaves as it is) —
  the same one level per instant a net's channel keeps. The recorder listens for instants only
  while it has such channels; a `Trigger` samples first, whatever the order of the listeners. A
  bit a simulator doesn't have (a recompiled module that lost the signal) gets no data. The
  1 024-cell module of `tests/bench/hdl.bench.ts` with 16 bits inside recorded: 12.0k against
  12.3k evaluations/s.
- **Across a rewind** (R14b): `seek(t, present)` after the attached simulator was restored to
  `t` keeps the record after `t` — the future a run from `t` repeats, up to `present` (the
  caller's: after a restore `now` no longer says how far it reached). While the run is behind
  it (`replaying`), a change at or before `present` is confirmed — a cursor per channel moves
  over the record, which has that instant collapsed already — instead of recorded again;
  `lastChange` answers at the cursor, `end` is the present, queries see the whole record. A
  channel added meanwhile records as usual; past the present recording goes on; a trim never
  reaches past `now`. `cut(t)` drops every change after `t` when the run leaves its recorded
  future.

## Inner signals

HDL-4 ([ADR-0035](adr/0035-inner-signals.md), `src/core/inner-signals.ts`): a part may show named
signals inside it — a Verilog module's registers and wires by their source names — through a view
on its definition, as memories (`memory`) and CPUs (`cpu`) show their contents:

```ts
definition.signals = {
  list: [{ name: 'state', lsb: 0, width: 2, src: 'traffic.v:11.13-11.18' }],
  level: (state, signal, bit) => Level.L1, // an instance's bit now, from its state; no copy
};
sim.definitionOf('A1/U1')?.signals; // the view of a part the simulator runs
innerReader(sim, { part: 'A1/U1', signal: 0, bit: 1 })?.(); // one bit's level now
```

- Not nets: nothing is driven or scheduled, the kernel doesn't know them. The recorder samples
  them at the end of each instant (its [bits inside parts](#recorder)); watches and test benches
  read them when asked.
- Their timing is the part's: a Verilog module's register changes at its clock edge's instant,
  inside its evaluation, and its pins follow after the module's delay — the waveforms show both,
  as a logic analyzer on a board's test point would.
- The registry checks a view: names given and unique, widths of 1 or more, integer `lsb`.
- Step Clock can't step by one: it stops before an edge the kernel has queued on a net
  ([ADR-0020](adr/0020-debugger.md)), and a signal inside a part has nothing queued.

## Triggers

`Trigger` (`src/core/trigger.ts`, R13) is a logic analyzer's trigger on recorder channels: a
condition is an AND of terms, at most one of them an edge ("pattern and one edge"):

| Term                   | Holds when                                                                      |
| ---------------------- | ------------------------------------------------------------------------------- |
| `rise`, `fall`, `edge` | the channel went exactly 0 → 1 (1 → 0, either) at this instant; `X → 1` is none |
| `level`                | the channel is at `0`, `1`, `X` or `Z`                                          |
| `equal`, `notEqual`    | the channels (bit 0 first) read the hex `value`; `X` digits are don't care      |

```ts
const trigger = new Trigger(
  recorder,
  [
    { kind: 'rise', channel: clk },
    { kind: 'equal', channels: bus, value: '3F' },
  ],
  (time) => sim.requestBreak(),
);
trigger.attach(sim); // armed; attach the new simulator after a carry-over
```

- Evaluated in `onInstant`, only at instants where one of its channels changed, from the
  recorder's levels: a glitch inside one instant (collapsed by the recorder) never fires it. It
  has the recorder sample its bits inside parts first (HDL-4).
- Fires **once** (single shot) and disarms: at the edge while the other terms hold, or —
  without an edge term — when the pattern **becomes** true (one already true when armed waits
  until it has been false). With `{ repeat: true }` (R14's breakpoints) it fires at every such
  instant and stays armed. Never twice at one instant: a carry-over at the instant it fired
  processes that instant again.
- `resync(now)` (R14b): after a rewind, the condition as it was at `now` (a pattern that held
  then must become false before it fires again), and a fire after `now` no longer blocks
  firing there again.
- Values: digits not written are 0, as in a number (`5` on eight bits is `0x05`, `X5` leaves the
  high nibble free); a bit that is `X` or `Z` matches no 0 or 1, so `notEqual` holds while it
  is. `conditionProblems(condition)` and `parseHexPattern(text, width)` give the reasons a
  condition can't be armed.
- The editor's analyzer arms it and turns its firing into a pause ([editor.md](editor.md#waveforms));
  R14's breakpoints are the same conditions without the analyzer.

## VCD export

`writeVcd(recorder, signals, options)` (`src/core/vcd.ts`, R13) writes a Value Change Dump
(IEEE 1364 §18), which GTKWave, Surfer, PulseView and HDL tools read:

```ts
writeVcd(
  recorder,
  [
    { name: 'CLK', channels: [clk] }, // a 1-bit wire
    { name: 'D[0..7]', channels: bus }, // a vector, bit 0 first
  ],
  { from: us(10), to: us(20), scope: 'Data Bus', date, version },
);
```

```text
$timescale 1ps $end
$scope module Data_Bus $end
$var wire 1 ! CLK $end
$var wire 8 " D [7:0] $end
$upscope $end
$enddefinitions $end
#10000000
$dumpvars
0!
b00111111 "
$end
#10500000
1!
…
#20000000
```

- Times are absolute picoseconds (`$timescale 1ps`), as the app shows them; the range defaults
  to the whole record (`start` … `end`), its values at `from` go in `$dumpvars`, and a last `#to`
  marks its end.
- Names are made VCD-safe (`vcdName`): `~{RD}` → `RD_n`, a bus's `[0..7]` dropped (the vector's
  `[7:0]` says it), `U1.Q0` → `U1_Q0` (readers take `.` for a scope), other characters → `_`;
  repeated names get `_2`, `_3`. Identifiers count through printable ASCII (`vcdIdentifier`).
- `0`, `1`, `x`, `z` per bit; no data is `x`; a change that writes what the dump already shows
  (`X`, then no data) is left out.
- `date` and `version` come from the caller: core never reads the clock.

## Test bench

Two kinds: **circuit test benches** test a circuit of a document from a JavaScript test script
in it, headless and (R15b) in the app — the user's, in `circuit`
([circuit.md](circuit.md#test-benches), R15a); and **core's `Bench`** below tests one part —
the library's, for every part's data sheet tests. Both drive inputs with core's `testDriver`
(`test/driver`: a tri-state source set by an action, released until set).

`src/core/testing` provides utilities used by every part test (pure: failures are thrown as plain
`Error`s, no test-framework imports):

- `new Bench(definition, props?, options?)` wraps one part: every `in`/`bidir` pin gets a
  tri-state test driver (`test/driver`, released until set), and every net is named after its
  pin.
- `set({ A: 1, B: 0, OE: 'Z' })`, `settle()` (throws if halted), `run(dt)`, `get('Y')`,
  `levels()`, `expect({ Y: 1 })`, `mismatches(...)`, `expectNoDiagnostics()`, `action(payload)`.
  Values are `0`, `1`, `'X'`, `'Z'` (or `Level` constants).
- `measure({ A: 1 }, 'Y')` applies a stimulus and returns the delay until `Y` changes.
- `functionTable(bench, { inputs, outputs, rows }, pins?, options?)` checks a datasheet function
  table written with datasheet letters: `H`, `L`, `X` = **don't care** (expanded to both levels),
  `Z` (outputs only; `X` in outputs is rejected). `pins` maps the columns (inputs, then outputs)
  to the bench's pins, so a part's generic table (`nA nB | nY`) checks each unit. All failing rows
  are reported together. Sequential tables (`↑`, `↓`, `h`, `l`, previous-state outputs `q`/`q̅`
  through the table's `state` map) run step by step with `options.gap` (default 1 µs) between
  data, clock pins and the transition; `options.states` lists the steps that load the states a
  previous-state row is checked from ([components.md](components.md#function-tables)).
- `truthTable(bench, inputs, outputs, rows)` checks rows of simulator values, where `X` means
  unknown — for X/Z propagation tests.
- `new Trace(sim)` records every net change (`lines()`, `of(net)`, `hash()` for determinism
  checks).

## Planned extensions

- Web Worker host with SharedArrayBuffer levels _(backlog)_.
- Fast mode for large synchronous designs (levelized/cycle-based evaluation) _(backlog)_.

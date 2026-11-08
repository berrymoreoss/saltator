# Lessons

Append-only log of non-obvious things learned while building this project: tool quirks, kernel
subtleties, datasheet traps. One entry per lesson, newest last. Don't record what the code or docs
already make obvious.

Format: `- YYYY-MM-DD (branch) — lesson. Why it matters / what to do instead.`

- 2026-11-06 (R00) — pnpm 12 rejects `pnpm -s <script>`; use `pnpm <script>` or call the binary
  directly. Matters when writing scripts and CI steps.
- 2026-11-06 (R00) — TypeScript here is v7 (native compiler) with `erasableSyntaxOnly`: no `enum`,
  `namespace` or constructor parameter properties. Use `as const` objects + union types.
- 2026-11-06 (R00) — `scripts/*.ts` run directly with `node` (native type stripping), so they must
  use erasable syntax only and import local files with explicit `.ts` extensions.
- 2026-11-06 (R00) — Biome 2.6 also formats Markdown (`pnpm lint:fix` realigns tables, turns
  `*x*` into `_x_`). Run it after editing docs, or `pnpm lint` fails.
- 2026-11-06 (R01) — Vitest 5 has no `bench` export: benchmarks are `test(name, async ({ bench })
  => { await bench(name, fn).run(); })` in `*.bench.ts`, run by `vitest bench`; tables and
  console output only show with `--reporter=verbose`.
- 2026-11-06 (R01) — Vite's module runner (vitest default) turns every imported binding into a
  getter, making kernel hot loops ~3× slower than the real bundle. Benchmark on native `import`
  (`pnpm bench` does: `--experimental.viteModuleRunner=false` + `scripts/resolve-hooks.ts`);
  never tune the kernel to numbers taken under the module runner.
- 2026-11-06 (R01) — In 4-state simulation a feedback loop that starts at `X` stays `X`
  (`not X = X`): a plain inverter ring never oscillates. Start oscillators through a NAND with an
  enable; latches need a set/reset. This is the intended "missing reset" lesson, not a bug.
- 2026-11-06 (R02) — The layer check applies to test files too: `src/circuit/*.test.ts` may not
  import `library`. Circuit unit tests use local parts from `src/circuit/test-parts.ts`;
  anything needing real parts goes to `tests/scenarios/`.
- 2026-11-06 (R02) — Biome's `useIterableCallbackReturn` rejects `forEach((x) => arr.push(x))`
  (the arrow returns push's result). Use `for … of` (or a block body) for side-effect loops.
- 2026-11-06 (R02) — With "everything touching connects", a wire laid along a row of pin tips
  (e.g. towards a rotated part) connects to every pin it passes. When drawing circuits in code or
  tests, approach pins head-on; check `compileCircuit(...).nets` if a result looks odd.
- 2026-11-06 (R02) — `Trace.hash()` mixes net **indices**, so it only compares runs of the same
  netlist. To compare differently built netlists (document vs `NetlistBuilder`), compare
  `trace.lines()` (net ids) and make the net ids match.
- 2026-11-06 (R02) — Biome formats `.json` files and `json`/`jsonc` fences inside Markdown, which
  destroys the one-line-per-item layout of `serializeDocument`. Show the file format in docs with a
  `text` fence; exclude saved example documents (R07) from Biome.
- 2026-11-06 (R03) — Biome's `useIterableCallbackReturn` also fires on a `map` callback whose
  exhaustive `switch` returns in every case (it doesn't see exhaustiveness). Move the `switch`
  into a helper function that returns the value.
- 2026-11-06 (R03) — Gate commits on the exit code: `pnpm check | tail` or `pnpm check; git
  commit` commits red. Use `pnpm check > log && git commit …`.
- 2026-11-06 (R03) — The registry validates pins and symbols with the **default** props. A test
  that needs a broken pin list for `resolveNetlist` must make it depend on a non-default prop.
- 2026-11-06 (R04a) — Playwright's `webServer.command` must not start the server through
  `pnpm exec`: pnpm moves it out of the process group Playwright kills, so the run hangs after
  the tests (or leaves an orphan on the port). Call `node_modules/.bin/vite` directly.
- 2026-11-06 (R04a) — Biome's a11y rules can't see a role chosen by an expression
  (`role={checked ? 'menuitemcheckbox' : 'menuitem'}`) and then flag `aria-checked` on a
  `<button>`. Render the two cases as separate elements with literal roles.
- 2026-11-06 (R04a) — The first canvas frame is slow (fonts, JIT: ~13 ms where steady frames take
  ~1 ms). Measure redraw time as the median of many frames, not the first one.
- 2026-11-06 (R04a) — Without the Chrome extension, look at the UI with a Playwright script in the
  scratchpad (`chromium.launch()`, `colorScheme`, `deviceScaleFactor: 2`, `page.evaluate` to
  drive `window.logicEditor` in dev builds) and read the PNG back.
- 2026-11-06 (R04b) — Merging collinear wires is not connectivity-neutral at crossings: two
  segments ending on a crossing wire connect to it, one run through it doesn't — and two corners
  meeting at a point would merge into an unconnected crossing. `normalizeWires` splits there; any
  future wire rewrite must keep the property test in `edit.test.ts` green.
- 2026-11-06 (R04b) — A stub wire from a fixed pin that runs sideways along the part connects to
  every pin tip it passes (e.g. U1.A's stub down to U1.B). New wires leave pins head-on, one cell
  out before turning (`move.ts`).
- 2026-11-06 (R04b) — Keep the `Editor`'s gesture logic on plain `PointerInput` values and the DOM
  code to thin adapters: drag, wire, place and paste gestures then run in Node tests (dozens of
  cases) instead of only in slow, coordinate-fiddly browser tests.
- 2026-11-06 (R04b) — Playwright treats a zero-size element as hidden: a `position: fixed`
  wrapper whose only child is `position: absolute` fails `toBeVisible()` though the menu shows.
  Let the content size the wrapper. Also, a row's accessible name includes its shortcut text
  (`Rotate R`): match menu items with a regex.
- 2026-11-06 (R04b) — Menu paste is asynchronous (`navigator.clipboard.readText`): a browser test
  must wait for the floating state (status hint) before clicking to drop, or the click lands
  first. Playwright e2e specs can import `src/` modules (layouts) directly to compute pin
  positions.
- 2026-11-07 (R05) — Two actions on one part at the same instant cancel out: the second drive
  replaces the pending first (inertial delay), so "toggle, toggle" with no time between does
  nothing. Tests (and test benches) must let time pass between actions they want to see.
- 2026-11-07 (R05) — The host refreshes `status` and `diagnostics` at most every 100 ms of wall
  time while running: a fake-clock test must run ≥ 7 frames of 16 ms before reading them (state
  changes, steps and actions refresh at once).
- 2026-11-07 (R05) — Playwright names: a toolbar button's accessible name is the command's
  `title` (falling back to `label`), and a menu command with `checked` is a `menuitemcheckbox`,
  not a `menuitem`. In Properties rows the label and value texts run together ("Ain SW1.Y"):
  match the `.prop-label` exactly instead of a `^A\b` regex on the row.
- 2026-11-07 (R05) — `Simulator.carryOver` relies on `evaluate` being idempotent with nothing
  changed; the invariance property test (`tests/scenarios/carry-over.test.ts`) catches a part
  that counts or toggles in `evaluate`, and was mutation-checked (shifting carried timers or
  re-running `init` fails it). Keep it green when the kernel or parts grow.
- 2026-11-07 (R06) — The forced `evaluate` at power-on and after a recompile is not a "nothing
  changed" call: inputs changed by t = 0 `init`/action events (or by the edit) show as changed
  in the same delta. Never skip parts of a multi-section chip because their inputs didn't
  change; evaluate every section (re-driving an unchanged output schedules nothing).
- 2026-11-07 (R06) — Nexperia's asset server answers 403 to WebFetch and curl; don't work around
  it — ask the user to download the PDFs. `pdftotext -layout` keeps their tables readable
  (`file` reports bogus page counts for them). Typical `ten`/`tdis` are given only at 2.0, 4.5
  and 6.0 V, hence the 4.5 V / 50 pF convention.
- 2026-11-07 (R06) — For visual checks without the Chrome extension, run
  `node_modules/.bin/vite --port 5199` in the background and a Playwright script from the
  scratchpad that imports `node_modules/@playwright/test/index.mjs` by absolute path (pnpm
  doesn't hoist `playwright` itself); drive `window.logicEditor` (`setCamera`, `setSelection`).
- 2026-11-07 (R07) — IndexedDB writes started in `pagehide` don't finish before the page goes
  away: a reload within a debounce lost the last edit. Write unload state synchronously
  (`localStorage`) and fold it into IndexedDB at the next start; don't let a debounce keep
  pushing a pending write back (bound the latency instead).
- 2026-11-07 (R07) — The app awaits IndexedDB before its first render (top-level await), so
  `page.goto` resolves before keys are handled: a key pressed right away is lost. Browser tests
  load through `openApp` (waits for the canvas). A second tab restores the latest session,
  which may be unsaved: File ▸ New then asks "Save changes?" (`newCircuit` answers it).
- 2026-11-07 (R07) — Stub the File System Access pickers in Playwright with handles from the
  origin private file system (`navigator.storage.getDirectory()`): real `FileSystemFileHandle`s
  that IndexedDB can store (plain objects with functions can't be cloned) and that survive a
  reload. Test files are typed without Node: no `Buffer` — read a download with `for await`
  over `createReadStream()`, hand a file to `setFiles` by path (`download.saveAs`), list files
  with `import.meta.glob` instead of `fs`.
- 2026-11-07 (R07) — Chrome never gives `Mod+N`/`Mod+T`/`Mod+W` to a page, and Option on a Mac
  changes `event.key` (⌥N is a dead `˜`): shortcuts with Alt match the physical key
  (`event.code`).
- 2026-11-07 (R07) — Laying out a circuit with DIP chips by hand: write it with
  `CircuitBuilder` in a throwaway script that also checks the compiled nets against the
  intended ones, then look at it in the browser (labels of rotated LEDs sit to their right and
  run into nearby wires). Save the result as a file; from then on the file is the source.
- 2026-11-07 (R08) — TI's ex-Harris CD74HC data sheets (CD74HC147, CD74HC283, …) give typical
  delays only at 5 V / 15 pF, maxima at 4.5 V / 50 pF; SN74HC sheets give both. Check before
  choosing a TI sheet for the 4.5 V / 50 pF convention; the Philips 74HC sheets (1990) have the
  typical values and the same JEDEC maxima.
- 2026-11-07 (R08) — `pdftotext -layout` drops overlines: `Y` and `Y̅` (74HC151) read the same and
  active-low headings look plain. Render the pinning and table pages (`pdftoppm -f N -l N -r 90
  -png`) and look; trust the pinning figure over a pin table (TI's CD74HC147 table calls output
  pin 9 an input).
- 2026-11-07 (R08) — Biome's `usePlaywrightValidDescribeCallback` fires on any call
  `describe('…', notAFunction)`, even a local helper in library code: don't name helpers
  `describe`. `noApproximativeNumericConstant` flags a data sheet's 0.693 (it wants `Math.LN2`):
  keep the data sheet constant once, with a `biome-ignore` giving the reason.
- 2026-11-07 (R08) — A free-running part (an astable 555, `io/clock`) never lets `Bench.settle`
  finish: run it for a time (`bench.run(dt)`) and record edges with `sim.onNetChange`.
- 2026-11-07 (R08) — Throwaway generators for example files run as a vitest file in
  `tests/scenarios/` (Node can't import the extensionless `src` paths directly) and write the
  file with `node:fs`; check every net there (`compileCircuit(…).nets`), then delete the
  generator. The Clock Module's 85 wires came out right the first time this way.
- 2026-11-07 (R09a) — `ctx.rose`/`ctx.fell` call `readPin`, so on a floating net they record a
  `floating-input` like `ctx.read`. Code that only watches a pin (timing checks tracking every
  data input) must use `ctx.changed` + `ctx.prev`, or it reports inputs nobody used.
- 2026-11-07 (R09a) — Function tables with don't-care clocks or set/reset rows trip a part's own
  timing checks if the checker sets everything at once (data and clock at one instant is a
  set-up violation). The checker sets data, then `clock` pins, then the transition, 1 µs apart;
  and a part's clock checks must be disarmed while set/reset holds it.
- 2026-11-07 (R09a) — `vitest run` doesn't typecheck: tests can pass while `tsc` rejects literal
  types (`{ R: 0 }[]` not assignable to `BenchValues[]`). Annotate stimulus arrays
  (`BenchValues[]`, `as const`) and run `pnpm check`, not just `pnpm test`, before committing.
- 2026-11-07 (R09a) — Nexperia data sheets differ in their dynamic table columns: most give
  min/typ/max at 25 °C plus −40…+85 and −40…+125, the 74HC74 (rev. 9) only −40…+85 (typ at
  25 °C inside it). And the 74HC112's table has Q = H, Q̅ = L with set and reset both LOW where
  the 74/109 (and TI's 112) have H H — its logic diagram agrees, so it's not a typo.
- 2026-11-07 (R09a) — The carry-over property can't compare whole diagnostic logs: a recompile
  re-reports floating inputs (counts differ by design). Compare the kinds that must not change
  (timing violations).
- 2026-11-07 (R09a) — Playwright `wire()` helper: two consecutive identical points (a planned
  corner on the same row as the pin) make a double click that ends the wire early, and the next
  clicks start a new one. Drop the redundant corner when the points line up.
- 2026-11-07 (R09a) — Mutation-check new tests by `sed`-patching one line of the implementation,
  running the file, and restoring from a scratchpad copy: in this branch it caught five tests
  that passed for the wrong reason (a clock-ordering test whose stimulus never made an edge,
  a power-on pulse test that never had a short phase, …).
- 2026-11-07 (R09b) — Biome formats Markdown too, so a docs-only commit can break `pnpm check`
  (the plan's start commit did). Gate every commit on the exit code —
  `pnpm check > log 2>&1 && git commit …` — not on a `grep` of its output piped before `&&`
  (that committed a red tree once).
- 2026-11-07 (R09b) — Look at the pinning figure before believing a note about it: the backlog
  said the 175's `Q̅0` was wrongly overlined whole, but its sheet overlines `Q̅0̅` whole; the real
  gap was that Nexperia overlines letters, not digits (`1R̅D̅`, `E̅1`), on most chips.
- 2026-11-07 (R09b) — Data sheets state some requirements in prose, not in the timing table
  (the 191: CE̅ rises only while CP is HIGH, U̅/D changes only while CE̅ or CP is HIGH; the 193:
  the other clock HIGH while one counts). Check them like timing requirements (ADR-0014: report,
  `X` where the outcomes differ) and say in the plan which prose rule became which check.
- 2026-11-07 (R09b) — `console.log` from a vitest test doesn't reach the terminal here; a probe
  test writes to a file in the scratchpad instead. In `CircuitBuilder`, a flipped part's pins
  move the other way from `at`: place parts by a pin (`placeBy`: probe the pin's offset in a
  scratch builder, then add at `target − offset`).
- 2026-11-07 (R09b) — Search keywords reach the Parts panel: `led` on the 74HC595 made a search
  for "led" list it (a UI test caught it). Keep keywords to what the part is, not what it drives.
- 2026-11-07 (R09b) — The carry-over property earns its keep only with a mutation that the unit
  tests miss: a 4040 counting on the forced evaluation (power-on starts at `X`, so `X + 1 = X`
  hides it) fails only the property.
- 2026-11-07 (R10a) — Joining nets by name breaks "the only pin on its net" as a test for an
  unconnected pin: every lone VCC symbol is on the `VCC` net with the others. Ask what touches
  the pin's point (`Connectivity.openPins` / `CompileResult.openPins`), never the net's size.
- 2026-11-07 (R10a) — A `centered` symbol's bounds reach half a cell above its origin, so code
  that turns bounds into a placement (`at = target − bounds.x/y`, the Symbol Gallery) gets
  `.5` coordinates, which documents reject. Round onto the grid (`Math.ceil`) wherever bounds
  become positions.
- 2026-11-07 (R10a) — Schematic-only parts aren't in the simulator: `sim.pinLevel`/`stateOf`
  throw for them and `PartLive` doesn't exist. Anything live about them goes through the scene
  (the signal map's points), and test helpers that build a simulator per part must skip them.
- 2026-11-07 (R10b) — Screenshot scripts: `Camera.x/y` are world cells at the canvas's top-left,
  not pixels (`setCamera({ x: 10, y: 4, scale: 28 })`). In the dev build, `page.evaluate` can
  `await import('/src/circuit/index.ts')` and build a circuit with `CircuitBuilder`, then
  `logicEditor.setCircuit(circuit, { fit: true })` — no example file needed to look at a part.
- 2026-11-07 (R10b) — Port 5199 may still be held by a dev server from an earlier session; start
  Vite on another port with `--strictPort` rather than killing a process you didn't start.
- 2026-11-07 (R10b) — A grammar that a prop must match has to be a regex (`PropDef.pattern`):
  bus names cap the indices at two digits and the whole name at 32 characters, which bounds the
  members without counting them. The library layer may not import `circuit` either, not even in
  tests: pin positions of a library part are checked in `tests/scenarios/`.
- 2026-11-07 (R12a) — Memory data sheets give no typical values, only limits: the convention
  "typical drives the simulation" doesn't apply. Simulate with the maxima of what the part
  drives and the minima of its holds (ADR-0017), keep `typical` empty, and expect a key with
  both a min and a max (`tOE`). The Part tab had to learn both.
- 2026-11-07 (R12a) — `pdftotext -layout` garbles the Renesas 6116 tables (columns shift between
  rows); read the rendered page (`pdftoppm -r 110`). Microchip's `ww1…/DeviceDoc/docNNNN.pdf`
  and Renesas PDFs download with curl; Alliance Memory's product table is built by script, so
  the user downloads the AS6C62256.
- 2026-11-07 (R12a) — A `Bench` leaves every `in`/`bidir` pin floating until set: a memory test
  that forgets the address reads all bits unknown (more than 8 unknown address bits merge to
  `X`), and an `X` against a strong level is no contention. Set every address pin before
  asserting a bus fight or a value.
- 2026-11-07 (R12a) — Order inside an instant matters for level-sensitive parts: a RAM treats a
  change in the same delta as a write's start as before it and one at its end as after it (so
  data sheet zeros like `tAS = tWR = tDH = 0` hold), which means recording change times only
  after the checks of that delta ran. A same-instant test with the bench left at the target
  address passed for the wrong reason — mutation-check these.
- 2026-11-07 (R12a) — Every gate output starts `X` for its first delay at power-on, so a RAM's
  `WE̅` driven by a gate looks like a possible write with an unknown address and wipes a
  `zeros` power-on. Unknown controls count as a possible write only after they were known once.
- 2026-11-07 (R12a) — `CircuitBuilder` stores props as given; example files must hold every
  resolved prop (`examples.test.ts`). Re-save a generated example through `resolveProps` and
  `serializeDocument` instead of editing its JSON by hand.
- 2026-11-07 (R12a) — A table `<caption>` with a long conditions string widens the Part tab's
  timing table past the dock (the Min column went off-screen at 1500 px). Keep `conditions`
  short; check a new part's Part tab in the browser.
- 2026-11-07 (R12b) — A focused element that takes typed keys but isn't an `<input>` (the hex
  view) gets single-key shortcuts too: `B`, `C`, `D`, `E`, `F` would arm tools or flip parts.
  Handle the keys in the element and `preventDefault` them — `dispatchShortcut` skips prevented
  events — and leave the rest (Mod+S, F5) alone.
- 2026-11-07 (R12b) — Undo restores the selection from before the edit: a browser test that
  edits from a panel with nothing selected loses its canvas selection (and Properties) on Undo.
  Select the part again before reading its pins.
- 2026-11-07 (R12b) — While running, `Simulation.action` only queues: the action happens in the
  next frame. A fake-clock test runs a frame (`clock.frame(16)`) before reading levels; while
  paused the action's zero-delay effects are applied at once.
- 2026-11-07 (R12b) — Compute Intel HEX checksums with a script when writing test files (sum of
  the record's bytes, two's complement); a guessed checksum twice turned a load test into a
  test of the error dialog.
- 2026-11-07 (R12b) — A mutation that survives may be equivalent code, not a missing test:
  `high < words ? low : low % words` is `low % words`, and an "after the last sample" shortcut
  matched what the binary search returns anyway. Simplify the code instead of testing around it.
- 2026-11-07 (R13) — `Simulator.settle({ maxTime })` with a negative span set `now` back to the
  limit when events were pending (only `runUntil` checked for running backwards); the host
  passed `pauseAt − now` after overshooting, and a test "passed" because time was rewound onto
  the expected instant. Clamp spans at 0, and mutation-check exact-time tests: removing the
  break that made the time exact should fail them.
- 2026-11-07 (R13) — At Max speed the host runs until its frame budget by wall time: with a
  `FakeClock` whose `cost` is 0 a free-running circuit never ends the frame (a silent hang of
  the whole test file). Set `clock.cost` in Max tests, and bound helper loops that wait for
  simulated time (throw after N frames or when the host isn't running).
- 2026-11-07 (R13) — Browser tests run a production build: there is no `window.logicEditor`, so
  anything a test needs exactly (cursors on edges) must be reachable from the UI. Keyboard paths
  (`]`, `}`) made the period measurable — and help users the same way.
- 2026-11-07 (R13) — A mutation script that `sed`-patches a file must restore it in `finally`
  _and_ bound each run: a mutation that loops forever (a cursor at −1 made a merge read `NaN`
  times) hangs vitest past any test timeout, and killing the script skipped its restore. The
  scratchpad `mutate.py` now times out runs and the file was put back by hand once.
- 2026-11-07 (R13) — `Omit<Union, 'key'>` is not distributive (it keeps only common keys), and
  narrowing a union by `kind === 'a' || kind === 'b'` inside a `map` callback failed under the
  native TypeScript; `'channels' in term` narrows reliably. Vitest passes either way — only
  `pnpm check` catches it.
- 2026-11-07 (R13) — `sameCircuit` decides both "no edit" (`Editor.edit`) and "unsaved"; a new
  document field it doesn't compare is silently dropped from undo and never marks the file
  dirty. Add every new field to it (and to `serializeDocument`, the schema and a migration).
- 2026-11-08 (R14) — `runUntil(NaN)` never ended: `t < now` is false for `NaN`, and so is
  `next > limit`, so the loop ran on with no limit (a silent test hang). Validate time limits
  with a positive test (`Number.isNaN`, `!(t >= now)`), and resolve props before reading
  them: `CircuitBuilder` and documents may leave defaults out (`duty` was `undefined`).
- 2026-11-08 (R14) — Driving a circuit from a script or a test: an action at the instant the
  last step ended is "at the same time" for the chips (a clock press right after releasing
  CLR is a recovery violation; a second manual pulse at the end of the first is a 0 ps LOW).
  Let simulated time pass between actions, as a hand on the real board does.
- 2026-11-08 (R14) — A carry-over at an instant processes that instant again in the new
  simulator (its forced evaluation runs `onInstant` at the carried time): anything evaluated
  per instant — a trigger rebuilt for the new simulator — fires there a second time. Keep such
  objects across a carry-over (re-attach them) and guard per-instant actions by the instant.
- 2026-11-08 (R14) — Actions while paused happen at the instant the run paused at, so the
  recorder merges them into that instant: a channel attached then saw no edge (fixed: its
  first level goes 1 ps early). Test what a tool sees of a change made while paused, not only
  of changes made while running.
- 2026-11-08 (R14b) — Restoring a kernel snapshot into a _replica_ needs the event queue's seq
  counter restored too: a lower counter makes the queued events look "queued after the delta
  began" (`peekSeq() < boundary` fails) and `processTimestamp` loops forever on the same
  instant. Per-delta stamps are the opposite: never restore them, let the delta id keep
  counting, so no stale stamp can equal a later delta.
- 2026-11-08 (R14b) — Comparing a replay with the original by "same levels" hides a replay
  that ran the kernel between two actions of one frame (press and release cancel out vs a
  0-width pulse): the levels end equal, the event count and the queue's head don't. Compare
  those too in determinism tests.
- 2026-11-08 (R14b) — After `Simulator.restore`, `sim.now` is the rewound time: anything that
  asks "how far did the record reach" must be told the present explicitly (`Recorder.seek(t,
  present)`), and an instant may be processed several times (an action while paused), so
  "where the run is" is a position — a time and the actions delivered by then — not a time.
- 2026-11-08 (R14b) — A run that stops exactly at a recorded action's instant must stop
  _before_ delivering it: the original run stopped there and the user acted after. Delivering
  actions due "now" at the top of every kernel call is right for resuming, wrong for the last
  call of a step — check the goal first.
- 2026-11-08 (R14b) — Editor tests with DIP chips: `CircuitBuilder.connect` routes wires along
  the chip's pin row and shorts everything (the R02/R04b lesson bit again: a 74HC161's outputs on
  VCC). Join pins with net labels placed at the pin tips (`b.pin('U1.CP')`) instead, and check
  `compileCircuit(…).netlist.nets` once.
- 2026-11-08 (LCD) — A mutation script that times vitest out with `subprocess.run(timeout=…)`
  kills only the parent: its workers stay, orphaned (PPID 1), each spinning at 100 % CPU for
  hours and slowing every later run. Start vitest in its own session (`start_new_session=True`)
  and `os.killpg` the group on a timeout; after an interrupted run, `pgrep -fl vitest`.
- 2026-11-08 (LCD) — Running every possible outcome and merging them is exact but multiplies:
  an instruction with 8 unknown bits (a floating bus) × 24 outcomes of an uncertain transfer was
  thousands of state copies per `E` edge, and a random-network property test ran out of memory
  (vitest diffing two huge change lists made it look like a crash). Enumerate only a few unknown
  bits (≤ 3) and fall back to "anything may have changed" beyond; drive the property test's
  inputs to known levels first (reset the counter).
- 2026-11-08 (LCD) — A part that drives `X` onto a net and reacts to that net going `X` can ring
  with a period of its own delays (the LCD's read released the bus `tDHR` after `E` went `X` —
  and a data pin on `E`'s net gave `E` back to the clock: 12M net changes in 10 ms). Keep an
  uncertain state until the input is known again instead of acting on every `X`; the kernel's
  oscillation guard only catches loops within one instant.
- 2026-11-08 (LCD) — The canvas redraws on events and light changes only: anything whose look
  changes with time alone (a blinking cursor) needs `ComponentDefinition.animation`. A page
  script that edits a part's state in place doesn't redraw either — move the camera.
- 2026-11-08 (LCD) — Generating an example with net labels: point each label away from its
  chip's middle, per pin — a 28C16's right side has A8–A10 besides data. A label pointed into a
  body is connected and passes every check; only looking in the browser found it.
- 2026-11-08 (LCD) — Driving a clocked example from a test: release a reset or press a button
  off the clock's edges (odd picoseconds). Releasing a 74HC4040's MR on a clock edge is a real
  recovery violation and the counter goes `X` — the test's timing, not the circuit's.
- 2026-11-08 (LCD) — Browser tests can read the canvas: `canvas.evaluate` with `getImageData`
  over a part's area, counting pixels by luminance rather than exact color (fitted to the
  window a dot is about a pixel and anti-aliasing blends it). And two UI actions in one frame
  are one simulated instant: wait between them as a hand would.
- 2026-11-08 (LCD) — "The pins don't move when the size changes" was tested as "every pin keeps
  its side and offset" — true, and the bottom pins still moved down with a taller body. Test a
  geometric promise in absolute points (`partLayout(...).pins`), and walk the acceptance
  criteria in the app: the browser test of the Properties change found it.
- 2026-11-08 (R11a) — A menu entry naming a command that doesn't exist crashes the whole app the
  moment its menu opens (a blank page in the browser; every unit test passed). A unit test now
  checks every menu, context menu and toolbar entry against `createCommands`: add a command and
  its menu entry together.
- 2026-11-08 (R11a) — Caches keyed by a part's type id go stale once definitions are generated:
  a subcircuit keeps its type while its ports, and so its pins, change. Key layout caches by the
  definition object (`WeakMap`), and keep a definition object while what it depends on is equal
  (the document registry reuses it by the circuit's name and ports).
- 2026-11-08 (R11a) — `Editor.registry` is a getter now (the document's registry): a React prop
  read from it at render goes stale unless the component subscribes to `state.design.registry`.
  The Parts panel gets its parts through `useStoreValue(editor.state, (s) => s.design.registry)`.
- 2026-11-08 (R11a) — The e2e test found what the unit tests couldn't: "Add Circuit" then a
  rename kept the id `circuit-2`, so instances were `sub/circuit-2`. Ids now follow the name
  until the circuit is placed. Walk a new feature end to end in the browser test, not only the
  pieces.
- 2026-11-08 (R11a) — A bus port inside a module needs no bus line: its bits join the nets of its
  members' names (labels `Q0`…`Q3` on the chip's pins), and so does a bus label at an instance's
  bus pin outside. Checks had to learn that such members are used (no `single-net-label`) and,
  at an output port, driven (no `undriven-input`).
- 2026-11-08 (R11b) — Step Clock took "the next instant" for the edge it was paused before; a
  button pressed there queues its gates' instants first, so the step stopped before the same
  edge again (the e2e test holding RESET over one clock found it, not the unit tests). A step
  defined by "the next instant" assumes nothing was queued since the last stop: actions do.
- 2026-11-08 (R11b) — macOS file systems ignore case: `Breadcrumbs.tsx` beside `breadcrumbs.ts`
  is one file to the resolver (`TS1261`, "differs only in casing"). Give the pure module of a
  component another name (`breadcrumb-view.ts`).
- 2026-11-08 (R11b) — The e2e helpers map grid points to pixels from the canvas box once; a bar
  that resized the canvas when a second circuit appeared would move every point. Float UI over
  the canvas (the breadcrumb bar) rather than taking its room.
- 2026-11-08 (R11b) — A guard that never runs passes every test: `Simulation.sync` returned early
  on the same netlist and scene, but the editor builds a new scene on every change, so a missing
  `path` comparison there survived mutation. Test a host's contract at the host
  (`sync` with one scene, two paths).
- 2026-11-08 (R15a) — V8 keeps 10 stack frames by default: from inside a bench (script → API →
  row → check → fail → line) the script's frame is already cut off, so a failure had no line.
  Script hosts raise `Error.stackTraceLimit` around every load and call; a `vm` context has an
  `Error` of its own to raise too.
- 2026-11-08 (R15a) — A Node `vm` context is not empty: V8 gives it a `console` of its own
  (`typeof console` was `object`). Delete what a sandboxed script must not use (`console`,
  `Date`, `Math.random`) in a prelude, and test for it.
- 2026-11-08 (R15a) — `tests/` is typed by `tsconfig.app.json` (DOM, no Node types): a scenario
  importing `scripts/script-host.ts` failed typecheck on `node:vm` though vitest passed. Tests
  that need Node go next to their scripts in `scripts/` (typed by `tsconfig.node.json`).
- 2026-11-08 (R15a) — A clock pulse on an input that was never driven rises from `Z`, which is
  no edge to a flip-flop (`prev` isn't `0`): the 74HC74 went `X` and the first bench "failed".
  A bench's pulse drives the input LOW from the step's start, as 0 → 1 → 0 means on the board.
- 2026-11-08 (R15a) — Scripts from `new Function` and `vm` run sloppy by default: assigning to a
  frozen `b.now` did nothing and a typo made a global. Prefix `'use strict';` on the script's
  first line (same line, so line numbers hold).
- 2026-11-08 (R15b) — A blob Worker started in a sandboxed iframe inherits the iframe's CSP, and
  `new Function` needs `'unsafe-eval'` there: without it the script host can't make code. Put
  `'unsafe-eval'` in the sandbox's `script-src`, nothing that reaches the network.
- 2026-11-08 (R15b) — V8 gives no line for a syntax error from `new Function` (nor `eval`, nor
  `importScripts`): the stack names only the caller. A nested Worker started from a blob of the
  script wrapped as `(function () {…})` reports it in `ErrorEvent.lineno` (not muted inside an
  opaque origin).
- 2026-11-08 (R15b) — A worker busy in a synchronous loop never runs its microtasks: a response
  queued with `promise.then(post)` before the loop never leaves (the bench's `started` didn't).
  Post at once; queue only behind something actually awaited.
- 2026-11-08 (R15b) — Playwright's `page.on('request')` reports a request a CSP blocked (as
  failed), and requests to missing files fail without any policy (404, CORS, MIME). A negative
  network test must aim at something that would succeed — a route fulfilled with
  `Access-Control-Allow-Origin: *` — and be checked by removing the policy (it read `xhr 200`).
- 2026-11-08 (R15b) — A "request counter" in UI state (`runToRequest`) misfires for a panel
  mounted by the same command: it starts at the new value and never sees a change. For a one-shot
  request (open a file picker), use a flag the panel clears when it acts.

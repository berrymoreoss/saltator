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
  (`pnpm bench` does: `--experimental.viteModuleRunner=false` + `scripts/bench-resolve-hooks.ts`);
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

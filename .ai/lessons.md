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

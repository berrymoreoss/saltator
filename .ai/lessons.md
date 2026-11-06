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

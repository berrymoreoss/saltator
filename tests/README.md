# tests — cross-layer tests and benchmarks

Unit tests live next to the code they test (`src/**/x.test.ts`). This folder is for tests that
combine layers and therefore can't live inside one (layer rules forbid `core` from importing
`library`):

- `tests/scenarios/*.test.ts` — kernel behavior exercised with real parts (ring oscillator,
  latches, tri-state buses, contention, determinism).
- `tests/e2e/*.spec.ts` — browser tests (Playwright, `pnpm e2e`) against a production build served
  by `vite preview`; not part of `pnpm check`. Load the app with `openApp` (it waits for the
  start-up session restore); `file-system.ts` stubs the File System Access pickers with handles
  from the origin private file system and reads the autosaved sessions.
- `tests/bench/*.bench.ts` — performance benchmarks (`pnpm bench`). They run on native `import`
  (not Vite's module runner, which slows hot loops ~3×) with `scripts/resolve-hooks.ts`;
  Vitest 5 benchmarks use the test context: `test(name, async ({ bench }) => …)`.

Not subject to `check:layers`; may import from any layer.

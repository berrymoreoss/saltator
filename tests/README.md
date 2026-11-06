# tests — cross-layer tests and benchmarks

Unit tests live next to the code they test (`src/**/x.test.ts`). This folder is for tests that
combine layers and therefore can't live inside one (layer rules forbid `core` from importing
`library`):

- `tests/scenarios/*.test.ts` — kernel behavior exercised with real parts (ring oscillator,
  latches, tri-state buses, contention, determinism).
- `tests/bench/*.bench.ts` — performance benchmarks (`pnpm bench`).

Not subject to `check:layers`; may import from any layer.

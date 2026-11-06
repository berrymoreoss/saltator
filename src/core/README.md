# src/core — simulation kernel

Event-driven, deterministic digital simulation: signal model (levels + drive strengths), event
queue, net resolution, component runtime API, test bench utilities.

- **Depends on:** nothing.
- **Pure:** no DOM, no React, no Node APIs, no npm packages. Must run in a browser, a Web Worker,
  and Node (tests) unchanged. Enforced by `tsconfig.core.json` and `pnpm check:layers`.
- **Deterministic:** no `Date.now()`, no `Math.random()`; randomness comes from a seeded RNG passed in.
- **Hot path:** avoid allocations in the event loop; prefer typed arrays and integer indices.

Modules: `time`, `logic` (levels, drives, resolution, 4-state operators), `event-queue`,
`component` (definition types, `defineComponent`, `resolveProps`), `symbol` (symbol geometry,
`validateSymbol`), `registry`, `netlist`
(`NetlistBuilder`, `resolveNetlist`), `diagnostics`, `simulator`. Test utilities (`Bench`,
`functionTable`, `truthTable`, `Trace`) live in `testing/` and are imported from
`src/core/testing`, not from the main index.

Spec: [docs/simulation.md](../../docs/simulation.md).

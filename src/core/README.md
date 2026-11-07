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
`validateSymbol`; `pinTextRuns`, a pin's text with its overlines as drawn), `registry`, `netlist`
(`NetlistBuilder`, `resolveNetlist`, `sameNetlistStructure`), `diagnostics`, `simulator`
(including `carryOver` for editing while running), `function-table` (the datasheet table format,
sequential letters included), `timing-checks` (`TimingChecks`: set-up, hold, pulse width and
recovery against `timing.min`, R09a; edge-to-edge and hold-only set-up/hold, R09b), `memory`
(ROM images as sparse hex runs, `MemoryDef`/`MemoryView`, the `poke` debug write, R12a; access
stamps and address pins, R12b), `image-files` (`.bin` and Intel HEX read, written and placed
into a memory, R12b), `random` (`SeededRandom`, `hashString`: reproducible randomness, R12a). Test
utilities (`Bench`, `functionTable`, `checkableRows`, `truthTable`, `Trace`) live in `testing/`
and are imported from
`src/core/testing`, not from the main index.

Spec: [docs/simulation.md](../../docs/simulation.md).

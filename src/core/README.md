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
(including `carryOver` for editing while running: state only for the same definition, HDL-1),
`hdl-module` (the IR of a Verilog module: types, the cells modules run, its ports' pins and
their directions, the shape check, `HDL_FAMILY` and the `delay` prop, HDL-1; tri-states, HDL-8), `function-table` (the datasheet table format,
sequential letters included), `timing-checks` (`TimingChecks`: set-up, hold, pulse width and
recovery against `timing.min`, R09a; edge-to-edge and hold-only set-up/hold, R09b; cycle time,
the LCD branch), `memory`
(ROM images as sparse hex runs, `MemoryDef`/`MemoryView`, the `poke` debug write, R12a; access
stamps and address pins, R12b), `image-files` (`.bin` and Intel HEX read, written and placed
into a memory, R12b), `random` (`SeededRandom`, `hashString`: reproducible randomness, R12a),
`recorder` (`Recorder`: probed nets' levels over time, bounded, R13; bits inside parts sampled
at instants, HDL-4), `inner-signals` (`SignalsDef`, a part's named signals as its definition's
`signals` view, `InnerBit`, `innerReader`, HDL-4), `trigger` (`Trigger`:
conditions on recorded channels that fire at an instant, R13; `repeat` for breakpoints, R14),
`vcd` (`writeVcd`, R13); the simulator's `requestBreak` and `onInstant` (R13) and the run
option `stopBefore` (a lookahead to a net's next change, R14); `diagnosticSeverity` and
`DiagnosticLog.onOccurrence` (R14; every `*-violation` an error since the LCD branch);
`ComponentDefinition.animation` (a part whose look changes with time alone, the LCD branch); `Simulator.snapshot`/`restore`/`replica` with
`state-copy` (frozen component states in shared pages), `Recorder.seek`/`cut` and
`Trigger.resync` for rewinding (R14b). Test
utilities (`Bench`, `functionTable`, `checkableRows`, `truthTable`, `Trace`) live in `testing/`
and are imported from
`src/core/testing`, not from the main index.

Spec: [docs/simulation.md](../../docs/simulation.md).

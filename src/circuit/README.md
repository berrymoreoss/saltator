# src/circuit — circuit document model

The editable, serializable description of a schematic (component instances, wires, labels,
buses, several circuits with subcircuit instances), its versioned JSON schema, and the compiler
that turns a document into a flat `Netlist` for the kernel.

- **Depends on:** `core`.
- **Pure:** no DOM, no React. Component definitions are injected via a registry, never imported
  from `library` directly.

Modules: `document.ts` (types), `schema.ts` + `migrations.ts` (loading), `serialize.ts`
(saving), `geometry.ts`, `layout.ts` (pin positions), `connectivity.ts` (nets from wires),
`compile.ts` + `checks.ts` (netlist, net names, design checks), `resolve.ts` (references such
as `U5`, `U5.A0`, `CLK`, `D[0..7]` to the compiled parts and nets; the memories, R12b; what a
probe shows and how to probe an unnamed net, R13; memory cells `U5[1F]` and
`renameReference`, R14),
`builder.ts` (code-first documents), `subcircuit.ts` (the document registry: a generated
`sub/<id>` definition per circuit, pins from its ports, R11a; a Verilog module's part from the
library's `hdlPart`, HDL-1), `verilog.ts` (Verilog modules: their ports, compiled to one part
`U1`, their issues, HDL-1), `design.ts` (`compileDesign`:
the top circuit flattened with instance paths), `document-edit.ts` (circuits added, renamed,
removed, set as top; renames across circuits; clipboard documents). Net labels are parts like any other (`schematicOnly`, a pin with a `net` name): the
compiler joins pins by name and leaves those parts out of the netlist. Bus lines (`Wire.bus`)
and bus pins (`PinDef.bus`) are a second layer, connected apart from wires and pins
(`CompileResult.buses`); `addWires` and `normalizeWires` keep the layers apart. Probes
(`Circuit.probes`, schema v3, R13) are references kept with the circuit for the Waveforms tab,
never compiled.
Test benches (`bench/`, R15a): `values.ts` (what a bench drives and expects, as bits; how a
report writes them), `table.ts` (text tables of vectors), `bench.ts` (`CircuitBench`: a circuit
as the top with drivers on its ports, steps, checks, memories, the report), `script.ts` (test
scripts: `ScriptHost`, `runBench`, `runTestScript`, the API object `b`), `function-host.ts`
(an in-realm host); its own test parts and circuits are `bench/test-*.ts`. A test script
(`Circuit.testScript`, schema v5) is never compiled; its text becomes code only in a host.
`test-parts.ts` holds small part definitions for unit tests: this layer may not import `library`,
not even in tests; scenarios with real parts live in `tests/scenarios/`.

Spec: [docs/circuit.md](../../docs/circuit.md).

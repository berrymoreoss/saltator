# src/circuit — circuit document model

The editable, serializable description of a schematic (component instances, wires, labels,
later: buses, subcircuits), its versioned JSON schema, and the compiler that turns a document
into a flat `Netlist` for the kernel.

- **Depends on:** `core`.
- **Pure:** no DOM, no React. Component definitions are injected via a registry, never imported
  from `library` directly.

Modules: `document.ts` (types), `schema.ts` + `migrations.ts` (loading), `serialize.ts`
(saving), `geometry.ts`, `layout.ts` (pin positions), `connectivity.ts` (nets from wires),
`compile.ts` + `checks.ts` (netlist, design checks), `builder.ts` (code-first documents).
`test-parts.ts` holds small part definitions for unit tests: this layer may not import `library`,
not even in tests; scenarios with real parts live in `tests/scenarios/`.

Spec: [docs/circuit.md](../../docs/circuit.md).

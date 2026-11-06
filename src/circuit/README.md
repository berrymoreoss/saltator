# src/circuit — circuit document model

The editable, serializable description of a schematic (component instances, wires, labels,
later: buses, subcircuits), its versioned JSON schema, and the compiler that turns a document
into a flat `Netlist` for the kernel.

- **Depends on:** `core`.
- **Pure:** no DOM, no React. Component definitions are injected via a registry, never imported
  from `library` directly.

Spec: [docs/architecture.md#circuit-model](../../docs/architecture.md#circuit-model).

# src/library — component library

Definitions of parts: pinout, package, properties, timing (with datasheet source), symbol
geometry as data, and behavior written against the `core` component API.

Planned layout: `primitives/`, `io/`, `74xx/`, `memory/`, `cpu/`, `peripherals/`, plus
`registry.ts`. One part per file, with a colocated `*.test.ts` built from the datasheet function
table.

- **Depends on:** `core`.
- **Pure:** no DOM, no React. Drawing code lives in `editor`; the library only describes geometry.

Spec: [docs/components.md](../../docs/components.md).

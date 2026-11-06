# src/library — component library

Definitions of parts: pinout, package, properties, timing (with datasheet source), symbol
geometry as data, and behavior written against the `core` component API.

Layout: `primitives/` (`prim/*`, R01), `io/` (`io/*`, R03: rails, contacts, LEDs, displays,
clock, probe) and `registry.ts` (`createDefaultRegistry()`); planned: `74xx/`, `memory/`, `cpu/`,
`peripherals/`. One part per file (or one factory file for a
family of near-identical parts, like `primitives/gates.ts`), with a colocated `*.test.ts` built
from the datasheet function table. Recipe: `.ai/workflows/add-component.md`.

- **Depends on:** `core`.
- **Pure:** no DOM, no React. Drawing code lives in `editor`; the library only describes geometry.

Spec: [docs/components.md](../../docs/components.md).

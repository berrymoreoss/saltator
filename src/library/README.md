# src/library — component library

Definitions of parts: pinout, package, properties, timing (with datasheet source), symbol
geometry as data, and behavior written against the `core` component API.

Layout: `primitives/` (`prim/*`, R01), `io/` (`io/*`, R03: rails, contacts, LEDs, displays,
clock, probe), `74xx/` (`74xx/*`, R06: 74HC gates and bus buffers — `ChipSpec` per function,
`LogicFamily` timing, pinouts written like data sheet tables; R08: MSI decoders, multiplexers,
adder, comparator, encoders, 4511, with per-path delays in `paths.ts`), `timer/` (`timer/*`,
R08: the behavioral NE555) and `registry.ts`
(`createDefaultRegistry()`); planned: `memory/`, `cpu/`, `peripherals/`. One part per file (or one factory file for a
family of near-identical parts, like `primitives/gates.ts`), with a colocated `*.test.ts` built
from the datasheet function table. Recipe: `.ai/workflows/add-component.md`.

- **Depends on:** `core`.
- **Pure:** no DOM, no React. Drawing code lives in `editor`; the library only describes geometry.

Spec: [docs/components.md](../../docs/components.md).

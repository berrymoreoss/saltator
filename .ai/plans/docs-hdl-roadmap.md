# Plan: docs/hdl-roadmap

| Field      | Value                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| Branch     | `docs/hdl-roadmap`                                                                 |
| Roadmap    | HDL-1…HDL-10, track [Programmable logic](../../docs/roadmap/programmable-logic.md) |
| Status     | done                                                                               |
| Depends on | —                                                                                  |
| Created    | 2026-11-09                                                                         |

## Goal

Reorder the Programmable logic track around its first use: the user writes logic in Verilog — an
address decoder, glue logic — instead of wiring 74HC chips, runs it as a part right away, and
takes the same source to a real FPGA. The track's first item becomes that, as small as it can
be; the items after it grow the same pipeline toward anything synthesizable — controllers on a
bus, memory, video and sound controllers, soft cores at a usable speed — with the gaps found in
the review (tri-states, the full cell set, wide values, internal clocks, `init` values,
parameters, speed) made items of their own. No product code changes.

## Scope

**In scope**

- `docs/roadmap/programmable-logic.md`: goal, item order, re-scoped items, new items, ideas.
- `docs/roadmap.md`: the track's goal in the tracks table.
- ADR-0030 (proposed): the item ids it refers to; one delay on the part for a module without
  `specify`.

**Out of scope** (and where it goes instead)

- Accepting ADR-0030 → HDL-1, after its benchmark.
- Specs in `docs/architecture.md`, `docs/simulation.md`, `docs/components.md` → HDL-1.

## Context

- Review (2026-11-09): the track started from library parts (a Verilog 74HC00, `specify`
  timing) and reached the user's own module only in HDL-3; "any synthesizable Verilog" lacked
  tri-state and `inout`, internal clocks, `init` values, wide arithmetic, instance parameters,
  and a planned way to speed — while the user's goal is a quick decoder first, cores and
  controllers in the end.
- [docs-roadmap-reorder](docs-roadmap-reorder.md) — the precedent: ids are kept, items move,
  a note records the move.

## Design

- **Ids are kept** ([roadmap rules](../../docs/roadmap.md#how-it-works)); none of the items has a
  branch or a plan yet, so their branch names may change.
  - HDL-1 `feat/hdl-modules` — re-scoped: Verilog modules in the document (the minimal pipeline,
    the editor and the module as a part from HDL-3, one delay on the part); the library parts,
    the 74HC00 proof and `specify` went to HDL-2.
  - HDL-3 `feat/hdl-editor` → `feat/hdl-projects` — re-scoped: Verilog projects (several files,
    includes, instance parameters, the SystemVerilog subset, carry-over across recompiles).
  - HDL-2 `feat/hdl-timing` → `feat/hdl-library` — re-scoped: library parts in Verilog with
    `specify` timing and timing checks, compiled ahead of time; the 74HC00/74HC74/74HC574 proof.
  - New: HDL-8 `feat/hdl-bus` (tri-state, `inout`), HDL-9 `feat/hdl-semantics` (every cell,
    signed and wide values, internal clocks, loops, `init`, differential tests against Yosys
    `sim`), HDL-10 `feat/hdl-fast` (promoted from the "Faster evaluation" idea).
  - Unchanged: HDL-4, HDL-5 (plus the `.pcf` export and the 5 V / 3.3 V note), HDL-6 (plus its
    proof), HDL-7 (measured against HDL-1's baseline, the target of HDL-10).
- **Order:** HDL-1 → HDL-8 → HDL-9 → HDL-3 → HDL-4 → HDL-6 → HDL-7 → HDL-10 → HDL-2 → HDL-5.
  HDL-1 stays the head (`next`).
- **Ideas added:** video, sound and memory controllers in Verilog (with what they need from
  other tracks), voltage checks, `$print`/`$check` cells, iCE40 primitives.

## Tasks

- [x] 1. Track file: goal, table, sections, ideas.
- [x] 2. `docs/roadmap.md` track goal; ADR-0030 references.
- [x] 3. `pnpm check` green; commit.
- [x] 4. User's review; merge with approval (finish-branch).

## Acceptance criteria

- [x] `pnpm check` is green; `pnpm roadmap` shows HDL-1 as the track's head.
- [x] The user approved the items and their order.

## Progress log

- 2026-11-09 — agreed with the user: the decoder in Verilog first, the track growing toward
  cores and controllers; track rewritten, ADR-0030 references updated.
- 2026-11-09 — the user approved the new order and items; merged.

## Handoff

- **State:** merged; nothing pending.
- **Next step:** HDL-1 (`feat/hdl-modules`) via `/start-branch HDL-1`; accept or revise ADR-0030
  there after its benchmark.

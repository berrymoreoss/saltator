# Plan: docs/programmable-logic-track

| Field      | Value                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| Branch     | `docs/programmable-logic-track`                                                 |
| Roadmap    | — (a new track, [Programmable logic](../../docs/roadmap/programmable-logic.md)) |
| Status     | done                                                                            |
| Depends on | —                                                                               |
| Created    | 2026-11-08                                                                      |

## Goal

Open the roadmap track for programmable logic: Verilog modules running in the simulator as
parts — library controllers, the user's own designs for an FPGA or CPLD, soft cores up to a
PicoRV32 — and the programmable devices (GAL, CPLD, FPGA) that hold them. Record the
architecture chosen in the discussion that led here (Yosys front end, an IR as plain data, one
interpreter in the library) as a proposed ADR, so the reasoning survives until HDL-1 starts. No
product code changes.

## Scope

**In scope**

- `docs/roadmap/programmable-logic.md`: goal, items HDL-1…HDL-7 with sections, ideas.
- `docs/roadmap.md`: the track's row; the "Programmable logic" track idea removed (it is now the
  track; its JEDEC fuse maps moved to the track's ideas).
- ADR-0030 (proposed) and its row in `docs/adr/README.md`.

**Out of scope** (and where it goes instead)

- Specs in `docs/architecture.md`, `docs/components.md`, `docs/simulation.md`, the glossary →
  HDL-1, when there is code to describe.
- Accepting ADR-0030 → HDL-1, after its benchmark.

## Context

- Discussion (2026-11-08): Icarus `vvp` in WebAssembly co-simulated with the kernel was weighed
  and rejected (ADR-0030, alternatives); 74xx chips gain little from Verilog, controllers and
  user designs gain a lot.
- [docs/roadmap.md](../../docs/roadmap.md) "How it works" — the rules for a new track.

## Design

- Track name "Programmable logic", prefix `HDL` (Q1).
- Item order (Q2): the headless pipeline with a 74HC00 as proof → `specify` timing and checks →
  modules in documents → internal signals → devices → memories → PicoRV32.
- HDL-1 is the track's head (`next`).

## Tasks

- [x] 1. Track file with items and ideas.
- [x] 2. `docs/roadmap.md`: track row, track idea removed.
- [x] 3. ADR-0030 (proposed), ADR index.
- [x] 4. `pnpm check` green; commit.
- [x] 5. User's review of the items; merge with approval (finish-branch).

## Acceptance criteria

- [x] `pnpm check` is green; `pnpm roadmap` lists the track with HDL-1 as its head.
- [x] The user approved the items and their order.

## Open questions

- [x] Q1. Track prefix — _proposed:_ `HDL` (`PLD-1` would read too close to `PLT-1`) —
  **answer:** `HDL`.
- [x] Q2. Item order — _proposed:_ as in Design; devices (HDL-5) before memories and PicoRV32,
  since GAL/CPLD glue logic is what a homebrew computer (M5) needs first — **answer:** as proposed.

## Progress log

- 2026-11-08 — branch started; track, roadmap row, ADR-0030 (proposed) drafted.
- 2026-11-08 — the user approved the items, their order and the `HDL` prefix; merged.

## Handoff

- **State:** merged; nothing pending.
- **Next step:** HDL-1 (`feat/hdl-modules`) via `/start-branch HDL-1`; accept or revise ADR-0030
  there after its benchmark.

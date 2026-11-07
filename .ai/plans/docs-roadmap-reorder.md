# Plan: docs/roadmap-reorder

| Field      | Value                                       |
| ---------- | ------------------------------------------- |
| Branch     | `docs/roadmap-reorder`                      |
| Roadmap    | R11, R12 ([roadmap](../../docs/roadmap.md)) |
| Status     | done                                        |
| Depends on | R10b                                        |
| Created    | 2026-11-07                                  |

## Goal

Move R11 (hierarchical design) after R14, without building anything, so the instruments for
serious design work — memory (R12), waveforms (R13), the debugger (R14) — come first, on the
flat circuits that net labels and buses already make workable. R11 then lands right before the
test benches (R15) and the full SAP-1 build (R16), which need hierarchy most.

## Decisions

- **IDs are kept.** R11 stays R11 and only moves; ADRs and plans refer to R11…R16 by id (about
  40 places, ADRs are history), so renumbering would break them. A note in the roadmap records
  the move, like the R04/R09/R10 split notes.
- **Milestones.** R12 joins Phase 2: memory chips are building blocks, and the SAP-1 modules
  need them (the RAM is two 74LS189s, the output register decodes through an EEPROM), so M2 now
  includes the RAM with its address register and the output register. Phase 3 is R13 → R14 →
  R11 → R15 → R16 → M3.
- **Hierarchy-ready references.** R12–R14 refer to parts and nets (inspector, probes, watches,
  breakpoints) through one resolver over the compiled netlist, so R11 adds paths into instances
  (`U5/D0`) in one place. Designators can't contain `/` (`ID_PATTERN`), so the path syntax is
  free.

## Tasks

- [x] 1. Roadmap: overview order and statuses (R12 `next`, R11 `planned`), the move note, R12 in
  Phase 2 with the shared-resolver rule, M2 acceptance with the RAM and the output register,
  Phase 3 renamed and reordered, R11 after R14 with what it extends.
- [x] 2. Vision: M2 lists the RAM and the output display.
- [x] 3. Merge to `main` with the user's approval.

## Progress log

- 2026-11-07 — agreed with the user: R11 after R14, R12 into Phase 2 / M2, ids kept.
- 2026-11-07 — roadmap and vision updated.
- 2026-11-07 — finished: R11 follows R14, R12 is next and closes Phase 2 / M2; merged with the
  user's approval.

## Handoff

- **State:** merged; nothing pending.
- **Next step:** `/start-branch` R12 `feat/memory`.
- **Watch out:** R12's plan must include the shared part/net reference resolver.
- **Verify with:** `pnpm check`.

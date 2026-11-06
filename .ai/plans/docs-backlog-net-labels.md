# Plan: docs/backlog-net-labels

| Field      | Value                     |
| ---------- | ------------------------- |
| Branch     | `docs/backlog-net-labels` |
| Roadmap    | — (backlog, R10 notes)    |
| Status     | done                      |
| Depends on | —                         |
| Created    | 2026-11-07                |

## Goal

Record two user requests in the roadmap without building anything: a quick-place toolbar group
(VCC, GND, Net Label) in the backlog, and the net-label behavior the user described (Proteus-style
named points that join distant parts) in R10, which already plans net labels.

## Tasks

- [x] 1. Backlog: quick-place toolbar group (VCC, GND, Net Label; shortcuts like KiCad's `P`/`L`).
- [x] 2. R10: describe net labels — name + one connection point, same name = one net, the
  switches → labels → 74HC00 example, net named after the label, single-label warning, scope
  until R11, VCC/GND joined by name (ADR-0007).
- [x] 3. Glossary: "Net label" _(planned, R10)_, distinct from a part's `label`.
- [x] 4. Merge to `main` with the user's approval.

## Open questions

- [x] Q1. What to call the feature — _proposed:_ "net label" (the KiCad/Altium/Proteus term; plain
  "label" already means a part's display text in the document) — **answer:** "net label";
  the user confirmed R10 covers the request (2026-11-07).

## Progress log

- 2026-11-07 — roadmap (R10, backlog) and glossary updated.
- 2026-11-07 — finished: R10 describes net labels, backlog has the quick-place toolbar group,
  glossary has "net label"; merged with the user's approval.

## Handoff

- **State:** merged; nothing pending.
- **Next step:** —
- **Watch out:** —
- **Verify with:** `pnpm check`.

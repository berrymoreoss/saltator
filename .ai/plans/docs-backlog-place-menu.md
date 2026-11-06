# Plan: docs/backlog-place-menu

| Field      | Value                     |
| ---------- | ------------------------- |
| Branch     | `docs/backlog-place-menu` |
| Roadmap    | — (backlog, R10 notes)    |
| Status     | done                      |
| Depends on | —                         |
| Created    | 2026-11-07                |

## Goal

Replace the backlog's quick-place toolbar group with the user's new idea, without building
anything: a **Place** submenu in the empty-canvas context menu (the same list as the menu bar's
Place menu), so frequently placed parts are one right click away and the toolbar stays clean.

## Tasks

- [x] 1. Backlog: the Place submenu replaces the quick-place toolbar group — Power, Ground,
  Pull-up, Pull-down, Wire, Net Label (R10), Port (R11), Part…; a part item arms the place tool.
- [x] 2. R10: net labels are placed from the Place submenu (was: the toolbar group).
- [x] 3. Merge to `main` with the user's approval.

## Open questions

- [x] Q1. Build it now or record it — **answer:** record it in the backlog only; R08 stays next
  (2026-11-07).
- [x] Q2. What a part item does — _proposed:_ place the part at the right-click point —
  **answer:** arm the sticky place tool, like a click in the Parts panel (ghost under the cursor,
  R/F before placing, Escape leaves), the same from the context menu and the menu bar
  (2026-11-07).
- [x] Q3. What goes in the list besides Power, Ground and Wire — **answer:** Pull-up, Pull-down
  and Part… (Search Parts); Net Label and Port when R10/R11 bring those parts (2026-11-07).

## Progress log

- 2026-11-07 — roadmap (backlog, R10) updated.
- 2026-11-07 — finished: the backlog has the Place submenu instead of the quick-place toolbar
  group, R10 points to it; merged with the user's approval.

## Handoff

- **State:** merged; nothing pending.
- **Next step:** —
- **Watch out:** "Port" is read as a subcircuit's interface pin (R11); confirm when R11 starts.
- **Verify with:** `pnpm check`.

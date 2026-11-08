# Plan: docs/roadmap-tracks

| Field      | Value                                                |
| ---------- | ---------------------------------------------------- |
| Branch     | `docs/roadmap-tracks`                                |
| Roadmap    | — (process change; [roadmap](../../docs/roadmap.md)) |
| Status     | in-progress                                          |
| Depends on | R15b (the last item merged)                          |
| Created    | 2026-11-08                                           |

## Goal

Turn the one linear roadmap into **tracks**: separate lines of work, each with its own ordered
items and goal, so that several of them (the parts library, the SAP-1, the 6502 systems, later
AVR or programmable logic) can be planned and built in parallel without fighting over one list.
Milestones (M1–M5) stay what they are: cross-track goals with an acceptance test. One item is
still one branch with one plan. No product code changes.

## Scope

**In scope**

- `docs/roadmap.md` becomes the index: the concepts and rules, the tracks, the milestones with
  the items each one needs, track ideas, a note on the old phases.
- One file per track in `docs/roadmap/`, the existing items moved there verbatim (split and move
  notes with them), the backlog sorted into the tracks' _Ideas_.
- The process follows: workflows (`start-branch`, `finish-branch`), `.ai/README.md`, the plan
  template, `AGENTS.md`, `CLAUDE.md`, the skills, `README.md`, `docs/README.md`.
- Parallel branches merging cleanly: the shared files that every branch touches (see Design).
- A `pnpm roadmap` overview and a roadmap check in `pnpm check` (Q4).
- ADR-0027 for the decision.

**Out of scope** (and where it goes instead)

- New items in the tracks (promoting ideas, AVR and FPGA content) → the user's next branches.
- Renumbering existing items (Q2).
- Worktrees for simultaneous sessions, unless Q4 says now → a later `chore/` branch.

## Context

Read before starting:

- [docs/roadmap.md](../../docs/roadmap.md) — the list being restructured.
- [docs-roadmap-reorder.md](docs-roadmap-reorder.md) — the last restructuring; decided that
  item ids are kept when items move.
- [.ai/workflows/](../workflows/) — `start-branch`, `finish-branch` read and write the roadmap.
- `scripts/layers.ts`, `scripts/check-layers.ts`, `scripts/layers.test.ts` — the pattern for a
  repo check: pure module, a runner, unit tests.

## Design

### Concepts

- **Track** — a line of work with a goal, a file `docs/roadmap/<name>.md` and an id prefix
  (`LIB`). Tracks run in parallel; a track can be added at any time.
- **Item** — one branch, one plan, as before. Ids are `<PREFIX>-<n>`, numbered per track from 1,
  never reused or renumbered; an item split at its start becomes `LIB-3a`, `LIB-3b`. Statuses:
  `done` · `in-progress` · `next` · `planned`. Within a track the order is the dependency: done
  items first, then at most **one head** (`next` or `in-progress`), then planned ones. If two
  items of one track need to run at once, the track is too wide: split it. Cross-track
  dependencies are explicit: `Needs: LIB-4`.
- **Milestone** — a goal across tracks (M1…M5, numbered globally), listed in the index with the
  items it needs and its acceptance test.
- **Idea** — an unnumbered bullet in a track's _Ideas_; promoting it gives it the track's next
  free id. Ideas for tracks that don't exist yet are listed in the index.
- Branches outside items (`fix/`, `chore/`, `docs/`) have no id; a request between items becomes
  an item in its track (replaces the "Off the roadmap" section).

### Layout

```
docs/roadmap.md              index: concepts, rules, tracks, milestones, track ideas
docs/roadmap/platform.md     PLT · kernel, circuit model, editor, design tools
docs/roadmap/parts.md        LIB · the parts library
docs/roadmap/sap-1.md        SAP · Ben Eater's SAP-1 (→ M3)
docs/roadmap/mos6502.md      MOS · 65C02 systems (→ M4)
```

The index keeps the old path, so the ~30 links to `docs/roadmap.md` (old plans, README, vision)
keep working. The index holds **no item statuses**: two branches in different tracks would edit
adjacent rows of one table and conflict; each branch edits only its own track's file. A track's
file: header (prefix, goal, links), an items table (`ID | Branch | Title | Needs | Status`), one
section per item (heading without the status, so the table is the only place it lives), _Ideas_.

Existing items, by track:

- `platform`: R00, R01, R02, R04a, R04b, R05, R07, R10a, R10b, R12b, R13, R14a, R14b, R11a,
  R11b, R15a, R15b (all done).
- `parts`: R03, R06, R08, R09a, R09b, R12a, the HD44780 LCD (no id; came off the roadmap).
- `sap-1`: R16a (`next`), R16b.
- `mos6502`: R17, R18, R19, R20 (`planned`; the track starts when the user decides).

Backlog → _Ideas_ of `platform` (kernel, editor, tools, files, export) or `parts` (logic families,
EEPROM writes, passives, LCD follow-ups); other CPUs/MCUs and video output → track ideas in the
index.

### Parallel branches

Files every branch touches, and what keeps their merges clean:

- The roadmap — one file per track; the index changes only when tracks or milestones do.
- `.ai/lessons.md` (append-only) — `merge=union` in `.gitattributes`.
- ADR numbers — two branches may take the same next number: `finish-branch` checks the number is
  still free after merging `main` and renumbers if not.
- Long-lived branches drift — `finish-branch` merges `main` into the branch and runs `pnpm check`
  before verifying.
- Two branches of one track — `start-branch` checks `git branch --list` for another branch of
  the same track (status `in-progress` lives on its branch, not on `main`).

### `pnpm roadmap` (Q4)

`scripts/roadmap.ts` (pure: parse the index and the track files, validate) with unit tests,
run by `scripts/roadmap-cli.ts`:

- `pnpm roadmap` prints each track's head (with Needs not yet done, and whether its branch exists
  locally), done counts, and the milestones' state — the view the index no longer has.
- `pnpm check:roadmap` (part of `pnpm check`) fails on: a track file missing or a duplicated
  prefix; a duplicated id or branch; an id not matching its track's prefix (legacy `R…` ids
  allowed); an unknown status; statuses out of order or two heads in a track; `Needs` or a
  milestone naming an unknown id; a reached milestone with undone items; a table row without its
  section or the other way round; a done or in-progress item without its plan file.

## Tasks

- [ ] 1. Track files: items moved verbatim, split/move notes with them, ideas sorted.
- [ ] 2. Index: concepts and rules, tracks, milestones with needs and acceptance, track ideas,
  the note on the old phases.
- [ ] 3. `scripts/roadmap.ts` + tests; `pnpm roadmap`, `pnpm check:roadmap` in `pnpm check` (Q4).
- [ ] 4. Process: workflows, `.ai/README.md`, plan template, skills, `AGENTS.md`, `CLAUDE.md`,
  `README.md`, `docs/README.md`.
- [ ] 5. Parallel safety: `.gitattributes`, the ADR numbering rule in `docs/adr/README.md`.
- [ ] 6. ADR-0027; lessons.
- [ ] 7. Merge to `main` with the user's approval.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green.
- [ ] Every item of the old roadmap is in exactly one track with its text unchanged; every
  backlog idea is in exactly one place (checked by a script against `main`'s file).
- [ ] No broken relative links in `docs/`, `.ai/`, `README.md`, `AGENTS.md`.
- [ ] `pnpm roadmap` shows R16a as the head of `sap-1`; `pnpm check:roadmap` fails on a
  duplicated id, two heads in one track and an unknown `Needs` (unit tests).
- [ ] The workflows name the new files; `start-branch` without an argument has a defined path.

## Open questions

- [x] Q1. Layout — _proposed:_ index `docs/roadmap.md` + `docs/roadmap/<track>.md`. —
  **answer:** as proposed.
- [x] Q2. Ids of existing items — _proposed:_ all R-ids kept (done and planned), new items get
  `<PREFIX>-<n>`. — **answer:** as proposed.
- [x] Q3. Initial tracks — _proposed:_ platform, parts, sap-1, mos6502; AVR, FPGA and others as
  track ideas in the index. — **answer:** as proposed (programmable logic may start with
  GAL/CPLD before an FPGA).
- [x] Q4. Tooling and simultaneous sessions — _proposed:_ merge safety + `pnpm roadmap` with a
  check in `pnpm check`; worktrees later. — **answer:** as proposed.

## Progress log

- 2026-11-08 — plan drafted; Q1–Q4 answered as proposed; started.

## Handoff

- **State:** plan approved, nothing built yet.
- **Next step:** task 1 — the track files.
- **Watch out:** Biome formats Markdown (`pnpm lint:fix` after editing docs).
- **Verify with:** `pnpm check`.

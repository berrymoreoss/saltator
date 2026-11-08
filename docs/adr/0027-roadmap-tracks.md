# 0027. The roadmap is a set of parallel tracks; milestones span them

- **Status:** accepted
- **Date:** 2026-11-08
- **Roadmap item:** — (docs/roadmap-tracks)

## Context

Until R15b the roadmap was one ordered list: items R00–R20 in phases, each phase ending in a
milestone, exactly one item `next`. It served while the work was one line: the kernel, then the
editor, then the tools, each building on the last. With M2 reached the work branches out:

- Lines of work with no order between them — more parts, the SAP-1 build, the 6502 systems, and
  later other architectures (AVR, programmable logic, video) — each a sequence of several
  branches. In one list, such a line is either interleaved with everything else or squeezed into
  `R21a`, `R21b`, … under one number.
- Two such lines could be worked on at the same time, and in one checkout one after the other
  without finishing either. One `next` for the whole project can't say that.
- Every branch edits the roadmap when it starts and when it finishes. Two parallel branches would
  edit neighbouring rows of the one overview table, which git reports as a conflict.
- Item ids are written in ~117 source and test files, the ADRs and the plans; the last
  restructuring ([docs/roadmap-reorder](../../.ai/plans/docs-roadmap-reorder.md)) kept them, and
  they must stay resolvable.

## Decision

- **Tracks.** The roadmap is a set of tracks, each a file in `docs/roadmap/` with a goal, what
  does not belong in it, an items table, a section per item and ideas. `docs/roadmap.md` is the
  index: the tracks with their id prefixes, the milestones, the rules, ideas for future tracks,
  the history. The first tracks: Platform (`PLT`, R00–R15b except parts), Parts (`LIB`), SAP-1
  (`SAP`, R16a–R16b), MOS 6502 (`MOS`, R17–R20).
- **Items** are still one branch with one plan each. Ids are `<prefix>-<n>`, numbered within the
  track, never changed or reused; the R ids are kept as they are, in their new tracks; the
  HD44780 LCD, which came off the roadmap without an id, is LIB-1. Within a track the table's
  order is the dependency and at most one item is the head (`next` or `in-progress`); other
  tracks' items an item needs are named in `Needs`.
- **Milestones** stay global (M1…M5) and list the items they need from any track, with their
  acceptance.
- **Statuses live only in the track files**; the index changes only when tracks or milestones
  do, so branches of different tracks touch different files.
- **Parallel branches**: one branch per track at a time (`start-branch` checks); `finish-branch`
  merges `main` first and renumbers an ADR number taken meanwhile; `.ai/lessons.md` merges by
  union (`.gitattributes`).
- **Checked**: `scripts/roadmap.ts` parses the index and the tracks; `pnpm check:roadmap` (in
  `pnpm check`) enforces the rules, `pnpm roadmap` prints each track's head, its branch and what
  it waits for, and the milestones' progress — the overview the index no longer has.

## Consequences

- A new line of work is a new file and a row; its items don't wait for, or renumber, anything
  else. Ideas sit in the track they belong to and are promoted there.
- Two sessions can each work on a track. Simultaneous sessions in separate worktrees are not set
  up yet; one checkout switching between branches works (each branch's state is its plan).
- Ids are mixed for a while (`R17` before `MOS-1` in one track): the price of never renaming.
- The roadmap's format is now code's input: a malformed table fails `pnpm check`, with the file
  and line.
- Where the project stands is no longer one table to read: `pnpm roadmap` is that view.

## Alternatives considered

- **One file with a section per track** — simpler to read in one place, but every branch edits
  the same file, and the overview table would conflict between parallel branches.
- **Renaming R16a–R20 into track ids** (`SAP-1`, `MOS-1`, …) with a mapping table — uniform ids,
  but the ADRs and plans that name R17 or R20 would need the table to be read, against the rule
  that an id never changes.
- **Global numbering continued (R21, R22, …) with a track column** — no coordination problem
  solved: two parallel branches would take the same next number, and numbers say nothing.
- **GitHub milestones and issues** — the repository has no remote, and agents work from files in
  the repository, which also keep the history with the code.
- **Splitting Platform into engine, editor and tools now** — no parallel work needs it yet; a
  track is split when two of its items need to move at once.

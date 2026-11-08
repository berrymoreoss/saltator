# Workflow: start a branch

Input, optionally: an item id (`LIB-3`, `R16a`); a track (`Parts` or its prefix `LIB`), meaning
its head; or a branch name (also for `fix/`, `chore/`, `docs/` branches, which have no item —
skip step 2 for them). Without input: run `pnpm roadmap`, show the user the tracks' heads and ask
which one to start.

The rules this workflow follows (tracks, items, heads, `Needs`) are in
[docs/roadmap.md](../../docs/roadmap.md), "How it works".

## 1. Check the ground

```sh
git status            # must be clean; if not, stop and ask the user
git switch main
git pull --ff-only    # only if a remote "origin" exists (git remote)
pnpm install
pnpm check            # main must be green before branching; if not, report and ask
```

## 2. Pick the item

- `pnpm roadmap` shows every track's head, its branch, and what it waits for.
- The item is its track's head (`next`). If the user names a planned item of a track whose head
  is another one, ask: then the named item becomes the head (`next`, its row and section moved up
  to right after the done items) and the old head goes back to `planned`.
- Its `Needs` are done. If not, tell the user what it waits for and ask how to proceed.
- No other branch of the same track exists (`git branch --list`, against the branches in the
  track's items table): a track has one branch at a time, and an `in-progress` status lives on
  its branch until the merge, so `main` doesn't show it.
- Work that isn't on the roadmap yet (the user asks for something new): add it to its track
  first — the track's next free id, a row, a section (from an idea if there is one) — or create a
  track if none fits.

## 3. Load context

Read, in this order:

1. `AGENTS.md` (conventions — you probably have it already).
2. The item's track file (`docs/roadmap/<track>.md`) — the item, its neighbours, its `Needs` —
   and the milestones in `docs/roadmap.md` that need it.
3. The existing plan for the item if one was pre-drafted (`.ai/plans/<branch>.md`).
4. Docs the item touches (`docs/architecture.md`, `docs/simulation.md`, `docs/components.md`,
   `docs/circuit.md`) and the ADR index (`docs/adr/README.md`).
5. `.ai/lessons.md`.
6. The code the item builds on.

## 4. Create the branch

```sh
git switch -c <type>/<slug>      # e.g. feat/engine-core, as named in the track's items table
```

## 5. Write or refine the plan

- File: `.ai/plans/<type>-<slug>.md`, from `.ai/plans/_template.md` if it doesn't exist.
- Fill Goal, Scope (in/out), Context links, Design, Tasks (small, ordered, each one committable
  with its tests), Acceptance criteria (checkable), Open questions.
- Design decisions with real alternatives: list the options and your recommendation.
- Scope that belongs to another track goes there (an idea, or an item named in `Needs`), not into
  this branch.

## 6. Get approval

Present a short summary of the plan to the user and **ask the open questions** (use the
question tool if available). Record the answers in the plan. Do not write production code before
the user approves the plan.

## 7. Mark as started

- Plan: `Status: in-progress`, add a progress-log entry with today's date.
- Track file: the item's status `next` → `in-progress`.
- `pnpm check:roadmap`.
- Commit: `docs(plan): start <branch>`.

## 8. Implement

Work through the tasks in order. For each task: code + tests → `pnpm check` → tick the checkbox
in the plan → commit (Conventional Commits). Keep the plan's progress log current; when context
gets long or the session ends, run the **handoff** workflow.

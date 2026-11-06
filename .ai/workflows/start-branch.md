# Workflow: start a branch

Input: optionally a roadmap item id (`R03`) or branch name. Default: the item with status `next`
in `docs/roadmap.md`.

## 1. Check the ground

```sh
git status            # must be clean; if not, stop and ask the user
git switch main
git pull --ff-only    # only if a remote "origin" exists (git remote)
pnpm install
pnpm check            # main must be green before branching; if not, report and ask
```

## 2. Load context

Read, in this order:

1. `AGENTS.md` (conventions — you probably have it already).
2. `docs/roadmap.md` — the item, its neighbours, dependencies.
3. The existing plan for the item if one was pre-drafted (`.ai/plans/<branch>.md`).
4. Docs the item touches (`docs/architecture.md`, `docs/simulation.md`, `docs/components.md`)
   and the ADR index (`docs/adr/README.md`).
5. `.ai/lessons.md`.
6. The code the item builds on.

## 3. Create the branch

```sh
git switch -c <type>/<slug>      # e.g. feat/engine-core, as named in the roadmap
```

## 4. Write or refine the plan

- File: `.ai/plans/<type>-<slug>.md`, from `.ai/plans/_template.md` if it doesn't exist.
- Fill Goal, Scope (in/out), Context links, Design, Tasks (small, ordered, each one committable
  with its tests), Acceptance criteria (checkable), Open questions.
- Design decisions with real alternatives: list the options and your recommendation.

## 5. Get approval

Present a short summary of the plan to the user and **ask the open questions** (use the
question tool if available). Record the answers in the plan. Do not write production code before
the user approves the plan.

## 6. Mark as started

- Plan: `Status: in-progress`, add a progress-log entry with today's date.
- Roadmap: item status `next` → `in-progress`.
- Commit: `docs(plan): start <branch>`.

## 7. Implement

Work through the tasks in order. For each task: code + tests → `pnpm check` → tick the checkbox
in the plan → commit (Conventional Commits). Keep the plan's progress log current; when context
gets long or the session ends, run the **handoff** workflow.

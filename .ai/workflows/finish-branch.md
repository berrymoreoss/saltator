# Workflow: finish a branch

## 1. Catch up with `main`

Other tracks' branches may have been merged since this one started.

- `git log --oneline HEAD..main` — if `main` moved, `git merge main` and resolve the conflicts
  (the usual places: shared docs such as `docs/components.md`, the ADR index, registries).
- ADR numbers: if `main` now has an ADR with the number this branch gave one of its own, take the
  next free number for ours (file name, the index row, every link to it).
- `pnpm check` must be green after the merge.

## 2. Verify

- Walk through every **acceptance criterion** in the plan and check it for real (run the test,
  open the app, measure). Tick each one; anything unmet → back to work or agree with the user to
  move it to a follow-up item.
- `pnpm check && pnpm build` must be green.
- For UI work: run the app and look at it (`pnpm dev`).

## 3. Update the knowledge base

- `docs/` reflects what was actually built (architecture, simulation, components…). Remove
  _(planned)_ markers for things that now exist.
- New architectural decisions → ADR (`docs/adr/`), index updated.
- New procedures (e.g. "how to add a part") → `.ai/workflows/`.
- `.ai/lessons.md` — append new non-obvious learnings.
- `AGENTS.md` — only if conventions or commands changed.

## 4. Close the plan and the roadmap item

- Plan: `Status: done`, final progress-log entry with a summary, Handoff section → "Merged; nothing
  pending" (or follow-ups with their roadmap ids).
- Track file (`docs/roadmap/<track>.md`): the item → `done`, its section rewritten as what was
  built (specs, decision, plan linked); the track's next planned item → `next`, unless the user
  wants the track to stay idle. Follow-ups found during the work → items or ideas of their tracks.
- Milestones (`docs/roadmap.md`): if the item was the last one a milestone needs, check the
  milestone's acceptance and mark it `reached` with the evidence.
- `pnpm check:roadmap`.
- Commit: `docs(plan): finish <branch>`.

## 5. Merge (ask the user first)

Show the user a summary (what changed, acceptance results, follow-ups) and **ask for approval to
merge**. Then:

- **With a remote** (`git remote` shows `origin`):

  ```sh
  git push -u origin <branch>
  gh pr create --base main --title "<title> (<id>)" --body "<summary + link to the plan>"
  ```

  Wait for CI; merge with a merge commit after the user approves (`gh pr merge --merge
  --delete-branch`), then `git switch main && git pull --ff-only`.
- **Without a remote**:

  ```sh
  git switch main
  git merge --no-ff <branch> -m "Merge <branch>: <title> (<id>)"
  git branch -d <branch>
  ```

## 6. Report

Tell the user it's merged and where the tracks stand now (`pnpm roadmap`), and that they can
`/clear` and run `/start-branch` for the next item of any track.

# Workflow: finish a branch

## 1. Verify

- Walk through every **acceptance criterion** in the plan and check it for real (run the test,
  open the app, measure). Tick each one; anything unmet → back to work or agree with the user to
  move it to a follow-up item.
- `pnpm check && pnpm build` must be green.
- For UI work: run the app and look at it (`pnpm dev`).

## 2. Update the knowledge base

- `docs/` reflects what was actually built (architecture, simulation, components…). Remove
  _(planned)_ markers for things that now exist.
- New architectural decisions → ADR (`docs/adr/`), index updated.
- New procedures (e.g. "how to add a part") → `.ai/workflows/`.
- `.ai/lessons.md` — append new non-obvious learnings.
- `AGENTS.md` — only if conventions or commands changed.

## 3. Close the plan and the roadmap item

- Plan: `Status: done`, final progress-log entry with a summary, Handoff section → "Merged; nothing
  pending" (or follow-ups with their roadmap ids).
- Roadmap: item → `done`; next item → `next`. Add follow-up items discovered during the work.
- Commit: `docs(plan): finish <branch>`.

## 4. Merge (ask the user first)

Show the user a summary (what changed, acceptance results, follow-ups) and **ask for approval to
merge**. Then:

- **With a remote** (`git remote` shows `origin`):

  ```sh
  git push -u origin <branch>
  gh pr create --base main --title "<title> (RNN)" --body "<summary + link to the plan>"
  ```

  Wait for CI; merge with a merge commit after the user approves (`gh pr merge --merge
  --delete-branch`), then `git switch main && git pull --ff-only`.
- **Without a remote**:

  ```sh
  git switch main
  git merge --no-ff <branch> -m "Merge <branch>: <title> (RNN)"
  git branch -d <branch>
  ```

## 5. Report

Tell the user it's merged, what's next on the roadmap, and that they can `/clear` and run
`/start-branch` for the next item.

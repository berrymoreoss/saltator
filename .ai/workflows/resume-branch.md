# Workflow: resume a branch

Use at the start of a session on an existing feature branch (typically right after `/clear`).

1. `git branch --show-current` — if on `main`, there is nothing to resume: suggest
   `start-branch` instead.
2. Open `.ai/plans/<branch with "/" → "-">.md`. Read **Handoff** first, then Tasks, Open
   questions and the latest progress-log entries.
3. Check the real state matches the handoff: `git status`, `git log --oneline -10`, and the
   _Verify with_ commands from the handoff (usually `pnpm check`).
4. If anything disagrees with the plan (uncommitted changes, failing tests not mentioned), report
   it to the user before continuing.
5. Read the docs/code listed in the plan's Context that the next task touches, plus
   `.ai/lessons.md`.
6. Briefly tell the user where things stand and what you'll do next, then continue with the
   **Next step** from the handoff.

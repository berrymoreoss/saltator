# Workflow: hand off a session

Run this before the user clears the context (`/clear`), when stopping mid-task, or when the
context is getting long. Goal: a fresh agent can continue with zero guesswork.

## 1. Bring the code to a resting state

- Prefer finishing the current task. If not possible, make the tree consistent.
- Run `pnpm check`.
  - Green → commit normally.
  - Red and can't be fixed now → commit with a `wip:` prefix and describe the failure in the
    handoff. Never leave uncommitted work.

## 2. Update the plan (`.ai/plans/<branch>.md`)

- Tick finished tasks; adjust remaining tasks if the approach changed.
- Progress log: add a dated entry — what was done this session (2–5 bullets).
- **Handoff** section (replace the previous content):
  - **State**: what works, what's half-done (files, functions).
  - **Next step**: the single concrete action to take first.
  - **Watch out**: gotchas, failing tests and why, decisions pending with the user.
  - **Verify with**: commands to confirm the state (`pnpm test src/core`, …).

## 3. Capture lessons

Anything non-obvious learned this session that would bite again (tool quirks, kernel subtleties,
datasheet traps) → append to `.ai/lessons.md`. Don't duplicate what the code or docs already say.

## 4. Commit and report

```sh
git add -A && git commit -m "docs(plan): handoff <short summary>"
```

Tell the user: branch name, what's done, the next step, and that it's safe to `/clear`. The next
session starts with the resume-branch workflow (`/resume-branch` in Claude Code).

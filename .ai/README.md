# .ai — process memory for AI-driven development

Agents start every session with an empty context. This folder holds everything an agent needs to
continue the work exactly where the previous session stopped. Product and architecture knowledge
lives in [`docs/`](../docs/README.md); this folder is about **process and state**.

```
.ai/
├── README.md              this file
├── workflows/             step-by-step procedures (tool-agnostic)
│   ├── start-branch.md    pick a roadmap item, branch, write/approve the plan
│   ├── resume-branch.md   continue a branch in a fresh session (after /clear)
│   ├── handoff.md         end a session cleanly so the next one can resume
│   └── finish-branch.md   verify, document, merge
├── plans/                 one plan per branch: <branch with "/" → "-">.md
│   └── _template.md
└── lessons.md             non-obvious things learned the hard way (append-only log)
```

## Lifecycle of a branch

```
roadmap item (docs/roadmap.md, status "next")
  └─ start-branch ─► branch feat/<slug> + plan .ai/plans/feat-<slug>.md (status: approved)
       └─ sessions (resume-branch at the start of each): implement tasks, tick checkboxes, log progress
            └─ handoff (before /clear or when stopping) ─► plan "Handoff" section updated
       └─ finish-branch ─► acceptance verified, docs updated, roadmap updated, merged to main
```

## Rules

- **One branch = one roadmap item = one plan.** Small fix/chore branches still get a short plan
  (Goal + Tasks + Handoff).
- **The plan is the source of truth for the branch's state.** If it isn't in the plan (or in git),
  the next session won't know it.
- **Plans are committed** on the branch and merged to main with it — they become the history of
  why things were built the way they were.
- **Ask, don't assume.** Design forks go to the user as questions; answers are recorded in the
  plan's "Open questions" section (and as an ADR if architectural).

## Claude Code adapters

`.claude/skills/` exposes the workflows as slash commands: `/start-branch`, `/resume-branch`,
`/handoff`, `/finish-branch`. They only point to the files here, so other agents can follow the same
procedures by reading `.ai/workflows/` directly.

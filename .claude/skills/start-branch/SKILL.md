---

name: start-branch
description: Start a roadmap item — create its branch, write or refine its plan in .ai/plans, ask the open questions and get the user's approval before coding.
argument-hint: "[item id like LIB-3, a track like Parts, or a branch name]"
disable-model-invocation: true
---

Follow `.ai/workflows/start-branch.md` step by step.

Target: $ARGUMENTS (if empty, run `pnpm roadmap` and ask which track's head to start).

Ask the plan's open questions and any design forks with the AskUserQuestion tool. Do not write
production code until the user has approved the plan.

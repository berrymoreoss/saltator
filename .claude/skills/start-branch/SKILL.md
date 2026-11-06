---

name: start-branch
description: Start a roadmap item — create its branch, write or refine its plan in .ai/plans, ask the open questions and get the user's approval before coding.
argument-hint: "[roadmap id like R03, or branch name]"
disable-model-invocation: true
---

Follow `.ai/workflows/start-branch.md` step by step.

Target: $ARGUMENTS (if empty, the roadmap item with status `next` in `docs/roadmap.md`).

Ask the plan's open questions and any design forks with the AskUserQuestion tool. Do not write
production code until the user has approved the plan.

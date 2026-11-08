@AGENTS.md

## Claude Code specifics

- Slash commands (in `.claude/skills/`, thin wrappers around `.ai/workflows/`):
  `/start-branch [item id | track | branch]`, `/resume-branch`, `/handoff`, `/finish-branch`.
- Use the AskUserQuestion tool for design forks and a plan's open questions; put your
  recommendation first.
- On a feature branch at the start of a session, read the branch's plan (Handoff section first)
  before doing anything else.
- The user communicates in Russian; reply in Russian. Everything written to the repo stays in
  English.

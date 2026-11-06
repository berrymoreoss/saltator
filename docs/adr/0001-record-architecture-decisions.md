# 0001. Record architecture decisions

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R00 (foundation)

## Context

The project is developed mostly by AI agents working in short sessions, each starting with an
empty context. Decisions made in one session must be visible and binding in the next, together with
their reasons, or they will be re-litigated or silently reversed.

## Decision

Record every architecturally significant decision as a numbered ADR in `docs/adr/` using
`template.md`. A decision is significant if reversing it would touch several modules, change the
saved file format, change the kernel semantics, or add a runtime dependency to a pure layer.

## Consequences

- Agents read the ADR index before designing; plans link the ADRs they rely on.
- A branch that makes such a decision adds an ADR in the same branch.
- Superseded ADRs stay, marked `superseded by NNNN`.

## Alternatives considered

- **Decisions only in plans** — plans are per-branch and become stale; hard to find later.
- **Decisions only in architecture.md** — loses the "why" and the rejected alternatives.

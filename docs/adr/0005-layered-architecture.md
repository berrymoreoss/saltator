# 0005. Layered architecture with enforced boundaries

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R00 (foundation)

## Context

The kernel and library must be testable headless, runnable in a Web Worker later, and must not
become entangled with rendering or React. In AI-driven development, conventions that aren't
enforced tend to erode one shortcut at a time.

## Decision

Six layers under `src/`: `core`, `library`, `circuit` (pure) and `editor`, `ui`, `app`. Allowed
dependencies are listed in [architecture.md](../architecture.md#layers) and enforced by:

- `scripts/check-layers.ts` (part of `pnpm check`): forbids imports against the layer order and npm
  packages in pure layers (except an explicit allowlist).
- `tsconfig.core.json`: type-checks pure layers without the DOM lib.

`circuit` does not import `library`; component definitions reach it through a registry interface
defined in `core`.

## Consequences

- Pure layers stay portable and fast to test.
- Adding a dependency to a pure layer is a deliberate act (allowlist + ADR).
- Some indirection (registry injection, observable stores) instead of direct imports.

## Alternatives considered

- **pnpm workspace with separate packages** — strongest isolation, but more config and build
  overhead for a single app. Can be adopted later if the kernel is published separately.
- **Convention only** — erodes.

# 0034. The commit is the version

- **Status:** accepted
- **Date:** 2026-11-11
- **Roadmap item:** — (chore/about-version)

## Context

The live demo is deployed by hand from `main` (ADR-0033) and lags it until someone deploys, so
looking at it, or reading a bug report about it, needs a way to tell which `main` it runs. There
are no releases: every merge to `main` is the next state of the product, and nobody maintains
the `0.0.0` in `package.json`.

## Decision

- **The version is the commit** the build was made from: Help ▸ About shows its short hash,
  linked to the commit on GitHub, and the commit's date — `Version 591d3cd · 2026-11-11`.
- **Read at build time:** `vite.config.ts` calls `readBuildInfo()` (`scripts/build-info.ts`):
  `git rev-parse HEAD`, `git log -1 --format=%cs`, `git status --porcelain`. It defines
  `__SALTATOR_BUILD__`, which only `src/ui/build-info.ts` reads.
- **The same everywhere:** `pnpm build`, the e2e build and the Pages workflow all run it; the
  workflow's shallow checkout has HEAD and its date, so it needs no change. Without git,
  `GITHUB_SHA` gives the hash; without both, the version is `unknown`.
- **Honest marks:** `-dirty` when the working tree had uncommitted changes; `· dev` on the dev
  server, which reads the build info once at its start and may lag later commits.
- **The commit's date, not the build's:** the same commit builds the same text.

## Consequences

- Nothing to bump by hand; the demo's About says exactly what is deployed.
- A local commit that isn't pushed yet links to a page GitHub doesn't have.
- The hash says nothing about compatibility; if releases ever come (a desktop build, a library on
  npm), a semantic version can stand in front of it (`0.1.0+591d3cd`) in a new ADR.

## Alternatives considered

- **A semantic version in `package.json`** (alone or with the hash as build metadata) — needs a
  release process the project doesn't have; the number would mostly stay stale.
- **The build's date and time** — not reproducible, and says nothing about the code.
- **A `virtual:build-info` module from a Vite plugin** — the same result with more code than
  `define`.

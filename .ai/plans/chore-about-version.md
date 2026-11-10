# Plan: chore/about-version

| Field      | Value                                             |
| ---------- | ------------------------------------------------- |
| Branch     | `chore/about-version`                             |
| Roadmap    | — (product polish around the live demo, no track) |
| Status     | in-progress                                       |
| Depends on | `chore/pages-deploy` (merged, ADR-0033)           |
| Created    | 2026-11-11                                        |

## Goal

Help ▸ About tells a newcomer what Saltator is and how to start, and shows which build is
running: the commit it was built from, baked in at build time — locally and in the Pages
workflow — so a bug report or a look at the live demo names the exact `main` it runs.

## Scope

**In scope**

- Build info read from git when Vite loads its config: full commit hash, commit date, whether the
  working tree has changes; `GITHUB_SHA` as a fallback when git isn't there; nothing when neither.
- The About dialog: a clearer text (what it is, what it does, where data lives, how to start),
  the version (`591d3cd · 2026-11-11`, the hash linking to the commit on GitHub; `-dirty` for a
  build with uncommitted changes; `· dev` on the dev server), links to the source and license.
- Tests: the build-info reader (unit), the version formatting (unit), the About dialog (e2e).
- Docs: an ADR for the versioning scheme, `docs/editor.md` (About), lessons if any.

**Out of scope** (and where it goes instead)

- Semantic versions, release tags, a changelog → not now (Q1: the commit is the version).
- Showing the version anywhere else (status bar, file metadata) → not asked for.

## Context

- `src/ui/Dialogs.tsx` — `AboutDialog`.
- `vite.config.ts` — shared by `vite build`, `vite dev` and Vitest; no `define` today.
- `.github/workflows/pages.yml` — `actions/checkout` (shallow, depth 1) then `pnpm build`.
- [ADR-0033](../../docs/adr/0033-pages-demo.md) — the manual Pages deploy of `main`.

## Design

- **Where the value comes from:** `scripts/build-info.ts` exports `readBuildInfo()`: `git
  rev-parse HEAD`, `git log -1 --format=%cs` (the commit date, so the same commit always builds
  the same text), `git status --porcelain` (dirty). A shallow checkout has all three. Without git:
  `GITHUB_SHA` (no date), else nulls.
- **How it gets into the app:** `vite.config.ts` puts it in `define` as `__SALTATOR_BUILD__`
  (JSON). `src/ui/build-info.ts` declares the constant, holds the formatting
  (`describeVersion`) and the repo URL, and is imported by the About dialog only, so nothing run by
  Node directly (the headless scripts) touches the undefined global.
- **Dev server:** the config is read once at server start, so the hash may lag later commits; the
  `· dev` mark (`import.meta.env.DEV`) says not to trust it fully.
- **Versioning scheme:** the commit is the version (Q1) — ADR-0034.

## Tasks

- [x] 1. `scripts/build-info.ts` + tests; `define` in `vite.config.ts`.
- [x] 2. `src/ui/build-info.ts` (`describeVersion`) + tests; the new About dialog and its styles;
  an e2e test (Help ▸ About shows the text and a 7-hex version).
- [x] 3. Docs: ADR-0034, `docs/adr/README.md`, `docs/editor.md`; a subpath build checked by hand.

## Acceptance criteria

- [x] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [x] A clean `pnpm build` shows `Version <HEAD short hash> · <commit date>` in About, the hash
  linking to the commit on GitHub; with uncommitted changes it says `-dirty`; `pnpm dev` adds
  `· dev`.
- [x] A build with no git and no `GITHUB_SHA` still builds and About says the version is unknown.
- [x] The Pages workflow needs no change: its checkout has HEAD, and its build reads it.

## Open questions

- [x] Q1. Version format — _proposed:_ short hash + commit date, hash links to the commit,
  `-dirty` / `· dev` marks — **answer:** as proposed.
- [x] Q2. About text — _proposed:_ tagline, what it does, data stays local, how to start, version
  and links — **answer:** as proposed.

## Progress log

- 2026-11-11 — plan drafted, Q1–Q2 answered, started.
- 2026-11-11 — tasks 1–3 done. Checked by hand: a `--base=/saltator/` build in light and dark
  (`Version 350fadb · 2026-11-11`, no console errors), the dev server (`· dev`), a `git archive`
  copy without `.git` (`commit: null`, and the hash from `GITHUB_SHA`). The hint says
  **File ▸ New from Example…** (the gallery command) rather than the approved draft's
  "File ▸ Examples", which is a submenu of single examples.
- 2026-11-11 — the user asked for the pixel-art bird on a chip in About: round-1 art copied from
  `playground/art/staging/saltator/1x/chip.png` (32×32, git-ignored source; the icon isn't picked
  yet) to `src/ui/assets/saltator-chip.png`, shown at 64 px with `image-rendering: pixelated`;
  Vite inlines it (under 4 KB), so the subpath build needs nothing. Checked in both themes.

## Handoff

- **State:** all tasks done, acceptance verified; waiting for the user's approval to merge.
- **Next step:** finish-branch (merge with `--no-ff`); a Pages deploy only if the user asks.
- **Watch out:** `__SALTATOR_BUILD__` exists only under Vite; keep `src/ui/build-info.ts` out of
  anything Node runs directly.
- **Verify with:** `pnpm check`, `pnpm build && pnpm preview`, Help ▸ About.

# Plan: chore/pre-public

| Field      | Value                                                     |
| ---------- | --------------------------------------------------------- |
| Branch     | `chore/pre-public`                                        |
| Roadmap    | — (publication under the `berrymoreoss` org, not a track) |
| Status     | done                                                      |
| Depends on | `chore/rename-saltator` (merged)                          |
| Created    | 2026-11-10                                                |

## Goal

The last fixes before the repository goes public, found by a pre-publication audit of the files,
the whole history (432 commits) and the GitHub settings. The audit found no secrets, no local
paths, no private email in the files and no surprises in deleted files. Two things are left:
third-party data shipped without its full license notice, and a leftover of the rename.

## Scope

**In scope**

- The SingleStepTests sample (`src/library/cpu/w65c02s-sst-sample.ts`, MIT): the full MIT notice
  (copyright line and permission notice), as the license asks of "all copies or substantial
  portions". Written by its generator, `scripts/sample-65c02.ts`, so a regenerated file keeps it.
- The favicon: `public/favicon.svg` (the old gate, `<title>Logic</title>`) → a temporary
  `public/favicon.ico` from Saltator's staged `head-16` sketch (16 px; 32 and 48 are it ×2 and ×3,
  nearest-neighbour, like the art pipeline's release pack). `index.html` links it.

**Out of scope** (and where it goes instead)

- The final icon, favicon set and app icon → publication stage 4 (the untracked
  `docs/publication.md`), after the icon is picked and frozen in `playground/art/`.
- GitHub Pages, the README screenshot and demo link, visibility, rulesets, secret scanning →
  publication stage 3. On the free plan Pages and rulesets need a public repo, so they come
  after the switch.
- Housekeeping after PR #1 (local `main` updated, the merged branch deleted) — done on `main`
  before this branch, nothing to commit.

## Context

- `scripts/sample-65c02.ts` — writes the sample's header; `src/library/cpu/w65c02s-sst.test.ts`
  is its only user (the sample is not in the app bundle).
- SingleStepTests 65x02 `LICENSE`: MIT, "Copyright (c) 2024 Thomas Harte et al".
- `index.html` — the `<link rel="icon">`; `public/` — served at the site root.
- `playground/art/` (git-ignored) — the art pipeline; `staging/saltator/1x/head-16.png` is the
  16×16 original, `lib/encode.ts` its ICO encoder (a directory of PNGs).

## Design

- **The notice lives in the generated file's header**, written by the generator: the sample is
  the only copy of SingleStepTests data in the repo and it isn't bundled, so a separate
  `THIRD_PARTY_NOTICES` would only point back to it. Regenerated from the local download cache to
  prove the generator and the file agree (only the header changes).
- **ICO only, no SVG fallback.** The 16-px drawing is pixel art: an ICO with 16, 32 and 48 keeps
  it crisp on 1× and 2× screens, and every browser reads PNG-in-ICO. Built with the art
  pipeline's encoder; the 16×16 image round-trips byte for byte.

## Tasks

- [x] 1. SingleStepTests notice: the full MIT text in `sample-65c02.ts`' header template;
  regenerate the sample (only the header changes).
- [x] 2. Favicon: `public/favicon.ico` from `head-16`; remove `public/favicon.svg`; `index.html`.
- [x] 3. Verify: `pnpm check`, `pnpm build`, `pnpm e2e`; in the browser the tab shows the bird.

## Acceptance criteria

- [x] `pnpm check`, `pnpm build` and `pnpm e2e` are green.
- [x] `w65c02s-sst-sample.ts` carries the SingleStepTests copyright line and MIT permission
  notice; regenerating it gives the same file.
- [x] No product-name "Logic" left in `public/` or `index.html`.
- [x] The dev server and the build serve `favicon.ico` (16, 32, 48) and the tab shows it.
  (Headless Chromium: the page links it, it loads, all three sizes decode; the Chrome extension
  wasn't connected, so the tab strip itself is for the user to glance at.)

## Open questions

None: the scope is the audit's items 1–3, approved by the user on 2026-11-10; the icon is the
user's pick (`head-16`, temporary).

## Progress log

- 2026-11-10 — pre-publication audit (files, history, GitHub settings); the user approved items
  1–3. Item 1 done on `main` (pulled the merge of PR #1; the remote branch was already gone, the
  local one deleted). `main` green (`pnpm check`). Branch created, plan written, started.
- 2026-11-10 — tasks 1–3 done. The notice (`6726f93`): the generator writes SingleStepTests' MIT
  text; regenerated from the cache, only the header changed, and a second run is identical. The
  favicon (`eb24a62`): `favicon.ico` (896 bytes; 16 from `staging/saltator/1x/head-16.png`, 32 and
  48 nearest-neighbour), `favicon.svg` removed. Verified: `pnpm check` (3334 tests), `pnpm build`
  (`dist/favicon.ico` identical), `pnpm e2e` (96 passed); `pnpm dev` and `pnpm preview` serve it,
  headless Chromium decodes 16/32/48. Lesson: the rename's grep looked at `src/` and missed
  `public/`.

## Handoff

- **State:** done; waiting for the user's approval to merge.
- **Next step:** after approval push, open the PR, `gh pr merge --merge --delete-branch`, then
  `git switch main && git pull --ff-only`. Publication goes on in the untracked
  `docs/publication.md` (stage 3).
- **Watch out:** `playground/` is git-ignored: only the generated `favicon.ico` entered the repo.
- **Verify with:** `pnpm check && pnpm build && pnpm e2e`.

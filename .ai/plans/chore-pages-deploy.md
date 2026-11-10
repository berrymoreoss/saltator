# Plan: chore/pages-deploy

| Field      | Value                                                     |
| ---------- | --------------------------------------------------------- |
| Branch     | `chore/pages-deploy`                                      |
| Roadmap    | — (publication under the `berrymoreoss` org, not a track) |
| Status     | in-progress                                               |
| Depends on | `docs/readme-screenshot` (merged); the repo is public     |
| Created    | 2026-11-10                                                |

## Goal

A live demo at `https://berrymoreoss.github.io/saltator/`, deployed **by hand only**: the author
decides when `main` goes live (the user's requirement). Readers of the README can try the app
without installing anything.

## Scope

**In scope**

- `.github/workflows/pages.yml`: `workflow_dispatch` only; checks, a build for the `/saltator/`
  subpath, upload and deploy to GitHub Pages.
- Pages enabled on the repo with GitHub Actions as its source.
- The app works under the subpath (favicon, examples, `?example=`, the test runner's workers):
  checked locally on a `--base /saltator/` build before the merge.
- Docs: AGENTS.md (the deploy command), README (the demo link), an ADR (hosting and the manual
  deploy).

**Out of scope** (and where it goes instead)

- CI on push/PR → stays on demand (see Q3).
- A custom domain (`saltator.berrymore.im`) → publication stage 5, after the domain.
- The repo's description, topics, website field, security settings → publication stage 3
  leftovers (the website field is set after the first deploy, by hand or with `gh`).

## Context

- `.github/workflows/ci.yml` — the on-demand CI job this mirrors (pnpm, Node from `.nvmrc`).
- `vite.config.ts` — no `base` today; `index.html` links `/favicon.ico`.
- Workers are Blob URLs (`src/app/bench-worker.ts`, `src/ui/test-runner.ts`): no paths to fix.
- Browser storage is namespaced (`saltator`, `saltator.*`, ADR-0032): the `github.io` origin is
  shared by every Pages site of the org, so the keys must not collide — they don't.
- [ADR-0032](../../docs/adr/0032-saltator.md) — the CI-on-demand decision this keeps.

## Design

- **Trigger:** `on: workflow_dispatch` only — the Run workflow button in Actions or
  `gh workflow run Pages`. No `push`, no schedule.
- **What it deploys** (Q2): `main` only; a run started on another branch fails fast before any
  work (`if: github.ref == 'refs/heads/main'`), on top of the `github-pages` environment's own
  branch policy.
- **The subpath:** the workflow builds with `vite build --base=/saltator/`; `vite.config.ts` stays
  without `base`, so `pnpm dev`, `pnpm preview` and the e2e tests keep serving at `/`.
- **Checks before deploying** (Q1): the build only — `pnpm build` (typecheck + `vite build`) with
  `--base=/saltator/`; the tests are the author's local gate before a merge. A `build` job
  uploads, a separate `deploy` job publishes the artifact (`actions/upload-pages-artifact` → `actions/deploy-pages`).
  Permissions: `contents: read`, `pages: write`, `id-token: write`; concurrency group `pages`,
  never cancelling a deploy in progress.
- **Action versions:** the current majors (checked 2026-11-10): `actions/checkout@v7`,
  `actions/setup-node@v7`, `pnpm/action-setup@v6`, `actions/configure-pages@v6`,
  `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`.
- **ADR-0033** "A live demo on GitHub Pages, deployed by hand": Pages over Netlify/Cloudflare
  (no account, no secrets, same org); manual over on-push (the author's control over what is
  live); the subpath only in the deploy build.

## Tasks

- [x] 1. The subpath works: a local `--base /saltator/` build served under `/saltator/`; smoke it
  in a browser (no 404s or console errors; favicon; the gallery; `?example=`; Run; Tests).
- [x] 2. `pages.yml` (Q1–Q2); enable Pages with the Actions source (`gh api … /pages`).
- [x] 3. Docs: ADR-0033 + index; AGENTS.md (Commands: the deploy); README (the demo link);
  `docs/architecture.md` if it covers the build.
- [ ] 4. Verify: `pnpm check`, `pnpm build`; after the merge, the first deploy from `main` (the
  user starts it or asks me to) and the live site checked.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm build` are green.
- [ ] `pages.yml` triggers only on `workflow_dispatch` and refuses a ref other than `main`.
- [ ] A `--base /saltator/` build runs under the subpath without 404s or console errors.
- [ ] After the first deploy, `https://berrymoreoss.github.io/saltator/` opens the app with its
  favicon, and `?example=two-digit-counter` opens the example.

## Open questions

- [x] Q1. What runs before a deploy? — _proposed:_ `pnpm check` + `pnpm test:circuits` + the
  build (a few minutes; a broken `main` can't go live). — **answer:** the build only (it
  typechecks); the tests run locally before a merge.
- [x] Q2. What can be deployed? — _proposed:_ `main` only. — **answer:** as proposed.
- [x] Q3. CI on push/PR now that it's free? — _proposed:_ stays on demand, as the user wants manual
  control. — **answer:** as proposed.

## Progress log

- 2026-11-10 — plan drafted. The user asked for Pages with a manual deploy only; answered
  Q1–Q3 (build only, `main` only, CI stays on demand). Started.

## Handoff

- **State:** in-progress; plan approved.
- **Next step:** task 1.
- **Watch out:** e2e tests use absolute paths (`page.goto('/')`), so they can't run under the
  subpath; the subpath smoke is a separate, local check.
- **Verify with:** `pnpm check && pnpm build`.

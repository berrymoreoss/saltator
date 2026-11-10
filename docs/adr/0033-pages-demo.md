# 0033. A live demo on GitHub Pages, deployed by hand

- **Status:** accepted
- **Date:** 2026-11-10
- **Roadmap item:** — (chore/pages-deploy)

## Context

The repository is public, and Saltator is a static web app: a reader of the README should be able
to try it without cloning anything. The author works alone, checks everything locally before a
merge, and wants to decide when a change goes live rather than have every merge published.
GitHub Actions is free for public repositories, and Pages is free for them on the org's plan.

## Decision

- **Hosting:** GitHub Pages of `berrymoreoss/saltator`, at `https://berrymoreoss.github.io/saltator/`,
  with GitHub Actions as the Pages source.
- **By hand only:** `.github/workflows/pages.yml` runs on `workflow_dispatch` alone (Run workflow
  in Actions, or `gh workflow run Pages`). No push, PR or schedule trigger.
- **`main` only:** a run on any other ref fails at its first step, and the `github-pages`
  environment allows only `main` as well.
- **The build only:** the workflow runs `pnpm build` (typecheck + `vite build`); the tests stay the
  local gate before a merge, as with CI, which also runs only on demand (`ci.yml`).
- **The subpath in the deploy build only:** `--base` comes from `actions/configure-pages`'
  `base_path` (`/saltator`; empty under a custom domain). `vite.config.ts` has no `base`, so
  `pnpm dev`, `pnpm preview` and the e2e tests keep serving at `/`.

## Consequences

- The demo lags `main` until someone deploys: after a merge worth showing, the author runs the
  workflow. Agents don't deploy without being asked.
- A broken `main` can still be deployed if it builds; the local `pnpm check` and `pnpm e2e` before
  each merge are what prevent it.
- The `github.io` origin is shared by every Pages site of the org: browser storage must stay
  namespaced (`saltator`, `saltator.*`, ADR-0032), and it is.
- The e2e tests can't run under the subpath (they navigate to absolute paths); a subpath build is
  smoke-tested by hand when the build setup changes.
- A custom domain (`saltator.berrymore.im`) later needs only the Pages setting and a CNAME: the
  base path follows.

## Alternatives considered

- **Deploy on every push to `main`** — the usual setup, but the author wants control over what is
  live.
- **Run the tests before deploying** — safer, but slower on each deploy and a repeat of the
  checks done before the merge; the author chose the build only.
- **Netlify, Cloudflare Pages, Vercel** — preview deploys and custom headers, but another
  account, secrets in the repo settings and a second place to look; Pages is in the same org.
- **`base: '/saltator/'` in `vite.config.ts`** — one place for it, but the dev server, preview and
  e2e tests would all move to the subpath.

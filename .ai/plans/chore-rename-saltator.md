# Plan: chore/rename-saltator

| Field      | Value                                                     |
| ---------- | --------------------------------------------------------- |
| Branch     | `chore/rename-saltator`                                   |
| Roadmap    | — (publication under the `berrymoreoss` org, not a track) |
| Status     | in-progress                                               |
| Depends on | —                                                         |
| Created    | 2026-11-10                                                |

## Goal

The app gets its public name before the repository goes public: **Logic becomes Saltator**
("Saltator — digital logic simulator"), published under the `berrymoreoss` GitHub org with the
MIT license. Documents become `.saltator.json`. CI runs only
on demand for now: the author is the only developer, everything runs locally, and automatic runs
spend the Actions quota for nothing.

## Scope

**In scope**

- CI: `.github/workflows/ci.yml` runs only on demand; the workflows and docs that say "CI runs it"
  say so.
- File format: `.saltator.json` everywhere (save, open, examples, the headless runner, Biome).
- The product name in the app: page title, window title (`adder — Saltator`), the About dialog and
  command, the file picker's description and ids, the drag MIME type, the VCD `$version`.
- Browser storage keys (IndexedDB `logic`, `logic.settings.v1`, `logic.session`,
  `logic.unload.*`, locks `logic.session.*`). See Q2.
- `package.json` name and description; the temp folder prefix of `scripts/yosys.ts`.
- Docs: AGENTS.md, README (rewritten for readers outside the project), the living specs
  (architecture, editor, circuit); a new ADR; `LICENSE` (MIT).

**Out of scope** (and where it goes instead)

- Making the repo public, GitHub Pages, turning CI back on with the deploy → publication stage 3
  (the untracked `docs/publication.md`).
- A screenshot and a live-demo link in the README → stage 3 (there's no demo URL until Pages).
- Saltator's pixel-art icon and favicon → stage 4.
- Renaming the local checkout folder `logic/` → `saltator/` → after the merge, by the user (Claude
  Code's memory is keyed by the path and moves with it).
- History stays as written: done plans in `.ai/plans/`, accepted ADRs and the descriptions of done
  roadmap items keep "Logic" and `.logic.json`; the new ADR records the change.

## Context

- [AGENTS.md](../../AGENTS.md), [README.md](../../README.md) — the name, the intro.
- [docs/architecture.md](../../docs/architecture.md) "Documents" (~l. 306), [docs/editor.md](../../docs/editor.md)
  "Files" (~l. 1262–1303, l. 1450, l. 1514), [docs/circuit.md](../../docs/circuit.md) test benches
  (~l. 703) — `.logic.json` and "CI runs".
- [.ai/workflows/finish-branch.md](../workflows/finish-branch.md) §5 — "Wait for CI".
- `src/ui/document-session.ts` (`FILE_EXTENSION`, `fileNameFor`, the name from a file name, the
  window title), `src/ui/files.ts` (picker types and ids), `src/ui/browser-storage.ts`,
  `src/ui/autosave.ts`, `src/ui/settings.ts`, `src/ui/parts-filter.ts` (drag MIME),
  `src/ui/Dialogs.tsx` + `src/ui/workbench-commands.ts` (About), `src/ui/WaveformsPanel.tsx`
  (VCD `$version`), `index.html`.
- `src/app/example-files.ts`, `tests/scenarios/examples.test.ts` (globs over `examples/`),
  `scripts/test-circuits.ts` (default files), `scripts/hdl-examples.ts` (writes examples),
  `biome.json` (ignores documents).
- `tests/e2e/*.spec.ts` — titles and file names in expectations.

## Design

- **One constant for the extension:** `FILE_EXTENSION = '.saltator.json'` (Q3: no legacy
  extension). An old `adder.logic.json` still loads through the generic `.json` route (the
  `<input>` fallback and drops accept `.json`; the picker's "All files"), named `adder.logic`;
  renaming it by hand gives the plain name.
- **The product name in one place.** `APP_NAME = 'Saltator'` in `src/ui` is used by the window
  title, About and the VCD `$version`; `index.html` has its own literal.
- **CI on demand:** `on: workflow_dispatch` (the Run button in Actions, or
  `gh workflow run CI`). The job stays as it is, ready for stage 3.
- **Storage keys** (Q2): `saltator` / `saltator.*`, no migration: the old `logic.*` data (the
  autosaved session, view settings, Open Recent) is left behind once.
- **ADR-0032** "Saltator: the product name, `.saltator.json`, browser storage": the name, the
  extension without a legacy one, old browser data left behind, the alternatives.

## Tasks

- [ ] 1. CI on demand: `ci.yml` → `workflow_dispatch`; finish-branch §5 (no CI to wait for; the
  local checks are the gate); docs that say "CI runs" (architecture, editor, circuit).
- [ ] 2. ADR-0032 + its row in `docs/adr/README.md`.
- [ ] 3. File format: `FILE_EXTENSION`, picker types; unit tests (`document-session.test.ts`,
  files tests).
- [ ] 4. Examples: `git mv examples/*.logic.json` → `*.saltator.json`; globs in
  `example-files.ts` and `examples.test.ts`; `hdl-examples.ts`; `test-circuits.ts`' default;
  `biome.json`; their tests.
- [ ] 5. The name in the app: `APP_NAME`; title, About, VCD `$version`, picker description and ids,
  drag MIME, `index.html`, `package.json`, the `yosys.ts` temp prefix; unit and e2e expectations.
- [ ] 6. Browser storage keys → `saltator` / `saltator.*` (Q2); `autosave.test.ts`, browser tests.
- [ ] 7. Docs: AGENTS.md, README for outside readers, living specs (`.logic.json` →
  `.saltator.json`, "Logic" → "Saltator" where it's the product); `LICENSE` (MIT, Q4).
- [ ] 8. Verify: `pnpm check`, `pnpm build`, `pnpm test:circuits`, `pnpm e2e`; in the browser:
  title, About, the gallery, Save As.

## Acceptance criteria

- [ ] `pnpm check`, `pnpm build`, `pnpm test:circuits` and `pnpm e2e` are green.
- [ ] The app says Saltator: tab title `Untitled — Saltator`, About Saltator, VCD `$version Saltator`.
- [ ] New documents save as `name.saltator.json`; the examples are `examples/*.saltator.json` and
  open from the gallery.
- [ ] No product-name "Logic" or `.logic.json` left outside history (plans, accepted ADRs, done
  roadmap items) and the new ADR — checked with `grep`.
- [ ] No `logic` / `logic.*` browser storage keys left in `src/`.
- [ ] `ci.yml` triggers only on `workflow_dispatch`; pushing the branch and opening the PR start
  no runs (`gh run list`).
- [ ] `LICENSE` is MIT.

## Open questions

- [x] Q1. How to turn CI off — _proposed:_ `on: workflow_dispatch` only (the file stays, can be
  run by hand). — **answer:** as proposed.
- [x] Q2. Browser storage keys — _proposed:_ rename to `saltator.*` without migration (only the
  author's browser has `logic.*` data: save open documents to files before updating). —
  **answer:** as proposed.
- [x] Q3. Old `.logic.json` files — _proposed:_ recognised when opening (picker, drop, the name);
  saving writes `.saltator.json`. — **answer:** no: rename only. Old files load through the
  generic `.json` route or after renaming them by hand.
- [x] Q4. The copyright line in `LICENSE` — _proposed:_ `Copyright (c) 2026 Sergei Aleinik`. —
  **answer:** as proposed.

## Progress log

- 2026-11-10 — plan drafted; the user answered Q1–Q4 and approved the plan; started.

## Handoff

- **State:** plan approved, nothing implemented yet.
- **Next step:** task 1 (CI on demand).
- **Watch out:** `docs/publication.md` is untracked on purpose (in `.git/info/exclude`): never
  `git add` it. `src/library/hdl/fixtures.ts` holds huge one-line JSON: exclude it from greps.
- **Verify with:** `pnpm check`, `pnpm e2e`.

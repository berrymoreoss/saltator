# AGENTS.md

Instructions for AI coding agents working in this repository. Humans: see [README.md](README.md).

**Logic** is a browser-based, event-driven digital logic simulator for designing and verifying
computers built from real chips (74HC series first, then ROM/RAM, 6502, peripherals) before
building them: _test before fab_. Start with [docs/vision.md](docs/vision.md) if the domain is new.

## Golden rules

1. **Never commit to `main` directly.** One roadmap item = one branch = one plan in `.ai/plans/`.
   Procedures: [.ai/workflows/](.ai/workflows/) (`start-branch`, `resume-branch`, `handoff`,
   `finish-branch`).
2. **The plan is the state.** Read the branch's plan first (especially _Handoff_); keep checkboxes,
   progress log and handoff current. Anything not in the plan or in git is lost at `/clear`.
3. **Ask at forks.** When a design choice has real alternatives, ask the user (offer a
   recommendation). Record the answer in the plan; architectural ones become an ADR in `docs/adr/`.
4. **Respect the layers.** `core`, `library`, `circuit` are pure (no DOM, no React, no npm
   packages). Allowed imports: [docs/architecture.md#layers](docs/architecture.md#layers).
   Enforced by `pnpm check`.
5. **The kernel is deterministic.** No `Date.now()`, `performance.now()` or `Math.random()` in pure
   layers; pass a seeded RNG if randomness is needed.
6. **Parts follow their datasheet.** Real pinout and timing with the source cited; tests built from
   the datasheet function table ([docs/components.md](docs/components.md); recipe:
   [.ai/workflows/add-component.md](.ai/workflows/add-component.md)).
7. **Green before commit.** `pnpm check` passes before every commit. Don't weaken a test or a lint
   rule to get there — fix the cause or ask.
8. **Docs move with code.** If behavior and docs disagree, fix one of them in the same branch.

## Commands

```sh
pnpm install          # setup (Node >= 24, pnpm via corepack)
pnpm dev              # Vite dev server
pnpm check            # typecheck + lint + layer check + tests — run before every commit
pnpm test             # tests once; pnpm test:watch for watch mode; pnpm test <path> for a subset
pnpm coverage         # tests with coverage (v8)
pnpm bench            # benchmarks (tests/bench), on native imports for realistic numbers
pnpm lint:fix         # format + autofix with Biome
pnpm build            # typecheck + production build
```

pnpm 12 has no `-s` flag; use `pnpm <script>`.

## Repository map

```
AGENTS.md, CLAUDE.md      agent instructions (CLAUDE.md imports this file)
.ai/                      process memory: workflows, per-branch plans, lessons
docs/                     vision, roadmap, architecture, simulation & component specs, ADRs
src/core/                 simulation kernel (pure)
src/library/              part definitions + registry (pure)
src/circuit/              circuit document, schema, netlist compiler (pure)
src/editor/               Canvas2D schematic editor (DOM, no React)
src/ui/                   React panels and shell
src/app/, src/main.tsx    composition root
tests/                    cross-layer scenario tests and benchmarks
scripts/                  repo tooling (TypeScript, run by Node directly)
.claude/skills/           Claude Code slash commands that point to .ai/workflows
```

Each `src/*` folder has a README with its rules.

## Code conventions

- TypeScript strict, including `noUncheckedIndexedAccess` and `erasableSyntaxOnly`: **no `enum`,
  no `namespace`, no constructor parameter properties.** Use `as const` objects + union types.
- No `any`. Prefer `unknown` + narrowing. Non-null assertions (`!`) are allowed for indexed access
  in hot loops where the index is proven valid.
- Named exports only (no default exports, except where a tool requires them, e.g. config files).
  Each layer exposes its public API through `index.ts`; import other layers via their index.
- Files and folders: `kebab-case.ts`; React components: `PascalCase.tsx`.
- Kernel hot paths: no allocations per event, integer indices, typed arrays.
- Comments explain _why_, not _what_. Public APIs get a short TSDoc comment.
- Formatting and import order are Biome's job (`pnpm lint:fix`).

## Testing conventions

- Vitest. Unit tests next to the code: `foo.ts` → `foo.test.ts`. Cross-layer scenarios in
  `tests/scenarios/`, benchmarks in `tests/bench/`.
- Import test APIs explicitly: `import { describe, expect, it } from 'vitest'`.
- Every part: datasheet function-table test + at least one timing assertion (core test bench).
- Tests must be deterministic: fixed seeds, no wall-clock time.
- Bug fix ⇒ regression test first.

## Git conventions

- Branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`, `example/<slug>`; roadmap
  items use the branch name given in [docs/roadmap.md](docs/roadmap.md).
- Plan file: branch name with `/` replaced by `-` → `.ai/plans/feat-engine-core.md`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) — `feat(core): add event
  queue`, `test(library): …`, `docs(plan): …`. Small, focused, each one green.
- Merging to `main`: only with the user's approval, merge commit (`--no-ff` / `gh pr merge
  --merge`). See [.ai/workflows/finish-branch.md](.ai/workflows/finish-branch.md).

## Documentation conventions

- Everything in the repo is written in **English** (code, comments, docs, plans, commits).
- Where things go: product/architecture knowledge → `docs/`; decisions with alternatives →
  `docs/adr/`; branch state → `.ai/plans/`; procedures → `.ai/workflows/`; hard-won gotchas →
  `.ai/lessons.md`.
- Mark not-yet-built parts of specs with _(planned)_; remove the marker when they land.

## Definition of done (per branch)

- All plan tasks done and acceptance criteria verified for real.
- `pnpm check` and `pnpm build` green; UI changes looked at in the browser.
- Docs, ADRs, lessons and roadmap updated; plan status `done`.
- Merged to `main` with the user's approval.

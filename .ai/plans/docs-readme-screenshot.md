# Plan: docs/readme-screenshot

| Field      | Value                                                     |
| ---------- | --------------------------------------------------------- |
| Branch     | `docs/readme-screenshot`                                  |
| Roadmap    | — (publication under the `berrymoreoss` org, not a track) |
| Status     | in-progress                                               |
| Depends on | `chore/pre-public` (merged)                               |
| Created    | 2026-11-10                                                |

## Goal

The repository is public now; its README shows no picture of the app. A screenshot right under
the tagline shows what Saltator is at a glance: a circuit running live, its chips, displays and
waveforms.

## Scope

**In scope**

- Two screenshots of the same scene, dark and light, in `docs/images/`.
- The README shows them with `<picture>` and `prefers-color-scheme`, so a reader sees the one
  that matches their GitHub theme.

**Out of scope** (and where it goes instead)

- A live-demo link → publication stage 3, after GitHub Pages (the untracked
  `docs/publication.md`).
- A script that retakes the screenshot (Q3: one-off) → the recipe below, by hand.

## Context

- `README.md` — the intro the picture goes under.
- `examples/two-digit-counter.saltator.json` — the scene; `tests/e2e/support.ts` (`openExample`,
  `fitted`) — where its parts are on screen.

## Design

- **The scene** (Q1): the Two-Digit Counter example running in real time — RESET pressed and let
  go, then about 4.5 s of counting, so the displays read a two-digit number; the Waveforms tab
  raised to show all five traces (CLK, ~RST, ONES, CARRY, TENS); chip A1 selected, so Properties
  shows a part and its pins. View ▸ Zoom to Fit after resizing the bottom panel.
- **Size:** a 1280×800 window at device scale 2 (2560×1600 PNG): crisp on 2× screens; GitHub
  scales it to the column.
- **Themes** (Q2): the same steps with `colorScheme` dark and light (the app follows the OS by
  default); `docs/images/screenshot-dark.png` and `screenshot-light.png`.
- **Recipe** (Q3: one-off, no script in the repo): `pnpm build && pnpm preview`, then a Playwright
  run outside the repo doing the steps above with `openExample` and `fitted` from
  `tests/e2e/support.ts`. Retake it by hand when the UI changes noticeably.

## Tasks

- [ ] 1. Take both screenshots into `docs/images/`; look at them.
- [ ] 2. README: the `<picture>` under the tagline, with alt text.
- [ ] 3. Verify: `pnpm check`; the README renders the picture on GitHub (after the push).

## Acceptance criteria

- [ ] `pnpm check` is green.
- [ ] `docs/images/screenshot-dark.png` and `screenshot-light.png` show the running Two-Digit
  Counter with its waveforms.
- [ ] The README on GitHub shows the screenshot matching the theme.

## Open questions

- [x] Q1. Which scene? — _proposed:_ the Two-Digit Counter (legible at README width) over the
  6502 ROM and RAM (closer to the goal, but small at fit zoom). — **answer:** the counter.
- [x] Q2. Theme? — _proposed:_ both, picked by the reader's GitHub theme. — **answer:** both.
- [x] Q3. Retaking it? — _proposed:_ a `pnpm screenshot` script. — **answer:** one-off, no script.

## Progress log

- 2026-11-10 — the repository went public. Candidates shot (six examples, then the counter and
  the 6502 with waveforms); the user picked the counter, both themes, one-off. Plan written,
  started.

## Handoff

- **State:** in-progress; plan written.
- **Next step:** task 1.
- **Watch out:** the app keeps layout and settings in browser storage: shoot in a fresh browser
  context.
- **Verify with:** `pnpm check`; the README on GitHub.

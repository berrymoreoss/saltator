# 0008. A desktop CAD-style workbench with fixed docks and view settings

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R04a (`feat/editor-canvas`)

## Context

R04 builds the application around the schematic: the shell, the canvas renderer and the symbols
of every part. The look and feel shapes every later panel (memory inspector, logic analyzer,
debugger), and some choices pull in dependencies. The author asked for a desktop, CAD-like
design. Questions decided at branch start (plan Q1–Q7): window layout, themes, gate drawing
style, panel flexibility, canvas navigation, icons — and whether R04 is one branch.

## Decision

- **Classic CAD layout**: menu bar, icon toolbar, Parts dock on the left, Properties on the
  right, a tabbed bottom dock (Messages; Memory and Analyzer later), status bar. Dense desktop
  styling.
- **Fixed docks with splitters**, hideable, sizes and visibility remembered; no drag-to-redock or
  floating panels, so no docking library.
- **Dark and light themes** from CSS tokens, following the OS unless overridden in View ▸ Theme;
  the canvas has a matching palette.
- **Gate style is a view setting**: ANSI distinctive shapes by default, IEC rectangles on
  request, on the same symbol geometry. Settings never change a document.
- **Navigation**: Figma-style by default (scroll pans, pinch or `Mod`+wheel zooms), KiCad-style
  wheel zoom as a setting; middle and Space drag always pan.
- **One command registry** drives menus, toolbar, shortcuts and the shortcut reference.
- **Dependencies** (ui layer and tooling only): `lucide-react` for generic icons (domain icons
  are our own SVGs in the same style) and `@playwright/test` for browser tests (`pnpm e2e`, run in
  CI after the build, not in `pnpm check`).
- **R04 is split**: R04a (shell and view, this decision) and R04b (editing tools).

## Consequences

- Panels added later are new tabs in an existing dock or a dock region, not floating windows;
  revisit with a docking library if that becomes limiting.
- Every drawing goes through semantic paints and the canvas theme, so new parts and the R05 level
  colors work in both themes; both gate styles must be maintained (a scenario test draws every
  part in both).
- The pure layers stay dependency-free; `lucide-react` is tree-shaken into the app bundle.
- Browser tests need Chromium (`pnpm exec playwright install chromium` locally; CI installs it).

## Alternatives considered

- **KiCad-style layout** (vertical tool strip, parts and properties in dialogs) — more canvas,
  but more modal windows; a learner benefits from seeing parts and properties at all times.
- **IDE-style layout** (activity bar switching side panels) — familiar to programmers, less to
  electronics users.
- **Full docking (dockview, flexlayout-react)** — drag tabs between docks, floating panels;
  another dependency and styling surface for flexibility nobody asked for yet.
- **Dark only / dark by default** — less work, but the light "paper" look is the CAD tradition
  and better for printing and screenshots.
- **ANSI only or IEC only** — simpler, but European learners read IEC and US datasheets use
  ANSI; the geometry is shared, so both cost only drawing code.
- **Wheel always zooms (KiCad)** — natural with a mouse, awkward on a trackpad.
- **Own SVG icons only** — no dependency, but ~25 icons to draw and keep consistent.

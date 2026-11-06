# 0002. Tech stack: Vite, TypeScript, React, Canvas2D

- **Status:** accepted
- **Date:** 2026-11-06
- **Roadmap item:** R00 (foundation)

## Context

We need a browser app with (a) a high-performance interactive schematic canvas showing live signal
states, (b) rich panels (inspector, hex editor, waveform viewer, debugger), and (c) a pure,
heavily tested simulation kernel. Development is AI-first, so mainstream, well-known tools reduce
mistakes.

## Decision

- **Vite** (dev server, build) + **TypeScript** in strict mode (`noUncheckedIndexedAccess`,
  `erasableSyntaxOnly`, `verbatimModuleSyntax`).
- **React** for the UI chrome only. The canvas is not React-rendered.
- **Custom Canvas2D renderer** for the schematic (in `src/editor`), redrawn on demand.
- **Vitest** for unit, scenario and benchmark tests; **Playwright** for browser e2e (from R04).
- **Biome** for linting and formatting (one fast tool, one config).
- **pnpm** as the package manager; Node ≥ 24 (scripts in `scripts/` are TypeScript run by Node's
  native type stripping).
- No state-management library up front: editor/simulator state lives in plain TS stores consumed
  via `useSyncExternalStore`. Revisit if it hurts.

## Consequences

- No TS `enum`/`namespace`/parameter properties (`erasableSyntaxOnly`); use `as const` objects
  and union types.
- Canvas rendering, hit-testing and text layout are our code — more work, full control and
  performance with thousands of wires.
- React expertise is ubiquitous among agents; panels are quick to build.

## Alternatives considered

- **SVG for the schematic** — easy hit-testing, but DOM cost grows with wire count and live
  recoloring at simulation rates; harder to optimize.
- **WebGL (PixiJS)** — fastest, but overkill for 2D schematics of this size and adds a dependency;
  can be revisited behind the renderer interface.
- **Solid / Svelte / vanilla** — viable; React chosen for ecosystem and agent familiarity.
- **ESLint + Prettier** — more plugins, more config; Biome covers our needs.

# src/app — composition root

Wires everything together: creates the registry (plus `dev/*` fixtures in dev builds), the
editor, the settings and UI stores, the document controller with the browser's file access, and
the React tree; at start-up it restores the autosaved session (or opens an example) and starts
autosave and Open Recent before the first render (top-level await on IndexedDB); `example-files.ts` lists the example
files in `examples/` (bundled as text), `examples.ts` builds the examples that stay in code
(Symbol Gallery, and `nandGrid`, shared with the circuit benchmark). The simulator host lives in the
editor (`editor.simulation`, R05). R15b: the test session with its two sandboxed runners;
`bench-worker.ts` is the runner that runs inside the sandbox's Worker, bundled from
`bench-worker-main.ts` into one script (`virtual:bench-runner`, scripts/vite-bench-runner.ts).
`src/main.tsx` (the Vite entry) also belongs to this layer.

- **Depends on:** every other layer. Nothing depends on `app`.

# src/app — composition root

Wires everything together: creates the registry (plus `dev/*` fixtures in dev builds), the
editor, the settings and UI stores and the React tree; `examples.ts` builds the File ▸ Examples
documents (and `nandGrid`, shared with the circuit benchmark). Later: the simulator host (R05).
`src/main.tsx` (the Vite entry) also belongs to this layer.

- **Depends on:** every other layer. Nothing depends on `app`.

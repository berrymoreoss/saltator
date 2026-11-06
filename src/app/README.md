# src/app — composition root

Wires everything together: creates the registry, simulator host, editor and React tree; global
styles. `src/main.tsx` (the Vite entry) also belongs to this layer.

- **Depends on:** every other layer. Nothing depends on `app`.

import { relative, sep } from 'node:path';

/**
 * Layer of a path under `src`: its top-level folder. Files directly in `src/` (main.tsx) belong
 * to `app`; a directory directly in `src/` (an import like `'../core'`, which resolves to
 * `core/index.ts`) is that layer.
 */
export function layerOf(path: string, src: string, isDirectory = false): string {
  const parts = relative(src, path).split(sep);
  return parts.length === 1 && !isDirectory ? 'app' : parts[0]!;
}

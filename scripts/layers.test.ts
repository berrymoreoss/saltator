import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layerOf } from './layers.ts';

const SRC = join('/repo', 'src');

describe('layerOf', () => {
  it('maps files to the top-level folder under src/', () => {
    expect(layerOf(join(SRC, 'core', 'logic.ts'), SRC)).toBe('core');
    expect(layerOf(join(SRC, 'library', 'primitives', 'gates.ts'), SRC)).toBe('library');
  });

  it('treats files directly in src/ as the app layer', () => {
    expect(layerOf(join(SRC, 'main.tsx'), SRC)).toBe('app');
    expect(layerOf(join(SRC, 'main'), SRC)).toBe('app');
  });

  it('maps a directory import (resolving to its index.ts) to that layer, not app', () => {
    // `import … from '../../core'` resolves to the directory src/core.
    expect(layerOf(join(SRC, 'core'), SRC, true)).toBe('core');
    expect(layerOf(join(SRC, 'core', 'testing'), SRC, true)).toBe('core');
  });
});

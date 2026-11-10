import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { readBuildInfo } from './scripts/build-info.ts';
import { benchRunner } from './scripts/vite-bench-runner.ts';

export default defineConfig({
  plugins: [react(), benchRunner()],
  // The commit is the version (ADR-0034): read once per build, dev server start or test run.
  define: { __SALTATOR_BUILD__: JSON.stringify(readBuildInfo()) },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.bench.ts',
        'src/**/test-parts.ts',
        'src/main.tsx',
      ],
      // Kernel and circuit model must stay thoroughly tested (R01, R02 acceptance criteria).
      thresholds: { 'src/core/**': { lines: 90 }, 'src/circuit/**': { lines: 90 } },
    },
  },
});

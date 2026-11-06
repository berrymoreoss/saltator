import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.bench.ts', 'src/main.tsx'],
      // The kernel must stay thoroughly tested (R01 acceptance criterion).
      thresholds: { 'src/core/**': { lines: 90 } },
    },
  },
});

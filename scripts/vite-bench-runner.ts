/**
 * A Vite plugin serving `virtual:bench-runner` (R15b): the test runner (src/app/bench-worker-main.ts
 * and everything it imports) bundled into one self-contained script, exported as its text. The
 * app starts it from a blob in a Worker inside an opaque-origin iframe, which can load nothing
 * from the app's origin — hence one script, not a module graph. Built by Vite's own `build`, the
 * same in `vite dev`, `vite build` and vitest; rebuilt when one of its files changes.
 */
import path from 'node:path';
import { build, type Plugin } from 'vite';

export const BENCH_RUNNER_ID = 'virtual:bench-runner';
const RESOLVED = `\0${BENCH_RUNNER_ID}`;

interface Chunk {
  readonly type: 'chunk';
  readonly code: string;
  readonly moduleIds: readonly string[];
}

/** The plugin; `entry` is the runner's entry module, relative to the project root. */
export function benchRunner(entry = 'src/app/bench-worker-main.ts'): Plugin {
  let root = process.cwd();
  let mode = 'development';
  let minify = false;
  return {
    name: 'bench-runner',
    configResolved(config) {
      root = config.root;
      mode = config.mode;
      minify = config.command === 'build';
    },
    resolveId(id) {
      return id === BENCH_RUNNER_ID ? RESOLVED : undefined;
    },
    async load(id) {
      if (id !== RESOLVED) return undefined;
      const chunk = await bundle(path.resolve(root, entry), { root, mode, minify });
      for (const file of chunk.moduleIds) if (path.isAbsolute(file)) this.addWatchFile(file);
      return `/** The test runner bundled into one script (scripts/vite-bench-runner.ts). */\nexport const benchRunnerSource = ${JSON.stringify(chunk.code)};\n`;
    },
  };
}

/** Bundles `entry` and its imports into one IIFE. */
async function bundle(
  entry: string,
  options: { root: string; mode: string; minify: boolean },
): Promise<Chunk> {
  const output = await build({
    configFile: false,
    root: options.root,
    mode: options.mode,
    logLevel: 'warn',
    publicDir: false,
    build: {
      write: false,
      minify: options.minify,
      emptyOutDir: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      lib: { entry, formats: ['iife'], name: 'benchRunner', fileName: 'bench-runner' },
    },
  });
  for (const result of Array.isArray(output) ? output : [output]) {
    if (!('output' in result)) continue;
    for (const item of result.output as readonly { type: string }[]) {
      if (item.type === 'chunk') return item as Chunk;
    }
  }
  throw new Error(`bench-runner: bundling ${entry} gave no script`);
}

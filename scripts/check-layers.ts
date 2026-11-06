/**
 * Enforces the architectural layer boundaries described in docs/architecture.md.
 *
 * Every top-level directory in src/ is a layer. A layer may import only from itself and from
 * the layers listed in ALLOWED. Pure layers (no DOM, no UI) may not import npm packages except
 * the ones explicitly allowlisted. Files directly in src/ (main.tsx) belong to the `app` layer.
 *
 * Run: pnpm check:layers
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SRC = resolve(import.meta.dirname, '..', 'src');

/** Which layers each layer may depend on (besides itself). Keep in sync with docs/architecture.md. */
const ALLOWED: Record<string, readonly string[]> = {
  core: [],
  library: ['core'],
  circuit: ['core'],
  editor: ['core', 'library', 'circuit'],
  ui: ['core', 'library', 'circuit', 'editor'],
  app: ['core', 'library', 'circuit', 'editor', 'ui'],
};

/** Layers that must stay framework- and platform-free (they may run in a Web Worker or Node). */
const PURE_LAYERS = new Set(['core', 'library', 'circuit']);

/** npm packages that pure layers may import. Add entries deliberately (and mention them in an ADR). */
const PURE_PACKAGE_ALLOWLIST: readonly string[] = [];

/** npm packages that test/bench files in pure layers may import. */
const TEST_PACKAGE_ALLOWLIST: readonly string[] = ['vitest'];

const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|bench)\.(ts|tsx)$/;
const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

function layerOf(file: string): string {
  const parts = relative(SRC, file).split(sep);
  return parts.length === 1 ? 'app' : parts[0]!;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

const violations: string[] = [];

for (const file of listFiles(SRC)) {
  const layer = layerOf(file);
  const allowed = ALLOWED[layer];
  const where = relative(process.cwd(), file);

  if (!allowed) {
    violations.push(`${where}: unknown layer "${layer}" (add it to scripts/check-layers.ts)`);
    continue;
  }

  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2]!;

    if (specifier.startsWith('.')) {
      const target = resolve(dirname(file), specifier);
      if (!target.startsWith(SRC + sep)) {
        violations.push(`${where}: imports "${specifier}" from outside src/`);
        continue;
      }
      const targetLayer = layerOf(target);
      if (targetLayer !== layer && !allowed.includes(targetLayer)) {
        violations.push(`${where}: layer "${layer}" must not import from "${targetLayer}"`);
      }
      continue;
    }

    if (PURE_LAYERS.has(layer)) {
      const pkg = packageName(specifier);
      const isTest = TEST_FILE.test(file);
      const ok =
        PURE_PACKAGE_ALLOWLIST.includes(pkg) || (isTest && TEST_PACKAGE_ALLOWLIST.includes(pkg));
      if (!ok) {
        violations.push(`${where}: pure layer "${layer}" must not import package "${specifier}"`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Layer check failed (${violations.length}):\n  ${violations.join('\n  ')}`);
  console.error('\nSee docs/architecture.md#layers');
  process.exit(1);
}
console.log('Layer check passed.');

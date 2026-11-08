/**
 * Prints where every roadmap track stands, after checking the roadmap's rules
 * (docs/roadmap.md, "How it works").
 *
 * Run: pnpm roadmap (overview) · pnpm check:roadmap (check only; part of pnpm check)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type GitState, parseRoadmap, renderOverview, validateRoadmap } from './roadmap.ts';

const ROOT = resolve(import.meta.dirname, '..');

function read(path: string): string | null {
  const file = join(ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function gitState(): GitState {
  try {
    const run = (...args: string[]) =>
      execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    const branches = run('branch', '--list', '--format=%(refname:short)');
    const current = run('branch', '--show-current');
    return { branches: new Set(branches.split('\n').filter(Boolean)), current: current || null };
  } catch {
    return { branches: new Set(), current: null };
  }
}

const checkOnly = process.argv.includes('--check');
const roadmap = parseRoadmap(read);
const errors = validateRoadmap(roadmap, (path) => existsSync(join(ROOT, path)));

if (!checkOnly) process.stdout.write(renderOverview(roadmap, gitState()));

if (errors.length > 0) {
  console.error(`\nRoadmap check failed (${errors.length}):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
if (checkOnly) console.log('Roadmap check passed.');

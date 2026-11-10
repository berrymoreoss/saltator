import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuildInfo } from './build-info.ts';

const SHA = '591d3cd4e2a1b0c9f8e7d6c5b4a3928170615243';

describe('readBuildInfo', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'saltator-build-info-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads the commit, its date and a clean tree from git', () => {
    const dir = tempDir();
    // Fixed dates and identity: the commit is the same on every run.
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_AUTHOR_DATE: '2026-11-11T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-11-11T12:00:00Z',
    };
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '--quiet', '--no-gpg-sign', '-m', 'first');

    const head = git('rev-parse', 'HEAD');
    expect(readBuildInfo(dir, {})).toEqual({ commit: head, date: '2026-11-11', dirty: false });

    writeFileSync(path.join(dir, 'a.txt'), 'b\n');
    expect(readBuildInfo(dir, {}).dirty).toBe(true);
  });

  it('falls back to GITHUB_SHA without git', () => {
    expect(readBuildInfo(tempDir(), { GITHUB_SHA: SHA })).toEqual({
      commit: SHA,
      date: null,
      dirty: false,
    });
  });

  it('knows nothing without git and without a valid GITHUB_SHA', () => {
    const nothing = { commit: null, date: null, dirty: false };
    expect(readBuildInfo(tempDir(), {})).toEqual(nothing);
    expect(readBuildInfo(tempDir(), { GITHUB_SHA: 'main' })).toEqual(nothing);
  });
});

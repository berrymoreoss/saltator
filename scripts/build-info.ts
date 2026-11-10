/**
 * The build's identity, read from git when Vite loads its config and baked into the app as
 * `__SALTATOR_BUILD__` (ADR-0034): the commit is the version. It works the same locally and in
 * the Pages workflow, whose shallow checkout still has HEAD and its date.
 */
import { execFileSync } from 'node:child_process';

/** Mirrored by `BuildInfo` in src/ui/build-info.ts, which can't import from scripts/. */
export interface BuildInfo {
  /** The full commit hash; null when neither git nor `GITHUB_SHA` knows it. */
  readonly commit: string | null;
  /** The commit's date (YYYY-MM-DD), not the build's: the same commit builds the same text. */
  readonly date: string | null;
  /** The working tree had uncommitted changes. */
  readonly dirty: boolean;
}

const HASH = /^[0-9a-f]{40,64}$/;

/** The build info of the checkout at `cwd`; `env` supplies the CI fallback when git is missing. */
export function readBuildInfo(
  cwd = process.cwd(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): BuildInfo {
  const git = (...args: string[]): string | null => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
  const commit = git('rev-parse', 'HEAD');
  if (commit && HASH.test(commit)) {
    return {
      commit,
      date: git('log', '-1', '--format=%cs') || null,
      dirty: (git('status', '--porcelain') ?? '') !== '',
    };
  }
  // A source archive without .git, built by CI: the workflow still knows the commit.
  const sha = env.GITHUB_SHA;
  return { commit: sha && HASH.test(sha) ? sha : null, date: null, dirty: false };
}

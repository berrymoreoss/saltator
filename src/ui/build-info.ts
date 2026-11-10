/**
 * Which build is running (ADR-0034): vite.config.ts reads it from git (scripts/build-info.ts) and
 * defines `__SALTATOR_BUILD__`. Only the About dialog imports this module, so code that Node runs
 * directly, without Vite, never meets the undefined global.
 */

/** Mirrors `BuildInfo` in scripts/build-info.ts. */
export interface BuildInfo {
  readonly commit: string | null;
  readonly date: string | null;
  readonly dirty: boolean;
}

declare const __SALTATOR_BUILD__: BuildInfo;

/** This build. */
export const BUILD: BuildInfo = __SALTATOR_BUILD__;

export const REPO_URL = 'https://github.com/berrymoreoss/saltator';
export const ORG_URL = 'https://github.com/berrymoreoss';

/** The version as About shows it: `591d3cd-dirty`, linked to its commit, then `2026-11-11 · dev`. */
export interface Version {
  readonly label: string;
  /** The commit on GitHub; none for an unknown build. */
  readonly url: string | null;
  readonly notes: readonly string[];
}

/** `dev`: served by the dev server, whose build info is read once at its start and may lag. */
export function describeVersion(build: BuildInfo, dev: boolean): Version {
  const notes = [...(build.date ? [build.date] : []), ...(dev ? ['dev'] : [])];
  if (!build.commit) return { label: 'unknown', url: null, notes };
  return {
    label: build.commit.slice(0, 7) + (build.dirty ? '-dirty' : ''),
    url: `${REPO_URL}/commit/${build.commit}`,
    notes,
  };
}

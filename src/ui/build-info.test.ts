import { describe, expect, it } from 'vitest';
import { BUILD, describeVersion, REPO_URL } from './build-info';

const SHA = '591d3cd4e2a1b0c9f8e7d6c5b4a3928170615243';

describe('describeVersion', () => {
  it('shows the short hash linked to its commit, and the commit date', () => {
    expect(describeVersion({ commit: SHA, date: '2026-11-11', dirty: false }, false)).toEqual({
      label: '591d3cd',
      url: `${REPO_URL}/commit/${SHA}`,
      notes: ['2026-11-11'],
    });
  });

  it('marks uncommitted changes and the dev server', () => {
    expect(describeVersion({ commit: SHA, date: '2026-11-11', dirty: true }, true)).toEqual({
      label: '591d3cd-dirty',
      url: `${REPO_URL}/commit/${SHA}`,
      notes: ['2026-11-11', 'dev'],
    });
  });

  it('says unknown without a commit, and leaves out a missing date', () => {
    expect(describeVersion({ commit: null, date: null, dirty: false }, false)).toEqual({
      label: 'unknown',
      url: null,
      notes: [],
    });
    expect(describeVersion({ commit: SHA, date: null, dirty: false }, false).notes).toEqual([]);
  });
});

describe('BUILD', () => {
  it('is defined by the Vite config', () => {
    expect(BUILD).toHaveProperty('dirty');
  });
});

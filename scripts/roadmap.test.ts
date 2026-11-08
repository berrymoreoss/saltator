import { describe, expect, it } from 'vitest';
import { parseRoadmap, planFile, renderOverview, validateRoadmap } from './roadmap.ts';

interface Row {
  id: string;
  branch?: string | null;
  title?: string;
  needs?: string;
  status: string;
}

function trackFile(name: string, rows: Row[], sections: Row[] = rows): string {
  const branch = (row: Row) =>
    row.branch === null ? '—' : `\`${row.branch ?? `feat/${row.id.toLowerCase()}`}\``;
  const title = (row: Row) => row.title ?? `Item ${row.id}`;
  return [
    `# ${name}`,
    '',
    'Goal.',
    '',
    '## Items',
    '',
    '| ID | Branch | Title | Needs | Status |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.id} | ${branch(row)} | ${title(row)} | ${row.needs ?? '—'} | ${row.status} |`,
    ),
    '',
    ...sections.flatMap((row) => [
      `## ${row.id} · ${title(row)}${row.branch === null ? '' : ` — ${branch(row)}`}`,
      '',
      'What it delivers.',
      '',
    ]),
    '## Ideas',
    '',
    '- An idea.',
  ].join('\n');
}

function indexFile(
  tracks: string[],
  milestones: string[] = ['| M1 | "First" | LIB-1 | open |'],
): string {
  return [
    '# Roadmap',
    '',
    '## Tracks',
    '',
    '| Track | Prefix | Goal |',
    '| --- | --- | --- |',
    ...tracks,
    '',
    '## Milestones',
    '',
    '| ID | Milestone | Needs | Status |',
    '| --- | --- | --- | --- |',
    ...milestones,
    '',
  ].join('\n');
}

const TRACKS = [
  '| [Parts](roadmap/parts.md) | `LIB` | Chips |',
  '| [CPU](roadmap/cpu.md) | `CPU` | A CPU |',
];

function files(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'docs/roadmap.md': indexFile(TRACKS),
    'docs/roadmap/parts.md': trackFile('Parts', [
      { id: 'R03', status: 'done' },
      { id: 'LIB-1', status: 'next' },
      { id: 'LIB-2', status: 'planned' },
    ]),
    'docs/roadmap/cpu.md': trackFile('CPU', [{ id: 'CPU-1', needs: 'LIB-1', status: 'next' }]),
    ...overrides,
  };
}

const PLANS = new Set(['.ai/plans/feat-r03.md', '.ai/plans/feat-lib-1.md']);

function check(
  overrides: Record<string, string> = {},
  plans: ReadonlySet<string> = PLANS,
): string[] {
  const all = files(overrides);
  const roadmap = parseRoadmap((path) => all[path] ?? null);
  return validateRoadmap(roadmap, (path) => plans.has(path));
}

describe('parseRoadmap', () => {
  it('reads the tracks, their items and the milestones', () => {
    const all = files();
    const roadmap = parseRoadmap((path) => all[path] ?? null);
    expect(roadmap.errors).toEqual([]);
    expect(roadmap.tracks.map((track) => [track.name, track.prefix, track.file])).toEqual([
      ['Parts', 'LIB', 'docs/roadmap/parts.md'],
      ['CPU', 'CPU', 'docs/roadmap/cpu.md'],
    ]);
    const parts = roadmap.files[0]!;
    expect(parts.items.map((item) => [item.id, item.branch, item.status])).toEqual([
      ['R03', 'feat/r03', 'done'],
      ['LIB-1', 'feat/lib-1', 'next'],
      ['LIB-2', 'feat/lib-2', 'planned'],
    ]);
    expect(parts.items[0]!.where).toEqual({ file: 'docs/roadmap/parts.md', line: 9 });
    expect(roadmap.files[1]!.items[0]!.needs).toEqual(['LIB-1']);
    expect(roadmap.milestones).toMatchObject([
      { id: 'M1', title: '"First"', needs: ['LIB-1'], status: 'open' },
    ]);
  });

  it('reads an item without a branch', () => {
    const roadmap = parseRoadmap(
      (path) =>
        files({
          'docs/roadmap/parts.md': trackFile('Parts', [
            { id: 'R00', branch: null, status: 'done' },
          ]),
        })[path] ?? null,
    );
    expect(roadmap.files[0]!.items[0]!.branch).toBeNull();
    expect(roadmap.files[0]!.sections[0]).toMatchObject({ id: 'R00', branch: null });
  });
});

describe('validateRoadmap', () => {
  it('accepts a roadmap that follows the rules', () => {
    expect(check()).toEqual([]);
  });

  it('reports a missing index, track file or table', () => {
    expect(
      validateRoadmap(
        parseRoadmap(() => null),
        () => true,
      ),
    ).toEqual(['docs/roadmap.md: missing']);
    const all = files();
    delete all['docs/roadmap/cpu.md'];
    expect(
      validateRoadmap(
        parseRoadmap((path) => all[path] ?? null),
        (path) => PLANS.has(path),
      ),
    ).toEqual(['docs/roadmap.md:8: track file docs/roadmap/cpu.md is missing']);
    expect(check({ 'docs/roadmap/cpu.md': '# CPU\n' })).toEqual([
      'docs/roadmap/cpu.md: no table under "## Items"',
    ]);
  });

  it('reports a table with other columns', () => {
    const wrong = files()['docs/roadmap/cpu.md']!.replace('| Needs | Status |', '| Status |');
    expect(check({ 'docs/roadmap/cpu.md': wrong })[0]).toMatch(
      /table columns are "ID \| Branch \| Title \| Status"/,
    );
  });

  it('reports a prefix used twice and a track file whose title differs', () => {
    const tracks = [TRACKS[0]!, '| [CPU](roadmap/cpu.md) | `LIB` | A CPU |'];
    expect(check({ 'docs/roadmap.md': indexFile(tracks) })).toContain(
      'docs/roadmap.md:8: track prefix "LIB" is also used at docs/roadmap.md:7',
    );
    const renamed = files()['docs/roadmap/cpu.md']!.replace('# CPU', '# Processor');
    expect(check({ 'docs/roadmap/cpu.md': renamed })).toEqual([
      'docs/roadmap/cpu.md: the title is "Processor", the index calls the track "CPU"',
    ]);
  });

  it('reports an id used twice, across tracks too', () => {
    const cpu = trackFile('CPU', [{ id: 'R03', branch: 'feat/other', status: 'done' }]);
    expect(
      check({ 'docs/roadmap/cpu.md': cpu }, new Set([...PLANS, '.ai/plans/feat-other.md'])),
    ).toEqual(['docs/roadmap/cpu.md:9: id R03 is also used at docs/roadmap/parts.md:9']);
  });

  it('reports an id that is neither the track prefix nor an R id', () => {
    const cpu = trackFile('CPU', [{ id: 'LIB-9', status: 'next' }]);
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      'docs/roadmap/cpu.md:9: id "LIB-9" is neither CPU-<n> nor an R id',
    ]);
  });

  it('accepts split items and legacy ids', () => {
    const cpu = trackFile('CPU', [
      { id: 'R17', status: 'done' },
      { id: 'CPU-1a', status: 'done' },
      { id: 'CPU-1b', status: 'planned' },
    ]);
    const plans = new Set([...PLANS, '.ai/plans/feat-r17.md', '.ai/plans/feat-cpu-1a.md']);
    expect(check({ 'docs/roadmap/cpu.md': cpu }, plans)).toEqual([]);
  });

  it('reports a branch used twice or not named <type>/<slug>', () => {
    const cpu = trackFile('CPU', [
      { id: 'CPU-1', branch: 'feat/lib-1', status: 'planned' },
      { id: 'CPU-2', branch: 'feature/x', status: 'planned' },
    ]);
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      "docs/roadmap/cpu.md:9: branch feat/lib-1 is also LIB-1's",
      'docs/roadmap/cpu.md:10: branch "feature/x" is not <feat|fix|chore|docs|example>/<slug>',
    ]);
  });

  it('reports an unknown status', () => {
    const cpu = trackFile('CPU', [{ id: 'CPU-1', status: 'idea' }]);
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      'docs/roadmap/cpu.md:9: unknown status "idea" (done, in-progress, next, planned)',
    ]);
  });

  it('reports two heads in one track', () => {
    const cpu = trackFile('CPU', [
      { id: 'CPU-1', status: 'in-progress' },
      { id: 'CPU-2', status: 'next' },
    ]);
    expect(
      check({ 'docs/roadmap/cpu.md': cpu }, new Set([...PLANS, '.ai/plans/feat-cpu-1.md'])),
    ).toEqual([
      'docs/roadmap/cpu.md: 2 items are next or in-progress; a track has at most one head',
    ]);
  });

  it('reports statuses out of order', () => {
    const cpu = trackFile('CPU', [
      { id: 'CPU-1', status: 'planned' },
      { id: 'CPU-2', status: 'next' },
    ]);
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      'docs/roadmap/cpu.md:10: CPU-2 is next after an item that is not done (order: done, head, planned)',
    ]);
  });

  it('reports needs naming an unknown item or the item itself', () => {
    const cpu = trackFile('CPU', [
      { id: 'CPU-1', needs: 'LIB-7', status: 'next' },
      { id: 'CPU-2', needs: 'CPU-2', status: 'planned' },
    ]);
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      'docs/roadmap/cpu.md:9: CPU-1 needs unknown item LIB-7',
      'docs/roadmap/cpu.md:10: CPU-2 needs itself',
    ]);
  });

  it('reports rows without sections, sections without rows, and sections out of order', () => {
    const rows: Row[] = [
      { id: 'CPU-1', status: 'next' },
      { id: 'CPU-2', status: 'planned' },
    ];
    expect(check({ 'docs/roadmap/cpu.md': trackFile('CPU', rows, [rows[0]!]) })).toEqual([
      'docs/roadmap/cpu.md:10: CPU-2 has no "## CPU-2 · …" section',
    ]);
    expect(check({ 'docs/roadmap/cpu.md': trackFile('CPU', [rows[0]!], rows) })).toEqual([
      'docs/roadmap/cpu.md:15: section CPU-2 has no row in the items table',
    ]);
    expect(check({ 'docs/roadmap/cpu.md': trackFile('CPU', rows, [rows[1]!, rows[0]!]) })).toEqual([
      "docs/roadmap/cpu.md: the sections are not in the items table's order",
    ]);
  });

  it('reports a section whose title or branch differs from its row', () => {
    const row: Row = { id: 'CPU-1', status: 'next' };
    const cpu = trackFile('CPU', [row], [{ ...row, title: 'Other', branch: 'feat/other' }]);
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      'docs/roadmap/cpu.md:11: section title "Other" differs from the table\'s "Item CPU-1"',
      "docs/roadmap/cpu.md:11: section branch feat/other differs from the table's feat/cpu-1",
    ]);
  });

  it('reports a malformed item heading', () => {
    const cpu = `${trackFile('CPU', [{ id: 'CPU-1', status: 'next' }])}\n\n## CPU-1: Item\n`;
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      'docs/roadmap/cpu.md:19: an item heading is "## <id> · <title> — `<branch>`"',
    ]);
  });

  it('reports a done or in-progress item without its plan', () => {
    expect(check({}, new Set(['.ai/plans/feat-r03.md']))).toEqual([]);
    expect(check({}, new Set())).toEqual([
      'docs/roadmap/parts.md:9: R03 is done but .ai/plans/feat-r03.md is missing',
    ]);
    const cpu = trackFile('CPU', [{ id: 'CPU-1', status: 'in-progress' }]);
    expect(check({ 'docs/roadmap/cpu.md': cpu })).toEqual([
      'docs/roadmap/cpu.md:9: CPU-1 is in-progress but .ai/plans/feat-cpu-1.md is missing',
    ]);
  });

  it('reports milestones with unknown needs, undone needs when reached, or a bad id or status', () => {
    const index = indexFile(TRACKS, [
      '| M1 | "First" | LIB-1, LIB-9 | reached |',
      '| M1 | "Again" | — | open |',
      '| X2 | "Bad" | — | done |',
    ]);
    expect(check({ 'docs/roadmap.md': index })).toEqual([
      'docs/roadmap.md:14: M1 is reached but LIB-1 is next',
      'docs/roadmap.md:14: M1 needs unknown item LIB-9',
      'docs/roadmap.md:15: milestone M1 is also at docs/roadmap.md:14',
      'docs/roadmap.md:16: milestone id "X2" is not M<n>',
      'docs/roadmap.md:16: unknown milestone status "done" (open, reached)',
    ]);
  });
});

describe('renderOverview', () => {
  it("shows each track's head, its branch, what it waits for, and the milestones", () => {
    const all = files({
      'docs/roadmap.md': indexFile(
        [...TRACKS, '| [Video](roadmap/video.md) | `VID` | Video |'],
        [
          '| M1 | "First" | LIB-1, CPU-1 | open |',
          '| M2 | "Done" | R03 | reached |',
          '| M3 | "Later" | — | open |',
        ],
      ),
      'docs/roadmap/video.md': trackFile('Video', [{ id: 'VID-1', status: 'planned' }]),
    });
    const roadmap = parseRoadmap((path) => all[path] ?? null);
    expect(
      renderOverview(roadmap, { branches: new Set(['main', 'feat/lib-1']), current: 'main' }),
    ).toBe(
      [
        'Tracks',
        '  Parts (LIB)  1 of 3 done; next: LIB-1 · Item LIB-1 — feat/lib-1 (branch exists)',
        '  CPU (CPU)    0 of 1 done; next: CPU-1 · Item CPU-1 — feat/cpu-1 (no branch yet); waits for LIB-1',
        '  Video (VID)  0 of 1 done; idle',
        '',
        'Milestones',
        '  M1 "First"  open, 0 of 2 done',
        '  M2 "Done"   reached',
        '  M3 "Later"  open',
        '',
      ].join('\n'),
    );
    expect(
      renderOverview(roadmap, { branches: new Set(['feat/lib-1']), current: 'feat/lib-1' }),
    ).toContain('feat/lib-1 (current branch)');
  });
});

describe('planFile', () => {
  it("is the branch name with '/' replaced by '-'", () => {
    expect(planFile('feat/engine-core')).toBe('.ai/plans/feat-engine-core.md');
    expect(planFile('example/sap-1-modules')).toBe('.ai/plans/example-sap-1-modules.md');
  });
});

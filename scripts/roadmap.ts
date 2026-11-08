/**
 * The roadmap as data: parses `docs/roadmap.md` (tracks, milestones) and the track files in
 * `docs/roadmap/`, checks the rules of its "How it works" section and renders the overview that
 * `pnpm roadmap` prints. Pure: the runner (`roadmap-cli.ts`) reads the files and asks git.
 */

/** Item statuses, in the order a track's items table lists them. */
export const ITEM_STATUSES = ['done', 'in-progress', 'next', 'planned'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const MILESTONE_STATUSES = ['open', 'reached'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** A place in a file, for messages (`docs/roadmap/parts.md:17`). */
export interface Where {
  readonly file: string;
  readonly line: number;
}

export interface Track {
  readonly name: string;
  /** Path relative to the repository root (`docs/roadmap/parts.md`). */
  readonly file: string;
  readonly prefix: string;
  readonly goal: string;
  readonly where: Where;
}

export interface Item {
  readonly id: string;
  /** `null` for an item without a branch of its own (R00, the initial commit). */
  readonly branch: string | null;
  readonly title: string;
  readonly needs: readonly string[];
  readonly status: string;
  readonly track: string;
  readonly where: Where;
}

export interface Milestone {
  readonly id: string;
  readonly title: string;
  readonly needs: readonly string[];
  readonly status: string;
  readonly where: Where;
}

/** An item's `## <id> · <title> — \`<branch>\`` heading in its track file. */
export interface Section {
  readonly id: string;
  readonly title: string;
  readonly branch: string | null;
  readonly where: Where;
}

export interface TrackFile {
  readonly track: Track;
  readonly title: string | null;
  readonly items: readonly Item[];
  readonly sections: readonly Section[];
}

export interface Roadmap {
  readonly tracks: readonly Track[];
  readonly milestones: readonly Milestone[];
  readonly files: readonly TrackFile[];
  /** Problems found while parsing (a missing table, a malformed row). */
  readonly errors: readonly string[];
}

export const INDEX_FILE = 'docs/roadmap.md';

const NONE = '—';
const PREFIX = /^[A-Z][A-Z0-9]*$/;
const LEGACY_ID = /^R\d{2}[a-z]?$/;
const MILESTONE_ID = /^M\d+$/;
const BRANCH = /^(feat|fix|chore|docs|example)\/[a-z0-9][a-z0-9-]*$/;
const SECTION = /^## (\S+) · (.+?)(?: — `([^`]+)`)?$/;
/** Headings in a track file that are not items. */
const TRACK_HEADINGS = new Set(['Items', 'Ideas']);

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly { readonly cells: readonly string[]; readonly line: number }[];
}

function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** The first table after the `## <heading>` line, or `null`. Lines are 1-based. */
function tableAfter(lines: readonly string[], heading: string): Table | null {
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) return null;
  let i = start + 1;
  while (i < lines.length && !lines[i]!.startsWith('|')) {
    if (lines[i]!.startsWith('## ')) return null;
    i++;
  }
  if (i >= lines.length) return null;
  const header = cellsOf(lines[i]!);
  const rows: { cells: string[]; line: number }[] = [];
  for (i += 2; i < lines.length && lines[i]!.startsWith('|'); i++) {
    rows.push({ cells: cellsOf(lines[i]!), line: i + 1 });
  }
  return { header, rows };
}

function code(cell: string): string | null {
  const match = /^`([^`]+)`$/.exec(cell);
  return match ? match[1]! : null;
}

function list(cell: string): string[] {
  return cell === NONE || cell === '' ? [] : cell.split(',').map((id) => id.trim());
}

function expectHeader(table: Table, columns: readonly string[], where: string, errors: string[]) {
  if (table.header.join('|') !== columns.join('|')) {
    errors.push(
      `${where}: table columns are "${table.header.join(' | ')}", expected "${columns.join(' | ')}"`,
    );
    return false;
  }
  return true;
}

/** Joins a link in the index (`roadmap/parts.md`) to a path from the repository root. */
function fromIndex(link: string): string {
  return `docs/${link}`;
}

/**
 * Parses the index and the track files. `read` returns a file's text by its path from the
 * repository root, or `null` if it doesn't exist.
 */
export function parseRoadmap(read: (path: string) => string | null): Roadmap {
  const errors: string[] = [];
  const index = read(INDEX_FILE);
  if (index === null)
    return { tracks: [], milestones: [], files: [], errors: [`${INDEX_FILE}: missing`] };
  const lines = index.split('\n');

  const tracks: Track[] = [];
  const trackTable = tableAfter(lines, 'Tracks');
  if (!trackTable) errors.push(`${INDEX_FILE}: no table under "## Tracks"`);
  else if (expectHeader(trackTable, ['Track', 'Prefix', 'Goal'], INDEX_FILE, errors)) {
    for (const { cells, line } of trackTable.rows) {
      const where = { file: INDEX_FILE, line };
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cells[0] ?? '');
      const prefix = code(cells[1] ?? '');
      if (!link || !prefix) {
        errors.push(
          `${INDEX_FILE}:${line}: a track row is "[Name](roadmap/<file>.md) | \`PREFIX\` | goal"`,
        );
        continue;
      }
      tracks.push({
        name: link[1]!,
        file: fromIndex(link[2]!),
        prefix,
        goal: cells[2] ?? '',
        where,
      });
    }
  }

  const milestones: Milestone[] = [];
  const milestoneTable = tableAfter(lines, 'Milestones');
  if (!milestoneTable) errors.push(`${INDEX_FILE}: no table under "## Milestones"`);
  else if (
    expectHeader(milestoneTable, ['ID', 'Milestone', 'Needs', 'Status'], INDEX_FILE, errors)
  ) {
    for (const { cells, line } of milestoneTable.rows) {
      milestones.push({
        id: cells[0] ?? '',
        title: cells[1] ?? '',
        needs: list(cells[2] ?? ''),
        status: cells[3] ?? '',
        where: { file: INDEX_FILE, line },
      });
    }
  }

  const files: TrackFile[] = [];
  for (const track of tracks) {
    const text = read(track.file);
    if (text === null) {
      errors.push(`${INDEX_FILE}:${track.where.line}: track file ${track.file} is missing`);
      continue;
    }
    files.push(parseTrack(text, track, errors));
  }
  return { tracks, milestones, files, errors };
}

function parseTrack(text: string, track: Track, errors: string[]): TrackFile {
  const lines = text.split('\n');
  const titleLine = lines.find((line) => line.startsWith('# '));
  const items: Item[] = [];
  const table = tableAfter(lines, 'Items');
  if (!table) errors.push(`${track.file}: no table under "## Items"`);
  else if (expectHeader(table, ['ID', 'Branch', 'Title', 'Needs', 'Status'], track.file, errors)) {
    for (const { cells, line } of table.rows) {
      const where = { file: track.file, line };
      const branchCell = cells[1] ?? '';
      const branch = branchCell === NONE ? null : code(branchCell);
      if (branchCell !== NONE && branch === null) {
        errors.push(`${track.file}:${line}: the branch is \`<type>/<slug>\` or ${NONE}`);
      }
      items.push({
        id: cells[0] ?? '',
        branch,
        title: cells[2] ?? '',
        needs: list(cells[3] ?? ''),
        status: cells[4] ?? '',
        track: track.name,
        where,
      });
    }
  }

  const sections: Section[] = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('## ') || TRACK_HEADINGS.has(line.slice(3))) return;
    const match = SECTION.exec(line);
    const where = { file: track.file, line: i + 1 };
    if (!match) {
      errors.push(`${track.file}:${i + 1}: an item heading is "## <id> · <title> — \`<branch>\`"`);
      return;
    }
    sections.push({ id: match[1]!, title: match[2]!, branch: match[3] ?? null, where });
  });

  return { track, title: titleLine ? titleLine.slice(2).trim() : null, items, sections };
}

function at(where: Where): string {
  return `${where.file}:${where.line}`;
}

/** The plan file of a branch (`feat/engine-core` → `.ai/plans/feat-engine-core.md`). */
export function planFile(branch: string): string {
  return `.ai/plans/${branch.replaceAll('/', '-')}.md`;
}

function rank(status: string): number {
  if (status === 'done') return 0;
  if (status === 'next' || status === 'in-progress') return 1;
  return 2;
}

/**
 * Checks the roadmap's rules. `exists` tells whether a file exists (by its path from the
 * repository root), for the plan files. Returns the problems found, parse errors first.
 */
export function validateRoadmap(roadmap: Roadmap, exists: (path: string) => boolean): string[] {
  const errors = [...roadmap.errors];

  const seen = {
    name: new Map<string, Where>(),
    prefix: new Map<string, Where>(),
    file: new Map<string, Where>(),
  };
  for (const track of roadmap.tracks) {
    for (const key of ['name', 'prefix', 'file'] as const) {
      const first = seen[key].get(track[key]);
      if (first)
        errors.push(
          `${at(track.where)}: track ${key} "${track[key]}" is also used at ${at(first)}`,
        );
      else seen[key].set(track[key], track.where);
    }
    if (!PREFIX.test(track.prefix)) {
      errors.push(
        `${at(track.where)}: prefix "${track.prefix}" is not uppercase letters and digits`,
      );
    }
  }

  const items = new Map<string, Item>();
  const branches = new Map<string, Item>();
  for (const file of roadmap.files) {
    const { track } = file;
    if (file.title !== track.name) {
      errors.push(
        `${track.file}: the title is "${file.title ?? ''}", the index calls the track "${track.name}"`,
      );
    }
    const own = new RegExp(`^${track.prefix}-\\d+[a-z]?$`);
    let heads = 0;
    let last = 0;
    for (const item of file.items) {
      const where = at(item.where);
      const first = items.get(item.id);
      if (first) errors.push(`${where}: id ${item.id} is also used at ${at(first.where)}`);
      else items.set(item.id, item);
      if (!own.test(item.id) && !LEGACY_ID.test(item.id)) {
        errors.push(`${where}: id "${item.id}" is neither ${track.prefix}-<n> nor an R id`);
      }
      if (item.branch !== null) {
        const other = branches.get(item.branch);
        if (other) errors.push(`${where}: branch ${item.branch} is also ${other.id}'s`);
        else branches.set(item.branch, item);
        if (!BRANCH.test(item.branch)) {
          errors.push(
            `${where}: branch "${item.branch}" is not <feat|fix|chore|docs|example>/<slug>`,
          );
        }
      }
      if (!(ITEM_STATUSES as readonly string[]).includes(item.status)) {
        errors.push(`${where}: unknown status "${item.status}" (${ITEM_STATUSES.join(', ')})`);
        continue;
      }
      if (rank(item.status) === 1) heads++;
      if (rank(item.status) < last) {
        errors.push(
          `${where}: ${item.id} is ${item.status} after an item that is not done (order: done, head, planned)`,
        );
      }
      last = Math.max(last, rank(item.status));
      if (item.branch !== null && (item.status === 'done' || item.status === 'in-progress')) {
        const plan = planFile(item.branch);
        if (!exists(plan))
          errors.push(`${where}: ${item.id} is ${item.status} but ${plan} is missing`);
      }
    }
    if (heads > 1) {
      errors.push(
        `${track.file}: ${heads} items are next or in-progress; a track has at most one head`,
      );
    }

    const rows = file.items.map((item) => item.id);
    const headings = file.sections.map((section) => section.id);
    for (const section of file.sections) {
      const item = file.items.find((candidate) => candidate.id === section.id);
      if (!item) {
        errors.push(`${at(section.where)}: section ${section.id} has no row in the items table`);
        continue;
      }
      if (section.title !== item.title) {
        errors.push(
          `${at(section.where)}: section title "${section.title}" differs from the table's "${item.title}"`,
        );
      }
      if (section.branch !== item.branch) {
        errors.push(
          `${at(section.where)}: section branch ${section.branch ?? NONE} differs from the table's ${item.branch ?? NONE}`,
        );
      }
    }
    for (const item of file.items) {
      if (!headings.includes(item.id))
        errors.push(`${at(item.where)}: ${item.id} has no "## ${item.id} · …" section`);
    }
    const shared = rows.filter((id) => headings.includes(id));
    const ordered = headings.filter((id) => rows.includes(id));
    if (shared.join() !== ordered.join()) {
      errors.push(`${track.file}: the sections are not in the items table's order`);
    }
  }

  for (const item of items.values()) {
    for (const need of item.needs) {
      if (need === item.id) errors.push(`${at(item.where)}: ${item.id} needs itself`);
      else if (!items.has(need))
        errors.push(`${at(item.where)}: ${item.id} needs unknown item ${need}`);
    }
  }

  const milestoneIds = new Map<string, Where>();
  for (const milestone of roadmap.milestones) {
    const where = at(milestone.where);
    const first = milestoneIds.get(milestone.id);
    if (first) errors.push(`${where}: milestone ${milestone.id} is also at ${at(first)}`);
    else milestoneIds.set(milestone.id, milestone.where);
    if (!MILESTONE_ID.test(milestone.id))
      errors.push(`${where}: milestone id "${milestone.id}" is not M<n>`);
    if (!(MILESTONE_STATUSES as readonly string[]).includes(milestone.status)) {
      errors.push(
        `${where}: unknown milestone status "${milestone.status}" (${MILESTONE_STATUSES.join(', ')})`,
      );
    }
    for (const need of milestone.needs) {
      const item = items.get(need);
      if (!item) errors.push(`${where}: ${milestone.id} needs unknown item ${need}`);
      else if (milestone.status === 'reached' && item.status !== 'done') {
        errors.push(`${where}: ${milestone.id} is reached but ${need} is ${item.status}`);
      }
    }
  }

  return errors;
}

/** What the overview knows about the repository's branches. */
export interface GitState {
  /** Local branch names. */
  readonly branches: ReadonlySet<string>;
  /** The checked-out branch, or `null` when detached. */
  readonly current: string | null;
}

/** The text `pnpm roadmap` prints: every track's head, then the milestones. */
export function renderOverview(roadmap: Roadmap, git: GitState): string {
  const items = new Map(
    roadmap.files.flatMap((file) => file.items.map((item) => [item.id, item] as const)),
  );
  const out: string[] = ['Tracks'];
  const width = Math.max(
    ...roadmap.tracks.map((track) => `${track.name} (${track.prefix})`.length),
  );

  for (const file of roadmap.files) {
    const { track } = file;
    const done = file.items.filter((item) => item.status === 'done').length;
    const head = file.items.find((item) => rank(item.status) === 1);
    const label = `${track.name} (${track.prefix})`.padEnd(width);
    const count = `${done} of ${file.items.length} done`;
    if (!head) {
      out.push(`  ${label}  ${count}; idle`);
      continue;
    }
    let line = `  ${label}  ${count}; ${head.status}: ${head.id} · ${head.title}`;
    if (head.branch !== null) {
      const state =
        head.branch === git.current
          ? 'current branch'
          : git.branches.has(head.branch)
            ? 'branch exists'
            : 'no branch yet';
      line += ` — ${head.branch} (${state})`;
    }
    const waiting = head.needs.filter((need) => items.get(need)?.status !== 'done');
    if (waiting.length > 0) line += `; waits for ${waiting.join(', ')}`;
    out.push(line);
  }

  out.push('', 'Milestones');
  const titleWidth = Math.max(
    ...roadmap.milestones.map((milestone) => `${milestone.id} ${milestone.title}`.length),
  );
  for (const milestone of roadmap.milestones) {
    const label = `${milestone.id} ${milestone.title}`.padEnd(titleWidth);
    const done = milestone.needs.filter((need) => items.get(need)?.status === 'done').length;
    const progress =
      milestone.status === 'reached' || milestone.needs.length === 0
        ? ''
        : `, ${done} of ${milestone.needs.length} done`;
    out.push(`  ${label}  ${milestone.status}${progress}`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * Loading documents from JSON: migration to the current schema, then structural validation that
 * reports every problem with its JSON path. Part types and props are not checked here (a file
 * must open even if a part is missing); the compiler reports them. Spec: docs/circuit.md.
 */
import { type HdlModule, hdlModuleProblems, type PropValue } from '../core';
import {
  CIRCUIT_ID,
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  ID_PATTERN,
  PROBE_RADIXES,
  type Probe,
  type ProbeRadix,
  SCHEMA_VERSION,
  type Wire,
} from './document';
import { COORD_LIMIT, isAxisAligned, isRotation, type Point, type Rotation } from './geometry';
import { type Migrations, migrate, type RawDocument } from './migrations';

/** A document that could not be loaded; `problems` lists every issue found. */
export class DocumentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid circuit document:\n  ${problems.join('\n  ')}`);
    this.name = 'DocumentError';
    this.problems = problems;
  }
}

export interface LoadOptions {
  /** Schema version to migrate to and validate against (tests only; default: current). */
  readonly version?: number;
  /** Migrations to use (tests only; default: the built-in ones). */
  readonly migrations?: Migrations;
}

/** Parses and loads a document from JSON text. Throws a `DocumentError`. */
export function parseDocument(text: string, options?: LoadOptions): CircuitDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new DocumentError([`not valid JSON: ${(error as Error).message}`]);
  }
  return loadDocument(value, options);
}

/**
 * Builds a document from parsed JSON: migrates older schema versions, validates the structure and
 * fills defaults (`rotation: 0`, `flip: false`, `props: {}`). Throws a `DocumentError` listing all
 * problems, or a single one for a file from a newer version of the app.
 */
export function loadDocument(value: unknown, options: LoadOptions = {}): CircuitDocument {
  const current = options.version ?? SCHEMA_VERSION;
  if (!isObject(value))
    throw new DocumentError([`document: expected an object, got ${show(value)}`]);
  const version = value.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DocumentError([`schemaVersion: expected an integer ≥ 1, got ${show(version)}`]);
  }
  if (version > current) {
    throw new DocumentError([
      `schemaVersion: this file was saved by a newer version of the app (schema ${version}; ` +
        `this version reads up to ${current})`,
    ]);
  }
  const raw = version < current ? migrate(value, version, current, options.migrations) : value;
  const checker = new Checker();
  const document = checker.document(raw);
  if (checker.problems.length > 0 || !document) throw new DocumentError(checker.problems);
  return document;
}

// --- Validation -----------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

const join = (base: string, key: string | number) =>
  typeof key === 'number' ? `${base}[${key}]` : base === '' ? key : `${base}.${key}`;

/** A field parser: the parsed value, or `undefined` if the value is invalid. */
interface Parser<T> {
  readonly expected: string;
  parse(value: unknown): T | undefined;
}

const text: Parser<string> = {
  expected: 'a string',
  parse: (v) => (typeof v === 'string' ? v : undefined),
};

const id: Parser<string> = {
  expected: 'an id (a letter or _, then letters, digits, _ or -)',
  parse: (v) => (typeof v === 'string' && ID_PATTERN.test(v) ? v : undefined),
};

const circuitId: Parser<string> = {
  expected: 'a circuit id (lowercase letters and digits, runs joined by -)',
  parse: (v) => (typeof v === 'string' && CIRCUIT_ID.test(v) ? v : undefined),
};

const nonEmpty: Parser<string> = {
  expected: 'a non-empty string',
  parse: (v) => (typeof v === 'string' && v !== '' ? v : undefined),
};

const isCoord = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= COORD_LIMIT;

const coord: Parser<number> = {
  expected: `an integer within ±${COORD_LIMIT}`,
  parse: (v) => (isCoord(v) ? v : undefined),
};

const point: Parser<Point> = {
  expected: `[x, y] with integers within ±${COORD_LIMIT}`,
  parse: (v) =>
    Array.isArray(v) && v.length === 2 && isCoord(v[0]) && isCoord(v[1]) ? [v[0], v[1]] : undefined,
};

const rotation: Parser<Rotation> = {
  expected: '0, 90, 180 or 270',
  parse: (v) => (isRotation(v) ? v : undefined),
};

const radix: Parser<ProbeRadix> = {
  expected: PROBE_RADIXES.map((r) => `"${r}"`).join(', '),
  parse: (v) => (PROBE_RADIXES.find((r) => r === v) ? (v as ProbeRadix) : undefined),
};

const bool: Parser<boolean> = {
  expected: 'true or false',
  parse: (v) => (typeof v === 'boolean' ? v : undefined),
};

const ROOT_KEYS = ['schemaVersion', 'circuits'];
const CIRCUIT_KEYS = ['id', 'name', 'components', 'wires', 'probes', 'testScript', 'verilog'];
const VERILOG_KEYS = ['module'];
const SIGNAL_PROBE_KEYS = ['ref', 'name', 'radix'];
const GROUP_PROBE_KEYS = ['name', 'members', 'radix'];
const COMPONENT_KEYS = ['id', 'type', 'label', 'x', 'y', 'rotation', 'flip', 'props'];
const WIRE_KEYS = ['id', 'from', 'to', 'bus'];

class Checker {
  readonly problems: string[] = [];

  document(raw: RawDocument): CircuitDocument | undefined {
    this.unknownKeys(raw, '', ROOT_KEYS);
    const circuits = this.array(raw, 'circuits', '');
    if (!circuits) return undefined;
    if (circuits.length === 0) this.fail('circuits', 'expected at least one circuit');
    const parsed = circuits.map((c, i) => this.circuit(c, join('circuits', i)));
    this.uniqueIds([{ items: circuits, path: 'circuits' }], 'circuit id', circuitId);
    if (parsed.some((c) => c === undefined)) return undefined;
    return { schemaVersion: SCHEMA_VERSION, circuits: parsed as Circuit[] };
  }

  private circuit(value: unknown, path: string): Circuit | undefined {
    if (!this.isObject(value, path)) return undefined;
    this.unknownKeys(value, path, CIRCUIT_KEYS);
    const ownId = this.field(value, 'id', path, circuitId);
    const name = this.field(value, 'name', path, text);
    const verilog = value.verilog === undefined ? null : this.verilog(value, path);
    // A Verilog module has no parts or wires: the keys may be left out, and must be empty.
    const drawn = (key: 'components' | 'wires') => {
      if (verilog === null) return this.array(value, key, path) ?? [];
      if (value[key] === undefined) return [];
      const items = this.array(value, key, path) ?? [];
      if (items.length > 0) this.fail(join(path, key), 'a Verilog module has no parts or wires');
      return [];
    };
    const rawComponents = drawn('components');
    const rawWires = drawn('wires');
    const components = rawComponents.map((c, i) =>
      this.component(c, join(join(path, 'components'), i)),
    );
    const wires = rawWires.map((w, i) => this.wire(w, join(join(path, 'wires'), i)));
    this.uniqueIds(
      [
        { items: rawComponents, path: join(path, 'components') },
        { items: rawWires, path: join(path, 'wires') },
      ],
      'id',
    );
    const rawProbes = value.probes === undefined ? [] : (this.array(value, 'probes', path) ?? []);
    const probes = rawProbes.map((p, i) => this.probe(p, join(join(path, 'probes'), i)));
    const testScript = this.script(value, path);
    if (ownId === undefined || name === undefined || testScript === undefined) return undefined;
    if (components.some((c) => !c) || wires.some((w) => !w) || probes.some((p) => !p)) {
      return undefined;
    }
    if (verilog === undefined) return undefined;
    return {
      id: ownId,
      name,
      components: components as ComponentInstance[],
      wires: wires as Wire[],
      probes: probes as Probe[],
      testScript,
      ...(verilog !== null && { verilog }),
    };
  }

  /** A Verilog module: `{}` before it is compiled, `{ module }` after (the IR, checked whole). */
  private verilog(value: Obj, path: string): { module?: HdlModule } | undefined {
    const at = join(path, 'verilog');
    const raw = value.verilog;
    if (!this.isObject(raw, at)) return undefined;
    this.unknownKeys(raw, at, VERILOG_KEYS);
    if (raw.module === undefined) return {};
    const problems = hdlModuleProblems(raw.module, join(at, 'module'));
    if (problems.length > 0) {
      this.problems.push(...problems);
      return undefined;
    }
    return { module: raw.module as HdlModule };
  }

  /** A test script's lines: strings without line breaks; missing is none. */
  private script(value: Obj, path: string): string[] | undefined {
    if (value.testScript === undefined) return [];
    const lines = this.array(value, 'testScript', path);
    if (!lines) return undefined;
    let ok = true;
    lines.forEach((line, i) => {
      if (typeof line === 'string' && !/[\r\n]/.test(line)) return;
      this.fail(
        join(join(path, 'testScript'), i),
        `expected a line of text (a string without line breaks), got ${show(line)}`,
      );
      ok = false;
    });
    return ok ? (lines as string[]) : undefined;
  }

  /** `{ ref, name?, radix? }` or a group `{ name, members, radix? }`; references unchecked. */
  private probe(value: unknown, path: string): Probe | undefined {
    if (!this.isObject(value, path)) return undefined;
    const group = value.members !== undefined;
    this.unknownKeys(value, path, group ? GROUP_PROBE_KEYS : SIGNAL_PROBE_KEYS);
    const probeRadix = this.optional(value, 'radix', path, radix);
    const extra = probeRadix === undefined ? {} : { radix: probeRadix };
    if (group) {
      const name = this.field(value, 'name', path, nonEmpty);
      const members = this.array(value, 'members', path);
      const refs = (members ?? []).map((m, i) => {
        if (typeof m === 'string' && m !== '') return m;
        this.fail(join(join(path, 'members'), i), `expected ${nonEmpty.expected}, got ${show(m)}`);
        return undefined;
      });
      if (members?.length === 0) this.fail(join(path, 'members'), 'expected at least one member');
      if (name === undefined || refs.length === 0 || refs.some((r) => r === undefined)) {
        return undefined;
      }
      return { name, members: refs as string[], ...extra };
    }
    const ref = this.field(value, 'ref', path, nonEmpty);
    const name = this.optional(value, 'name', path, nonEmpty);
    if (ref === undefined) return undefined;
    return { ref, ...(name !== undefined && { name }), ...extra };
  }

  private component(value: unknown, path: string): ComponentInstance | undefined {
    if (!this.isObject(value, path)) return undefined;
    this.unknownKeys(value, path, COMPONENT_KEYS);
    const fields = {
      id: this.field(value, 'id', path, id),
      type: this.field(value, 'type', path, nonEmpty),
      x: this.field(value, 'x', path, coord),
      y: this.field(value, 'y', path, coord),
      rotation: this.field(value, 'rotation', path, rotation, 0),
      flip: this.field(value, 'flip', path, bool, false),
      props: this.props(value, path),
    };
    const label = this.optional(value, 'label', path, text);
    if (Object.values(fields).some((v) => v === undefined)) return undefined;
    const instance = fields as ComponentInstance;
    return label === undefined ? instance : { ...instance, label };
  }

  private wire(value: unknown, path: string): Wire | undefined {
    if (!this.isObject(value, path)) return undefined;
    this.unknownKeys(value, path, WIRE_KEYS);
    const wireId = this.field(value, 'id', path, id);
    const from = this.field(value, 'from', path, point);
    const to = this.field(value, 'to', path, point);
    if (from && to && !isAxisAligned(from, to)) {
      this.fail(path, 'a wire must be horizontal or vertical with non-zero length');
      return undefined;
    }
    const bus = this.field(value, 'bus', path, bool, false);
    if (wireId === undefined || !from || !to || bus === undefined) return undefined;
    return bus ? { id: wireId, from, to, bus } : { id: wireId, from, to };
  }

  private props(value: Obj, path: string): Record<string, PropValue> | undefined {
    const raw = value.props;
    if (raw === undefined) return {};
    const propsPath = join(path, 'props');
    if (!this.isObject(raw, propsPath)) return undefined;
    const props: Record<string, PropValue> = {};
    let ok = true;
    for (const [key, v] of Object.entries(raw)) {
      if (typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v)) {
        props[key] = v as PropValue;
      } else {
        this.fail(join(propsPath, key), `expected a number, string or boolean, got ${show(v)}`);
        ok = false;
      }
    }
    return ok ? props : undefined;
  }

  /** A required field, or an optional one when `fallback` is given. */
  private field<T>(obj: Obj, key: string, base: string, parser: Parser<T>, fallback?: T) {
    if (obj[key] === undefined) {
      if (fallback !== undefined) return fallback;
      this.fail(join(base, key), `missing (expected ${parser.expected})`);
      return undefined;
    }
    return this.optional(obj, key, base, parser);
  }

  private optional<T>(obj: Obj, key: string, base: string, parser: Parser<T>): T | undefined {
    const value = obj[key];
    if (value === undefined) return undefined;
    const parsed = parser.parse(value);
    if (parsed === undefined) {
      this.fail(join(base, key), `expected ${parser.expected}, got ${show(value)}`);
    }
    return parsed;
  }

  private array(obj: Obj, key: string, base: string): readonly unknown[] | undefined {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    this.fail(
      join(base, key),
      value === undefined ? 'missing (expected an array)' : `expected an array, got ${show(value)}`,
    );
    return undefined;
  }

  private isObject(value: unknown, path: string): value is Obj {
    if (isObject(value)) return true;
    this.fail(path, `expected an object, got ${show(value)}`);
    return false;
  }

  private unknownKeys(obj: Obj, path: string, known: readonly string[]): void {
    for (const key of Object.keys(obj)) {
      if (!known.includes(key)) this.fail(path || 'document', `unknown field "${key}"`);
    }
  }

  /** Reports repeated (syntactically valid) ids across the given lists, even in broken items. */
  private uniqueIds(
    lists: readonly { items: readonly unknown[]; path: string }[],
    what: string,
    parser: Parser<string> = id,
  ) {
    const seen = new Set<string>();
    for (const { items, path } of lists) {
      items.forEach((item, i) => {
        const value = isObject(item) ? parser.parse(item.id) : undefined;
        if (value === undefined) return;
        if (seen.has(value)) this.fail(join(join(path, i), 'id'), `duplicate ${what} "${value}"`);
        seen.add(value);
      });
    }
  }

  private fail(path: string, message: string): void {
    this.problems.push(`${path}: ${message}`);
  }
}

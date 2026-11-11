/**
 * Schema migrations: old documents are upgraded one version at a time before validation, so a
 * file saved by any earlier version still opens. Never edit a released migration; add a new one.
 */
import { CIRCUIT_ID, circuitIdFor, SCHEMA_VERSION } from './document';

/** Raw JSON of a document, before validation. */
export type RawDocument = Record<string, unknown>;

/** Upgrades a raw document from version `n` (its key in `Migrations`) to `n + 1`. */
export type Migration = (doc: RawDocument) => RawDocument;

export type Migrations = Readonly<Record<number, Migration>>;

/** Built-in migrations, keyed by the version they upgrade from. */
export const MIGRATIONS: Migrations = {
  // v2 added bus lines (`"bus": true` on a wire); v1 documents have none.
  1: (doc) => doc,
  // v3 added probes (`"probes"` on a circuit, R13); v2 documents have none.
  2: (doc) => doc,
  // v4 (R11a) gave the other circuits a meaning and made circuit ids slugs (`main`), the part
  // half of an instance's type; v3 only ever wrote `main`, others are turned into slugs.
  3: slugCircuitIds,
  // v5 added test scripts (`"testScript"` on a circuit, R15a); v4 documents have none.
  4: (doc) => doc,
  // v6 added Verilog modules (`"verilog"` on a circuit, HDL-1); v5 documents have none.
  5: (doc) => doc,
  // v7 let modules hold tri-states (`inout` ports, `z` port bits, `$tribuf`, HDL-8); v6 ones have none.
  6: (doc) => doc,
  // v8 let modules hold the rest of the cells and signed operands (HDL-9); v7 ones have none.
  7: (doc) => doc,
  // v9 gave modules memories (`memories`, `$memrd`, `$memwr`; HDL-6); v8 ones have none.
  8: addModuleMemories,
};

/** v8 → v9: every compiled module gets an empty `memories`. */
function addModuleMemories(doc: RawDocument): RawDocument {
  const { circuits } = doc;
  if (!Array.isArray(circuits)) return doc;
  return {
    ...doc,
    circuits: (circuits as unknown[]).map((circuit) => {
      if (typeof circuit !== 'object' || circuit === null) return circuit;
      const { verilog } = circuit as RawDocument;
      if (typeof verilog !== 'object' || verilog === null) return circuit;
      const { module } = verilog as RawDocument;
      if (typeof module !== 'object' || module === null || Array.isArray(module)) return circuit;
      if ((module as RawDocument).memories !== undefined) return circuit;
      return { ...circuit, verilog: { ...verilog, module: { ...module, memories: [] } } };
    }),
  };
}

function slugCircuitIds(doc: RawDocument): RawDocument {
  const { circuits } = doc;
  if (!Array.isArray(circuits)) return doc;
  const ids = (circuits as unknown[]).map((c) =>
    typeof c === 'object' && c !== null ? (c as RawDocument).id : undefined,
  );
  const taken = ids.filter((id): id is string => typeof id === 'string' && CIRCUIT_ID.test(id));
  return {
    ...doc,
    circuits: (circuits as unknown[]).map((circuit, i) => {
      const id = ids[i];
      if (typeof id !== 'string' || CIRCUIT_ID.test(id) || id === '') return circuit;
      const slug = circuitIdFor(id, taken);
      taken.push(slug);
      return { ...(circuit as RawDocument), id: slug };
    }),
  };
}

/**
 * Upgrades `doc` from `from` to `to`, running `migrations[from]`, `migrations[from + 1]`, … and
 * setting `schemaVersion` after each step. Throws if a step is missing (a programming error).
 */
export function migrate(
  doc: RawDocument,
  from: number,
  to: number = SCHEMA_VERSION,
  migrations: Migrations = MIGRATIONS,
): RawDocument {
  let current = doc;
  for (let version = from; version < to; version++) {
    const step = migrations[version];
    if (!step) throw new Error(`no migration from schema version ${version} to ${version + 1}`);
    current = { ...step(current), schemaVersion: version + 1 };
  }
  return current;
}

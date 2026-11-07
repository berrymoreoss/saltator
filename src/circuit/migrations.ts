/**
 * Schema migrations: old documents are upgraded one version at a time before validation, so a
 * file saved by any earlier version still opens. Never edit a released migration; add a new one.
 */
import { SCHEMA_VERSION } from './document';

/** Raw JSON of a document, before validation. */
export type RawDocument = Record<string, unknown>;

/** Upgrades a raw document from version `n` (its key in `Migrations`) to `n + 1`. */
export type Migration = (doc: RawDocument) => RawDocument;

export type Migrations = Readonly<Record<number, Migration>>;

/** Built-in migrations, keyed by the version they upgrade from. */
export const MIGRATIONS: Migrations = {
  // v2 added bus lines (`"bus": true` on a wire); v1 documents have none.
  1: (doc) => doc,
};

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

import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './document';
import { MIGRATIONS, migrate } from './migrations';

describe('migrate', () => {
  const migrations = {
    1: (doc: Record<string, unknown>) => ({ ...doc, steps: ['1→2'] }),
    2: (doc: Record<string, unknown>) => ({ ...doc, steps: [...(doc.steps as string[]), '2→3'] }),
  };

  it('runs every step in order and sets schemaVersion after each', () => {
    expect(migrate({ schemaVersion: 1 }, 1, 3, migrations)).toEqual({
      schemaVersion: 3,
      steps: ['1→2', '2→3'],
    });
    expect(migrate({ schemaVersion: 2, steps: [] }, 2, 3, migrations)).toEqual({
      schemaVersion: 3,
      steps: ['2→3'],
    });
  });

  it('does nothing when already current', () => {
    const doc = { schemaVersion: 3 };
    expect(migrate(doc, 3, 3, migrations)).toBe(doc);
  });

  it('throws on a missing step', () => {
    expect(() => migrate({}, 1, 4, migrations)).toThrow('no migration from schema version 3 to 4');
  });

  it('has a built-in migration for every version below the current one', () => {
    for (let version = 1; version < SCHEMA_VERSION; version++) {
      expect(MIGRATIONS[version]).toBeTypeOf('function');
    }
  });
});

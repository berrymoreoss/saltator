import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './commands';

const noop = () => {};

describe('CommandRegistry', () => {
  it('finds the command for a key press', () => {
    let runs = 0;
    const registry = new CommandRegistry([
      { id: 'a', label: 'A', shortcuts: ['Mod+A'], run: () => runs++ },
      { id: 'b', label: 'B', shortcuts: ['Home', 'Mod+0'], run: noop },
    ]);
    const press = { key: '0', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
    expect(registry.match(press, true)?.id).toBe('b');
    expect(registry.match({ ...press, key: 'x' }, true)).toBeUndefined();
    registry.get('a').run();
    expect(runs).toBe(1);
  });

  it('rejects duplicate ids and shortcuts', () => {
    expect(
      () =>
        new CommandRegistry([
          { id: 'a', label: 'A', run: noop },
          { id: 'a', label: 'A', run: noop },
        ]),
    ).toThrow(/duplicate command/);
    expect(
      () =>
        new CommandRegistry([
          { id: 'a', label: 'A', shortcuts: ['Mod+K'], run: noop },
          { id: 'b', label: 'B', shortcuts: ['Mod+k'], run: noop },
        ]),
    ).toThrow(/used by "a" and "b"/);
  });

  it('throws on unknown ids', () => {
    expect(() => new CommandRegistry([]).get('x')).toThrow(/unknown command/);
  });
});

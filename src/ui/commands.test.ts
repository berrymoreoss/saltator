import { describe, expect, it } from 'vitest';
import { CommandRegistry, dispatchShortcut } from './commands';

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

describe('dispatchShortcut', () => {
  /** A key press as the dispatcher sees it; records preventDefault. */
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) => {
    const event = {
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      isComposing: false,
      target: null,
      prevented: false,
      get defaultPrevented(): boolean {
        return this.prevented;
      },
      preventDefault() {
        this.prevented = true;
      },
      ...extra,
    };
    return event as unknown as KeyboardEvent & { prevented: boolean };
  };

  it('runs enabled commands and takes the key from the browser', () => {
    let runs = 0;
    const registry = new CommandRegistry([
      { id: 'a', label: 'A', shortcuts: ['W'], run: () => runs++ },
    ]);
    const event = press('w');
    expect(dispatchShortcut(registry, event, true)).toBe(true);
    expect([runs, event.prevented]).toEqual([1, true]);
  });

  it('leaves disabled keys to the browser, except for global commands (F5 never reloads)', () => {
    const registry = new CommandRegistry([
      { id: 'local', label: 'L', shortcuts: ['Mod+D'], enabled: () => false, run: noop },
      { id: 'run', label: 'R', shortcuts: ['F5'], global: true, enabled: () => false, run: noop },
    ]);
    const bookmark = press('d', { metaKey: true });
    expect(dispatchShortcut(registry, bookmark, true)).toBe(false);
    expect(bookmark.prevented).toBe(false);
    const reload = press('F5');
    expect(dispatchShortcut(registry, reload, true)).toBe(false);
    expect(reload.prevented).toBe(true);
  });
});

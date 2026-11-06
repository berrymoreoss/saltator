import { describe, expect, it } from 'vitest';
import { formatShortcut, isMacPlatform, matchesShortcut, parseShortcut } from './shortcuts';

const key = (
  k: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'shift' | 'alt', boolean>> = {},
) => ({
  key: k,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe('parseShortcut', () => {
  it('reads modifiers and the key', () => {
    expect(parseShortcut('Shift+Mod+Z')).toEqual({ key: 'z', mod: true, shift: true, alt: false });
    expect(parseShortcut('Home')).toEqual({ key: 'Home', mod: false, shift: false, alt: false });
    expect(parseShortcut('Mod++')).toEqual({ key: '+', mod: true, shift: false, alt: false });
  });

  it('rejects unknown modifiers', () => {
    expect(() => parseShortcut('Hyper+A')).toThrow(/unknown modifier/);
  });
});

describe('matchesShortcut', () => {
  const undo = parseShortcut('Mod+Z');

  it('uses ⌘ on macOS and Ctrl elsewhere', () => {
    expect(matchesShortcut(undo, key('z', { meta: true }), true)).toBe(true);
    expect(matchesShortcut(undo, key('z', { ctrl: true }), true)).toBe(false);
    expect(matchesShortcut(undo, key('z', { ctrl: true }), false)).toBe(true);
    expect(matchesShortcut(undo, key('z', { meta: true }), false)).toBe(false);
  });

  it('requires the exact modifiers', () => {
    expect(matchesShortcut(undo, key('Z', { meta: true, shift: true }), true)).toBe(false);
    expect(matchesShortcut(undo, key('z'), true)).toBe(false);
    expect(matchesShortcut(parseShortcut('/'), key('/'), true)).toBe(true);
  });

  it('ignores Shift for characters typed with Shift', () => {
    expect(
      matchesShortcut(parseShortcut('Mod++'), key('+', { meta: true, shift: true }), true),
    ).toBe(true);
    expect(matchesShortcut(parseShortcut('?'), key('?', { shift: true }), false)).toBe(true);
  });
});

describe('formatShortcut', () => {
  it('uses symbols on macOS and words elsewhere', () => {
    expect(formatShortcut('Shift+Mod+Z', true)).toBe('⇧⌘Z');
    expect(formatShortcut('Shift+Mod+Z', false)).toBe('Ctrl+Shift+Z');
    expect(formatShortcut('Escape', true)).toBe('Esc');
    expect(formatShortcut('Mod+0', false)).toBe('Ctrl+0');
  });

  it('detects macOS', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
  });
});

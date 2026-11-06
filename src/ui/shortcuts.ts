/**
 * Keyboard shortcuts written once as text (`Mod+0`, `Shift+Mod+Z`, `Home`, `/`) and matched
 * against keyboard events or shown in menus. `Mod` is ⌘ on macOS and Ctrl elsewhere.
 */

export interface Shortcut {
  /** `KeyboardEvent.key`, lower-cased for letters. */
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export function parseShortcut(text: string): Shortcut {
  // A trailing `+` is the plus key itself (`+`, `Mod++`), not a separator.
  const plusKey = text.endsWith('+');
  const parts = (plusKey ? text.slice(0, -1) : text).split('+').filter((p) => p !== '');
  const key = plusKey ? '+' : (parts.pop() ?? '');
  const modifiers = new Set(parts);
  for (const m of modifiers) {
    if (m !== 'Mod' && m !== 'Shift' && m !== 'Alt') {
      throw new Error(`unknown modifier "${m}" in shortcut "${text}"`);
    }
  }
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    mod: modifiers.has('Mod'),
    shift: modifiers.has('Shift'),
    alt: modifiers.has('Alt'),
  };
}

/** The parts of a keyboard event a shortcut looks at. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> &
  Partial<Pick<KeyboardEvent, 'code'>>;

/** Keys whose character needs Shift on common layouts: Shift is not part of the shortcut. */
const SHIFTED = new Set(['+', '?', '_', ':', '{', '}', '|', '"', '<', '>', '!', '@', '#']);

/** The key a shortcut compares: letters lower-cased. */
function keyOf(event: KeyLike): string {
  // Alt (Option on macOS) changes the character — ⌥N types a dead `˜` — so with Alt a letter or
  // digit is read from the physical key.
  const physical = event.altKey && event.code?.match(/^(?:Key([A-Z])|Digit([0-9]))$/);
  if (physical) return (physical[1] ?? physical[2]!).toLowerCase();
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export function matchesShortcut(shortcut: Shortcut, event: KeyLike, mac: boolean): boolean {
  if (keyOf(event) !== shortcut.key) return false;
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  if (mod !== shortcut.mod || other || event.altKey !== shortcut.alt) return false;
  return SHIFTED.has(shortcut.key) || event.shiftKey === shortcut.shift;
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Enter: '↩',
};

/** Human-readable form: `⇧⌘Z` on macOS, `Ctrl+Shift+Z` elsewhere. */
export function formatShortcut(text: string, mac: boolean): string {
  const s = parseShortcut(text);
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  if (mac) {
    return `${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.mod ? '⌘' : ''}${MAC_SYMBOLS[key] ?? key}`;
  }
  return [s.mod && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', key === 'Escape' ? 'Esc' : key]
    .filter(Boolean)
    .join('+');
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

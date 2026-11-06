/**
 * Commands: every user action has one definition — label, icon, shortcut, enabled/checked state,
 * what it does — read by the menu bar, the toolbar, the keyboard handler and the shortcut
 * reference. A shortcut is therefore defined exactly once.
 */
import type { ComponentType } from 'react';
import { type KeyLike, matchesShortcut, parseShortcut, type Shortcut } from './shortcuts';

export type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

export interface Command {
  readonly id: string;
  /** Menu text (and the name in the shortcuts dialog). */
  readonly label: string;
  /** Menu text that depends on state (`Undo Move`); defaults to the label. */
  readonly menuLabel?: () => string;
  /** Shorter text for toolbar tooltips (defaults to the label). */
  readonly title?: string;
  readonly icon?: IconComponent;
  /** Shortcuts in `parseShortcut` syntax; the first one is shown. */
  readonly shortcuts?: readonly string[];
  /** Runs even while typing in a text field (Escape). */
  readonly global?: boolean;
  readonly enabled?: () => boolean;
  /** A toggle or radio item's state. */
  readonly checked?: () => boolean;
  readonly run: () => void;
}

export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  readonly #shortcuts: { readonly shortcut: Shortcut; readonly command: Command }[] = [];

  constructor(commands: readonly Command[]) {
    const seen = new Map<string, string>();
    for (const command of commands) {
      if (this.#commands.has(command.id)) throw new Error(`duplicate command "${command.id}"`);
      this.#commands.set(command.id, command);
      for (const text of command.shortcuts ?? []) {
        const shortcut = parseShortcut(text);
        const key = JSON.stringify(shortcut);
        const other = seen.get(key);
        if (other) throw new Error(`shortcut ${text} is used by "${other}" and "${command.id}"`);
        seen.set(key, command.id);
        this.#shortcuts.push({ shortcut, command });
      }
    }
  }

  get(id: string): Command {
    const command = this.#commands.get(id);
    if (!command) throw new Error(`unknown command "${id}"`);
    return command;
  }

  list(): readonly Command[] {
    return [...this.#commands.values()];
  }

  /** The command a key press triggers, if any. */
  match(event: KeyLike, mac: boolean): Command | undefined {
    return this.#shortcuts.find(({ shortcut }) => matchesShortcut(shortcut, event, mac))?.command;
  }
}

export function isEnabled(command: Command): boolean {
  return command.enabled?.() ?? true;
}

/** True when keys typed at `target` belong to a text field, not to shortcuts. */
export function isTextField(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    return true;
  }
  if (target.tagName !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'range', 'color'].includes(type);
}

/** Runs the command bound to a key press; returns true if one ran. */
export function dispatchShortcut(
  registry: CommandRegistry,
  event: KeyboardEvent,
  mac: boolean,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const command = registry.match(event, mac);
  if (!command || !isEnabled(command)) return false;
  if (isTextField(event.target) && !command.global) return false;
  event.preventDefault();
  command.run();
  return true;
}

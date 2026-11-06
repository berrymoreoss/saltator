import { Check, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Command, type CommandRegistry, isEnabled } from './commands';
import { formatShortcut } from './shortcuts';
import type { MenuDef, MenuEntry } from './workbench-commands';

interface MenuBarProps {
  readonly menus: readonly MenuDef[];
  readonly commands: CommandRegistry;
  readonly mac: boolean;
}

/**
 * A desktop menu bar: click a title to open its menu, then hover the other titles to switch;
 * clicking an item runs it; Escape or a click outside closes. Submenus open on hover.
 */
export function MenuBar({ menus, commands, mac }: MenuBarProps) {
  const [open, setOpen] = useState<number | undefined>(undefined);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === undefined) return;
    const onPointer = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(undefined);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(undefined);
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const close = () => setOpen(undefined);

  return (
    <div className="menubar" role="menubar" ref={bar}>
      {menus.map((menu, i) => (
        <div key={menu.label} className="menubar-item">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            className={open === i ? 'menubar-title open' : 'menubar-title'}
            onPointerDown={(e) => {
              e.preventDefault();
              setOpen(open === i ? undefined : i);
            }}
            onPointerEnter={() => {
              if (open !== undefined) setOpen(i);
            }}
          >
            {menu.label}
          </button>
          {open === i && (
            <MenuList items={menu.items} commands={commands} mac={mac} onDone={close} />
          )}
        </div>
      ))}
    </div>
  );
}

interface MenuListProps {
  readonly items: readonly MenuEntry[];
  readonly commands: CommandRegistry;
  readonly mac: boolean;
  readonly onDone: () => void;
  readonly submenu?: boolean;
}

function MenuList({ items, commands, mac, onDone, submenu }: MenuListProps) {
  const [openSub, setOpenSub] = useState<string | undefined>(undefined);
  return (
    <div className={submenu ? 'menu submenu' : 'menu'} role="menu">
      {items.map((entry, i) => {
        if (typeof entry === 'string') {
          return (
            <CommandItem
              key={entry}
              command={commands.get(entry)}
              mac={mac}
              onDone={onDone}
              onHover={() => setOpenSub(undefined)}
            />
          );
        }
        if ('separator' in entry) {
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
          return <hr key={`sep-${i}`} className="menu-separator" />;
        }
        return (
          <div
            key={entry.label}
            className="menu-sub"
            onPointerEnter={() => setOpenSub(entry.label)}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openSub === entry.label}
              className={openSub === entry.label ? 'menu-row active' : 'menu-row'}
              onClick={() => setOpenSub(entry.label)}
            >
              <span className="menu-check" />
              <span className="menu-label">{entry.label}</span>
              <ChevronRight size={12} className="menu-arrow" />
            </button>
            {openSub === entry.label && (
              <MenuList items={entry.items} commands={commands} mac={mac} onDone={onDone} submenu />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface CommandItemProps {
  readonly command: Command;
  readonly mac: boolean;
  readonly onDone: () => void;
  readonly onHover: () => void;
}

function CommandItem({ command, mac, onDone, onHover }: CommandItemProps) {
  const enabled = isEnabled(command);
  const checked = command.checked?.();
  const shortcut = command.shortcuts?.[0];
  const content = (
    <>
      <span className="menu-check">{checked && <Check size={13} strokeWidth={2.5} />}</span>
      <span className="menu-label">{command.label}</span>
      {shortcut && <span className="menu-shortcut">{formatShortcut(shortcut, mac)}</span>}
    </>
  );
  const run = () => {
    onDone();
    command.run();
  };
  return checked === undefined ? (
    <button
      type="button"
      role="menuitem"
      className="menu-row"
      disabled={!enabled}
      onPointerEnter={onHover}
      onClick={run}
    >
      {content}
    </button>
  ) : (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="menu-row"
      disabled={!enabled}
      onPointerEnter={onHover}
      onClick={run}
    >
      {content}
    </button>
  );
}

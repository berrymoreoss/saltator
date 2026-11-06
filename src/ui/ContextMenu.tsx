import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Point } from '../circuit';
import type { Editor } from '../editor';
import type { CommandRegistry } from './commands';
import { useStore } from './hooks';
import { MenuList } from './MenuBar';
import { CANVAS_CONTEXT_MENU, ITEM_CONTEXT_MENU } from './workbench-commands';

interface ContextMenuProps {
  readonly editor: Editor;
  readonly commands: CommandRegistry;
  readonly mac: boolean;
}

/**
 * The canvas context menu, opened by the editor's `context-menu` request: editing commands over
 * a part or wire, paste/select all/fit over empty canvas. Escape, a click outside or running a
 * command closes it.
 */
export function ContextMenu({ editor, commands, mac }: ContextMenuProps) {
  const request = useStore(editor.requests);
  const [open, setOpen] = useState<{ at: Point; onItem: boolean } | undefined>(undefined);
  const [position, setPosition] = useState<Point>([0, 0]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (request?.kind !== 'context-menu') return;
    setOpen({ at: request.client, onItem: request.hit !== undefined });
    setPosition(request.client);
  }, [request]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const menu = box.current?.firstElementChild;
    if (!open || !(menu instanceof HTMLElement)) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition([
      Math.max(4, Math.min(open.at[0], window.innerWidth - width - 4)),
      Math.max(4, Math.min(open.at[1], window.innerHeight - height - 4)),
    ]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(undefined);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
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

  if (!open) return null;
  return (
    <div
      ref={box}
      className="context-menu"
      style={{ left: position[0], top: position[1] }}
      data-testid="context-menu"
    >
      <MenuList
        items={open.onItem ? ITEM_CONTEXT_MENU : CANVAS_CONTEXT_MENU}
        commands={commands}
        mac={mac}
        onDone={() => setOpen(undefined)}
      />
    </div>
  );
}

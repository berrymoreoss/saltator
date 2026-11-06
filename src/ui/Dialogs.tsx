import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { CommandRegistry } from './commands';
import { formatShortcut } from './shortcuts';

interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly testId?: string;
}

/** A modal window: Escape, the close button or a click outside closes it. */
export function Dialog({ title, onClose, children, testId }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="dialog-header">
          <span>{title}</span>
          <button type="button" className="icon-button" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

const SECTIONS: readonly (readonly [prefix: string, title: string])[] = [
  ['tool.', 'Tools'],
  ['edit.', 'Edit'],
  ['parts.', 'Parts'],
  ['view.', 'View'],
  ['help.', 'Help'],
];

/** Every command that has a shortcut, from the command registry. */
export function ShortcutsDialog({
  commands,
  mac,
  onClose,
}: {
  readonly commands: CommandRegistry;
  readonly mac: boolean;
  readonly onClose: () => void;
}) {
  const withShortcuts = commands.list().filter((c) => (c.shortcuts?.length ?? 0) > 0);
  return (
    <Dialog title="Keyboard Shortcuts" onClose={onClose} testId="shortcuts-dialog">
      <div className="shortcut-columns">
        {SECTIONS.map(([prefix, title]) => {
          const list = withShortcuts.filter((c) => c.id.startsWith(prefix));
          if (list.length === 0) return null;
          return (
            <div key={prefix} className="shortcut-section">
              <div className="prop-section-title">{title}</div>
              {list.map((command) => (
                <div key={command.id} className="shortcut-row">
                  <span>{command.label}</span>
                  <span className="shortcut-keys">
                    {command.shortcuts!.map((s) => (
                      <kbd key={s}>{formatShortcut(s, mac)}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        <div className="shortcut-section">
          <div className="prop-section-title">Canvas</div>
          <div className="shortcut-row">
            <span>Pan</span>
            <span className="shortcut-keys">
              <kbd>Space</kbd>+drag · middle drag · scroll
            </span>
          </div>
          <div className="shortcut-row">
            <span>Zoom</span>
            <span className="shortcut-keys">
              pinch · <kbd>{mac ? '⌘' : 'Ctrl'}</kbd>+scroll
            </span>
          </div>
          <div className="shortcut-row">
            <span>Add to selection</span>
            <span className="shortcut-keys">
              <kbd>{mac ? '⇧' : 'Shift'}</kbd>+click
            </span>
          </div>
          <div className="shortcut-row">
            <span>Move the selection</span>
            <span className="shortcut-keys">drag it</span>
          </div>
          <div className="shortcut-row">
            <span>Draw a wire</span>
            <span className="shortcut-keys">drag from a pin tip</span>
          </div>
          <div className="shortcut-row">
            <span>Edit a part</span>
            <span className="shortcut-keys">double-click</span>
          </div>
          <div className="shortcut-row">
            <span>Context menu</span>
            <span className="shortcut-keys">right click</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function AboutDialog({ onClose }: { readonly onClose: () => void }) {
  return (
    <Dialog title="About Logic" onClose={onClose} testId="about-dialog">
      <p className="about-title">Logic</p>
      <p>
        An event-driven digital logic simulator for designing and verifying computers built from
        real chips — <em>test before fab</em>.
      </p>
      <p className="muted">
        4-state logic with drive strengths, datasheet timing, 74HC parts, memories and CPUs as the
        roadmap grows.
      </p>
    </Dialog>
  );
}

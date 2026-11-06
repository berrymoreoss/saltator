import { X } from 'lucide-react';
import { type ReactNode, useRef } from 'react';

interface PanelProps {
  readonly title: ReactNode;
  readonly onClose?: () => void;
  /** Extra header controls (right-aligned, before the close button). */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}

/** A docked panel: a compact title bar and a scrolling body. */
export function Panel({ title, onClose, actions, children, className, testId }: PanelProps) {
  return (
    <section className={className ? `panel ${className}` : 'panel'} data-testid={testId}>
      <header className="panel-header">
        <div className="panel-title">{title}</div>
        <div className="panel-actions">
          {actions}
          {onClose && (
            <button type="button" className="icon-button" title="Hide panel" onClick={onClose}>
              <X size={13} />
            </button>
          )}
        </div>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

interface SplitterProps {
  /** `vertical` splits left/right (drag horizontally), `horizontal` splits top/bottom. */
  readonly orientation: 'vertical' | 'horizontal';
  /** Size of the panel being resized when the drag starts. */
  readonly size: number;
  /** +1 if dragging right/down grows the panel, −1 if it shrinks it. */
  readonly direction: 1 | -1;
  readonly onResize: (size: number) => void;
  readonly label: string;
}

/** A draggable divider between a dock and the canvas. */
export function Splitter({ orientation, size, direction, onResize, label }: SplitterProps) {
  const start = useRef<{ pointer: number; size: number } | undefined>(undefined);
  const vertical = orientation === 'vertical';
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element
    <div
      className={`splitter ${orientation}`}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={size}
      tabIndex={-1}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pointer: vertical ? e.clientX : e.clientY, size };
        document.body.classList.add(vertical ? 'resizing-x' : 'resizing-y');
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const delta = (vertical ? e.clientX : e.clientY) - s.pointer;
        onResize(s.size + direction * delta);
      }}
      onPointerUp={(e) => {
        start.current = undefined;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove('resizing-x', 'resizing-y');
      }}
    />
  );
}

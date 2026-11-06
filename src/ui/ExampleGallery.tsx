import { useEffect, useMemo, useRef } from 'react';
import type { ComponentRegistry } from '../core';
import { type CanvasTheme, drawCircuitPreview, type GateStyle } from '../editor';
import { Dialog } from './Dialogs';
import type { Example } from './ui-state';

interface ExampleGalleryProps {
  /** Examples with a description are shown (the dev-only stress test has none). */
  readonly examples: readonly Example[];
  readonly registry: ComponentRegistry;
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
  readonly onOpen: (example: Example) => void;
  readonly onClose: () => void;
}

const THUMBNAIL = { width: 220, height: 120 };

/** File ▸ New from Example…: a card per example — a thumbnail drawn live, title, description. */
export function ExampleGalleryDialog({
  examples,
  registry,
  theme,
  gateStyle,
  onOpen,
  onClose,
}: ExampleGalleryProps) {
  return (
    <Dialog title="New from Example" onClose={onClose} testId="example-gallery" wide>
      <p className="muted">Opens an untitled copy; Save asks where to keep it.</p>
      <div className="example-grid">
        {examples
          .filter((e) => e.description !== undefined)
          .map((example) => (
            <button
              key={example.id}
              type="button"
              className="example-card"
              data-example={example.id}
              onClick={() => onOpen(example)}
            >
              <Thumbnail
                example={example}
                registry={registry}
                theme={theme}
                gateStyle={gateStyle}
              />
              <span className="example-title">{example.label}</span>
              <span className="example-description muted">{example.description}</span>
            </button>
          ))}
      </div>
    </Dialog>
  );
}

function Thumbnail({
  example,
  registry,
  theme,
  gateStyle,
}: {
  readonly example: Example;
  readonly registry: ComponentRegistry;
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const circuit = useMemo(() => example.document().circuits[0]!, [example]);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(THUMBNAIL.width * dpr);
    element.height = Math.round(THUMBNAIL.height * dpr);
    drawCircuitPreview(ctx, registry, circuit, THUMBNAIL, { theme, gateStyle, dpr });
  }, [circuit, registry, theme, gateStyle]);
  return (
    <canvas
      ref={canvas}
      className="example-thumbnail"
      style={{ aspectRatio: `${THUMBNAIL.width} / ${THUMBNAIL.height}`, height: 'auto' }}
      role="img"
      aria-label={`Thumbnail of ${example.label}`}
    />
  );
}

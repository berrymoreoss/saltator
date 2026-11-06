import { useEffect, useRef, useState } from 'react';
import type { ComponentRegistry, PropValue } from '../core';
import { type CanvasTheme, drawPartPreview, type GateStyle } from '../editor';

interface PartPreviewProps {
  readonly type: string;
  readonly registry: ComponentRegistry;
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
  /** CSS height in px; the width follows the element's box. Omit to fill the parent's height. */
  readonly height?: number;
  /** An instance's props (the drawing follows prop-dependent shapes). */
  readonly props?: Readonly<Record<string, PropValue>>;
}

/** A part drawn by the canvas drawers, fitted into the element (Parts panel, Part tab). */
export function PartPreview({ type, registry, theme, gateStyle, height, props }: PartPreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || size.width === 0 || size.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * dpr);
    element.height = Math.round(size.height * dpr);
    drawPartPreview(ctx, registry, type, size, {
      theme,
      gateStyle,
      dpr,
      ...(props && { props: { ...props } }),
    });
  }, [type, registry, theme, gateStyle, size, props]);

  return (
    <canvas
      ref={canvas}
      className="part-preview"
      style={height === undefined ? { height: '100%' } : { height }}
      aria-label={`Symbol of ${type}`}
    />
  );
}

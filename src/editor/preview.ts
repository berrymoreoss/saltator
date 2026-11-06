/**
 * A single part drawn on its own (the Parts panel preview): same drawers and theme as the canvas,
 * no designator, fitted into the given size.
 */
import { emptyCircuit } from '../circuit';
import type { ComponentRegistry, PropValue } from '../core';
import { fitRect, type Viewport } from './camera';
import { renderScene } from './renderer';
import { buildScene } from './scene';
import { EMPTY_SELECTION } from './selection';
import type { GateStyle } from './symbols';
import type { CanvasTheme } from './theme';

export interface PreviewOptions {
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
  readonly dpr: number;
  readonly props?: Readonly<Record<string, PropValue>>;
}

export function drawPartPreview(
  ctx: CanvasRenderingContext2D,
  registry: ComponentRegistry,
  type: string,
  size: Viewport,
  options: PreviewOptions,
): void {
  const circuit = {
    ...emptyCircuit(),
    components: [
      { id: 'P', type, x: 0, y: 0, rotation: 0 as const, flip: false, props: options.props ?? {} },
    ],
  };
  const scene = buildScene(circuit, registry);
  const part = { ...scene.parts[0]!, texts: [] };
  const camera = fitRect(part.bounds, size, 18);
  renderScene(
    ctx,
    { ...scene, parts: [part], partById: new Map([[part.id, part]]) },
    { camera, viewport: size, dpr: options.dpr },
    {
      theme: options.theme,
      gateStyle: options.gateStyle,
      showGrid: false,
      selection: EMPTY_SELECTION,
    },
  );
}

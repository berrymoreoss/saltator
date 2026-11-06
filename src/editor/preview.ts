/**
 * Parts and circuits drawn on their own, fitted into a given size, with the canvas's drawers and
 * theme: a single part without its designator (Parts panel, Part tab) and a whole circuit (the
 * example gallery's thumbnails).
 */
import { type Circuit, emptyCircuit } from '../circuit';
import type { ComponentRegistry, PropValue } from '../core';
import { BASE_SCALE, centerOn, fitRect, type Viewport } from './camera';
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

/** A whole circuit fitted into `size` (an example's thumbnail); an empty one shows the paper. */
export function drawCircuitPreview(
  ctx: CanvasRenderingContext2D,
  registry: ComponentRegistry,
  circuit: Circuit,
  size: Viewport,
  options: Omit<PreviewOptions, 'props'>,
): void {
  const scene = buildScene(circuit, registry);
  const camera = scene.bounds
    ? fitRect(scene.bounds, size, 16)
    : centerOn([0, 0], size, BASE_SCALE);
  renderScene(
    ctx,
    scene,
    { camera, viewport: size, dpr: options.dpr },
    {
      theme: options.theme,
      gateStyle: options.gateStyle,
      showGrid: false,
      selection: EMPTY_SELECTION,
    },
  );
}

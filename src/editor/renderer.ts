/**
 * Draws one frame of the schematic: background, grid, wires, junctions, parts with their pins and
 * text, marks for open pins and dangling wire ends, hover and selection, the selection box.
 * Stateless: the caller (the canvas view) owns the canvas and decides when to redraw.
 * Spec: docs/editor.md#rendering.
 */
import type { Point, Rect } from '../circuit';
import type { Level } from '../core';
import { type Camera, type Viewport, visibleRect } from './camera';
import { CanvasGraphics, LINE_WIDTH, MIN_LINE_PX, WIRE_WIDTH } from './graphics';
import { gridSpacing } from './grid';
import type { BoxMode, Hit } from './hit-test';
import type { Scene, ScenePart } from './scene';
import type { Selection } from './selection';
import { drawPartBody, type GateStyle, type LiveDraw, type PartLive } from './symbols';
import { type CanvasTheme, SignalStyle, signalColor } from './theme';

export interface Frame {
  readonly camera: Camera;
  /** Canvas size in CSS px. */
  readonly viewport: Viewport;
  /** Device pixels per CSS px. */
  readonly dpr: number;
}

/** What the simulation shows on wires: each net's signal style. */
export interface SignalView {
  /** Style of a wire's net, by wire id (`NONE` for wires the simulation doesn't know). */
  wire(id: string): SignalStyle;
  /** Style at a connection point: junction dots. */
  point(p: Point): SignalStyle;
  /** Contention is in its bright phase (it flashes while running). */
  readonly flash: boolean;
  /** A part as it is in the simulation; undefined for parts the simulation doesn't have. */
  part(id: string): PartLive | undefined;
}

export interface RenderOptions {
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
  readonly showGrid: boolean;
  readonly selection: Selection;
  readonly hover?: Hit;
  readonly box?: { readonly rect: Rect; readonly mode: BoxMode };
  /**
   * Items that are not placed yet — a part being placed, pasted items before they are dropped,
   * a wire being drawn: drawn translucent, wires in the selection color.
   */
  readonly ghost?: Selection;
  /** Points where the item being placed will connect to something. */
  readonly connections?: readonly Point[];
  /** Live levels while simulating: wires and junctions take the colors of their nets. */
  readonly signals?: SignalView;
}

/** Wire style of each level, for parts that show a level (probes, clocks). */
const LEVEL_STYLES: readonly SignalStyle[] = [
  SignalStyle.L0,
  SignalStyle.L1,
  SignalStyle.X,
  SignalStyle.Z,
];

/** Opacity of ghost parts. */
const GHOST_ALPHA = 0.55;

/** Text and marks stick out of a part's bounds by about this much, in cells (for culling). */
const CULL_MARGIN = 4;

export function intersects(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x - margin <= b.x + b.width &&
    b.x <= a.x + a.width + margin &&
    a.y - margin <= b.y + b.height &&
    b.y <= a.y + a.height + margin
  );
}

/** Draws a full frame. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  frame: Frame,
  options: RenderOptions,
): void {
  const { camera, viewport, dpr } = frame;
  const { theme } = options;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, viewport.width * dpr, viewport.height * dpr);
  if (options.showGrid) drawGrid(ctx, frame, theme);

  const view = visibleRect(camera, viewport);
  const g = new CanvasGraphics(ctx, camera, dpr, theme);
  const parts = scene.parts.filter((part) => intersects(part.bounds, view, CULL_MARGIN));

  drawHover(g, scene, options);
  drawSelectionFills(g, parts, options);
  drawWires(g, scene, view, options);
  drawJunctions(g, scene, view, options);
  const ghost = options.ghost;
  const signals = options.signals;
  const levelColor = (level: Level) => signalColor(theme, LEVEL_STYLES[level]!);
  for (const part of parts) {
    const isGhost = ghost?.parts.has(part.id) === true;
    if (isGhost) ctx.globalAlpha = GHOST_ALPHA;
    const live = isGhost ? undefined : signals?.part(part.id);
    drawPart(g, part, options, live && { part: live, levelColor });
    if (isGhost) ctx.globalAlpha = 1;
  }
  drawMarks(g, scene, parts, view, ghost);
  if (options.connections) drawConnections(g, options.connections);
  if (options.box) drawBox(g, options.box.rect, options.box.mode);
}

function drawGrid(ctx: CanvasRenderingContext2D, frame: Frame, theme: CanvasTheme): void {
  const { camera, viewport, dpr } = frame;
  const { step, major } = gridSpacing(camera.scale);
  const view = visibleRect(camera, viewport);
  const x0 = Math.ceil(view.x / step) * step;
  const y0 = Math.ceil(view.y / step) * step;
  const k = camera.scale * dpr;
  const size = Math.max(1, Math.round(dpr));
  const half = size / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const minor = new Path2D();
  const strong = new Path2D();
  for (let y = y0; y <= view.y + view.height; y += step) {
    const sy = Math.round((y - camera.y) * k) - half;
    for (let x = x0; x <= view.x + view.width; x += step) {
      const sx = Math.round((x - camera.x) * k) - half;
      (x % major === 0 && y % major === 0 ? strong : minor).rect(sx, sy, size, size);
    }
  }
  ctx.fillStyle = theme.gridDot;
  ctx.fill(minor);
  ctx.fillStyle = theme.gridMajor;
  ctx.fill(strong);
}

function drawHover(g: CanvasGraphics, scene: Scene, options: RenderOptions): void {
  const { hover, theme } = options;
  if (!hover) return;
  g.world();
  if (hover.kind === 'part') {
    const part = scene.partById.get(hover.id);
    if (!part) return;
    const b = part.bounds;
    g.beginPath();
    g.rect(b.x - 0.3, b.y - 0.3, b.width + 0.6, b.height + 0.6);
    g.stroke(theme.hover, 0.12);
  } else {
    const wire = scene.wireById.get(hover.id);
    if (!wire) return;
    g.beginPath();
    g.moveTo(wire.from[0], wire.from[1]);
    g.lineTo(wire.to[0], wire.to[1]);
    g.stroke(theme.hover, 0.5);
  }
}

function drawSelectionFills(
  g: CanvasGraphics,
  parts: readonly ScenePart[],
  options: RenderOptions,
): void {
  const { selection, theme } = options;
  if (selection.parts.size === 0) return;
  g.world();
  g.beginPath();
  for (const part of parts) {
    if (!selection.parts.has(part.id)) continue;
    const b = part.bounds;
    g.rect(b.x - 0.3, b.y - 0.3, b.width + 0.6, b.height + 0.6);
  }
  g.fill(theme.selectionFill);
}

function drawWires(g: CanvasGraphics, scene: Scene, view: Rect, options: RenderOptions): void {
  const { selection, theme, ghost, signals } = options;
  // One path per color: plain or level colors, the selection color for selected and ghost wires.
  // While simulating, a selected wire keeps its level color over a selection halo.
  const halo: (readonly [Point, Point])[] = [];
  const byColor = new Map<string, (readonly [Point, Point])[]>();
  for (const wire of scene.wires) {
    const [x0, y0] = wire.from;
    const [x1, y1] = wire.to;
    const box = {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0),
    };
    if (!intersects(box, view, 1)) continue;
    const selected = selection.wires.has(wire.id);
    let color: string;
    if (ghost?.wires.has(wire.id)) color = theme.selection;
    else if (signals) {
      color = signalColor(theme, signals.wire(wire.id), signals.flash);
      if (selected) halo.push([wire.from, wire.to]);
    } else color = selected ? theme.selection : theme.wire;
    groupPush(byColor, color, [wire.from, wire.to] as const);
  }
  g.world();
  if (halo.length > 0) strokeSegments(g, halo, theme.hover, WIRE_WIDTH * 4);
  for (const [color, segments] of byColor) strokeSegments(g, segments, color, WIRE_WIDTH);
}

/** Adds `item` to its group's list. */
function groupPush<K, V>(groups: Map<K, V[]>, key: K, item: V): void {
  const list = groups.get(key);
  if (list) list.push(item);
  else groups.set(key, [item]);
}

function strokeSegments(
  g: CanvasGraphics,
  segments: readonly (readonly [Point, Point])[],
  color: string,
  width: number,
): void {
  g.beginPath();
  for (const [from, to] of segments) {
    g.moveTo(from[0], from[1]);
    g.lineTo(to[0], to[1]);
  }
  g.stroke(color, width);
}

function drawJunctions(g: CanvasGraphics, scene: Scene, view: Rect, options: RenderOptions): void {
  if (scene.junctions.length === 0) return;
  const { signals, theme } = options;
  const r = Math.max(0.2, 2.5 / g.scale);
  const byColor = new Map<string, Point[]>();
  for (const p of scene.junctions) {
    const [x, y] = p;
    if (x < view.x - 1 || x > view.x + view.width + 1) continue;
    if (y < view.y - 1 || y > view.y + view.height + 1) continue;
    const color = signals ? signalColor(theme, signals.point(p), signals.flash) : theme.junction;
    groupPush(byColor, color, p);
  }
  g.world();
  for (const [color, points] of byColor) {
    g.beginPath();
    for (const [x, y] of points) {
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, Math.PI * 2);
    }
    g.fill(color);
  }
}

function drawPart(
  g: CanvasGraphics,
  part: ScenePart,
  options: RenderOptions,
  live: LiveDraw | undefined,
): void {
  const { selection, theme, gateStyle } = options;
  g.highlight = selection.parts.has(part.id) ? theme.selection : undefined;
  g.place(part.placement);

  if (part.layout.pins.length > 0) {
    g.beginPath();
    for (const pin of part.layout.pins) {
      const [x, y] = pin.at;
      g.moveTo(x, y);
      switch (pin.side) {
        case 'left':
          g.lineTo(x + 1, y);
          break;
        case 'right':
          g.lineTo(x - 1, y);
          break;
        case 'top':
          g.lineTo(x, y + 1);
          break;
        case 'bottom':
          g.lineTo(x, y - 1);
          break;
      }
    }
    g.stroke('pin', LINE_WIDTH);
  }
  drawPartBody(g, part, gateStyle, theme.error, live);

  g.world();
  for (const text of part.texts) {
    g.text(text.text, text.at[0], text.at[1], {
      size: text.size,
      align: text.align,
      baseline: text.baseline,
      paint: 'text',
      bold: text.role === 'designator' || text.role === 'name',
    });
  }
  g.highlight = undefined;
}

/** Open circles on unconnected pin ends, squares on dangling wire ends (not for ghosts). */
function drawMarks(
  g: CanvasGraphics,
  scene: Scene,
  parts: readonly ScenePart[],
  view: Rect,
  ghost: Selection | undefined,
): void {
  const r = Math.max(0.15, 2 / g.scale);
  g.world();
  g.beginPath();
  for (const part of parts) {
    if (ghost?.parts.has(part.id)) continue;
    for (const pin of part.pins) {
      if (!pin.open) continue;
      g.moveTo(pin.at[0] + r, pin.at[1]);
      g.arc(pin.at[0], pin.at[1], r, 0, Math.PI * 2);
    }
  }
  g.stroke(g.theme.openPin, MIN_LINE_PX / g.scale);
  if (scene.danglingEnds.length === 0) return;
  const s = Math.max(0.3, 5 / g.scale);
  g.beginPath();
  for (const [x, y] of scene.danglingEnds) {
    if (x < view.x - 1 || x > view.x + view.width + 1) continue;
    if (y < view.y - 1 || y > view.y + view.height + 1) continue;
    g.rect(x - s / 2, y - s / 2, s, s);
  }
  g.stroke(g.theme.warning, 1.5 / g.scale);
}

/** Rings where a ghost will connect: what a click would join. */
function drawConnections(g: CanvasGraphics, points: readonly Point[]): void {
  if (points.length === 0) return;
  const r = Math.max(0.3, 4.5 / g.scale);
  g.world();
  g.beginPath();
  for (const [x, y] of points) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill(g.theme.selectionFill);
  g.stroke(g.theme.selection, 1.5 / g.scale);
}

function drawBox(g: CanvasGraphics, rect: Rect, mode: BoxMode): void {
  g.world();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.width, rect.height);
  g.fill(g.theme.selectionFill);
  if (mode === 'touching') g.setDash([4 / g.scale, 3 / g.scale]);
  g.stroke(g.theme.selection, 1 / g.scale);
  g.setDash([]);
}

/**
 * The editor facade the UI mounts on a `<canvas>`: owns the circuit, its scene, the selection and
 * the camera; turns pointer, wheel and Space-key input into navigation and selection; redraws on
 * demand. React reads its state through the `state` and `view` stores. Spec: docs/editor.md.
 */
import type { Circuit, Point, Rect } from '../circuit';
import { emptyCircuit, normalizeWires, sameCircuit } from '../circuit';
import type { ComponentRegistry } from '../core';
import {
  BASE_SCALE,
  type Camera,
  centerOn,
  DEFAULT_CAMERA,
  fitRect,
  panBy,
  toWorld,
  type Viewport,
  zoomAt,
  zoomStep,
} from './camera';
import {
  EMPTY_HISTORY,
  type History,
  invertRenames,
  pushEntry,
  redoEntry,
  sealHistory,
  undoEntry,
} from './history';
import { type BoxMode, boxHits, type Hit, hitTest, rectFromPoints } from './hit-test';
import { deleteSelection, flipSelection, moveSelection, rotateSelection } from './operations';
import { renderScene } from './renderer';
import { buildScene, LayoutCache, type Scene } from './scene';
import {
  EMPTY_SELECTION,
  isSelected,
  pruneSelection,
  type Selection,
  sameSelection,
  selectAll,
  selectHit,
  selectionOf,
  selectionSize,
  toggleHit,
  unionSelection,
} from './selection';
import { Store } from './store';
import type { GateStyle } from './symbols';
import { type CanvasTheme, DARK_CANVAS } from './theme';

/** What the scroll wheel does without modifiers: pan (Figma, trackpads) or zoom (KiCad, mice). */
export type WheelMode = 'pan' | 'zoom';

/** What a left-button drag does: select (click, box) or pan the view. R04b adds editing tools. */
export type Tool = 'select' | 'pan';

export interface EditorSettings {
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
  readonly showGrid: boolean;
  readonly wheel: WheelMode;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  theme: DARK_CANVAS,
  gateStyle: 'ansi',
  showGrid: true,
  wheel: 'pan',
};

/** Document-level state: changes when the circuit or the selection changes. */
export interface EditorState {
  readonly circuit: Circuit;
  readonly scene: Scene;
  readonly selection: Selection;
  /**
   * Parts renamed by the change that produced this state, old designator → new (an edit, its
   * undo or redo), so a simulator host can carry their state over (R05, ADR-0006).
   */
  readonly renames?: ReadonlyMap<string, string>;
}

/** How `Editor.edit` records an edit. */
export interface EditOptions {
  /** Selection after the edit (default: the current one, minus items that are gone). */
  readonly selection?: Selection;
  /** Consecutive edits with the same key are one undo step (arrow-key nudges). */
  readonly coalesce?: string;
  readonly renames?: ReadonlyMap<string, string>;
  /** Zoom to fit the new circuit (opening an example). */
  readonly fit?: boolean;
}

/** View state: changes with every pan, zoom and pointer move (keep its consumers small). */
export interface ViewState {
  readonly camera: Camera;
  readonly viewport: Viewport;
  /** Grid point nearest to the pointer, while it is over the canvas. */
  readonly cursor?: Point;
  /** Duration of the last redraw in ms. */
  readonly frameMs: number;
}

/** Something to show: a part, a wire or a point (design issues carry any of them). */
export interface Locatable {
  readonly component?: string;
  readonly wire?: string;
  readonly at?: Point;
}

/** Pointer travel (px) before a press on empty canvas becomes a selection box. */
const DRAG_THRESHOLD = 3;
/** Hit-test tolerance in screen px. */
const HIT_TOLERANCE = 5;

type Gesture =
  | { readonly kind: 'pan'; last: Point }
  | {
      readonly kind: 'box';
      readonly start: Point;
      readonly startWorld: Point;
      readonly additive: boolean;
      readonly before: Selection;
      active: boolean;
    }
  | { readonly kind: 'press' };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export class Editor {
  readonly registry: ComponentRegistry;
  readonly state: Store<EditorState>;
  readonly view: Store<ViewState>;
  readonly tool = new Store<Tool>('select');
  /** Undo/redo stacks (labels drive the Edit menu). */
  readonly history = new Store<History>(EMPTY_HISTORY);
  #settings: EditorSettings;
  readonly #layouts = new LayoutCache();
  #hover: Hit | undefined;
  #box: { rect: Rect; mode: BoxMode } | undefined;
  #gesture: Gesture | undefined;
  #space = false;
  #canvas: HTMLCanvasElement | undefined;
  #ctx: CanvasRenderingContext2D | undefined;
  #dpr = 1;
  #frame = 0;
  #fitPending = true;

  constructor(
    registry: ComponentRegistry,
    circuit: Circuit = emptyCircuit(),
    settings: Partial<EditorSettings> = {},
  ) {
    this.registry = registry;
    this.#settings = { ...DEFAULT_SETTINGS, ...settings };
    const scene = buildScene(circuit, registry, { layouts: this.#layouts });
    this.state = new Store<EditorState>({ circuit, scene, selection: EMPTY_SELECTION });
    this.view = new Store<ViewState>({
      camera: DEFAULT_CAMERA,
      viewport: { width: 0, height: 0 },
      frameMs: 0,
    });
  }

  get settings(): EditorSettings {
    return this.#settings;
  }

  get scene(): Scene {
    return this.state.get().scene;
  }

  /**
   * Loads a circuit: replaces the document and forgets the undo history; the selection keeps the
   * items that still exist. Edits go through `edit` instead.
   */
  setCircuit(circuit: Circuit, options: { fit?: boolean } = {}): void {
    this.#show(circuit, this.state.get().selection, undefined, options.fit);
    this.history.set(EMPTY_HISTORY);
  }

  /**
   * Commits one user action as one undo step: normalizes the wires (if they changed) and records
   * the circuit and selection before and after. Returns false (and records nothing) when the
   * circuit didn't change.
   */
  edit(label: string, circuit: Circuit, options: EditOptions = {}): boolean {
    const before = this.state.get();
    const next = circuit.wires === before.circuit.wires ? circuit : normalizeWires(circuit);
    if (sameCircuit(next, before.circuit)) {
      if (options.selection) this.setSelection(options.selection);
      return false;
    }
    this.#show(next, options.selection ?? before.selection, options.renames, options.fit);
    const after = this.state.get();
    this.history.update((history) =>
      pushEntry(history, {
        label,
        before: { circuit: before.circuit, selection: before.selection },
        after: { circuit: after.circuit, selection: after.selection },
        ...(options.coalesce !== undefined && { coalesce: options.coalesce }),
        ...(options.renames && { renames: options.renames }),
      }),
    );
    return true;
  }

  /** Label of the action Undo would revert (`Move`), if any. */
  get undoLabel(): string | undefined {
    return this.history.get().past.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.history.get().future.at(-1)?.label;
  }

  undo(): void {
    const step = undoEntry(this.history.get());
    if (!step) return;
    const { circuit, selection } = step.entry.before;
    this.#show(circuit, selection, invertRenames(step.entry.renames));
    this.history.set(step.history);
  }

  redo(): void {
    const step = redoEntry(this.history.get());
    if (!step) return;
    const { circuit, selection } = step.entry.after;
    this.#show(circuit, selection, step.entry.renames);
    this.history.set(step.history);
  }

  /** Ends coalescing: the next nudge starts a new undo step. */
  sealHistory(): void {
    this.history.update(sealHistory);
  }

  #show(
    circuit: Circuit,
    selection: Selection,
    renames: ReadonlyMap<string, string> | undefined,
    fit = false,
  ): void {
    const scene = buildScene(circuit, this.registry, { layouts: this.#layouts });
    this.state.set({
      circuit,
      scene,
      selection: pruneSelection(selection, scene),
      ...(renames && renames.size > 0 && { renames }),
    });
    this.#hover = undefined;
    if (fit) {
      this.#fitPending = true;
      this.#fitIfReady();
    }
    this.invalidate();
  }

  setSettings(settings: Partial<EditorSettings>): void {
    this.#settings = { ...this.#settings, ...settings };
    this.invalidate();
  }

  setSelection(selection: Selection): void {
    const { renames: _, ...current } = this.state.get();
    if (sameSelection(selection, current.selection)) return;
    this.state.set({ ...current, selection });
    this.invalidate();
  }

  setTool(tool: Tool): void {
    this.tool.set(tool);
    this.#updateCursor();
  }

  selectAll(): void {
    this.setSelection(selectAll(this.scene));
  }

  clearSelection(): void {
    this.setSelection(EMPTY_SELECTION);
  }

  // ── Editing ─────────────────────────────────────────────────────────────────────────────

  get hasSelection(): boolean {
    return selectionSize(this.state.get().selection) > 0;
  }

  /** Deletes the selected parts and wires (wires attached to deleted parts stay). */
  deleteSelection(): void {
    const { circuit, selection } = this.state.get();
    if (selectionSize(selection) === 0) return;
    this.edit('Delete', deleteSelection(circuit, selection), { selection: EMPTY_SELECTION });
  }

  /** Turns the selection a quarter turn about its center; attached wires follow. */
  rotate(clockwise = true): void {
    const { selection } = this.state.get();
    this.edit('Rotate', rotateSelection(this.scene, selection, clockwise));
  }

  /** Mirrors the selection about its center: `horizontal` swaps left and right. */
  flip(direction: 'horizontal' | 'vertical' = 'horizontal'): void {
    const { selection } = this.state.get();
    this.edit('Flip', flipSelection(this.scene, selection, direction));
  }

  /** Moves the selection by whole cells; repeated nudges of one selection are one undo step. */
  nudge(dx: number, dy: number): void {
    const { selection } = this.state.get();
    const key = `nudge ${[...selection.parts].join(',')} ${[...selection.wires].join(',')}`;
    this.edit('Move', moveSelection(this.scene, selection, dx, dy), { coalesce: key });
  }

  // ── Camera ──────────────────────────────────────────────────────────────────────────────

  setCamera(camera: Camera): void {
    this.view.update((view) => ({ ...view, camera }));
    this.invalidate();
  }

  #center(): Point {
    const { viewport } = this.view.get();
    return [viewport.width / 2, viewport.height / 2];
  }

  zoomIn(): void {
    this.setCamera(zoomStep(this.view.get().camera, 1, this.#center()));
  }

  zoomOut(): void {
    this.setCamera(zoomStep(this.view.get().camera, -1, this.#center()));
  }

  /** 100 % about the center of the view. */
  zoomActual(): void {
    const { camera } = this.view.get();
    this.setCamera(zoomAt(camera, BASE_SCALE / camera.scale, this.#center()));
  }

  /** Shows the whole circuit (or the origin at 100 % when it is empty). */
  zoomToFit(): void {
    const { viewport } = this.view.get();
    const bounds = this.scene.bounds;
    this.setCamera(bounds ? fitRect(bounds, viewport) : centerOn([0, 0], viewport, BASE_SCALE));
  }

  /** Selects the item and brings it into view: centered, at 100 % or more. */
  locate(item: Locatable, options: { zoom?: boolean } = {}): void {
    const scene = this.scene;
    const part = item.component ? scene.partById.get(item.component) : undefined;
    const wire = item.wire ? scene.wireById.get(item.wire) : undefined;
    if (part) this.setSelection(selectionOf([part.id]));
    else if (wire) this.setSelection(selectionOf([], [wire.id]));
    const rect: Rect | undefined = part
      ? part.bounds
      : wire
        ? rectFromPoints(wire.from, wire.to)
        : item.at
          ? { x: item.at[0], y: item.at[1], width: 0, height: 0 }
          : undefined;
    if (!rect) return;
    const { camera, viewport } = this.view.get();
    if (options.zoom) {
      this.setCamera(fitRect(rect, viewport, 96));
      return;
    }
    const center: Point = [rect.x + rect.width / 2, rect.y + rect.height / 2];
    this.setCamera(centerOn(center, viewport, Math.max(camera.scale, BASE_SCALE)));
  }

  // ── Canvas ──────────────────────────────────────────────────────────────────────────────

  /** Attaches to a canvas: sizing, input and drawing. Returns the detach function. */
  mount(canvas: HTMLCanvasElement): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.#canvas = canvas;
    this.#ctx = ctx;
    const abort = new AbortController();
    const { signal } = abort;

    const resize = () => this.#resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // devicePixelRatio changes when the window moves to another display or the page zooms.
    let dprQuery: MediaQueryList | undefined;
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDpr);
      dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    };
    const onDpr = () => {
      watchDpr();
      resize();
    };
    watchDpr();

    canvas.addEventListener('pointerdown', (e) => this.#onPointerDown(e), { signal });
    canvas.addEventListener('pointermove', (e) => this.#onPointerMove(e), { signal });
    canvas.addEventListener('pointerup', (e) => this.#onPointerUp(e), { signal });
    canvas.addEventListener('pointercancel', () => this.#endGesture(), { signal });
    canvas.addEventListener('pointerleave', () => this.#onPointerLeave(), { signal });
    canvas.addEventListener('wheel', (e) => this.#onWheel(e), { signal, passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    window.addEventListener('keydown', (e) => this.#onKey(e, true), { signal });
    window.addEventListener('keyup', (e) => this.#onKey(e, false), { signal });
    window.addEventListener('blur', () => this.#setSpace(false), { signal });

    resize();
    return () => {
      abort.abort();
      observer.disconnect();
      dprQuery?.removeEventListener('change', onDpr);
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
      this.#canvas = undefined;
      this.#ctx = undefined;
    };
  }

  /** Schedules a redraw on the next animation frame. */
  invalidate(): void {
    if (this.#frame !== 0 || !this.#ctx) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
    });
  }

  #resize(): void {
    const canvas = this.#canvas;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.#dpr = dpr;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    this.view.update((view) => ({ ...view, viewport: { width, height } }));
    this.#fitIfReady();
    this.#draw();
  }

  #fitIfReady(): void {
    const { viewport } = this.view.get();
    if (!this.#fitPending || viewport.width === 0 || viewport.height === 0) return;
    this.#fitPending = false;
    this.zoomToFit();
  }

  #draw(): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const start = performance.now();
    const { camera, viewport } = this.view.get();
    const { scene, selection } = this.state.get();
    const { theme, gateStyle, showGrid } = this.#settings;
    renderScene(
      ctx,
      scene,
      { camera, viewport, dpr: this.#dpr },
      {
        theme,
        gateStyle,
        showGrid,
        selection,
        ...(this.#hover && { hover: this.#hover }),
        ...(this.#box && { box: this.#box }),
      },
    );
    const frameMs = performance.now() - start;
    this.view.update((view) => ({ ...view, frameMs }));
  }

  // ── Input ───────────────────────────────────────────────────────────────────────────────

  #local(e: MouseEvent): Point {
    const rect = this.#canvas!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  #hitAt(screen: Point): Hit | undefined {
    const { camera } = this.view.get();
    return hitTest(this.scene, toWorld(camera, screen), HIT_TOLERANCE / camera.scale);
  }

  #onPointerDown(e: PointerEvent): void {
    const canvas = this.#canvas!;
    canvas.focus({ preventScroll: true });
    const at = this.#local(e);
    if (e.button === 1 || (e.button === 0 && (this.#space || this.tool.get() === 'pan'))) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.#gesture = { kind: 'pan', last: at };
      this.#updateCursor();
      return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const hit = this.#hitAt(at);
    const { selection } = this.state.get();
    if (hit) {
      if (e.shiftKey) this.setSelection(toggleHit(selection, hit));
      else if (!isSelected(selection, hit)) this.setSelection(selectHit(hit));
      this.#gesture = { kind: 'press' };
      return;
    }
    this.#gesture = {
      kind: 'box',
      start: at,
      startWorld: toWorld(this.view.get().camera, at),
      additive: e.shiftKey,
      before: selection,
      active: false,
    };
  }

  #onPointerMove(e: PointerEvent): void {
    const at = this.#local(e);
    const { camera } = this.view.get();
    const world = toWorld(camera, at);
    const cursor: Point = [Math.round(world[0]), Math.round(world[1])];
    const previous = this.view.get().cursor;
    if (!previous || previous[0] !== cursor[0] || previous[1] !== cursor[1]) {
      this.view.update((view) => ({ ...view, cursor }));
    }

    const gesture = this.#gesture;
    if (gesture?.kind === 'pan') {
      this.setCamera(panBy(camera, at[0] - gesture.last[0], at[1] - gesture.last[1]));
      gesture.last = at;
      return;
    }
    if (gesture?.kind === 'box') {
      const moved = Math.hypot(at[0] - gesture.start[0], at[1] - gesture.start[1]);
      if (!gesture.active && moved < DRAG_THRESHOLD) return;
      gesture.active = true;
      // Left-to-right selects what is inside, right-to-left what the box touches.
      const mode: BoxMode = at[0] >= gesture.start[0] ? 'inside' : 'touching';
      const rect = rectFromPoints(gesture.startWorld, world);
      this.#box = { rect, mode };
      const hits = boxHits(this.scene, rect, mode);
      const boxed = selectionOf(hits.parts, hits.wires);
      this.setSelection(gesture.additive ? unionSelection(gesture.before, boxed) : boxed);
      this.invalidate();
      return;
    }
    if (gesture) return;
    const hover = this.#hitAt(at);
    if (hover?.kind !== this.#hover?.kind || hover?.id !== this.#hover?.id) {
      this.#hover = hover;
      this.invalidate();
    }
  }

  #onPointerUp(e: PointerEvent): void {
    const gesture = this.#gesture;
    if (gesture?.kind === 'box' && !gesture.active && !gesture.additive) this.clearSelection();
    if (this.#canvas?.hasPointerCapture(e.pointerId)) {
      this.#canvas.releasePointerCapture(e.pointerId);
    }
    this.#endGesture();
  }

  #endGesture(): void {
    this.#gesture = undefined;
    if (this.#box) {
      this.#box = undefined;
      this.invalidate();
    }
    this.#updateCursor();
  }

  #onPointerLeave(): void {
    if (this.#gesture) return;
    this.view.update(({ cursor: _, ...view }) => view);
    if (this.#hover) {
      this.#hover = undefined;
      this.invalidate();
    }
  }

  #onWheel(e: WheelEvent): void {
    e.preventDefault();
    const at = this.#local(e);
    const { camera } = this.view.get();
    // Normalize line/page deltas (some mice) to pixels.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const modifier = e.metaKey || e.ctrlKey;
    if (modifier || (this.#settings.wheel === 'zoom' && !e.shiftKey)) {
      // Pinch gestures arrive as ctrl+wheel with small deltas; mouse wheels with large ones.
      const sensitivity = e.ctrlKey && !e.metaKey && Math.abs(dy) < 50 ? 0.01 : 0.002;
      this.setCamera(zoomAt(camera, Math.exp(-dy * sensitivity), at));
      return;
    }
    if (this.#settings.wheel === 'zoom') {
      // KiCad mode: Shift+wheel pans horizontally.
      this.setCamera(panBy(camera, -(dx || dy), 0));
      return;
    }
    this.setCamera(panBy(camera, -dx, -dy));
  }

  #onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code !== 'Space' || isTyping(e.target)) return;
    if (down && !this.#pointerOverCanvas()) return;
    e.preventDefault();
    this.#setSpace(down);
  }

  #pointerOverCanvas(): boolean {
    return this.#canvas?.matches(':hover') === true || document.activeElement === this.#canvas;
  }

  #setSpace(down: boolean): void {
    if (this.#space === down) return;
    this.#space = down;
    this.#updateCursor();
  }

  #updateCursor(): void {
    const canvas = this.#canvas;
    if (!canvas) return;
    canvas.style.cursor =
      this.#gesture?.kind === 'pan'
        ? 'grabbing'
        : this.#space || this.tool.get() === 'pan'
          ? 'grab'
          : 'default';
  }
}

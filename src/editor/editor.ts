/**
 * The editor facade the UI mounts on a `<canvas>`: owns the circuit, its scene, the selection, the
 * undo history and the camera; turns pointer, wheel and key input into navigation, selection and
 * edits (tools: select/move, pan, wire, place; floating paste); redraws on demand. React reads its
 * state through the stores. The DOM layer only converts events into `PointerInput`s, so the
 * gestures run (and are tested) without a browser. Spec: docs/editor.md.
 */
import type {
  Circuit,
  CircuitDocument,
  ComponentInstance,
  Design,
  DocumentRegistry,
  Point,
  Rect,
  Rotation,
} from '../circuit';
import {
  addComponents,
  addWires,
  CompileCache,
  type ComponentPatch,
  circuitsContaining,
  compileDesign,
  copyFragment,
  designatorError,
  emptyCircuit,
  fragmentDocument,
  importCircuits,
  inverseTransformPoint,
  nextDesignator,
  normalizeWires,
  partLayout,
  pasteFragment,
  prefixOfType,
  removeItems,
  renamePartInDocument,
  replaceCircuit,
  SCHEMA_VERSION,
  sameCircuit,
  sameDocument,
  scriptLines,
  subcircuitOf,
  transformPoint,
  transformRect,
  updateComponent,
} from '../circuit';
import { type ComponentRegistry, type PropValue, resolveProps } from '../core';
import { Analyzer } from './analyzer';
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
import { fragmentText, parseFragment } from './clipboard';
import { Debugger, EMPTY_DEBUG_SETUP } from './debugger';
import {
  EMPTY_HISTORY,
  type History,
  invertRenames,
  pushEntry,
  redoEntry,
  type Snapshot,
  sealHistory,
  undoEntry,
} from './history';
import { type BoxMode, boxHits, type Hit, hitTest, rectFromPoints } from './hit-test';
import { MemoryInspector } from './memory-inspector';
import { type ItemTransform, mirror, rotation, transformItems } from './move';
import {
  deleteSelection,
  flipSelection,
  moveSelection,
  rotateSelection,
  selectionBounds,
} from './operations';
import { type ProbeSpot, probeSpotAt } from './probe-target';
import { renderScene } from './renderer';
import { buildScene, LayoutCache, layoutBounds, type Scene } from './scene';
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
import {
  BROWSER_CLOCK,
  Simulation,
  type SimulationModel,
  type SimulationOptions,
} from './simulation';
import { Store } from './store';
import { type GateStyle, INTERACTIONS, type Poke } from './symbols';
import { type CanvasTheme, DARK_CANVAS } from './theme';
import {
  ConnectionIndex,
  legPosture,
  otherPosture,
  type Posture,
  pathConnections,
  polylineSegments,
  routeL,
} from './wire-route';

/** What the scroll wheel does without modifiers: pan (Figma, trackpads) or zoom (KiCad, mice). */
export type WheelMode = 'pan' | 'zoom';

/** The part the place tool puts down on each click. */
export interface PlaceTool {
  readonly kind: 'place';
  readonly type: string;
  /** Props every placed part gets (a pull-up is `prim/pull` with `direction: 'up'`). */
  readonly props?: Readonly<Record<string, PropValue>>;
}

/**
 * What a left-button press does: select/move, pan the view, draw a wire, place a part, or
 * operate parts of the running simulation (switches, buttons).
 */
export type Tool = 'select' | 'pan' | 'wire' | 'bus' | 'interact' | 'probe' | PlaceTool;

/** What is going on right now (for the status-bar hint). */
export type EditorMode = 'idle' | 'moving' | 'boxing' | 'panning' | 'wiring' | 'floating';

/** Something the editor asks the UI to do. `seq` grows with every request. */
export type EditorRequest =
  | {
      readonly kind: 'context-menu';
      /** Viewport (client) coordinates for the menu. */
      readonly client: Point;
      readonly hit?: Hit;
      readonly seq: number;
    }
  | { readonly kind: 'edit-properties'; readonly seq: number }
  /** A probe was added or removed from the canvas (show the Waveforms tab), or why not. */
  | {
      readonly kind: 'probed';
      readonly ref: string;
      readonly problem?: string;
      readonly seq: number;
    };

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

/** Document-level state: changes when the document, the circuit open or the selection changes. */
export interface EditorState {
  /** The whole document: every circuit, the first the top (R11a). */
  readonly document: CircuitDocument;
  /** The circuit open on the canvas, the one edits go to. */
  readonly circuit: Circuit;
  /**
   * The instance of it open (R11b), whose levels the canvas shows: its instance path, `''` the
   * top circuit, `A1`, `A1/A2`; undefined when the design places the circuit nowhere.
   */
  readonly path: string | undefined;
  /** The open circuit's scene. */
  readonly scene: Scene;
  /** The top circuit flattened: what simulates, what the tools resolve against. */
  readonly design: Design;
  readonly selection: Selection;
  /**
   * Parts of the design renamed by the change that produced this state, old netlist id → new
   * (an edit, its undo or redo), so a simulator host can carry their state over (R05).
   */
  readonly renames?: ReadonlyMap<string, string>;
}

/** How `Editor.edit` records an edit. */
export interface EditOptions {
  /** Selection after the edit (default: the current one, minus items that are gone). */
  readonly selection?: Selection;
  /** Consecutive edits with the same key are one undo step (arrow-key nudges). */
  readonly coalesce?: string;
  /** Parts of the open circuit renamed by the edit, old designator → new. */
  readonly renames?: ReadonlyMap<string, string>;
  /** Zoom to fit the new circuit (opening an example). */
  readonly fit?: boolean;
}

/** How `Editor.editDocument` records an edit of the document. */
export interface DocumentEditOptions extends EditOptions {
  /** The circuit open after the edit (default: the one open, else the top). */
  readonly open?: string;
}

/** How an `Editor` is wired up beyond its document and view settings. */
export interface EditorOptions {
  /** The simulator host's clock and frame budget (a fake clock in tests). */
  readonly simulation?: SimulationOptions;
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

/** A pointer event as the gestures see it (canvas pixels; no DOM). */
export interface PointerInput {
  /** Position on the canvas in CSS px. */
  readonly at: Point;
  /** 0 left, 1 middle, 2 right. */
  readonly button: number;
  readonly shift: boolean;
  /** Viewport position, for menus the UI opens there. */
  readonly client?: Point;
}

/** Pointer travel (px) before a press becomes a drag. */
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
  /** Pressed on an item; a drag moves the selection, or draws a wire from a pin tip. */
  | {
      readonly kind: 'press';
      readonly start: Point;
      readonly startWorld: Point;
      readonly hit: Hit;
      /** Pin tip or free wire end under the press: a drag draws a wire from here. */
      readonly wireFrom?: WireStart;
      /** Select the hit on release (a press on a pin tip leaves the selection until then). */
      readonly selectOnClick: boolean;
    }
  | { readonly kind: 'move'; readonly startWorld: Point; delta: Point; circuit: Circuit }
  /** A wire dragged out of a pin (Select tool): releasing finishes it. */
  | { readonly kind: 'wire-drag' }
  /** Interact tool, pressed where there is nothing to operate: a click selects, a drag pans. */
  | {
      readonly kind: 'interact-press';
      readonly start: Point;
      readonly hit?: Hit;
      last: Point;
      panning: boolean;
    }
  /** Interact tool, holding a momentary part (a push button) until the press ends. */
  | { readonly kind: 'hold'; readonly component: string; readonly release: unknown };

/** Where a wire or a bus line can start: a pin tip or a dangling end, and its layer. */
interface WireStart {
  readonly at: Point;
  readonly bus: boolean;
}

/** The wire being drawn: fixed points so far, the leg to the pointer follows `posture`. */
interface WireDraft {
  readonly points: Point[];
  /** A bus line (the Bus tool, or dragged out of a bus pin or bus end). */
  readonly bus: boolean;
  /** Posture of the leg to the pointer, once known; `swapped` flips it (Tab). */
  posture?: Posture;
  swapped: boolean;
  readonly index: ConnectionIndex;
}

/** Pasted or duplicated items following the pointer until a click drops them. */
interface Floating {
  readonly fragment: Circuit;
  /** The document a drop goes into: the editor's, with the circuits a paste brought along. */
  readonly document: CircuitDocument;
  /** Grid point of the fragment that sits under the pointer. */
  readonly anchor: Point;
  readonly label: string;
}

/** An `EditorRequest` before it gets its sequence number. */
type RequestInput =
  | { readonly kind: 'context-menu'; readonly client: Point; readonly hit?: Hit }
  | { readonly kind: 'edit-properties' }
  | { readonly kind: 'probed'; readonly ref: string; readonly problem?: string };

interface Preview {
  readonly circuit: Circuit;
  readonly ghost: Selection;
  /** The parts it is drawn with, when they are not the document's (a paste's circuits). */
  readonly registry?: DocumentRegistry;
}

function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const cell = (p: Point): Point => [Math.round(p[0]), Math.round(p[1])];
const rot = (r: number): Rotation => (((r % 360) + 360) % 360) as Rotation;

/**
 * The instance of circuit `circuit` to open: `''` for the top; `wanted` if it places the
 * circuit, else the longest end of it that does (`A1/A2` → `A2` once the circuit A1 placed is
 * the top); else its first instance in design order; undefined if the design places it nowhere.
 */
function instancePath(
  design: Design,
  circuit: string,
  wanted: string | undefined,
): string | undefined {
  if (circuit === design.top) return '';
  for (let rest = wanted; rest; ) {
    if (design.circuitAt(rest) === circuit) return rest;
    const slash = rest.indexOf('/');
    rest = slash < 0 ? undefined : rest.slice(slash + 1);
  }
  return design.instances.find((i) => i.circuit === circuit)?.path;
}

function snapshotOf(state: EditorState): Snapshot {
  return {
    document: state.document,
    open: state.circuit.id,
    ...(state.path !== undefined && { path: state.path }),
    selection: state.selection,
  };
}

export class Editor {
  /** The library's parts; `registry` adds the document's circuits (R11a). */
  readonly library: ComponentRegistry;
  readonly state: Store<EditorState>;
  readonly view: Store<ViewState>;
  readonly tool = new Store<Tool>('select');
  readonly mode = new Store<EditorMode>('idle');
  /** Undo/redo stacks (labels drive the Edit menu). */
  readonly history = new Store<History>(EMPTY_HISTORY);
  /** Requests to the UI: open the context menu, focus the Properties panel. */
  readonly requests = new Store<EditorRequest | undefined>(undefined);
  /** Runs the circuit (R05); follows every document change. */
  readonly simulation: Simulation;
  /** The memories of the circuit: cells, addresses, accesses, edits (R12b). */
  readonly memory: MemoryInspector;
  /** The waveform analyzer: probes, their record, the view and the trigger (R13). */
  readonly analyzer: Analyzer;
  /** The debugger: breakpoints, steps, watches, run statistics (R14). */
  readonly debug: Debugger;
  #settings: EditorSettings;
  readonly #layouts = new LayoutCache();
  /** Each circuit compiled once per change of it, and the document registry (R11a). */
  readonly #cache = new CompileCache();
  /** The camera each circuit was left with, by circuit id. */
  readonly #cameras = new Map<string, Camera>();
  /** The simulation model of each state, so the host sees one object per state. */
  readonly #models = new WeakMap<EditorState, SimulationModel>();
  #hover: Hit | undefined;
  /** The Probe tool's spot under the pointer. */
  #probeHover: ProbeSpot | undefined;
  /** What a right click pointed at, for the context menu's Add to Waveforms. */
  #contextProbe: ProbeSpot | undefined;
  #box: { rect: Rect; mode: BoxMode } | undefined;
  #gesture: Gesture | undefined;
  #wire: WireDraft | undefined;
  #floating: Floating | undefined;
  /** Orientation of the next part the place tool puts down (R and F change it). */
  #place: { rotation: Rotation; flip: boolean } = { rotation: 0, flip: false };
  /** Props of the part of each type placed or edited last, for types with `nextProps`. */
  readonly #lastProps = new Map<string, Readonly<Record<string, PropValue>>>();
  /** A part dragged over the canvas from the Parts panel. */
  #dragType: string | undefined;
  #preview: Preview | undefined;
  #previewScene: Scene | undefined;
  #index: { scene: Scene; wires: ConnectionIndex; buses: ConnectionIndex } | undefined;
  #requestSeq = 0;
  #space = false;
  #canvas: HTMLCanvasElement | undefined;
  #ctx: CanvasRenderingContext2D | undefined;
  #dpr = 1;
  #frame = 0;
  #fitPending = true;

  constructor(
    library: ComponentRegistry,
    content: Circuit | CircuitDocument = emptyCircuit(),
    settings: Partial<EditorSettings> = {},
    options: EditorOptions = {},
  ) {
    this.library = library;
    this.#settings = { ...DEFAULT_SETTINGS, ...settings };
    const document = documentOf(content);
    this.state = new Store<EditorState>(
      this.#stateOf(document, document.circuits[0]!.id, EMPTY_SELECTION),
    );
    this.simulation = new Simulation(library, this.#model(this.state.get()), options.simulation);
    this.memory = new MemoryInspector(this, options.simulation?.clock ?? BROWSER_CLOCK);
    this.state.subscribe(() => {
      const state = this.state.get();
      this.simulation.sync(this.#model(state), state.renames);
    });
    // After the host's own subscription: the analyzer follows the simulator the host keeps.
    this.analyzer = new Analyzer(this);
    this.debug = new Debugger(this, options.simulation?.clock ?? BROWSER_CLOCK);
    this.simulation.revision.subscribe(() => this.#redrawNow());
    // Run (from stopped) arms the Interact tool; Stop leaves it.
    let running = false;
    this.simulation.status.subscribe(() => {
      const active = this.simulation.state !== 'stopped';
      if (active === running) return;
      running = active;
      // The Probe tool stays: probing while running is what it is for.
      if (active && this.tool.get() !== 'probe') this.setTool('interact');
      else if (!active && this.tool.get() === 'interact') this.setTool('select');
    });
    this.view = new Store<ViewState>({
      camera: DEFAULT_CAMERA,
      viewport: { width: 0, height: 0 },
      frameMs: 0,
    });
  }

  get settings(): EditorSettings {
    return this.#settings;
  }

  /** The parts the document can use: the library's and its circuits' (`sub/<id>`). */
  get registry(): DocumentRegistry {
    return this.state.get().design.registry;
  }

  get scene(): Scene {
    return this.state.get().scene;
  }

  /**
   * The netlist id of a part of the open circuit in the instance open (`U1` at the top,
   * `A1/U1` inside A1); undefined in a circuit the design places nowhere.
   */
  flatPart(id: string): string | undefined {
    return this.#model(this.state.get()).flatPart(id);
  }

  /** What the simulation host runs and shows for a state: the open scene in its instance. */
  #model(state: EditorState): SimulationModel {
    let model = this.#models.get(state);
    if (!model) {
      const { design, scene, path } = state;
      const prefix = path ? `${path}/` : '';
      model = {
        netlist: design.netlist,
        scene,
        path,
        flatNet: path === undefined ? () => undefined : (net) => design.netOf(path, net),
        flatPart: path === undefined ? () => undefined : (id) => prefix + id,
      };
      this.#models.set(state, model);
    }
    return model;
  }

  /**
   * A state for a document with circuit `open` on the canvas (the top if it has no such
   * circuit), in the instance at `path` if that places it, else in its first instance.
   */
  #stateOf(
    document: CircuitDocument,
    open: string,
    selection: Selection,
    renames?: ReadonlyMap<string, string>,
    path?: string,
  ): EditorState {
    const design = compileDesign(document, this.library, { cache: this.#cache });
    const circuit = document.circuits.find((c) => c.id === open) ?? document.circuits[0]!;
    const scene = buildScene(circuit, design.registry, {
      compiled: design.circuits.get(circuit.id)!,
      layouts: this.#layouts,
    });
    return {
      document,
      circuit,
      path: instancePath(design, circuit.id, path),
      scene,
      design,
      selection: pruneSelection(selection, scene),
      ...(renames && renames.size > 0 && { renames }),
    };
  }

  /** The circuit as drawn right now: a gesture's preview, or the document. */
  get displayed(): Circuit {
    return this.#preview?.circuit ?? this.state.get().circuit;
  }

  /**
   * Loads a circuit as a document of its own (tests, examples): see `setDocument`.
   */
  setCircuit(circuit: Circuit, options: { fit?: boolean; camera?: Camera } = {}): void {
    this.setDocument(documentOf(circuit), options);
  }

  /**
   * Loads a document: replaces it and forgets the undo history, opens circuit `open` (default:
   * the top); the selection keeps the items that still exist. Edits go through `edit` instead.
   * `fit` zooms to fit once the canvas has a size; `camera` restores a view instead (and cancels
   * a pending fit).
   */
  setDocument(
    document: CircuitDocument,
    options: { open?: string; path?: string; fit?: boolean; camera?: Camera } = {},
  ): void {
    this.cancel();
    this.analyzer.clear();
    this.debug.load(EMPTY_DEBUG_SETUP);
    this.#cameras.clear();
    const open = options.open ?? document.circuits[0]!.id;
    this.#show(document, open, this.state.get().selection, {
      fit: options.fit === true && !options.camera,
      ...(options.path !== undefined && { path: options.path }),
    });
    this.history.set(EMPTY_HISTORY);
    if (options.camera) {
      this.#fitPending = false;
      this.setCamera(options.camera);
    }
  }

  /**
   * Opens another circuit of the document on the canvas — not an edit — in its first instance
   * (R11b). The camera the circuit was left with comes back; one never shown is zoomed to fit.
   */
  openCircuit(id: string): void {
    const state = this.state.get();
    if (id === state.circuit.id || !state.document.circuits.some((c) => c.id === id)) return;
    this.cancel();
    this.#show(state.document, id, EMPTY_SELECTION);
  }

  /**
   * Goes into the instance at instance path `path` (`A1/A2`; `''` the top): its circuit open,
   * drawn with its levels while simulating (R11b). Not an edit; the circuit's camera comes back.
   */
  openInstance(path: string): void {
    const state = this.state.get();
    const circuit = state.design.circuitAt(path);
    if (circuit === undefined || path === state.path) return;
    this.cancel();
    const same = circuit === state.circuit.id;
    this.#show(state.document, circuit, same ? state.selection : EMPTY_SELECTION, { path });
  }

  /**
   * Leaves the instance open for the one it is placed in, with it selected and in view. Returns
   * false at the top or in a circuit the design doesn't place.
   */
  goUp(): boolean {
    const path = this.state.get().path;
    if (!path) return false;
    const slash = path.lastIndexOf('/');
    return this.goUpTo(slash < 0 ? '' : path.slice(0, slash));
  }

  /**
   * Goes up to `ancestor`, an instance the open one is inside (`''` the top), with the instance
   * on the way down selected and in view (from `A2/A1`: `A1` in A2, `A2` at the top). False
   * when the open instance isn't inside it.
   */
  goUpTo(ancestor: string): boolean {
    const path = this.state.get().path;
    if (!path || (ancestor !== '' && !path.startsWith(`${ancestor}/`))) return false;
    const rest = ancestor === '' ? path : path.slice(ancestor.length + 1);
    const designator = rest.split('/')[0]!;
    this.openInstance(ancestor);
    const part = this.scene.partById.get(designator);
    if (!part) return true;
    this.setSelection(selectionOf([part.id]));
    if (this.#fitPending) return true;
    const { camera, viewport } = this.view.get();
    const [x0, y0] = toWorld(camera, [0, 0]);
    const [x1, y1] = toWorld(camera, [viewport.width, viewport.height]);
    const { x, y, width, height } = part.bounds;
    const visible = x >= x0 && y >= y0 && x + width <= x1 && y + height <= y1;
    if (!visible) this.#bringIntoView(part.bounds, false);
    return true;
  }

  /**
   * Goes into instance `designator` of the open circuit, in the instance open (`A1` inside
   * `A2` is `A2/A1`); from a circuit placed nowhere, into the first instance of its circuit.
   * Returns false when it is no subcircuit instance.
   */
  goInto(designator: string): boolean {
    const { scene, path } = this.state.get();
    const type = scene.partById.get(designator)?.instance.type;
    const inner = type === undefined ? undefined : subcircuitOf(type);
    if (inner === undefined) return false;
    if (path === undefined) this.openCircuit(inner);
    else this.openInstance(path === '' ? designator : `${path}/${designator}`);
    return true;
  }

  /** Goes to the top circuit (its instance path `''`). */
  goTop(): void {
    this.openInstance('');
  }

  /** The camera of each circuit but the open one, as it was left (sessions keep them). */
  get cameras(): ReadonlyMap<string, Camera> {
    return this.#cameras;
  }

  /**
   * Commits one user action on the open circuit as one undo step: normalizes the wires (if they
   * changed) and records the document, the circuit open and the selection before and after.
   * Returns false (and records nothing) when the circuit didn't change.
   */
  edit(label: string, circuit: Circuit, options: EditOptions = {}): boolean {
    const before = this.state.get();
    const own = circuit.id === before.circuit.id ? circuit : { ...circuit, id: before.circuit.id };
    const next = own.wires === before.circuit.wires ? own : normalizeWires(own);
    if (sameCircuit(next, before.circuit)) {
      if (options.selection) this.setSelection(options.selection);
      return false;
    }
    return this.#commit(label, replaceCircuit(before.document, next), before.circuit.id, options);
  }

  /**
   * Commits a change of the document as one undo step: circuits added, renamed, removed or
   * reordered, an edit in a circuit not open, a paste that brings circuits along. The open
   * circuit's wires are normalized if they changed. Returns false when nothing changed.
   */
  editDocument(
    label: string,
    document: CircuitDocument,
    options: DocumentEditOptions = {},
  ): boolean {
    const before = this.state.get();
    const open = options.open ?? before.circuit.id;
    let next = document;
    const circuit = next.circuits.find((c) => c.id === open);
    const old = before.document.circuits.find((c) => c.id === open);
    if (circuit && old && circuit.wires !== old.wires) {
      next = replaceCircuit(next, normalizeWires(circuit));
    }
    if (sameDocument(next, before.document) && open === before.circuit.id) {
      if (options.selection) this.setSelection(options.selection);
      return false;
    }
    return this.#commit(label, next, open, options);
  }

  #commit(label: string, document: CircuitDocument, open: string, options: EditOptions): boolean {
    const before = this.state.get();
    const renames =
      options.renames && this.#flatRenames(before.design, before.circuit.id, options.renames);
    this.#show(document, open, options.selection ?? before.selection, {
      ...(renames && { renames }),
      ...(options.fit !== undefined && { fit: options.fit }),
    });
    const after = this.state.get();
    this.history.update((history) =>
      pushEntry(history, {
        label,
        before: snapshotOf(before),
        after: snapshotOf(after),
        ...(options.coalesce !== undefined && { coalesce: options.coalesce }),
        ...(renames && renames.size > 0 && { renames }),
      }),
    );
    return true;
  }

  /**
   * Renames of parts of circuit `circuit` as renames of the design's parts: in every instance
   * of it (and at the top when it is the top), each part and, for an instance renamed, every part
   * inside it (`A1` → `A3`: `A1/U1` → `A3/U1`).
   */
  #flatRenames(
    design: Design,
    circuit: string,
    renames: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> {
    const scopes = [
      ...(circuit === design.top ? [''] : []),
      ...design.instances.filter((i) => i.circuit === circuit).map((i) => `${i.path}/`),
    ];
    const flat = new Map<string, string>();
    // An instance renamed: its path too, for references to nets inside it (`A1/CLK`).
    for (const scope of scopes) {
      for (const [from, to] of renames) {
        if (design.circuitAt(scope + from) !== undefined) flat.set(scope + from, scope + to);
      }
    }
    for (const { id } of design.netlist.components) {
      for (const scope of scopes) {
        if (!id.startsWith(scope)) continue;
        const rest = id.slice(scope.length);
        for (const [from, to] of renames) {
          if (rest === from) flat.set(id, scope + to);
          else if (rest.startsWith(`${from}/`))
            flat.set(id, `${scope}${to}${rest.slice(from.length)}`);
        }
      }
    }
    return flat;
  }

  /** Label of the action Undo would revert (`Move`), if any. */
  get undoLabel(): string | undefined {
    return this.history.get().past.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.history.get().future.at(-1)?.label;
  }

  undo(): void {
    if (this.#cancelGesture()) return;
    const step = undoEntry(this.history.get());
    if (!step) return;
    const { document, open, path, selection } = step.entry.before;
    const renames = invertRenames(step.entry.renames);
    this.#show(document, open, selection, {
      ...(renames && { renames }),
      ...(path !== undefined && { path }),
    });
    this.history.set(step.history);
  }

  redo(): void {
    if (this.#cancelGesture()) return;
    const step = redoEntry(this.history.get());
    if (!step) return;
    const { document, open, path, selection } = step.entry.after;
    const { renames } = step.entry;
    this.#show(document, open, selection, {
      ...(renames && { renames }),
      ...(path !== undefined && { path }),
    });
    this.history.set(step.history);
  }

  /** Ends coalescing: the next nudge starts a new undo step. */
  sealHistory(): void {
    this.history.update(sealHistory);
  }

  /**
   * Shows a document with circuit `open` on the canvas in the instance at `path`; without one,
   * the instance open stays if the circuit does, else its first instance.
   */
  #show(
    document: CircuitDocument,
    open: string,
    selection: Selection,
    options: {
      readonly renames?: ReadonlyMap<string, string>;
      readonly fit?: boolean;
      readonly path?: string;
    } = {},
  ): void {
    const { renames } = options;
    let fit = options.fit === true;
    const old = this.state.get();
    const previous = old.circuit.id;
    // Where an edit breaks the path (its instance deleted), the circuit's first instance.
    const path = options.path ?? (open === previous ? old.path : undefined);
    const state = this.#stateOf(document, open, selection, renames, path);
    // Another circuit on the canvas (opened, or an undo there): each keeps its own camera. The
    // same circuit under a new id (renamed while placed nowhere) is no other circuit.
    const index = old.document.circuits.findIndex((c) => c.id === previous);
    const renamed =
      !document.circuits.some((c) => c.id === previous) &&
      document.circuits[index]?.id === state.circuit.id;
    const switched = state.circuit.id !== previous && !renamed;
    if (switched) this.#cameras.set(previous, this.view.get().camera);
    this.state.set(state);
    if (switched) {
      const camera = this.#cameras.get(state.circuit.id);
      if (camera) {
        this.#fitPending = false;
        this.setCamera(camera);
      } else {
        fit = true;
      }
    }
    this.#hover = undefined;
    if (fit) {
      this.#fitPending = true;
      this.#fitIfReady();
    }
    this.#updatePreview();
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

  /** Switches the tool; a part type arms the place tool with a fresh orientation. */
  setTool(tool: Tool): void {
    this.#releaseHold();
    this.#wire = undefined;
    this.#floating = undefined;
    if (typeof tool === 'object') this.#place = { rotation: 0, flip: false };
    if (this.#probeHover) {
      this.#probeHover = undefined;
      this.invalidate();
    }
    this.tool.set(tool);
    this.#setMode('idle');
    this.#updatePreview();
    this.#updateCursor();
  }

  /** Arms the place tool with a part type (the Parts panel), optionally with preset props. */
  placePart(type: string, props?: Readonly<Record<string, PropValue>>): void {
    this.setTool(props ? { kind: 'place', type, props } : { kind: 'place', type });
  }

  selectAll(): void {
    this.setSelection(selectAll(this.scene));
  }

  clearSelection(): void {
    this.setSelection(EMPTY_SELECTION);
  }

  /**
   * Escape: cancels the current gesture, wire or floating paste; else leaves the wire or place
   * tool for Select; else clears the selection.
   */
  escape(): void {
    if (this.cancel()) return;
    const tool = this.tool.get();
    if (tool === 'probe') {
      this.setTool(this.simulation.active ? 'interact' : 'select');
      return;
    }
    if (tool !== 'select' && tool !== 'pan') {
      this.setTool('select');
      return;
    }
    if (tool === 'pan') this.setTool('select');
    this.clearSelection();
  }

  /** Cancels a gesture, a wire being drawn or a floating paste; true if there was one. */
  cancel(): boolean {
    return this.#cancelGesture();
  }

  #cancelGesture(): boolean {
    this.#releaseHold();
    const gesture = this.#gesture;
    let cancelled = false;
    if (gesture?.kind === 'box') {
      this.setSelection(gesture.before);
      cancelled = gesture.active;
    }
    if (gesture?.kind === 'move' || gesture?.kind === 'wire-drag') cancelled = true;
    this.#gesture = undefined;
    this.#box = undefined;
    if (this.#wire) {
      this.#wire = undefined;
      cancelled = true;
    }
    if (this.#floating) {
      this.#floating = undefined;
      cancelled = true;
    }
    this.#setMode('idle');
    this.#updatePreview();
    this.#updateCursor();
    this.invalidate();
    return cancelled;
  }

  /** Lets go of a held push button (pointer up or cancelled, window blurred, tool changed). */
  #releaseHold(): void {
    const gesture = this.#gesture;
    if (gesture?.kind !== 'hold') return;
    this.#gesture = undefined;
    const flat = this.flatPart(gesture.component);
    if (flat !== undefined) this.simulation.action(flat, gesture.release);
  }

  /** What pressing a part at a world point does in the Interact tool, if anything. */
  #pokeAt(id: string, world: Point): Poke | undefined {
    const part = this.scene.partById.get(id);
    if (part?.drawing.kind !== 'symbol') return undefined;
    const interaction = INTERACTIONS[part.drawing.symbol.kind];
    if (!interaction) return undefined;
    const local = inverseTransformPoint(world, part.placement);
    return interaction({ local, body: part.layout.body, props: part.props });
  }

  /** Interact tool: operate the part under the pointer, else start a click-or-pan. */
  #interactDown(at: Point, probing = false): void {
    const hit = this.#hitAt(at);
    if (hit?.kind === 'part' && !probing) {
      const poke = this.#pokeAt(hit.id, this.#world(at));
      const flat = this.flatPart(hit.id);
      if (poke && flat !== undefined && this.simulation.action(flat, poke.press)) {
        if (poke.release !== undefined) {
          this.#gesture = { kind: 'hold', component: hit.id, release: poke.release };
        }
        return;
      }
    }
    this.#gesture = {
      kind: 'interact-press',
      start: at,
      last: at,
      panning: false,
      ...(hit && { hit }),
    };
  }

  #setMode(mode: EditorMode): void {
    this.mode.set(mode);
  }

  #request(request: RequestInput): void {
    this.requests.set({ ...request, seq: ++this.#requestSeq });
  }

  // ── Editing ─────────────────────────────────────────────────────────────────────────────

  get hasSelection(): boolean {
    return selectionSize(this.state.get().selection) > 0;
  }

  /**
   * Delete: while drawing a wire, takes back its last corner; otherwise deletes the selected
   * parts and wires (wires attached to deleted parts stay).
   */
  deleteSelection(): void {
    const wire = this.#wire;
    if (wire) {
      if (wire.points.length > 1) {
        wire.points.pop();
        wire.posture = undefined;
        this.#updatePreview();
      } else {
        this.#cancelGesture();
      }
      return;
    }
    const { circuit, selection } = this.state.get();
    if (selectionSize(selection) === 0) return;
    this.edit('Delete', deleteSelection(circuit, selection), { selection: EMPTY_SELECTION });
  }

  /**
   * Turns a quarter turn: the part about to be placed, the floating paste, or the selection
   * about its center (attached wires follow).
   */
  rotate(clockwise = true): void {
    if (this.#floating) {
      this.#transformFloating(rotation(this.#floating.anchor, clockwise));
      return;
    }
    if (typeof this.tool.get() === 'object') {
      const place = this.#place;
      this.#place = { ...place, rotation: rot(place.rotation + (clockwise ? 90 : 270)) };
      this.#updatePreview();
      return;
    }
    const { selection } = this.state.get();
    this.edit('Rotate', rotateSelection(this.scene, selection, clockwise));
  }

  /** Mirrors the part about to be placed, the floating paste or the selection. */
  flip(direction: 'horizontal' | 'vertical' = 'horizontal'): void {
    if (this.#floating) {
      this.#transformFloating(mirror(this.#floating.anchor, direction));
      return;
    }
    if (typeof this.tool.get() === 'object') {
      const { rotation: r, flip } = this.#place;
      // Same rule as for placed parts: toggle the flip, negate the rotation (+180° vertically).
      this.#place = { rotation: rot((direction === 'horizontal' ? 0 : 180) - r), flip: !flip };
      this.#updatePreview();
      return;
    }
    const { selection } = this.state.get();
    this.edit('Flip', flipSelection(this.scene, selection, direction));
  }

  /** Moves the selection by whole cells; repeated nudges of one selection are one undo step. */
  nudge(dx: number, dy: number): void {
    if (this.#gesture || this.#wire || this.#floating) return;
    const { selection } = this.state.get();
    const key = `nudge ${[...selection.parts].join(',')} ${[...selection.wires].join(',')}`;
    this.edit('Move', moveSelection(this.scene, selection, dx, dy), { coalesce: key });
  }

  // ── Properties ──────────────────────────────────────────────────────────────────────────

  /** Renames a part; returns why not (invalid or taken designator) instead of renaming. */
  renamePart(from: string, to: string): string | undefined {
    const { circuit, document } = this.state.get();
    const error = designatorError(circuit, from, to);
    if (error) return error;
    if (from === to) return undefined;
    // Probe references to it are rewritten in every circuit, through every instance path.
    this.editDocument(`Rename ${from}`, renamePartInDocument(document, circuit.id, from, to), {
      selection: selectionOf([to]),
      renames: new Map([[from, to]]),
    });
    return undefined;
  }

  /**
   * The circuit and the part a netlist id names: `U5` the top circuit's, `A1/U3` part U3 of the
   * circuit instance A1 places (its definition, shared by every instance).
   */
  partAt(id: string): { readonly circuit: Circuit; readonly part: ComponentInstance } | undefined {
    const { document, design } = this.state.get();
    const slash = id.lastIndexOf('/');
    const circuitId = design.circuitAt(slash < 0 ? '' : id.slice(0, slash));
    const circuit = document.circuits.find((c) => c.id === circuitId);
    const part = circuit?.components.find((c) => c.id === id.slice(slash + 1));
    return circuit && part ? { circuit, part } : undefined;
  }

  /**
   * `setPartProp` for a part of the design by netlist id (`A1/U3`): inside an instance it edits
   * the circuit the instance places — every instance of it changes.
   */
  setPartPropAt(
    id: string,
    key: string,
    value: PropValue,
    options: { readonly label?: string; readonly coalesce?: string } = {},
  ): string | undefined {
    const found = this.partAt(id);
    if (!found) return `"${id}" can't be edited.`;
    if (found.circuit.id === this.state.get().circuit.id) {
      return this.setPartProp(found.part.id, key, value, options);
    }
    const definition = this.registry.get(found.part.type);
    if (!definition) return `"${id}" can't be edited.`;
    let props: Readonly<Record<string, PropValue>>;
    try {
      props = resolveProps(definition, { ...found.part.props, [key]: value }, id);
    } catch (error) {
      return (error as Error).message;
    }
    const label =
      options.label ?? `Change ${definition.props?.find((p) => p.key === key)?.label ?? key}`;
    const circuit = updateComponent(found.circuit, found.part.id, { props });
    this.editDocument(label, replaceCircuit(this.state.get().document, circuit), {
      ...(options.coalesce !== undefined && { coalesce: options.coalesce }),
    });
    return undefined;
  }

  /** Sets a part's label (empty removes it). */
  setPartLabel(id: string, label: string): void {
    const { circuit } = this.state.get();
    this.edit(`Label ${id}`, updateComponent(circuit, id, { label: label.trim() }));
  }

  /**
   * Sets one prop of a part; returns why not (the value fails the part's prop checks) instead.
   * Pins may move if the prop changes the layout; attached wires are not re-routed. `options`
   * name the undo step (default `Change <prop>`) and coalesce edits in a row (a memory's bytes).
   */
  setPartProp(
    id: string,
    key: string,
    value: PropValue,
    options: { readonly label?: string; readonly coalesce?: string } = {},
  ): string | undefined {
    const { circuit } = this.state.get();
    const instance = circuit.components.find((c) => c.id === id);
    const definition = instance && this.registry.get(instance.type);
    if (!instance || !definition) return `"${id}" can't be edited.`;
    let props: Readonly<Record<string, PropValue>>;
    try {
      // All props written, resolved (circuit.md: a file keeps its meaning if a default changes).
      props = resolveProps(definition, { ...instance.props, [key]: value }, id);
    } catch (error) {
      return (error as Error).message;
    }
    const label =
      options.label ?? `Change ${definition.props?.find((p) => p.key === key)?.label ?? key}`;
    this.edit(label, updateComponent(circuit, id, { props }), {
      ...(options.coalesce !== undefined && { coalesce: options.coalesce }),
    });
    this.#rememberProps(instance.type, props);
    return undefined;
  }

  /**
   * Sets the test script of circuit `circuitId` (R15b) to `source`: one undo step while typing
   * goes on (edits in a row coalesce until `sealHistory`), the circuit open stays open. The
   * script is no part of the netlist, so a run and its history go on through it.
   */
  setTestScript(circuitId: string, source: string): boolean {
    const { document } = this.state.get();
    const circuit = document.circuits.find((c) => c.id === circuitId);
    if (!circuit) return false;
    const testScript = scriptLines(source);
    return this.editDocument(
      document.circuits.length > 1 ? `Edit Test Script of ${circuit.name}` : 'Edit Test Script',
      replaceCircuit(document, { ...circuit, testScript }),
      { coalesce: `script:${circuitId}` },
    );
  }

  /**
   * Moves, turns or mirrors one part to the given placement, as the move tool would (wires
   * follow): flip first, then quarter turns about its center, then a move to `x`, `y`.
   */
  setPartPlacement(id: string, target: Omit<ComponentPatch, 'props' | 'label'>): void {
    const only = selectionOf([id]);
    let scene = this.scene;
    const current = () => scene.circuit.components.find((c) => c.id === id);
    const step = (circuit: Circuit) => {
      scene = buildScene(circuit, this.registry, { layouts: this.#layouts });
    };
    let label = 'Move';
    const start = current();
    if (!start) return;
    if (target.flip !== undefined && target.flip !== start.flip) {
      step(flipSelection(scene, only, 'horizontal'));
      label = 'Flip';
    }
    if (target.rotation !== undefined) {
      const turns = ((((target.rotation - (current()?.rotation ?? 0)) / 90) % 4) + 4) % 4;
      for (let i = 0; i < turns; i++) step(rotateSelection(scene, only, true));
      if (turns > 0) label = 'Rotate';
    }
    const now = current()!;
    const dx = target.x === undefined ? 0 : target.x - now.x;
    const dy = target.y === undefined ? 0 : target.y - now.y;
    if (dx !== 0 || dy !== 0) step(moveSelection(scene, only, dx, dy));
    this.edit(label, scene.circuit);
  }

  // ── Clipboard ───────────────────────────────────────────────────────────────────────────

  /**
   * The selection as clipboard text, or undefined if nothing is selected. Instances bring the
   * circuits they place along, so they paste into another document.
   */
  copySelection(): string | undefined {
    const { circuit, document, selection } = this.state.get();
    if (selectionSize(selection) === 0) return undefined;
    return fragmentText(fragmentDocument(document, copyFragment(circuit, selection)));
  }

  /** Copies, then deletes the selection. */
  cutSelection(): string | undefined {
    const text = this.copySelection();
    if (text === undefined) return undefined;
    const { circuit, selection } = this.state.get();
    this.edit('Cut', removeItems(circuit, selection), { selection: EMPTY_SELECTION });
    return text;
  }

  /**
   * Starts a floating paste of clipboard text; false if the text holds no parts or wires. The
   * circuits it carries come into the document with the drop (reused when the same, renamed when
   * an id holds another); an instance of a circuit that would contain the open one is refused.
   */
  pasteText(text: string): boolean {
    const clipboard = parseFragment(text);
    if (!clipboard) return false;
    const { document, circuit } = this.state.get();
    const { document: next, fragment } = importCircuits(document, clipboard);
    const outer = circuitsContaining(next, circuit.id);
    if (fragment.components.some((c) => outer.has(subcircuitOf(c.type) ?? ''))) return false;
    this.#startFloating(fragment, 'Paste', next);
    return true;
  }

  /** Copies of the selection follow the pointer until a click drops them. */
  duplicate(): void {
    const { circuit, selection } = this.state.get();
    if (selectionSize(selection) === 0) return;
    this.#startFloating(copyFragment(circuit, selection), 'Duplicate');
  }

  #startFloating(
    fragment: Circuit,
    label: string,
    document: CircuitDocument = this.state.get().document,
  ): void {
    this.#cancelGesture();
    const tool = this.tool.get();
    if (typeof tool === 'object' || tool === 'wire' || tool === 'bus') this.setTool('select');
    const scene = buildScene(fragment, this.#registryOf(document), { layouts: this.#layouts });
    const bounds = selectionBounds(scene, selectAll(scene));
    const anchor: Point = bounds
      ? [Math.round(bounds.x + bounds.width / 2), Math.round(bounds.y + bounds.height / 2)]
      : [0, 0];
    this.#floating = { fragment, document, anchor, label };
    this.#setMode('floating');
    this.#updatePreview();
    this.#updateCursor();
  }

  /** The parts of a document: the editor's registry, or one for a paste's document. */
  #registryOf(document: CircuitDocument): DocumentRegistry {
    return document === this.state.get().document
      ? this.registry
      : this.#cache.registry(document, this.library);
  }

  #transformFloating(t: ItemTransform): void {
    const floating = this.#floating!;
    const registry = this.#registryOf(floating.document);
    const scene = buildScene(floating.fragment, registry, { layouts: this.#layouts });
    const fragment = transformItems(scene, selectAll(scene), t);
    this.#floating = { ...floating, fragment };
    this.#updatePreview();
  }

  /** Where floating items go: under the pointer, else the middle of the view. */
  #pointerCell(): Point {
    const { cursor, camera, viewport } = this.view.get();
    return cursor ?? cell(toWorld(camera, [viewport.width / 2, viewport.height / 2]));
  }

  #floatingResult():
    | { circuit: Circuit; ghost: Selection; registry: DocumentRegistry }
    | undefined {
    const floating = this.#floating;
    if (!floating) return undefined;
    const at = this.#pointerCell();
    const offset: Point = [at[0] - floating.anchor[0], at[1] - floating.anchor[1]];
    const registry = this.#registryOf(floating.document);
    const pasted = pasteFragment(this.state.get().circuit, floating.fragment, offset, registry);
    return { circuit: pasted.circuit, ghost: selectionOf(pasted.parts, pasted.wires), registry };
  }

  #dropFloating(): void {
    const floating = this.#floating;
    const result = this.#floatingResult();
    this.#floating = undefined;
    this.#setMode('idle');
    if (floating && result) {
      if (floating.document === this.state.get().document) {
        this.edit(floating.label, result.circuit, { selection: result.ghost });
      } else {
        this.editDocument(floating.label, replaceCircuit(floating.document, result.circuit), {
          selection: result.ghost,
        });
      }
    }
    this.#updatePreview();
    this.#updateCursor();
  }

  // ── Placing parts ───────────────────────────────────────────────────────────────────────

  /**
   * A new instance of `type` centered on `at` with the place tool's orientation — a
   * schematic-only part (a net label, a bus entry) with its first pin on `at`, so a click on a
   * pin tip or wire end attaches it.
   */
  #newPart(type: string, at: Point, orientation = this.#place): ComponentInstance | undefined {
    const definition = this.registry.get(type);
    if (!definition) return undefined;
    const props = this.#nextProps(type);
    const layout = partLayout(definition, props);
    const placement = { origin: [0, 0] as Point, ...orientation };
    const first = layout.pins[0];
    let center: Point;
    if (definition.schematicOnly && first) {
      center = transformPoint(first.at, placement);
    } else {
      const placed = transformRect(layoutBounds(layout), placement);
      center = [Math.round(placed.x + placed.width / 2), Math.round(placed.y + placed.height / 2)];
    }
    const circuit = this.state.get().circuit;
    return {
      id: nextDesignator(circuit, prefixOfType(this.registry, type)),
      type,
      x: at[0] - center[0],
      y: at[1] - center[1],
      rotation: orientation.rotation,
      flip: orientation.flip,
      // Every prop written: the file keeps its meaning if a default changes (circuit.md).
      props,
    };
  }

  /** Whether `type` may be placed in the open circuit: not a circuit that contains it. */
  #placeable(type: string): boolean {
    const id = subcircuitOf(type);
    if (id === undefined) return true;
    const { document, circuit } = this.state.get();
    return !circuitsContaining(document, circuit.id).has(id);
  }

  #placeAt(type: string, at: Point, orientation = this.#place): void {
    if (!this.#placeable(type)) return;
    const part = this.#newPart(type, at, orientation);
    if (!part) return;
    const name = this.registry.get(type)?.name ?? type;
    this.edit(`Place ${name}`, addComponents(this.state.get().circuit, [part]), {
      selection: selectionOf([part.id]),
    });
    this.#rememberProps(type, part.props);
  }

  /**
   * Props of a new part: the defaults, or what the part's `nextProps` makes of the last one
   * placed or edited (the next net label continues `D0` with `D1`).
   */
  #nextProps(type: string): Record<string, PropValue> {
    const definition = this.registry.get(type)!;
    const tool = this.tool.get();
    if (typeof tool === 'object' && tool.type === type && tool.props && !this.#dragType) {
      return resolveProps(definition, tool.props);
    }
    const last = this.#lastProps.get(type);
    if (!last || !definition.nextProps) return resolveProps(definition, {});
    try {
      return resolveProps(definition, definition.nextProps(last));
    } catch {
      return resolveProps(definition, {});
    }
  }

  #rememberProps(type: string, props: Readonly<Record<string, PropValue>>): void {
    if (this.registry.get(type)?.nextProps) this.#lastProps.set(type, props);
  }

  /** The part being dragged from the Parts panel, if any. */
  get draggedPart(): string | undefined {
    return this.#dragType;
  }

  /**
   * A part is dragged from the Parts panel: with a viewport position while over the canvas (its
   * ghost follows), without one when it leaves; `undefined` when the drag ends.
   */
  dragPart(type: string | undefined, client?: Point): void {
    this.#dragType = type;
    if (type && client) this.#setCursorCell(this.#cellAtClient(client));
    else this.view.update(({ cursor: _, ...view }) => view);
    this.#updatePreview();
  }

  /** Drops a part dragged from the Parts panel at a viewport position. */
  dropPart(type: string, client: Point): void {
    this.#dragType = undefined;
    this.#placeAt(type, this.#cellAtClient(client), { rotation: 0, flip: false });
    this.#updatePreview();
  }

  #cellAtClient(client: Point): Point {
    const rect = this.#canvas?.getBoundingClientRect();
    const local: Point = rect ? [client[0] - rect.left, client[1] - rect.top] : client;
    return cell(toWorld(this.view.get().camera, local));
  }

  // ── Wires ───────────────────────────────────────────────────────────────────────────────

  /** What a new wire (or, with `bus`, a new bus line) would connect to. */
  #connectionIndex(bus = false): ConnectionIndex {
    const scene = this.scene;
    if (this.#index?.scene !== scene) {
      this.#index = {
        scene,
        wires: new ConnectionIndex(scene),
        buses: new ConnectionIndex(scene, true),
      };
    }
    return bus ? this.#index.buses : this.#index.wires;
  }

  #startWire(from: Point, bus: boolean): void {
    this.#wire = { points: [from], bus, swapped: false, index: this.#connectionIndex(bus) };
    this.#setMode('wiring');
    this.#updatePreview();
  }

  /** The draft's points plus the L to the pointer. */
  #wirePath(): Point[] {
    const wire = this.#wire!;
    const to = this.#pointerCell();
    const last = wire.points.at(-1)!;
    if (!wire.posture && !samePoint(last, to)) {
      wire.posture = legPosture(wire.index, last, wire.points.at(-2), to);
    }
    const base = wire.posture ?? 'horizontal';
    return [...wire.points, ...routeL(last, to, wire.swapped ? otherPosture(base) : base)];
  }

  /** Swaps which way the wire's last leg bends (Tab while drawing). */
  swapWirePosture(): void {
    if (!this.#wire) return;
    this.#wire.swapped = !this.#wire.swapped;
    this.#updatePreview();
  }

  /** Fixes the leg to `at`; finishes on a connection or a repeated click, else keeps drawing. */
  #wireClick(at: Point): void {
    const wire = this.#wire!;
    this.#setCursorCell(at);
    const last = wire.points.at(-1)!;
    if (samePoint(last, at)) {
      this.#finishWire();
      return;
    }
    const path = this.#wirePath();
    wire.points.splice(0, wire.points.length, ...path);
    wire.posture = undefined;
    wire.swapped = false;
    if (wire.index.connectsEnd(at)) this.#finishWire();
    else this.#updatePreview();
  }

  #finishWire(): void {
    const wire = this.#wire;
    this.#wire = undefined;
    this.#setMode('idle');
    if (wire) {
      const segments = polylineSegments(wire.points);
      if (segments.length > 0) {
        const { circuit } = addWires(this.state.get().circuit, segments, wire.bus);
        this.edit(wire.bus ? 'Bus' : 'Wire', circuit, { selection: EMPTY_SELECTION });
      }
    }
    this.#updatePreview();
  }

  // ── Preview ─────────────────────────────────────────────────────────────────────────────

  /** Recomputes what a gesture or tool shows on top of the document (drawn on the next frame). */
  #updatePreview(): void {
    this.#preview = this.#computePreview();
    this.#previewScene = undefined;
    this.invalidate();
  }

  #computePreview(): Preview | undefined {
    const circuit = this.state.get().circuit;
    const gesture = this.#gesture;
    if (gesture?.kind === 'move') return { circuit: gesture.circuit, ghost: EMPTY_SELECTION };
    if (this.#wire) {
      const { circuit: next, wires } = addWires(
        circuit,
        polylineSegments(this.#wirePath()),
        this.#wire.bus,
      );
      return {
        circuit: next,
        ghost: selectionOf(
          [],
          wires.map((w) => w.id),
        ),
      };
    }
    const floating = this.#floatingResult();
    if (floating) return floating;
    const tool = this.tool.get();
    const type = this.#dragType ?? (typeof tool === 'object' ? tool.type : undefined);
    const cursor = this.view.get().cursor;
    if (type && cursor && !this.#gesture && this.#placeable(type)) {
      const orientation = this.#dragType ? { rotation: 0 as const, flip: false } : this.#place;
      const part = this.#newPart(type, cursor, orientation);
      if (part) return { circuit: addComponents(circuit, [part]), ghost: selectionOf([part.id]) };
    }
    return undefined;
  }

  /** Where the ghost touches what is drawn (it will connect there). */
  #ghostConnections(scene: Scene, ghost: Selection): Point[] {
    if (selectionSize(ghost) === 0) return [];
    // Each layer connects only to itself: bus pins and bus lines to bus lines and bus pins.
    const index = (bus: boolean) => this.#connectionIndex(bus);
    const out: Point[] = [];
    for (const id of ghost.parts) {
      for (const pin of scene.partById.get(id)?.pins ?? []) {
        if (index(pin.bus).connectsEnd(pin.at)) out.push(pin.at);
      }
    }
    const wire = this.#wire;
    if (wire) out.push(...pathConnections(wire.index, this.#wirePath()));
    else {
      for (const id of ghost.wires) {
        const w = scene.wireById.get(id);
        if (w) out.push(...pathConnections(index(w.bus), [w.from, w.to]));
      }
    }
    return out;
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
    if (rect) this.#bringIntoView(rect, options.zoom === true);
  }

  /**
   * `locate` for a part of the design by netlist id (`U5`, `A1/U3`, a diagnostic's
   * `component`): goes into the instance it is in first (R11b).
   */
  locatePart(id: string, options: { zoom?: boolean } = {}): void {
    const { path, local } = this.#enter(id);
    if (path !== undefined) this.locate({ component: local }, options);
  }

  /**
   * Selects the wires of a net the simulator names (a diagnostic's `net`: `CLK`, `A1/U2.Y`) and
   * brings them into view, in the instance its id is in (its outermost); a net without wires
   * (pin on pin) locates the part its id starts with (`U2.Y`).
   */
  locateNet(net: string, options: { zoom?: boolean } = {}): void {
    const { path, local } = this.#enter(net);
    if (path === undefined) return;
    const wires = this.simulation
      .wiresOfNet(net)
      .flatMap((id) => this.scene.wireById.get(id) ?? []);
    if (wires.length === 0) {
      const component = local.split('.')[0];
      if (component) this.locate({ component }, options);
      return;
    }
    this.locateItems({ wires: wires.map((w) => w.id) }, options);
  }

  /**
   * Selects parts and wires of the circuit open and brings them all into view; false when none
   * of them is there.
   */
  locateItems(
    items: { readonly parts?: readonly string[]; readonly wires?: readonly string[] },
    options: { zoom?: boolean } = {},
  ): boolean {
    const scene = this.scene;
    const parts = (items.parts ?? []).flatMap((id) => scene.partById.get(id) ?? []);
    const wires = (items.wires ?? []).flatMap((id) => scene.wireById.get(id) ?? []);
    if (parts.length === 0 && wires.length === 0) return false;
    this.setSelection(
      selectionOf(
        parts.map((p) => p.id),
        wires.map((w) => w.id),
      ),
    );
    const xs = [
      ...wires.flatMap((w) => [w.from[0], w.to[0]]),
      ...parts.flatMap((p) => [p.bounds.x, p.bounds.x + p.bounds.width]),
    ];
    const ys = [
      ...wires.flatMap((w) => [w.from[1], w.to[1]]),
      ...parts.flatMap((p) => [p.bounds.y, p.bounds.y + p.bounds.height]),
    ];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const rect = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    this.#bringIntoView(rect, options.zoom === true);
    return true;
  }

  /**
   * Goes into the instance a flat id is in (`A1/U3` → A1, `U5` → the top): its path and the id
   * inside it, or no path when the design has no such instance.
   */
  #enter(id: string): { readonly path: string | undefined; readonly local: string } {
    const slash = id.lastIndexOf('/');
    const path = slash < 0 ? '' : id.slice(0, slash);
    const local = id.slice(slash + 1);
    if (this.state.get().design.circuitAt(path) === undefined) return { path: undefined, local };
    this.openInstance(path);
    return { path, local };
  }

  #bringIntoView(rect: Rect, zoom: boolean): void {
    const { camera, viewport } = this.view.get();
    if (zoom) {
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

    const input = (e: PointerEvent | MouseEvent): PointerInput => ({
      at: this.#local(e),
      button: e.button,
      shift: e.shiftKey,
      client: [e.clientX, e.clientY],
    });
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        canvas.focus({ preventScroll: true });
        if (e.button === 1) e.preventDefault();
        if (e.button !== 2) canvas.setPointerCapture(e.pointerId);
        this.pointerDown(input(e));
      },
      { signal },
    );
    canvas.addEventListener('pointermove', (e) => this.pointerMove(input(e)), { signal });
    canvas.addEventListener(
      'pointerup',
      (e) => {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        this.pointerUp(input(e));
      },
      { signal },
    );
    canvas.addEventListener('pointercancel', () => this.#cancelGesture(), { signal });
    canvas.addEventListener('pointerleave', () => this.pointerLeave(), { signal });
    canvas.addEventListener('dblclick', (e) => this.doubleClick(input(e)), { signal });
    canvas.addEventListener('wheel', (e) => this.#onWheel(e), { signal, passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    window.addEventListener('keydown', (e) => this.#onKey(e, true), { signal });
    window.addEventListener('keyup', (e) => this.#onKey(e, false), { signal });
    window.addEventListener(
      'blur',
      () => {
        this.#setSpace(false);
        this.#releaseHold();
      },
      { signal },
    );

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

  /** Draws right away (the simulation advanced inside an animation frame). */
  #redrawNow(): void {
    if (!this.#ctx) return;
    if (this.#frame !== 0) {
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
    }
    this.#draw();
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
    const { selection } = this.state.get();
    const preview = this.#preview;
    let scene = this.scene;
    if (preview) {
      this.#previewScene ??= buildScene(preview.circuit, preview.registry ?? this.registry, {
        layouts: this.#layouts,
      });
      scene = this.#previewScene;
    }
    const { theme, gateStyle, showGrid } = this.#settings;
    const signals = this.simulation.signalView();
    renderScene(
      ctx,
      scene,
      { camera, viewport, dpr: this.#dpr },
      {
        theme,
        gateStyle,
        showGrid,
        selection,
        ...(this.#hover && !preview && { hover: this.#hover }),
        ...(this.#probeHover && { probe: this.#probeHover }),
        ...(this.#box && { box: this.#box }),
        ...(signals && { signals }),
        ...(preview && {
          ghost: preview.ghost,
          connections: this.#ghostConnections(scene, preview.ghost),
        }),
      },
    );
    const frameMs = performance.now() - start;
    this.view.update((view) => ({ ...view, frameMs }));
  }

  // ── Input (no DOM below this line except in the event adapters) ─────────────────────────

  #local(e: MouseEvent): Point {
    const rect = this.#canvas!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  #world(screen: Point): Point {
    return toWorld(this.view.get().camera, screen);
  }

  #spotAt(screen: Point): ProbeSpot | string | undefined {
    const { camera } = this.view.get();
    const { circuit, document, path } = this.state.get();
    const spot = probeSpotAt(
      this.scene,
      this.registry,
      toWorld(camera, screen),
      HIT_TOLERANCE / camera.scale,
    );
    if (spot === undefined || typeof spot === 'string' || path === '') return spot;
    // Probes, watches and breakpoints are of what simulates: inside an instance, by its path,
    // named as read there (R11b, Q4: `A1/Q0`, not the outer net's name).
    if (path === undefined) {
      const top = document.circuits[0]!.name;
      return `${circuit.name} isn't placed in ${top}, so it doesn't simulate: place it to probe it.`;
    }
    return { ...spot, ref: `${path}/${spot.ref}` };
  }

  /** The Probe tool's click: adds what is under the pointer to the waveforms, or removes it. */
  #probeAt(screen: Point): void {
    const spot = this.#spotAt(screen);
    if (spot === undefined) return;
    if (typeof spot === 'string') {
      this.#request({ kind: 'probed', ref: '', problem: spot });
      return;
    }
    this.toggleProbe(spot.ref);
  }

  /** What the last right click pointed at that can be probed (the context menu's entry). */
  get contextProbe(): ProbeSpot | undefined {
    return this.#contextProbe;
  }

  /** Adds `ref` to the waveforms, or removes it when probed; asks the UI to show the tab. */
  toggleProbe(ref: string): void {
    const result = this.analyzer.toggleProbe(ref);
    const problem = result === 'added' || result === 'removed' ? undefined : result;
    this.#request({ kind: 'probed', ref, ...(problem !== undefined && { problem }) });
  }

  #hitAt(screen: Point): Hit | undefined {
    const { camera } = this.view.get();
    return hitTest(this.scene, toWorld(camera, screen), HIT_TOLERANCE / camera.scale);
  }

  /**
   * A pin tip or a free (dangling) wire end near the pointer: where a wire can start — a bus
   * line out of a bus pin or a bus line's end.
   */
  #wireStartAt(screen: Point): WireStart | undefined {
    const { camera } = this.view.get();
    const world = toWorld(camera, screen);
    const tolerance = HIT_TOLERANCE / camera.scale;
    const near = (p: Point) =>
      Math.abs(p[0] - world[0]) <= tolerance && Math.abs(p[1] - world[1]) <= tolerance;
    const scene = this.scene;
    for (let i = scene.parts.length - 1; i >= 0; i--) {
      const part = scene.parts[i]!;
      for (const pin of part.pins) if (near(pin.at)) return { at: pin.at, bus: pin.bus };
    }
    const end = scene.danglingEnds.find(near);
    if (!end) return undefined;
    const bus = scene.wires.some((w) => w.bus && (samePoint(w.from, end) || samePoint(w.to, end)));
    return { at: end, bus };
  }

  /** Records the grid point under the pointer; true if it changed. */
  #setCursorCell(cursor: Point): boolean {
    const previous = this.view.get().cursor;
    if (previous && samePoint(previous, cursor)) return false;
    this.view.update((view) => ({ ...view, cursor }));
    return true;
  }

  pointerDown(input: PointerInput): void {
    const { at, button } = input;
    const tool = this.tool.get();
    if (button === 2) {
      this.#contextMenu(input);
      return;
    }
    if (button === 1 || (button === 0 && (this.#space || tool === 'pan'))) {
      this.#gesture = { kind: 'pan', last: at };
      this.#setMode('panning');
      this.#updateCursor();
      return;
    }
    if (button !== 0) return;
    const here = cell(this.#world(at));
    this.#setCursorCell(here);

    if (this.#floating) {
      this.#dropFloating();
      return;
    }
    if (tool === 'interact' || tool === 'probe') {
      this.#interactDown(at, tool === 'probe');
      return;
    }
    if (typeof tool === 'object') {
      this.#placeAt(tool.type, here);
      return;
    }
    if (tool === 'wire' || tool === 'bus') {
      if (this.#wire) this.#wireClick(here);
      else this.#startWire(here, tool === 'bus');
      return;
    }

    const hit = this.#hitAt(at);
    const { selection } = this.state.get();
    if (hit) {
      if (input.shift) {
        this.setSelection(toggleHit(selection, hit));
        return;
      }
      const wireFrom = this.#wireStartAt(at);
      if (!wireFrom && !isSelected(selection, hit)) this.setSelection(selectHit(hit));
      this.#gesture = {
        kind: 'press',
        start: at,
        startWorld: this.#world(at),
        hit,
        ...(wireFrom && { wireFrom }),
        selectOnClick: wireFrom !== undefined,
      };
      return;
    }
    this.#gesture = {
      kind: 'box',
      start: at,
      startWorld: this.#world(at),
      additive: input.shift,
      before: selection,
      active: false,
    };
  }

  pointerMove(input: PointerInput): void {
    const { at } = input;
    const { camera } = this.view.get();
    const world = toWorld(camera, at);
    const cellChanged = this.#setCursorCell(cell(world));

    const gesture = this.#gesture;
    if (gesture?.kind === 'pan') {
      this.setCamera(panBy(camera, at[0] - gesture.last[0], at[1] - gesture.last[1]));
      gesture.last = at;
      return;
    }
    if (gesture?.kind === 'hold') return;
    if (gesture?.kind === 'interact-press') {
      if (!gesture.panning) {
        const moved = Math.hypot(at[0] - gesture.start[0], at[1] - gesture.start[1]);
        if (moved < DRAG_THRESHOLD) return;
        gesture.panning = true;
        this.#setMode('panning');
        this.#updateCursor();
      }
      this.setCamera(panBy(camera, at[0] - gesture.last[0], at[1] - gesture.last[1]));
      gesture.last = at;
      return;
    }
    if (gesture?.kind === 'box') {
      const moved = Math.hypot(at[0] - gesture.start[0], at[1] - gesture.start[1]);
      if (!gesture.active && moved < DRAG_THRESHOLD) return;
      gesture.active = true;
      this.#setMode('boxing');
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
    if (gesture?.kind === 'press') {
      const moved = Math.hypot(at[0] - gesture.start[0], at[1] - gesture.start[1]);
      if (moved < DRAG_THRESHOLD) return;
      if (gesture.wireFrom) {
        this.#gesture = { kind: 'wire-drag' };
        this.#startWire(gesture.wireFrom.at, gesture.wireFrom.bus);
      } else {
        this.#gesture = {
          kind: 'move',
          startWorld: gesture.startWorld,
          delta: [0, 0],
          circuit: this.state.get().circuit,
        };
        this.#setMode('moving');
      }
      this.#hover = undefined;
      this.#updateCursor();
      // Fall through to update the new gesture's preview.
    }
    const current = this.#gesture;
    if (current?.kind === 'move') {
      const delta: Point = cell([
        world[0] - current.startWorld[0],
        world[1] - current.startWorld[1],
      ]);
      if (samePoint(delta, current.delta)) return;
      current.delta = delta;
      const { selection } = this.state.get();
      current.circuit = moveSelection(this.scene, selection, delta[0], delta[1]);
      this.#updatePreview();
      return;
    }
    if (this.#wire || this.#floating || typeof this.tool.get() === 'object') {
      if (cellChanged || !this.#preview) this.#updatePreview();
      return;
    }
    if (current) return;
    if (this.tool.get() === 'probe') {
      const spot = this.#spotAt(at);
      const next = typeof spot === 'object' ? spot : undefined;
      if (next?.ref !== this.#probeHover?.ref || next?.pin !== this.#probeHover?.pin) {
        this.#probeHover = next;
        this.invalidate();
      }
      this.#updateCursor(at);
      return;
    }
    const hover = this.#hitAt(at);
    if (hover?.kind !== this.#hover?.kind || hover?.id !== this.#hover?.id) {
      this.#hover = hover;
      this.invalidate();
    }
    this.#updateCursor(at);
  }

  pointerUp(input: PointerInput): void {
    const gesture = this.#gesture;
    if (gesture?.kind === 'hold') {
      this.#releaseHold();
      return;
    }
    this.#gesture = undefined;
    if (gesture?.kind === 'interact-press') {
      if (gesture.panning) {
        // a pan
      } else if (this.tool.get() === 'probe') {
        this.#probeAt(input.at);
      } else {
        this.setSelection(gesture.hit ? selectHit(gesture.hit) : EMPTY_SELECTION);
      }
    } else if (gesture?.kind === 'box') {
      if (!gesture.active && !gesture.additive) this.clearSelection();
      this.#box = undefined;
      this.invalidate();
    } else if (gesture?.kind === 'press') {
      if (gesture.selectOnClick) this.setSelection(selectHit(gesture.hit));
    } else if (gesture?.kind === 'move') {
      this.#updatePreview();
      if (!samePoint(gesture.delta, [0, 0])) this.edit('Move', gesture.circuit);
    } else if (gesture?.kind === 'wire-drag') {
      const here = cell(this.#world(input.at));
      this.#setCursorCell(here);
      const wire = this.#wire;
      if (wire && !samePoint(wire.points[0]!, here)) {
        wire.points.splice(0, wire.points.length, ...this.#wirePath());
      }
      this.#finishWire();
    }
    if (this.mode.get() !== 'wiring' && this.mode.get() !== 'floating') this.#setMode('idle');
    this.#updatePreview();
    this.#updateCursor(input.at);
  }

  /**
   * Double-click: finishes a wire (Wire tool), goes into a subcircuit instance (R11b), or asks
   * the UI to edit the part's properties.
   */
  doubleClick(input: PointerInput): void {
    if (input.button !== 0) return;
    if (this.#wire) {
      this.#finishWire();
      return;
    }
    const tool = this.tool.get();
    if (tool !== 'select' && tool !== 'interact') return;
    const hit = this.#hitAt(input.at);
    if (hit?.kind === 'part' && this.goInto(hit.id)) return;
    if (tool !== 'select') return;
    if (hit?.kind === 'part') {
      this.setSelection(selectHit(hit));
      this.#request({ kind: 'edit-properties' });
    }
  }

  pointerLeave(): void {
    if (this.#gesture) return;
    this.view.update(({ cursor: _, ...view }) => view);
    this.#probeHover = undefined;
    this.#hover = undefined;
    this.#updatePreview();
  }

  #contextMenu(input: PointerInput): void {
    // Right-click ends what is in progress instead of opening the menu.
    if (this.#gesture || this.#wire || this.#floating) {
      this.#cancelGesture();
      return;
    }
    if (typeof this.tool.get() === 'object') {
      this.setTool('select');
      return;
    }
    const hit = this.#hitAt(input.at);
    const { selection } = this.state.get();
    if (hit && !isSelected(selection, hit)) this.setSelection(selectHit(hit));
    const spot = this.#spotAt(input.at);
    this.#contextProbe = typeof spot === 'object' ? spot : undefined;
    this.#request({
      kind: 'context-menu',
      client: input.client ?? input.at,
      ...(hit && { hit }),
    });
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
    if (isTyping(e.target)) return;
    if (e.key === 'Tab' && down && this.#wire) {
      e.preventDefault();
      this.swapWirePosture();
      return;
    }
    if (e.code !== 'Space') return;
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

  #updateCursor(at?: Point): void {
    const canvas = this.#canvas;
    if (!canvas) return;
    const tool = this.tool.get();
    const gesture = this.#gesture;
    let cursor = 'default';
    if (gesture?.kind === 'pan') cursor = 'grabbing';
    else if (this.#space || tool === 'pan') cursor = 'grab';
    else if (gesture?.kind === 'move' || this.#floating) cursor = 'move';
    else if (gesture?.kind === 'interact-press' && gesture.panning) cursor = 'grabbing';
    else if (tool === 'probe') {
      cursor = at && typeof this.#spotAt(at) === 'object' ? 'crosshair' : 'default';
    } else if (tool === 'interact') {
      const hit = at && this.simulation.active ? this.#hitAt(at) : undefined;
      cursor =
        hit?.kind === 'part' && this.#pokeAt(hit.id, this.#world(at!)) ? 'pointer' : 'default';
    } else if (tool === 'wire' || tool === 'bus' || typeof tool === 'object' || this.#wire) {
      cursor = 'crosshair';
    } else if (at && this.#wireStartAt(at)) cursor = 'crosshair';
    else if (at) {
      const hit = this.#hitAt(at);
      if (hit && isSelected(this.state.get().selection, hit)) cursor = 'move';
    }
    canvas.style.cursor = cursor;
  }
}

/** A circuit as a document of its own; a document as it is. */
function documentOf(content: Circuit | CircuitDocument): CircuitDocument {
  return 'circuits' in content ? content : { schemaVersion: SCHEMA_VERSION, circuits: [content] };
}

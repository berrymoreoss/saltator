/**
 * Component definitions and the runtime contract between parts and the simulator.
 * Spec: docs/components.md (definition shape), docs/simulation.md#components-at-runtime.
 */
import type { CpuDef } from './cpu';
import type { ComponentDiagnostic } from './diagnostics';
import type { FunctionTable } from './function-table';
import type { SignalsDef } from './inner-signals';
import type { Drive, Level } from './logic';
import { IMAGE_HINT, type MemoryDef, readImage } from './memory';
import type { SymbolDef } from './symbol';
import type { Time } from './time';

/** Index of a pin in an instance's pin list (resolved once; no string lookups while running). */
export type PinRef = number;

/**
 * - `in` reads the net; `out` drives strong 0/1; `tristate` drives 0/1 or releases (Z);
 * - `bidir` reads and drives (RAM/CPU data pins);
 * - `power` and `nc` are neither read nor driven (power is not simulated in the MVP).
 */
export type PinDir = 'in' | 'out' | 'tristate' | 'bidir' | 'power' | 'nc';

export interface PinDef {
  /** Datasheet name: `1A`, `1Y`, `OE`, `VCC`. Unique within the part. */
  readonly name: string;
  /**
   * What drawings show instead of the name, when the data sheet's symbol isn't unique: the
   * 74HC151's complementary output `YN` is drawn `Y` with an overline. Netlists, messages and
   * test benches keep using the name.
   */
  readonly label?: string;
  /** What the pin does, from the datasheet's pin description: `output enable input (active LOW)`. */
  readonly description?: string;
  /** Physical pin number (required when the part has a `package`). */
  readonly number?: number;
  readonly dir: PinDir;
  /** Drawn with a bubble/overline: `OE`, `CE`, `WE`. */
  readonly activeLow?: boolean;
  /** Drawn with a clock triangle. */
  readonly clock?: boolean;
  /**
   * Only ever drives weakly (pull resistors). Design checks don't count it as a push-pull output;
   * the editor may draw it differently. Allowed on driver pins only.
   */
  readonly weak?: boolean;
  /**
   * Only observes the net without loading it (LEDs, displays, probes): reading `Z` through it is
   * not a floating input, and design checks don't flag it as undriven. `in` pins only.
   */
  readonly sense?: boolean;
  /**
   * The output is tied to this level for good (power rails, constants). Design checks count
   * outputs tied to the same level as one source, so two VCC symbols wired together are not a
   * short. Strong `out` pins only.
   */
  readonly constant?: 0 | 1;
  /**
   * The pin joins the circuit-wide net of this name wherever it sits: every pin with the same
   * name is on one net, without a wire between them (net labels, the VCC and GND symbols).
   */
  readonly net?: string;
  /**
   * The pin connects on the bus layer: to bus lines and other bus pins, never to wires or other
   * pins (a bus entry's bus end, a bus label's pin). `nc` pins only.
   */
  readonly bus?: boolean;
}

/** True for pins whose net level the component may read. */
export function isReadPin(dir: PinDir): boolean {
  return dir === 'in' || dir === 'bidir';
}

/** True for pins that own a driver slot. */
export function isDriverPin(dir: PinDir): boolean {
  return dir === 'out' || dir === 'tristate' || dir === 'bidir';
}

export interface PackageDef {
  readonly kind: 'dip';
  /** Total pin count, e.g. 14 for a 74HC00. */
  readonly pins: number;
}

/** A gate section of a multi-gate chip (`U1A` … `U1D`), for the future symbol view. */
export interface UnitDef {
  readonly name: string;
  readonly pins: readonly string[];
}

export type PropValue = number | boolean | string;

export interface PropDef {
  readonly key: string;
  readonly label: string;
  /**
   * `time` values are integer picoseconds, like every time in the kernel. `image` values are a
   * memory's contents as text (sparse hex runs, `parseImage`); `max` is the size in bytes.
   */
  readonly type: 'number' | 'integer' | 'boolean' | 'enum' | 'color' | 'string' | 'time' | 'image';
  readonly default: PropValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Allowed values of an `enum` prop. */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Display unit: `Hz`, `ns`. */
  readonly unit?: string;
  /** A `number` entered and shown with SI prefixes: `4.7 kΩ`, `100 nF`, `2 kHz`. */
  readonly si?: boolean;
  /**
   * The values a `string` prop allows: `regex` (anchored, without the `g` flag) must match the
   * whole value; `hint` says in words what it allows and ends the error message (`must be …`).
   */
  readonly pattern?: { readonly regex: RegExp; readonly hint: string };
  /**
   * A `string` prop whose value may hold line breaks (`\n`): a schematic text. Validated as any
   * string; Properties edits it in a text area.
   */
  readonly multiline?: boolean;
}

/** Datasheet timing, in picoseconds, keyed by datasheet symbol (`tpd`, `tPLH`, `tsu`, …). */
export interface TimingDef {
  /** Values the behavior uses (typical at VCC = 5 V unless `conditions` says otherwise). */
  readonly typical: Readonly<Record<string, Time>>;
  /** Maximum values, for a future worst-case mode. */
  readonly max?: Readonly<Record<string, Time>>;
  /**
   * Minimum values the part requires (`tsu`, `th`, `tW`, `trec`): the data sheet's guaranteed
   * minimum, which the timing checks use (`TimingChecks`). Their typical values, which may be
   * negative, go into `typical` for reference. Parts whose data sheets give only limits
   * (memories) also keep the minima of their outputs here (`tOH`, `tCLZ`).
   */
  readonly min?: Readonly<Record<string, Time>>;
  readonly conditions?: string;
  /** Where the numbers came from: datasheet, revision, table. */
  readonly source?: string;
}

/**
 * The view a behavior has of the simulator while one of its callbacks runs. The simulator reuses
 * one context object for all components: never keep a reference to it after the callback.
 */
export interface EvalContext<State = unknown> {
  /** Current simulation time. */
  readonly now: Time;
  /** Per-instance mutable state (from `createState`). */
  readonly state: State;
  /** Instance id from the netlist (for messages). */
  readonly id: string;
  /** Current resolved level of the pin's net. Reading `Z` records a `floating-input`. */
  read(pin: PinRef): Level;
  /**
   * The pin's level like `read`, but a `Z` records nothing: for a part that decides afterwards
   * whether it used the value (a Verilog module, HDL-8) and then calls `reportFloating`.
   */
  level(pin: PinRef): Level;
  /**
   * Records a `floating-input` on the pin's net as `read` of a `Z` does — once until the net
   * changes, never through a `sense` pin — for a floating value the part read with `level` and
   * used, now or just before this delta (a flip-flop sampling it at an edge).
   */
  reportFloating(pin: PinRef): void;
  /** Level of the pin's net before the change in the triggering delta (= `read` if unchanged). */
  prev(pin: PinRef): Level;
  /** Did this pin's net change in the triggering delta cycle? */
  changed(pin: PinRef): boolean;
  /** Changed from exactly 0 to exactly 1 (edges from/to `X`/`Z` don't count; see `prev`). */
  rose(pin: PinRef): boolean;
  /** Changed from exactly 1 to exactly 0. */
  fell(pin: PinRef): boolean;
  /** Schedules `drive` on a driver pin after `delay` (inertial; see docs/simulation.md). */
  drive(pin: PinRef, drive: Drive, delay: Time): void;
  /** Calls `wake(ctx, token)` after `delay`. */
  wakeAfter(delay: Time, token?: number): void;
  /** Reports a diagnostic (setup/hold violation, …); the kernel adds time and component id. */
  report(diagnostic: ComponentDiagnostic): void;
}

/** Per-instance runtime behavior. All mutable state lives in `ctx.state`. */
export interface Behavior<State = unknown> {
  /**
   * Initial state; must be plain structured-clone-able data (objects, arrays, typed arrays) so
   * the simulator can preserve it across recompiles and snapshot it. Default: `undefined`.
   */
  createState?(): State;
  /** Called once at t = 0, before any events. Set initial outputs here. */
  init?(ctx: EvalContext<State>): void;
  /** Called when nets this component reads changed (at most once per delta cycle). */
  evaluate?(ctx: EvalContext<State>): void;
  /** Called when a timer scheduled with `ctx.wakeAfter()` fires. */
  wake?(ctx: EvalContext<State>, token: number): void;
  /** External action from the UI or a test bench (press a button, flip a switch). */
  action?(ctx: EvalContext<State>, action: unknown): void;
}

/** A part type. Written once per part in `src/library`; looked up by `type` in a registry. */
export interface ComponentDefinition<
  Props extends object = Record<string, PropValue>,
  State = unknown,
> {
  /** Stable type id `family/part`, e.g. `74xx/74hc00`. Never rename (saved documents use it). */
  readonly type: string;
  /** Short name shown on the part: `74HC00`. */
  readonly name: string;
  /** What it is: `Quad 2-input NAND gate`. */
  readonly title: string;
  /** Extra palette search terms. */
  readonly keywords?: readonly string[];
  /**
   * Designator prefix for new instances (`SW` → `SW1`, `SW2`): uppercase letters, by KiCad/IEEE
   * convention (`U` chips and gates, `R`, `SW`, `D` LEDs, `DS` displays, `X` clocks, `TP`
   * probes, `PWR` rails). Defaults to `U`.
   */
  readonly designatorPrefix?: string;
  /** URL of the datasheet the pins, function table and timing come from. */
  readonly datasheet?: string;
  /** Pin list (order defines `PinRef`s), or a function of props for parts like N-input gates. */
  readonly pins: readonly PinDef[] | ((props: Props) => readonly PinDef[]);
  readonly package?: PackageDef;
  readonly units?: readonly UnitDef[];
  readonly props?: readonly PropDef[];
  /** Datasheet timing, or a function of props for parts sold in speed grades (a `speed` prop). */
  readonly timing?: TimingDef | ((props: Props) => TimingDef);
  /** The datasheet function table (one unit's, for multi-gate chips), shown in Part Info. */
  readonly functionTable?: FunctionTable;
  /**
   * Drawn and connected but never simulated (net labels): the circuit compiler leaves it out of
   * the netlist, so adding or moving one only changes which pins share a net.
   */
  readonly schematicOnly?: boolean;
  /**
   * A subcircuit's port (R11a, `net/port`): its one pin joins the net or bus of `name` in its
   * circuit and is that circuit's interface pin, with the direction and side the instance's
   * symbol gives it. Ports are schematic-only.
   */
  readonly port?: (props: Props) => PortDef;
  /**
   * The props the editor gives the next instance placed after one with `props` was placed or
   * edited (net labels: `D0` → `D1`). Without it, new instances get the defaults.
   */
  readonly nextProps?: (props: Props) => Props;
  /**
   * Geometry of a part drawn as a symbol rather than a package (LEDs, switches, gates), or a
   * function of props for parts like LED bars. Ignored when `package` is set.
   */
  readonly symbol?: SymbolDef | ((props: Props) => SymbolDef);
  /**
   * The part holds memory (ROM, RAM): its size and a view of an instance's cells, for inspectors
   * and test benches.
   */
  readonly memory?: MemoryDef<State>;
  /**
   * The part is a CPU: its registers and a view of an instance's state, for the CPU tab,
   * watches and test benches.
   */
  readonly cpu?: CpuDef<State>;
  /**
   * The part has named signals inside (a Verilog module's registers and wires, HDL-4): their
   * names and a view of an instance's levels, for probes, watches, breakpoints and test benches.
   */
  readonly signals?: SignalsDef<State>;
  /**
   * The part's look changes as simulated time passes, without an event (an LCD's blinking
   * cursor): the length in ps of one look of an instance in `state`, or undefined while it stays
   * as it is. The editor redraws whenever the time crosses into the next one.
   */
  readonly animation?: (state: State, props: Props) => Time | undefined;
  /** Creates the behavior of one instance. `props` are validated and defaulted. */
  create(props: Props): Behavior<State>;
}

/** Which way a port's signal goes, seen from the subcircuit: `in` comes from outside. */
export type PortDirection = 'in' | 'out' | 'bidir';

/** Where a port's pin sits on the instance symbol; `auto`: inputs left, the others right. */
export type PortSide = 'auto' | 'left' | 'right' | 'top' | 'bottom';

/** A subcircuit's interface pin, as a port part declares it (`ComponentDefinition.port`). */
export interface PortDef {
  /** A net name (`CLK`) or a bus name (`D[0..7]`, a bus port). */
  readonly name: string;
  readonly direction: PortDirection;
  readonly side: PortSide;
}

/** A definition with its generic parameters erased, as stored in a registry. */
export type AnyComponentDefinition = ComponentDefinition<Record<string, PropValue>, unknown>;

/**
 * Declares a part with full type inference for its props and state and returns it in the erased
 * form registries store. Safe because the simulator only ever passes `create`/`pins` props that
 * were resolved against this same definition's `props`.
 */
export function defineComponent<Props extends object, State>(
  definition: ComponentDefinition<Props, State>,
): AnyComponentDefinition {
  return definition as unknown as AnyComponentDefinition;
}

/** Prefix of parts that don't set `designatorPrefix`. */
export const DEFAULT_DESIGNATOR_PREFIX = 'U';

/** Uppercase letters only, so the number that follows is unambiguous (`SW12`). */
export const DESIGNATOR_PREFIX = /^[A-Z]+$/;

/** The designator prefix new instances of a part get. */
export function designatorPrefixOf(definition: AnyComponentDefinition): string {
  return definition.designatorPrefix ?? DEFAULT_DESIGNATOR_PREFIX;
}

/** Pin list of an instance with the given (resolved) props. */
export function pinsOf(
  definition: AnyComponentDefinition,
  props: Record<string, PropValue>,
): readonly PinDef[] {
  return typeof definition.pins === 'function' ? definition.pins(props) : definition.pins;
}

/** The timing of an instance with the given (resolved) props; undefined without timing. */
export function timingOf(
  definition: AnyComponentDefinition,
  props: Record<string, PropValue>,
): TimingDef | undefined {
  const { timing } = definition;
  return typeof timing === 'function' ? timing(props) : timing;
}

/** Index of the pin called `name`; throws if there is none. */
export function pinIndex(pins: readonly PinDef[], name: string): PinRef {
  const index = pins.findIndex((p) => p.name === name);
  if (index < 0) throw new Error(`no pin "${name}" (pins: ${pins.map((p) => p.name).join(', ')})`);
  return index;
}

/**
 * Throws if pin names are empty or not unique, a label or net name is blank, or a flag doesn't fit
 * the pin: `weak` on a non-driver, `sense` on anything but `in`, `bus` on anything but `nc`,
 * `constant` on anything but a strong `out` (or with a level other than 0/1). `where` prefixes
 * the message.
 */
export function validatePins(pins: readonly PinDef[], where: string): void {
  const seen = new Set<string>();
  for (const pin of pins) {
    if (pin.name === '') throw new Error(`${where}: empty pin name`);
    if (seen.has(pin.name)) throw new Error(`${where}: duplicate pin "${pin.name}"`);
    if (pin.label !== undefined && !/\S/.test(pin.label)) {
      throw new Error(`${where}: pin "${pin.name}" has an empty label`);
    }
    if (pin.net !== undefined && !/\S/.test(pin.net)) {
      throw new Error(`${where}: pin "${pin.name}" has an empty net name`);
    }
    const bad = (what: string) =>
      new Error(`${where}: pin "${pin.name}" is "${pin.dir}" and cannot be ${what}`);
    if (pin.weak && !isDriverPin(pin.dir)) throw bad('weak');
    if (pin.sense && pin.dir !== 'in') throw bad('sense');
    if (pin.bus && pin.dir !== 'nc') throw bad('a bus pin');
    if (pin.constant !== undefined) {
      if (pin.dir !== 'out') throw bad('constant');
      if (pin.weak) throw new Error(`${where}: pin "${pin.name}" cannot be weak and constant`);
      if (pin.constant !== 0 && pin.constant !== 1) {
        throw new Error(`${where}: pin "${pin.name}" constant must be 0 or 1`);
      }
    }
    seen.add(pin.name);
  }
}

/**
 * Validates raw props (from a netlist or document) against a definition and fills in defaults.
 * Throws with a precise message on unknown keys, wrong types, out-of-range values.
 */
export function resolveProps(
  definition: AnyComponentDefinition,
  raw: Readonly<Record<string, unknown>> = {},
  where = definition.type,
): Record<string, PropValue> {
  const defs = definition.props ?? [];
  const known = new Set(defs.map((d) => d.key));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      const list = defs.length > 0 ? defs.map((d) => d.key).join(', ') : 'none';
      throw new Error(`${where}: unknown prop "${key}" (props: ${list})`);
    }
  }
  const props: Record<string, PropValue> = {};
  for (const def of defs) {
    const value = raw[def.key] ?? def.default;
    const expected = propProblem(def, value);
    if (expected !== undefined) {
      throw new Error(`${where}: prop "${def.key}" must be ${expected}, got ${shown(value)}`);
    }
    props[def.key] = value as PropValue;
  }
  return props;
}

/** A value in a message: long strings (images) cut short. */
function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}..."` : text;
}

/** Returns what the value should have been, or `undefined` if it is valid. */
function propProblem(def: PropDef, value: unknown): string | undefined {
  switch (def.type) {
    case 'number':
    case 'integer':
    case 'time':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'a finite number';
      if (def.type !== 'number' && !Number.isInteger(value)) {
        return def.type === 'time' ? 'an integer number of picoseconds' : 'an integer';
      }
      if (def.min !== undefined && value < def.min) return `≥ ${def.min}`;
      if (def.max !== undefined && value > def.max) return `≤ ${def.max}`;
      return undefined;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'a boolean';
    case 'enum': {
      const options = (def.options ?? []).map((o) => o.value);
      return typeof value === 'string' && options.includes(value)
        ? undefined
        : `one of ${options.map((o) => JSON.stringify(o)).join(', ')}`;
    }
    case 'color':
      return typeof value === 'string' ? undefined : 'a string';
    case 'string':
      if (typeof value !== 'string') return 'a string';
      return def.pattern === undefined || def.pattern.regex.test(value)
        ? undefined
        : def.pattern.hint;
    case 'image': {
      if (typeof value !== 'string') return 'a string';
      const result = readImage(value, def.max ?? 0);
      return typeof result === 'string' ? `${IMAGE_HINT} (${result})` : undefined;
    }
  }
}

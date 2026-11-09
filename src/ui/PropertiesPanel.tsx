import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { circuitUses, designatorError, renameCircuit, subcircuitOf } from '../circuit';
import {
  formatTime,
  type PropDef,
  type PropValue,
  pinsOf,
  programmedBytes,
  readImage,
} from '../core';
import { type Editor, LED_COLORS, type Scene, type ScenePart, type SceneWire } from '../editor';
import { useStore } from './hooks';
import { LevelBadge, LiveLevel, styleBit } from './LiveLevel';
import { formatSi, parsePropText, propText } from './prop-input';

/** A prop value as shown to the user: units, enum labels, time in ns/µs/ms. */
export function formatProp(def: PropDef, value: PropValue | undefined): string {
  if (value === undefined) return '—';
  switch (def.type) {
    case 'time':
      return formatTime(Number(value));
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'enum':
      return def.options?.find((o) => o.value === value)?.label ?? String(value);
    case 'image':
      return imageSummary(def, String(value));
    default:
      if (def.type === 'number' && def.si) return formatSi(Number(value), def.unit);
      return def.unit ? `${value} ${def.unit}` : String(value);
  }
}

/** A memory image as Properties shows it: `214 of 2048 bytes programmed`, `Erased (2048 bytes)`. */
export function imageSummary(def: PropDef, text: string): string {
  const size = def.max ?? 0;
  const bytes = readImage(text, size);
  if (typeof bytes === 'string') return 'Invalid contents';
  const programmed = programmedBytes(bytes);
  return programmed === 0 ? `Erased (${size} bytes)` : `${programmed} of ${size} bytes programmed`;
}

function Row({
  label,
  wide,
  children,
}: {
  readonly label: string;
  /** The value under its label, across the panel (a text area). */
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={wide ? 'prop-row wide' : 'prop-row'}>
      <div className="prop-label">{label}</div>
      <div className="prop-value">{children}</div>
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="prop-section">
      <div className="prop-section-title">{title}</div>
      {children}
    </div>
  );
}

/** What is selected; a single part's designator, label, placement and props are editable. */
export function PropertiesPanel({
  editor,
  focusRequest,
}: {
  readonly editor: Editor;
  /** Changes when the designator field should take focus (double-click, Edit ▸ Properties). */
  readonly focusRequest: number;
}) {
  const { scene, selection } = useStore(editor.state);
  const designator = useRef<HTMLInputElement>(null);
  // A part edited as text (a schematic text) takes the request in its text, not its designator.
  const text = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === seen.current) return;
    seen.current = focusRequest;
    const field = text.current ?? designator.current;
    field?.focus();
    field?.select();
  }, [focusRequest]);

  const parts = [...selection.parts].flatMap((id) => scene.partById.get(id) ?? []);
  const wires = [...selection.wires].flatMap((id) => scene.wireById.get(id) ?? []);

  if (parts.length === 1 && wires.length === 0) {
    const part = parts[0]!;
    return (
      <PartProperties
        key={part.id}
        part={part}
        scene={scene}
        editor={editor}
        designatorRef={designator}
        textRef={text}
      />
    );
  }
  if (parts.length === 0 && wires.length === 1) {
    return <WireProperties wire={wires[0]!} scene={scene} editor={editor} />;
  }
  if (parts.length + wires.length > 1) return <MultiProperties parts={parts} wires={wires} />;
  return <CircuitProperties editor={editor} scene={scene} nameRef={designator} />;
}

/** Nothing selected: the open circuit — its name (editable), its role, where it is placed. */
function CircuitProperties({
  editor,
  scene,
  nameRef,
}: {
  readonly editor: Editor;
  readonly scene: Scene;
  readonly nameRef: Ref<HTMLInputElement>;
}) {
  const { document, design } = useStore(editor.state);
  const { circuit } = scene;
  const top = circuit.id === design.top;
  const uses = circuitUses(document, circuit.id);
  const names = new Map(document.circuits.map((c) => [c.id, c.name]));
  const definition = editor.registry.get(`sub/${circuit.id}`);
  const ports =
    definition && pinsOf(definition, {}).length > 0
      ? definition.title.replace(/^Subcircuit: /, '')
      : undefined;
  return (
    <div className="props" data-testid="circuit-properties">
      <Section title="Circuit">
        <Row label="Name">
          <Field
            key={circuit.id}
            value={circuit.name}
            label="Circuit name"
            inputRef={nameRef}
            testId="circuit-name"
            validate={(text) => (text.trim() === '' ? 'A circuit needs a name.' : undefined)}
            onCommit={(text) => {
              // A circuit nothing places takes an id from its new name: follow it.
              const index = document.circuits.indexOf(circuit);
              const next = renameCircuit(document, circuit.id, text.trim());
              editor.editDocument(`Rename ${circuit.name}`, next, {
                open: next.circuits[index]?.id ?? circuit.id,
              });
            }}
          />
        </Row>
        <Row label="Id">
          <span className="mono">{circuit.id}</span>
        </Row>
        <Row label="Role">
          {top ? 'Top circuit: it simulates' : circuit.verilog ? 'Verilog module' : 'Subcircuit'}
        </Row>
        {document.circuits.length > 1 && (
          <Row label="Placed in">
            {uses.length === 0
              ? 'nowhere'
              : uses.map((u) => `${names.get(u.circuit)}: ${u.components.join(', ')}`).join('; ')}
          </Row>
        )}
        {ports && <Row label="Ports">{ports}</Row>}
        <Row label="Parts">{scene.parts.length}</Row>
        <Row label="Wires">{scene.wires.length}</Row>
        <Row label="Nets">{scene.compiled.nets.length}</Row>
      </Section>
      <div className="empty-note">Select a part or a wire to see its properties.</div>
    </div>
  );
}

interface FieldProps {
  readonly value: string;
  readonly label: string;
  /** Why the text can't be used, or undefined if it can. */
  readonly validate?: (text: string) => string | undefined;
  /** Applies the text; returns an error to show instead of closing the edit. */
  readonly onCommit: (text: string) => unknown;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly mono?: boolean;
  readonly placeholder?: string;
  readonly testId?: string;
}

/**
 * A text field that edits a value: Enter or leaving the field applies it (if valid), Escape
 * reverts; invalid text is marked with the reason below.
 */
function Field({
  value,
  label,
  validate,
  onCommit,
  inputRef,
  mono,
  placeholder,
  testId,
}: FieldProps) {
  const [draft, setDraft] = useState(value);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDraft(value);
    setFailure(undefined);
  }, [value]);
  // Escape blurs the field, and the blur handler still sees the edited draft: skip that commit.
  const reverting = useRef(false);
  const error = failure ?? (draft === value ? undefined : validate?.(draft));
  const commit = () => {
    if (draft === value) return;
    if (validate?.(draft)) return;
    const result = onCommit(draft);
    if (typeof result === 'string') setFailure(result);
  };
  return (
    <div className="field">
      <input
        ref={inputRef}
        className={['prop-input', mono && 'mono', error && 'invalid'].filter(Boolean).join(' ')}
        value={draft}
        aria-label={label}
        aria-invalid={error !== undefined}
        placeholder={placeholder}
        spellCheck={false}
        data-testid={testId}
        onChange={(e) => {
          setDraft(e.target.value);
          setFailure(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setDraft(value);
            setFailure(undefined);
            reverting.current = true;
            e.currentTarget.blur();
            reverting.current = false;
          }
        }}
        onBlur={() => {
          if (reverting.current) return;
          if (error || validate?.(draft)) {
            setDraft(value);
            setFailure(undefined);
          } else commit();
        }}
      />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

/** Rows a text area shows: its lines, within these limits (it scrolls beyond). */
const TEXT_ROWS = { min: 3, max: 16 } as const;

/**
 * A multi-line text field: Enter starts a new line, Mod+Enter or leaving the field applies the
 * text, Escape reverts. Lines don't wrap, so a listing keeps its columns.
 */
function TextArea({
  value,
  label,
  mono,
  inputRef,
  testId,
  onCommit,
}: {
  readonly value: string;
  readonly label: string;
  readonly mono: boolean;
  readonly inputRef?: Ref<HTMLTextAreaElement>;
  readonly testId: string;
  readonly onCommit: (text: string) => unknown;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  // Escape blurs the field, and the blur handler still sees the edited draft: skip that commit.
  const reverting = useRef(false);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const lines = draft.split('\n').length;
  return (
    <textarea
      ref={inputRef}
      className={['prop-input', 'prop-text', mono && 'mono'].filter(Boolean).join(' ')}
      value={draft}
      rows={Math.min(Math.max(lines, TEXT_ROWS.min), TEXT_ROWS.max)}
      wrap="off"
      aria-label={label}
      spellCheck={false}
      data-testid={testId}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
          reverting.current = true;
          e.currentTarget.blur();
          reverting.current = false;
        }
      }}
      onBlur={() => {
        if (!reverting.current) commit();
      }}
    />
  );
}

const ROTATION_OPTIONS = [0, 90, 180, 270] as const;

function PartProperties({
  part,
  scene,
  editor,
  designatorRef,
  textRef,
}: {
  readonly part: ScenePart;
  readonly scene: Scene;
  readonly editor: Editor;
  readonly designatorRef: Ref<HTMLInputElement>;
  /** For the part's first multi-line text prop. */
  readonly textRef: Ref<HTMLTextAreaElement>;
}) {
  const { instance, definition } = part;
  // A bus label names a bus: show it like a selected bus line.
  const busPin = part.definition?.schematicOnly
    ? part.pins.find((p) => p.bus && p.net !== undefined && !p.open)
    : undefined;
  const defs = definition ? pinsOf(definition, part.props) : [];
  const circuit = editor.state.get().circuit;
  const integer = (text: string) =>
    /^\s*-?\d+\s*$/.test(text) ? undefined : 'Enter a whole number of grid cells.';
  const placed = subcircuitOf(instance.type);
  const firstMultiline = definition?.props?.find((d) => d.type === 'string' && d.multiline);
  return (
    <div className="props" data-testid="part-properties">
      <div className="props-heading">
        <span className="props-name">{instance.id}</span>
        <span className="muted">{definition?.name ?? instance.type}</span>
      </div>
      {definition && <div className="props-subtitle">{definition.title}</div>}
      {placed !== undefined && definition && (
        <div className="props-subtitle">
          <button
            type="button"
            className="link-button"
            data-testid="open-subcircuit"
            title={`Open ${definition.name} in this instance`}
            onClick={() => editor.goInto(instance.id)}
          >
            Go Into {instance.id}
          </button>
        </div>
      )}
      {part.drawing.kind === 'broken' && <div className="props-error">{part.drawing.reason}</div>}
      <Section title="Part">
        <Row label="Designator">
          <Field
            value={instance.id}
            label="Designator"
            mono
            inputRef={designatorRef}
            testId="prop-designator"
            validate={(text) => designatorError(circuit, instance.id, text.trim())}
            onCommit={(text) => editor.renamePart(instance.id, text.trim())}
          />
        </Row>
        <Row label="Type">
          <span className="mono">{instance.type}</span>
        </Row>
        {/* A net label shows its name only; free label text would never be drawn. */}
        {!definition?.schematicOnly && (
          <Row label="Label">
            <Field
              value={instance.label ?? ''}
              label="Label"
              placeholder="none"
              testId="prop-label"
              onCommit={(text) => editor.setPartLabel(instance.id, text)}
            />
          </Row>
        )}
        <Row label="Position">
          <span className="field-pair">
            <Field
              value={String(instance.x)}
              label="X"
              mono
              testId="prop-x"
              validate={integer}
              onCommit={(text) => editor.setPartPlacement(instance.id, { x: Number(text) })}
            />
            <Field
              value={String(instance.y)}
              label="Y"
              mono
              testId="prop-y"
              validate={integer}
              onCommit={(text) => editor.setPartPlacement(instance.id, { y: Number(text) })}
            />
          </span>
        </Row>
        <Row label="Rotation">
          <select
            className="prop-input"
            aria-label="Rotation"
            value={instance.rotation}
            data-testid="prop-rotation"
            onChange={(e) =>
              editor.setPartPlacement(instance.id, {
                rotation: Number(e.target.value) as (typeof ROTATION_OPTIONS)[number],
              })
            }
          >
            {ROTATION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </Row>
        <Row label="Flipped">
          <input
            type="checkbox"
            aria-label="Flipped"
            checked={instance.flip}
            data-testid="prop-flip"
            onChange={(e) => editor.setPartPlacement(instance.id, { flip: e.target.checked })}
          />
        </Row>
        {definition?.datasheet && (
          <Row label="Datasheet">
            <a className="link" href={definition.datasheet} target="_blank" rel="noreferrer">
              open
            </a>
          </Row>
        )}
      </Section>
      {definition?.props && definition.props.length > 0 && (
        <Section title="Properties">
          {definition.props.map((def) => {
            const multiline = def.type === 'string' && def.multiline === true;
            return (
              <Row
                key={def.key}
                label={def.unit ? `${def.label} (${def.unit})` : def.label}
                wide={multiline}
              >
                <PropEditor
                  def={def}
                  value={part.props[def.key]}
                  editable={part.drawing.kind !== 'broken'}
                  mono={part.props.font === 'mono'}
                  {...(multiline && def === firstMultiline && { textRef })}
                  onChange={(value) => editor.setPartProp(instance.id, def.key, value)}
                />
              </Row>
            );
          })}
        </Section>
      )}
      {part.pins.length > 0 && (
        <Section title="Pins">
          {part.pins.map((pin, i) => {
            const def = defs[i];
            return (
              <Row key={pin.name} label={def?.number ? `${def.number} ${pin.name}` : pin.name}>
                <span className="muted">{def?.dir}</span>{' '}
                {pin.open ? (
                  <span className="muted">open</span>
                ) : (
                  <span className="mono">{pin.net}</span>
                )}{' '}
                <LiveLevel editor={editor} pin={[instance.id, pin.name]} />
              </Row>
            );
          })}
        </Section>
      )}
      {busPin?.net !== undefined && <BusSection bus={busPin.net} scene={scene} editor={editor} />}
    </div>
  );
}

/** The editor for one prop, by its type. */
function PropEditor({
  def,
  value,
  editable,
  mono,
  textRef,
  onChange,
}: {
  readonly def: PropDef;
  readonly value: PropValue | undefined;
  readonly editable: boolean;
  /** A multi-line text in a monospaced font (a listing): edit it in one too. */
  readonly mono?: boolean;
  readonly textRef?: Ref<HTMLTextAreaElement>;
  readonly onChange: (value: PropValue) => string | undefined;
}) {
  // Contents are loaded, not typed (the memory inspector edits them, R12b).
  if (!editable || def.type === 'image') return <>{formatProp(def, value)}</>;
  const testId = `prop-${def.key}`;
  if (def.type === 'string' && def.multiline) {
    return (
      <TextArea
        value={String(value ?? '')}
        label={def.label}
        mono={mono === true}
        testId={testId}
        {...(textRef && { inputRef: textRef })}
        onCommit={(text) => onChange(text)}
      />
    );
  }
  if (def.type === 'boolean') {
    return (
      <input
        type="checkbox"
        aria-label={def.label}
        checked={value === true}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (def.type === 'enum') {
    const swatch = def.key === 'color' ? LED_COLORS[String(value)] : undefined;
    return (
      <>
        {swatch && <span className="swatch" style={{ background: swatch }} />}
        <select
          className="prop-input"
          aria-label={def.label}
          value={String(value)}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        >
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </>
    );
  }
  return (
    <Field
      value={propText(def, value)}
      label={def.label}
      mono={def.type !== 'string' && def.type !== 'color'}
      testId={testId}
      validate={(text) => {
        const parsed = parsePropText(def, text);
        return 'error' in parsed ? parsed.error : undefined;
      }}
      onCommit={(text) => {
        const parsed = parsePropText(def, text);
        return 'error' in parsed ? parsed.error : onChange(parsed.value);
      }}
    />
  );
}

/**
 * A bus: its name, its value while simulating (hex, binary, decimal when every bit is known) and
 * each member net with its level, most significant first, as a data sheet lists a bus.
 */
function BusSection({
  bus: id,
  scene,
  editor,
}: {
  readonly bus: string;
  readonly scene: Scene;
  readonly editor: Editor;
}) {
  useStore(editor.simulation.ticks);
  const bus = scene.compiled.buses.find((b) => b.id === id);
  if (!bus) return null;
  const live = editor.simulation.busLive(bus.id);
  const named = new Set(scene.compiled.nets.flatMap((n) => n.names));
  const bits = live?.members.map(styleBit).reverse().join('');
  const known = bits !== undefined && /^[01]+$/.test(bits);
  return (
    <>
      <Section title="Bus">
        <Row label="Name">
          <span className="mono">{bus.names.length > 0 ? bus.names.join(', ') : 'unnamed'}</span>
        </Row>
        <Row label="Members">{bus.members.length}</Row>
        {live && (
          <Row label="Value">
            <span className="mono" data-testid="bus-value">
              {live.value}
            </span>{' '}
            <span className="mono muted">
              {bits}
              {known && ` = ${Number.parseInt(bits, 2)}`}
            </span>
          </Row>
        )}
      </Section>
      {bus.members.length > 0 && (
        <Section title="Bits">
          {bus.members
            .map((member, i) => (
              <Row key={member} label={member}>
                {live ? (
                  <LevelBadge style={live.members[i]!} />
                ) : (
                  !named.has(member) && <span className="muted">no net</span>
                )}
              </Row>
            ))
            .reverse()}
        </Section>
      )}
    </>
  );
}

function WireProperties({
  wire,
  scene,
  editor,
}: {
  readonly wire: SceneWire;
  readonly scene: Scene;
  readonly editor: Editor;
}) {
  const length = Math.abs(wire.to[0] - wire.from[0]) + Math.abs(wire.to[1] - wire.from[1]);
  if (wire.bus) {
    return (
      <div className="props" data-testid="wire-properties">
        <div className="props-heading">
          <span className="props-name">Bus line {wire.id}</span>
        </div>
        <Section title="Bus line">
          <Row label="From">
            <span className="mono">{wire.from.join(', ')}</span>
          </Row>
          <Row label="To">
            <span className="mono">{wire.to.join(', ')}</span>
          </Row>
          <Row label="Length">{length} cells</Row>
        </Section>
        <BusSection bus={wire.net} scene={scene} editor={editor} />
      </div>
    );
  }
  const net = scene.compiled.nets.find((n) => n.id === wire.net);
  return (
    <div className="props" data-testid="wire-properties">
      <div className="props-heading">
        <span className="props-name">Wire {wire.id}</span>
      </div>
      <Section title="Wire">
        <Row label="From">
          <span className="mono">{wire.from.join(', ')}</span>
        </Row>
        <Row label="To">
          <span className="mono">{wire.to.join(', ')}</span>
        </Row>
        <Row label="Length">{length} cells</Row>
        <Row label="Net">
          <span className="mono">{wire.net}</span> <LiveLevel editor={editor} wire={wire.id} />
        </Row>
      </Section>
      {net && net.pins.length > 0 && (
        <Section title="Connected pins">
          {net.pins.map((pin) => (
            <Row key={`${pin.component}.${pin.pin}`} label={`${pin.component}.${pin.pin}`}>
              <span className="muted">{pin.dir}</span>{' '}
              <LiveLevel editor={editor} pin={[pin.component, pin.pin]} />
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function MultiProperties({
  parts,
  wires,
}: {
  readonly parts: readonly ScenePart[];
  readonly wires: readonly SceneWire[];
}) {
  const byName = new Map<string, number>();
  for (const part of parts) {
    const name = part.definition?.name ?? part.instance.type;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  return (
    <div className="props">
      <div className="props-heading">
        <span className="props-name">{parts.length + wires.length} items</span>
      </div>
      <Section title="Selection">
        {[...byName].map(([name, count]) => (
          <Row key={name} label={name}>
            {count}
          </Row>
        ))}
        {wires.length > 0 && <Row label="Wires">{wires.length}</Row>}
      </Section>
    </div>
  );
}

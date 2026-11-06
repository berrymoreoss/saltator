import type { ReactNode } from 'react';
import { formatTime, type PropDef, type PropValue, pinsOf } from '../core';
import { type Editor, LED_COLORS, type Scene, type ScenePart, type SceneWire } from '../editor';
import { useStore } from './hooks';

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
    default:
      return def.unit ? `${value} ${def.unit}` : String(value);
  }
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="prop-row">
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

/** What is selected, read-only (editing comes with R04b). */
export function PropertiesPanel({ editor }: { readonly editor: Editor }) {
  const { scene, selection } = useStore(editor.state);
  const parts = [...selection.parts].flatMap((id) => scene.partById.get(id) ?? []);
  const wires = [...selection.wires].flatMap((id) => scene.wireById.get(id) ?? []);

  if (parts.length === 1 && wires.length === 0) return <PartProperties part={parts[0]!} />;
  if (parts.length === 0 && wires.length === 1) {
    return <WireProperties wire={wires[0]!} scene={scene} />;
  }
  if (parts.length + wires.length > 1) return <MultiProperties parts={parts} wires={wires} />;
  return (
    <div className="props">
      <Section title="Circuit">
        <Row label="Name">{scene.circuit.name}</Row>
        <Row label="Parts">{scene.parts.length}</Row>
        <Row label="Wires">{scene.wires.length}</Row>
        <Row label="Nets">{scene.compiled.nets.length}</Row>
      </Section>
      <div className="empty-note">Select a part or a wire to see its properties.</div>
    </div>
  );
}

function PartProperties({ part }: { readonly part: ScenePart }) {
  const { instance, definition } = part;
  const defs = definition ? pinsOf(definition, part.props) : [];
  return (
    <div className="props" data-testid="part-properties">
      <div className="props-heading">
        <span className="props-name">{instance.id}</span>
        <span className="muted">{definition?.name ?? instance.type}</span>
      </div>
      {definition && <div className="props-subtitle">{definition.title}</div>}
      {part.drawing.kind === 'broken' && <div className="props-error">{part.drawing.reason}</div>}
      <Section title="Part">
        <Row label="Designator">{instance.id}</Row>
        <Row label="Type">
          <span className="mono">{instance.type}</span>
        </Row>
        <Row label="Label">{instance.label ?? <span className="muted">—</span>}</Row>
        <Row label="Position">
          <span className="mono">
            {instance.x}, {instance.y}
          </span>
        </Row>
        <Row label="Rotation">
          {instance.rotation}°{instance.flip ? ', flipped' : ''}
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
          {definition.props.map((def) => (
            <Row key={def.key} label={def.label}>
              {def.key === 'color' && LED_COLORS[String(part.props[def.key])] && (
                <span
                  className="swatch"
                  style={{ background: LED_COLORS[String(part.props[def.key])] }}
                />
              )}
              {formatProp(def, part.props[def.key])}
            </Row>
          ))}
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
                )}
              </Row>
            );
          })}
        </Section>
      )}
    </div>
  );
}

function WireProperties({ wire, scene }: { readonly wire: SceneWire; readonly scene: Scene }) {
  const net = scene.compiled.nets.find((n) => n.id === wire.net);
  const length = Math.abs(wire.to[0] - wire.from[0]) + Math.abs(wire.to[1] - wire.from[1]);
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
          <span className="mono">{wire.net}</span>
        </Row>
      </Section>
      {net && net.pins.length > 0 && (
        <Section title="Connected pins">
          {net.pins.map((pin) => (
            <Row key={`${pin.component}.${pin.pin}`} label={`${pin.component}.${pin.pin}`}>
              <span className="muted">{pin.dir}</span>
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

import { ChevronDown, ChevronRight, ExternalLink, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnyComponentDefinition, ComponentRegistry } from '../core';
import { pinsOf, resolveProps } from '../core';
import { type CanvasTheme, drawPartPreview, type GateStyle } from '../editor';
import { groupParts } from './parts-filter';

interface PartsPanelProps {
  readonly registry: ComponentRegistry;
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
  /** Changes when the search box should take focus (Edit ▸ Find Part, `/`). */
  readonly searchRequest: number;
}

/**
 * The part library: families as collapsible groups, a search box, and a preview of the selected
 * part (symbol, title, pins, datasheet). Placing parts from here comes in R04b.
 */
export function PartsPanel({ registry, theme, gateStyle, searchRequest }: PartsPanelProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const search = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupParts(registry.list(), query), [registry, query]);
  const definition = selected ? registry.get(selected) : undefined;

  useEffect(() => {
    if (searchRequest > 0) {
      search.current?.focus();
      search.current?.select();
    }
  }, [searchRequest]);

  const toggle = (family: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });

  return (
    <div className="parts">
      <div className="search-box">
        <Search size={13} />
        <input
          ref={search}
          type="search"
          placeholder="Search parts"
          aria-label="Search parts"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (query) setQuery('');
              else e.currentTarget.blur();
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            title="Clear search"
            onClick={() => setQuery('')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="parts-list">
        {groups.length === 0 && <div className="empty-note">No parts match “{query}”.</div>}
        {groups.map((group) => {
          const open = query !== '' || !collapsed.has(group.family);
          return (
            <div key={group.family} className="parts-group">
              <button
                type="button"
                className="group-header"
                aria-expanded={open}
                onClick={() => toggle(group.family)}
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{group.label}</span>
                <span className="group-count">{group.parts.length}</span>
              </button>
              {open &&
                group.parts.map((part) => (
                  <button
                    key={part.type}
                    type="button"
                    className={part.type === selected ? 'part-row selected' : 'part-row'}
                    title={part.type}
                    onClick={() => setSelected(part.type)}
                    data-type={part.type}
                  >
                    <span className="part-name">{part.name}</span>
                    <span className="part-title">{part.title}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
      {definition && (
        <PartDetails
          definition={definition}
          registry={registry}
          theme={theme}
          gateStyle={gateStyle}
        />
      )}
    </div>
  );
}

interface PartDetailsProps {
  readonly definition: AnyComponentDefinition;
  readonly registry: ComponentRegistry;
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
}

function PartDetails({ definition, registry, theme, gateStyle }: PartDetailsProps) {
  const pins = pinsOf(definition, resolveProps(definition, {}));
  return (
    <div className="part-details" data-testid="part-details">
      <PartPreview type={definition.type} registry={registry} theme={theme} gateStyle={gateStyle} />
      <div className="part-info">
        <div className="part-info-name">
          {definition.name} <span className="mono muted">{definition.type}</span>
        </div>
        <div className="muted">{definition.title}</div>
        <div className="part-pins">
          {pins.map((pin) => (
            <span key={pin.name} className="pin-chip" title={pin.dir}>
              {pin.number !== undefined && <span className="muted">{pin.number}</span>}
              {pin.name}
            </span>
          ))}
        </div>
        {definition.datasheet && (
          <a href={definition.datasheet} target="_blank" rel="noreferrer" className="link">
            Datasheet <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

const PREVIEW_HEIGHT = 112;

function PartPreview({
  type,
  registry,
  theme,
  gateStyle,
}: {
  readonly type: string;
  readonly registry: ComponentRegistry;
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(width * dpr);
    element.height = Math.round(PREVIEW_HEIGHT * dpr);
    drawPartPreview(
      ctx,
      registry,
      type,
      { width, height: PREVIEW_HEIGHT },
      { theme, gateStyle, dpr },
    );
  }, [type, registry, theme, gateStyle, width]);

  return (
    <canvas
      ref={canvas}
      className="part-preview"
      style={{ height: PREVIEW_HEIGHT }}
      aria-label={`Symbol of ${type}`}
    />
  );
}

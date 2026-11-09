import { FileCode, Plus, Star } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Point } from '../circuit';
import type { Editor } from '../editor';
import type { CommandRegistry } from './commands';
import { useStore } from './hooks';
import { MenuList } from './MenuBar';
import { CIRCUIT_CONTEXT_MENU } from './workbench-commands';

/**
 * The document's circuits (R11a): the top marked with a star, Verilog modules (HDL-1) with a code
 * mark, the open one highlighted, each with how many instances of it are placed. A click opens
 * one; a right click opens it and shows the Circuit commands; + adds a circuit or a module.
 */
export function CircuitsPanel({
  editor,
  commands,
  mac,
}: {
  readonly editor: Editor;
  readonly commands: CommandRegistry;
  readonly mac: boolean;
}) {
  const { document, circuit } = useStore(editor.state);
  const [menu, setMenu] = useState<Point | undefined>(undefined);
  const counts = new Map<string, number>();
  for (const c of document.circuits) {
    for (const part of c.components) {
      if (part.type.startsWith('sub/')) {
        const id = part.type.slice(4);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return (
    <div className="circuits">
      <ul className="circuits-list" data-testid="circuits">
        {document.circuits.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className={c.id === circuit.id ? 'circuit-row open' : 'circuit-row'}
              aria-current={c.id === circuit.id ? 'page' : undefined}
              title={i === 0 ? `${c.name}: the top circuit, it simulates` : `Open ${c.name}`}
              onClick={() => editor.openCircuit(c.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                editor.openCircuit(c.id);
                setMenu([e.clientX, e.clientY]);
              }}
            >
              <span className="circuit-top">
                {i === 0 && <Star size={11} aria-label="top circuit" />}
              </span>
              <span className="circuit-name">{c.name}</span>
              {c.verilog && (
                <FileCode size={11} className="circuit-verilog" aria-label="Verilog module" />
              )}
              {(counts.get(c.id) ?? 0) > 0 && (
                <span className="circuit-count muted" title="Instances placed">
                  {counts.get(c.id)}×
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="circuits-actions">
        <button
          type="button"
          className="circuits-add"
          onClick={() => commands.get('circuit.add').run()}
          data-testid="add-circuit"
        >
          <Plus size={12} /> Add Circuit
        </button>
        <button
          type="button"
          className="circuits-add"
          title="Add Verilog Module: a circuit written in Verilog, compiled from Yosys's JSON"
          onClick={() => commands.get('circuit.addVerilog').run()}
          data-testid="add-verilog-module"
        >
          <Plus size={12} /> Verilog Module
        </button>
      </div>
      {menu && (
        <CircuitMenu at={menu} commands={commands} mac={mac} onClose={() => setMenu(undefined)} />
      )}
    </div>
  );
}

/** The context menu of a circuit row: kept inside the window; Escape or a click outside closes it. */
function CircuitMenu({
  at,
  commands,
  mac,
  onClose,
}: {
  readonly at: Point;
  readonly commands: CommandRegistry;
  readonly mac: boolean;
  readonly onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Point>(at);
  useLayoutEffect(() => {
    const element = box.current?.firstElementChild;
    if (!(element instanceof HTMLElement)) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition([
      Math.max(4, Math.min(at[0], window.innerWidth - width - 4)),
      Math.max(4, Math.min(at[1], window.innerHeight - height - 4)),
    ]);
  }, [at]);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <div
      ref={box}
      className="context-menu"
      style={{ left: position[0], top: position[1] }}
      data-testid="circuit-menu"
    >
      <MenuList items={CIRCUIT_CONTEXT_MENU} commands={commands} mac={mac} onDone={onClose} />
    </div>
  );
}

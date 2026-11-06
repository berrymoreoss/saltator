import { CircleX, TriangleExclamationPoint } from 'lucide-react';
import type { ComponentRegistry } from '../core';
import {
  type Editor,
  type EditorMode,
  type Scene,
  type Selection,
  type Tool,
  zoomPercent,
} from '../editor';
import { useStore } from './hooks';
import { SimulationStatus } from './SimControls';

/** One line about the selection: `U1 · NAND`, `3 parts, 2 wires`, or nothing. */
export function selectionSummary(selection: Selection, scene: Scene): string {
  const parts = selection.parts.size;
  const wires = selection.wires.size;
  if (parts + wires === 0) return 'Nothing selected';
  if (parts === 1 && wires === 0) {
    const [id] = selection.parts;
    const part = scene.partById.get(id!);
    return part ? `${part.id} · ${part.definition?.name ?? part.instance.type}` : id!;
  }
  if (parts === 0 && wires === 1) {
    const [id] = selection.wires;
    const wire = scene.wireById.get(id!);
    return wire ? `Wire ${wire.id} · net ${wire.net}` : id!;
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [parts > 0 && plural(parts, 'part'), wires > 0 && plural(wires, 'wire')]
    .filter(Boolean)
    .join(', ');
}

interface StatusBarProps {
  readonly editor: Editor;
  readonly onShowMessages: () => void;
}

/** What the pointer does now, for the status bar (`simulating`: a simulator exists). */
export function statusHint(
  tool: Tool,
  mode: EditorMode,
  registry: ComponentRegistry,
  simulating = false,
): string {
  switch (mode) {
    case 'moving':
      return 'Release to drop · Esc to cancel';
    case 'boxing':
      return 'Drag right to select what is inside, left for what the box touches';
    case 'panning':
      return 'Release to stop panning';
    case 'wiring':
      return 'Click to add a corner · Click a pin or wire to finish · Double-click to end · Tab other bend · ⌫ undo corner · Esc cancel';
    case 'floating':
      return 'Click to drop · R rotate · F flip · Esc cancel';
    case 'idle':
      break;
  }
  if (typeof tool === 'object') {
    const name = registry.get(tool.type)?.name ?? tool.type;
    return `Click to place ${name} · R rotate · F flip · Esc to stop`;
  }
  switch (tool) {
    case 'select':
      return 'Click to select · Drag to move · Drag from a pin to draw a wire · Shift-click to add';
    case 'pan':
      return 'Drag to pan · V to select';
    case 'wire':
      return 'Click to start a wire · Esc for Select';
    case 'interact':
      return simulating
        ? 'Click switches and DIP switches · Hold buttons · Click a manual clock to step · Drag to pan · V to edit'
        : 'Run (F5) to operate switches and buttons · Drag to pan · V to select';
  }
}

export function StatusBar({ editor, onShowMessages }: StatusBarProps) {
  const { scene, selection } = useStore(editor.state);
  const view = useStore(editor.view);
  const tool = useStore(editor.tool);
  const mode = useStore(editor.mode);
  const simulating = useStore(editor.simulation.status).state !== 'stopped';
  const errors = scene.issues.filter((i) => i.severity === 'error').length;
  const warnings = scene.issues.length - errors;
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="status-cell mono" title="Cursor position (grid cells)" data-testid="cursor">
        X {view.cursor ? view.cursor[0] : '–'}&nbsp;&nbsp;Y {view.cursor ? view.cursor[1] : '–'}
      </span>
      <span className="status-cell mono" data-testid="zoom" title="Zoom">
        {zoomPercent(view.camera)} %
      </span>
      <span className="status-cell" data-testid="selection-summary">
        {selectionSummary(selection, scene)}
      </span>
      <SimulationStatus simulation={editor.simulation} />
      <span className="status-cell status-hint" data-testid="status-hint">
        {statusHint(tool, mode, editor.registry, simulating)}
      </span>
      <span className="status-spacer" />
      <span className="status-cell">
        {scene.parts.length} parts · {scene.wires.length} wires
      </span>
      {import.meta.env.DEV && (
        <span className="status-cell mono" title="Last redraw">
          {view.frameMs.toFixed(1)} ms
        </span>
      )}
      <button
        type="button"
        className="status-cell status-issues"
        title="Design checks — show Messages"
        onClick={onShowMessages}
        data-testid="issue-counts"
      >
        <span className={errors > 0 ? 'issue-count error' : 'issue-count'}>
          <CircleX size={12} /> {errors}
        </span>
        <span className={warnings > 0 ? 'issue-count warning' : 'issue-count'}>
          <TriangleExclamationPoint size={12} /> {warnings}
        </span>
      </button>
    </footer>
  );
}

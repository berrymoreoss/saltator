import { CircleX, TriangleExclamationPoint } from 'lucide-react';
import { type Editor, type Scene, type Selection, zoomPercent } from '../editor';
import { useStore } from './hooks';

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

const HINTS = {
  select: 'Click to select · Shift-click to add · Drag right for inside, left for touching',
  pan: 'Drag to pan · V to select',
} as const;

export function StatusBar({ editor, onShowMessages }: StatusBarProps) {
  const { scene, selection } = useStore(editor.state);
  const view = useStore(editor.view);
  const tool = useStore(editor.tool);
  const errors = scene.issues.filter((i) => i.severity === 'error').length;
  const warnings = scene.issues.length - errors;
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="status-cell mono" title="Cursor position (grid cells)">
        X {view.cursor ? view.cursor[0] : '–'}&nbsp;&nbsp;Y {view.cursor ? view.cursor[1] : '–'}
      </span>
      <span className="status-cell mono" data-testid="zoom" title="Zoom">
        {zoomPercent(view.camera)} %
      </span>
      <span className="status-cell" data-testid="selection-summary">
        {selectionSummary(selection, scene)}
      </span>
      <span className="status-cell status-hint">{HINTS[tool]}</span>
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

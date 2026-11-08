import { ArrowUp, ChevronRight, Star } from 'lucide-react';
import type { Editor } from '../editor';
import { breadcrumbView } from './breadcrumb-view';
import type { CommandRegistry } from './commands';
import { useStore } from './hooks';
import { formatShortcut } from './shortcuts';

/**
 * Where the open circuit is in the design (R11b), over the canvas's top left corner while the
 * document has several circuits: Up, the top circuit, the instances down to the one open (a
 * click goes up to one), the other instances of its circuit to switch to, and what an edit
 * there changes. It floats, so the canvas keeps its size when a circuit is added.
 */
export function Breadcrumbs({
  editor,
  commands,
  mac,
}: {
  readonly editor: Editor;
  readonly commands: CommandRegistry;
  readonly mac: boolean;
}) {
  const state = useStore(editor.state);
  if (state.document.circuits.length < 2) return null;
  const { crumbs, instances, note } = breadcrumbView(state);
  const up = commands.get('circuit.goUp');
  const shortcut = up.shortcuts?.[0];
  return (
    <nav className="breadcrumbs" aria-label="Where in the design" data-testid="breadcrumbs">
      <button
        type="button"
        className="crumb-up"
        aria-label="Go Up"
        title={`Go Up${shortcut ? ` (${formatShortcut(shortcut, mac)})` : ''}`}
        disabled={!state.path}
        onClick={() => editor.goUp()}
        data-testid="go-up"
      >
        <ArrowUp size={12} />
      </button>
      <ol className="crumbs">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          const label = (
            <>
              {i === 0 && <Star size={10} aria-label="top circuit" />}
              {crumb.label}
            </>
          );
          return (
            <li key={crumb.path ?? `#${i}`}>
              {i > 0 && <ChevronRight size={11} className="crumb-separator" aria-hidden />}
              {last || crumb.path === undefined ? (
                <span className="crumb current" aria-current="location">
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  className="crumb"
                  title={i === 0 ? 'Go to the top circuit' : `Go up to ${crumb.path}`}
                  onClick={() => {
                    // Placed nowhere, the top crumb only opens the top; else it goes up to it.
                    if (!editor.goUpTo(crumb.path ?? '')) editor.goTop();
                  }}
                >
                  {label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {instances.length > 1 && (
        <select
          className="crumb-instances"
          aria-label="Instance"
          title="Switch to another instance of this circuit"
          value={state.path}
          onChange={(e) => editor.openInstance(e.target.value)}
          data-testid="instance-select"
        >
          {instances.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </select>
      )}
      {note && <span className="crumb-note">{note}</span>}
    </nav>
  );
}

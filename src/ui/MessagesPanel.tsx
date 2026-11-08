import { CircleCheck, CircleX, TriangleExclamationPoint } from 'lucide-react';
import type { CircuitIssue, DesignIssue } from '../circuit';
import type { Editor } from '../editor';
import { useStore } from './hooks';

/** Where an issue is: `U1.A`, `wire w3`, `(4, 7)`. */
export function issueLocation(issue: DesignIssue): string {
  if (issue.component) return issue.pin ? `${issue.component}.${issue.pin}` : issue.component;
  if (issue.wire) return `wire ${issue.wire}`;
  if (issue.at) return `(${issue.at[0]}, ${issue.at[1]})`;
  return '';
}

/**
 * The design checks of every circuit of the document, errors first (R11a: each with its circuit
 * when there are several). Click opens the circuit, selects the item and brings it into view;
 * double-click zooms to it.
 */
export function MessagesPanel({ editor }: { readonly editor: Editor }) {
  const { design, document } = useStore(editor.state);
  const { issues } = design;
  const names = new Map(document.circuits.map((c) => [c.id, c.name]));
  const several = document.circuits.length > 1;
  const locate = (issue: CircuitIssue, zoom: boolean) => {
    editor.openCircuit(issue.circuit);
    editor.locate(issue, { zoom });
  };
  if (issues.length === 0) {
    return (
      <div className="messages-empty">
        <CircleCheck size={14} /> No problems found by the design checks.
      </div>
    );
  }
  return (
    <ul className="messages" data-testid="messages">
      {issues.map((issue, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: issues have no id; order is stable
        <li key={i}>
          <button
            type="button"
            className={`message ${issue.severity}`}
            onClick={() => locate(issue, false)}
            onDoubleClick={() => locate(issue, true)}
            title="Click to locate, double-click to zoom"
          >
            {issue.severity === 'error' ? (
              <CircleX size={13} className="message-icon" />
            ) : (
              <TriangleExclamationPoint size={13} className="message-icon" />
            )}
            <span className="message-code mono">{issue.code}</span>
            <span className="message-text">{issue.message}</span>
            <span className="message-where mono">
              {several ? `${names.get(issue.circuit)}: ` : ''}
              {issueLocation(issue)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The Messages tab's badges: design-check errors and warnings. */
export function MessagesBadges({ editor }: { readonly editor: Editor }) {
  const { design } = useStore(editor.state);
  const errors = design.issues.filter((i) => i.severity === 'error').length;
  const warnings = design.issues.length - errors;
  return (
    <>
      {errors > 0 && <span className="tab-badge error">{errors}</span>}
      {warnings > 0 && <span className="tab-badge warning">{warnings}</span>}
    </>
  );
}

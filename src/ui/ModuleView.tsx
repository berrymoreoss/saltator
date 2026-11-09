import { CircleAlert, CircleCheck, Copy, FileUp, Play, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import type { HdlMessage } from '../core';
import type { Editor } from '../editor';
import { useStore } from './hooks';
import {
  compileJson,
  type ModuleDrafts,
  messageText,
  moduleCommand,
  moduleSummary,
  placements,
} from './module-view';

/** One line of the view's messages: a converter message, an issue's text, or Compile's success. */
interface Line {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly text: string;
}

const ICONS = { error: CircleAlert, warning: TriangleAlert, ok: CircleCheck } as const;

/**
 * A Verilog module's view (HDL-1), shown in place of the canvas while the module is open: the
 * Yosys command to make its JSON, an editor to paste the JSON into or import its file, Compile
 * (the IR into the document, one undo step), the messages, and what the compiled module has.
 * The editor's text is the session's (`ModuleDrafts`), not the document's.
 */
export function ModuleView({
  editor,
  drafts,
}: {
  readonly editor: Editor;
  readonly drafts: ModuleDrafts;
}) {
  const { circuit, document, design } = useStore(editor.state);
  const id = circuit.id;
  const [text, setText] = useState(() => drafts.text(id));
  const [compiled, setCompiled] = useState(() => drafts.messages(id));
  const [copied, setCopied] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const module = circuit.verilog?.module;
  const command = moduleCommand(circuit);

  const edit = (value: string) => {
    setText(value);
    drafts.setText(id, value);
  };
  const compile = () => {
    const result = compileJson(text);
    drafts.setMessages(id, result.messages);
    setCompiled(result.messages);
    if (result.module) editor.setModule(id, result.module);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  // After a Compile in this session: its messages (and its success); before: the module's issues.
  const lines: Line[] =
    compiled !== undefined
      ? [
          ...compiled.map(
            (m: HdlMessage): Line => ({ severity: m.severity, text: messageText(m) }),
          ),
          ...(compiled.some((m) => m.severity === 'error') || !module
            ? []
            : [
                {
                  severity: 'ok' as const,
                  text: `Compiled ${module.top}: ${module.cells.length} cells`,
                },
              ]),
        ]
      : design.issues
          .filter((issue) => issue.circuit === id && issue.code.startsWith('hdl-'))
          .map((issue) => ({ severity: issue.severity, text: issue.message }));
  const summary = module && moduleSummary(module);
  const placed = placements(document, id);

  return (
    <div className="module-view" data-testid="module-view">
      <div className="module-head">
        <h2 className="module-title">
          {circuit.name} <span className="muted">Verilog module</span>
        </h2>
        <p className="module-step">1. Make its JSON netlist with Yosys on your computer:</p>
        <div className="module-command">
          <code data-testid="yosys-command">{command}</code>
          <button type="button" className="tool-button memory-action" onClick={copy}>
            <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="module-step">2. Paste the JSON below or import its file, then Compile.</p>
      </div>
      <div className="module-body">
        <div className="module-source">
          <div className="module-toolbar">
            <button
              type="button"
              className="tool-button memory-action"
              title="Read a JSON netlist file into the editor"
              onClick={() => file.current?.click()}
            >
              <FileUp size={13} /> Import JSON…
            </button>
            <button
              type="button"
              className="tool-button memory-action"
              title="Turn the JSON into the module (one undo step)"
              onClick={compile}
              data-testid="compile-module"
            >
              <Play size={13} /> Compile
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              data-testid="import-json"
              onChange={(e) => {
                const chosen = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (chosen) void chosen.text().then(edit);
              }}
            />
          </div>
          <textarea
            className="module-json"
            spellCheck={false}
            aria-label="Yosys JSON netlist"
            placeholder={'{ "creator": "Yosys …", "modules": { … } }'}
            value={text}
            onChange={(e) => edit(e.currentTarget.value)}
            data-testid="module-json"
          />
          {lines.length > 0 && (
            <ul className="module-messages" data-testid="module-messages">
              {lines.map((line) => {
                const Icon = ICONS[line.severity];
                return (
                  <li
                    key={`${line.severity} ${line.text}`}
                    className={`module-message ${line.severity}`}
                  >
                    <Icon size={12} aria-label={line.severity} />
                    <span>{line.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <aside className="module-summary" data-testid="module-summary">
          {summary ? (
            <>
              <h3>Module {summary.top}</h3>
              <p className="muted">{summary.creator}</p>
              <h3>Ports</h3>
              <table className="module-table">
                <tbody>
                  {summary.ports.map((port) => (
                    <tr key={port.name}>
                      <td className="module-cell mono">{port.name}</td>
                      <td className="module-cell muted">
                        {port.dir === 'in' ? 'input' : 'output'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Cells ({summary.cellCount})</h3>
              <table className="module-table">
                <tbody>
                  {summary.cells.map(([type, count]) => (
                    <tr key={type}>
                      <td className="module-cell mono">{type}</td>
                      <td className="module-cell muted">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Placed</h3>
              <p className="muted">{placed || 'Nowhere yet: place it from Parts ▸ Subcircuits'}</p>
            </>
          ) : (
            <p className="muted">Not compiled yet.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

import { ExternalLink } from 'lucide-react';
import type { TextRun } from '../core';
import type { CanvasTheme, Editor, GateStyle } from '../editor';
import { useStoreValue } from './hooks';
import { PartPreview } from './PartPreview';
import {
  columnRuns,
  datasheetName,
  type FunctionTableInfo,
  functionTableInfo,
  type NameView,
  outputsHeading,
  type PartPick,
  pinInfo,
  type TimingInfo,
  type TimingRow,
  timingInfo,
} from './part-info';

interface PartInfoPanelProps {
  readonly editor: Editor;
  /** The last part picked on the canvas or in the Parts panel. */
  readonly pick: PartPick | undefined;
  readonly theme: CanvasTheme;
  readonly gateStyle: GateStyle;
}

/**
 * The Part tab of the bottom dock: what a learner needs while wiring a chip — its drawing, every
 * pin with its datasheet description, the datasheet function table, its timing (delays and the
 * set-up, hold, pulse-width and recovery minima the timing checks use) and a link to the
 * datasheet.
 * Spec: docs/editor.md#part-info.
 */
export function PartInfoPanel({ editor, pick, theme, gateStyle }: PartInfoPanelProps) {
  const instance = useStoreValue(editor.state, (state) =>
    pick?.id === undefined
      ? undefined
      : state.circuit.components.find((c) => c.id === pick.id && c.type === pick.type),
  );
  const definition = pick ? editor.registry.get(pick.type) : undefined;
  if (!pick || !definition) {
    return (
      <div className="empty-note">
        Select a part on the canvas or in the Parts panel to see its pins and function table.
      </div>
    );
  }
  const pins = pinInfo(definition, instance?.props);
  const table = functionTableInfo(definition.functionTable);
  const timing = timingInfo(definition, instance?.props);
  const numbered = pins.some((pin) => pin.number !== undefined);
  const described = pins.some((pin) => pin.description !== undefined);

  return (
    <div className="part-sheet" data-testid="part-sheet">
      <div className="part-sheet-drawing">
        <PartPreview
          type={definition.type}
          registry={editor.registry}
          theme={theme}
          gateStyle={gateStyle}
          {...(instance && { props: instance.props })}
        />
      </div>
      <div className="part-sheet-main">
        <div className="part-sheet-header">
          {instance && <span className="part-sheet-id">{instance.id}</span>}
          <span className="part-info-name">{definition.name}</span>
          <span>{definition.title}</span>
          <span className="mono muted">{definition.type}</span>
          {definition.datasheet && (
            <a className="link" href={definition.datasheet} target="_blank" rel="noreferrer">
              Datasheet {datasheetName(definition.datasheet)} <ExternalLink size={11} />
            </a>
          )}
        </div>
        <div className="part-sheet-tables">
          <div className="part-sheet-scroll">
            <table className="sheet-table" aria-label="Pins">
              <thead>
                <tr>
                  {numbered && <th className="num">No.</th>}
                  <th>Name</th>
                  <th>Type</th>
                  {described && <th>Description</th>}
                </tr>
              </thead>
              <tbody>
                {pins.map((pin, i) => (
                  <tr key={pin.number ?? i}>
                    {numbered && <td className="num">{pin.number}</td>}
                    <td className="mono">
                      <Runs runs={pin.runs} />
                      {pin.id && <span className="muted"> ({pin.id})</span>}
                    </td>
                    <td className="muted">{pin.type}</td>
                    {described && <td>{pin.description}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="part-sheet-scroll">
            {table ? (
              <FunctionTableView
                table={table}
                columns={columnRuns(definition)}
                outputs={outputsHeading(definition)}
              />
            ) : (
              <div className="empty-note">No function table for this part.</div>
            )}
            {timing && <TimingView timing={timing} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A text with overlines, as runs (`pinTextRuns`). */
function Runs({ runs }: { readonly runs: readonly TextRun[] }) {
  return runs.map((run, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
    <span key={i} className={run.overline ? 'overline' : undefined}>
      {run.text}
    </span>
  ));
}

function FunctionTableView({
  table,
  columns,
  outputs,
}: {
  readonly table: FunctionTableInfo;
  /** Columns that name a pin, drawn as the pin is (its label, its overlines). */
  readonly columns: ReadonlyMap<string, readonly TextRun[]>;
  /** Heading of the output columns. */
  readonly outputs: string;
}) {
  const column = (name: string, first: boolean) => {
    const runs = columns.get(name);
    return (
      <th key={name} className={first ? 'outputs-start' : undefined}>
        {runs ? <Runs runs={runs} /> : name}
      </th>
    );
  };
  return (
    <table className="sheet-table function-table" aria-label="Function table">
      <caption>Function table{table.note && ` — ${table.note}`}</caption>
      <thead>
        <tr>
          <th colSpan={table.inputs.length}>Inputs</th>
          <th colSpan={table.outputs.length} className="outputs-start">
            {outputs}
          </th>
        </tr>
        <tr>
          {table.inputs.map((name) => column(name, false))}
          {table.outputs.map((name, i) => column(name, i === 0))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are static datasheet data
          <tr key={r}>
            {row.inputs.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
              <td key={i}>{cell}</td>
            ))}
            {row.outputs.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
              <td key={`o${i}`} className={i === 0 ? 'outputs-start' : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={table.inputs.length + table.outputs.length} className="legend">
            H = HIGH, L = LOW, X = don’t care, Z = high impedance
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** A timing key's path: pin names as drawn (with their overlines), words as text. */
function Path({ path }: { readonly path: TimingRow['path'] }) {
  return path.map((part, i) =>
    typeof part === 'string' ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
      <span key={i}>{part}</span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
      <Runs key={i} runs={(part as NameView).runs} />
    ),
  );
}

function TimingView({ timing }: { readonly timing: TimingInfo }) {
  const rows = (list: readonly TimingRow[], limit: 'max' | 'min') =>
    list.map((row, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: rows are static datasheet data
      <tr key={`${limit}${i}`}>
        <td className="mono">
          t<sub>{row.symbol.slice(1)}</sub>
        </td>
        <td className="mono">
          <Path path={row.path} />
        </td>
        <td className="num">{row.typical}</td>
        <td className="num">{row.max ?? ''}</td>
        <td className="num">{row.min ?? ''}</td>
      </tr>
    ));
  return (
    <table className="sheet-table timing-table" aria-label="Timing">
      <caption>Timing{timing.conditions && ` — ${timing.conditions}`}</caption>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Path</th>
          <th className="num">Typ</th>
          <th className="num">Max</th>
          <th className="num">Min</th>
        </tr>
      </thead>
      <tbody>
        {rows(timing.delays, 'max')}
        {rows(timing.requirements, 'min')}
      </tbody>
      {timing.source && (
        <tfoot>
          <tr>
            <td colSpan={5} className="legend">
              {timing.requirements.length > 0 &&
                'Min: the guaranteed minimum the timing checks hold the circuit to. '}
              Source: {timing.source}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

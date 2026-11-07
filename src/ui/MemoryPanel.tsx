import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { parseAddress } from '../circuit';
import type { Editor, MemoryEntry } from '../editor';
import { useStore } from './hooks';
import {
  addressDigits,
  bytesPerRow,
  cellChar,
  cellDigits,
  cellText,
  type HexCursor,
  hexKey,
  ROW_HEIGHT,
  rowAddress,
  scrollToRow,
} from './memory-view';

interface MemoryPanelProps {
  readonly editor: Editor;
  /** The memory picked last (canvas selection, Inspect Memory, the picker). */
  readonly pick: string | undefined;
  readonly onPick: (id: string) => void;
  readonly follow: boolean;
  readonly onFollow: (follow: boolean) => void;
  /** Buttons after the picker (Load, Save, Erase). */
  readonly actions?: (entry: MemoryEntry) => ReactNode;
}

/**
 * The Memory tab of the bottom dock: a hex view of one memory of the circuit — live while
 * simulating, with the cells just read (green) and written (orange) lit and the address on the
 * chip's pins outlined and followed — whose bytes are edited in place. Spec:
 * docs/editor.md#memory-tab.
 */
export function MemoryPanel({ editor, pick, onPick, follow, onFollow, actions }: MemoryPanelProps) {
  useStore(editor.state);
  const memories = editor.memory.memories();
  const entry = memories.find((m) => m.id === pick) ?? memories[0];
  if (!entry) {
    return (
      <div className="empty-note" data-testid="memory-panel">
        This circuit has no memories: place an EEPROM or a RAM to see its cells here.
      </div>
    );
  }
  return (
    <MemoryView
      key={entry.id}
      editor={editor}
      entry={entry}
      memories={memories}
      onPick={onPick}
      follow={follow}
      onFollow={onFollow}
      actions={actions}
    />
  );
}

interface MemoryViewProps extends Omit<MemoryPanelProps, 'pick'> {
  readonly entry: MemoryEntry;
  readonly memories: readonly MemoryEntry[];
}

/** Rows drawn above and below the visible ones, so fast scrolling shows no gaps. */
const OVERSCAN = 4;

function MemoryView({
  editor,
  entry,
  memories,
  onPick,
  follow,
  onFollow,
  actions,
}: MemoryViewProps) {
  const inspector = editor.memory;
  const status = useStore(editor.simulation.status);
  useStore(editor.simulation.revision);
  const [, setFade] = useState(0);
  const [cursor, setCursor] = useState<HexCursor>({ address: 0, typed: '' });
  const [notice, setNotice] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ width: 600, height: 120 });
  const [charWidth, setCharWidth] = useState(7.2);
  const [goTo, setGoTo] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const goToInput = useRef<HTMLInputElement>(null);
  /** The scroll position set by Follow, whose scroll event isn't the user's. */
  const followScroll = useRef<number | undefined>(undefined);

  const cells = inspector.cells(entry.id);
  const live = cells.kind === 'live';
  const address = inspector.address(entry.id);
  const { words, width } = entry;
  const digits = addressDigits(words);
  const perRow = bytesPerRow(box.width - 16, charWidth, digits, cellDigits(width));
  const rows = Math.ceil(words / perRow);
  const visibleRows = Math.max(1, Math.floor(box.height / ROW_HEIGHT));
  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);

  const hasGrid = cells.kind !== 'none';
  useLayoutEffect(() => {
    const element = grid.current;
    if (!hasGrid || !element) return;
    const observer = new ResizeObserver(() => {
      setBox({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    if (measure.current) setCharWidth(measure.current.getBoundingClientRect().width / 10 || 7.2);
    return () => observer.disconnect();
  }, [hasGrid]);

  // Keep fading highlights moving when no simulator frame redraws the panel.
  useEffect(() => {
    if (!inspector.fading) return;
    const frame = requestAnimationFrame(() => setFade((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  });

  const scrollTo = (row: number) => {
    const element = grid.current;
    if (!element) return;
    const top = scrollToRow(row, firstVisible, visibleRows);
    if (top === undefined) return;
    element.scrollTop = top * ROW_HEIGHT;
    setScrollTop(element.scrollTop);
    return element.scrollTop;
  };

  // Follow: keep the address on the chip's pins in view.
  const followed = follow && live ? address?.value : undefined;
  useLayoutEffect(() => {
    if (followed === undefined) return;
    const top = scrollTo(Math.floor(followed / perRow));
    if (top !== undefined) followScroll.current = top;
  });

  const write = (at: number, value: number) => {
    const problem = inspector.write(entry.id, at, [value]);
    setNotice(problem ?? '');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      goToInput.current?.focus();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const result = hexKey(cursor, event.key, {
      words,
      width,
      perRow,
      pageRows: Math.max(1, visibleRows - 1),
    });
    if (!result.handled) return;
    event.preventDefault();
    setCursor(result.cursor);
    if (result.write) write(result.write.address, result.write.value);
    scrollTo(Math.floor(result.cursor.address / perRow));
  };

  const jump = (event: FormEvent) => {
    event.preventDefault();
    const target = parseAddress(goTo, words);
    if (typeof target === 'string') {
      setNotice(target);
      return;
    }
    setNotice('');
    setCursor({ address: target, typed: '' });
    onFollow(false);
    const row = Math.floor(target / perRow);
    const element = grid.current;
    if (element) {
      element.scrollTop = Math.max(0, row - Math.floor(visibleRows / 2)) * ROW_HEIGHT;
      setScrollTop(element.scrollTop);
      element.focus();
    }
  };

  const onScroll = () => {
    const element = grid.current;
    if (!element) return;
    const top = element.scrollTop;
    const ours = followScroll.current;
    followScroll.current = undefined;
    if (follow && (ours === undefined || Math.abs(top - ours) > 1)) onFollow(false);
    setScrollTop(top);
  };

  const data =
    cells.kind === 'live' ? cells.view.data : cells.kind === 'image' ? cells.data : undefined;
  const unknown = cells.kind === 'live' ? cells.view.unknown : undefined;
  const erasedDim = !entry.volatile;
  const first = Math.max(0, firstVisible - OVERSCAN);
  const last = Math.min(rows, firstVisible + visibleRows + OVERSCAN + 1);
  const rowElements: ReactNode[] = [];
  if (data) {
    for (let row = first; row < last; row++) {
      const base = row * perRow;
      const cellElements: ReactNode[] = [];
      let ascii = '';
      for (let i = 0; i < perRow && base + i < words; i++) {
        const a = base + i;
        const value = data[a]!;
        const x = unknown?.[a] ?? 0;
        const typing = cursor.address === a && cursor.typed !== '';
        const text = typing
          ? cursor.typed.padEnd(cellDigits(width), '_')
          : cellText(value, x, width);
        let className = 'memory-cell';
        if (i > 0 && i % 8 === 0) className += ' group';
        if (x !== 0) className += ' unknown';
        else if (erasedDim && value === 0xff) className += ' erased';
        if (address?.value === a && live) className += ' current';
        if (cursor.address === a) className += ' cursor';
        let style: CSSProperties | undefined;
        if (cells.kind === 'live') {
          const written = inspector.intensity(cells.view.writtenAt[a]!);
          const read = inspector.intensity(cells.view.readAt[a]!);
          if (written > 0) {
            style = {
              background: `color-mix(in srgb, var(--warning) ${Math.round(written * 45)}%, transparent)`,
            };
          } else if (read > 0) {
            style = {
              background: `color-mix(in srgb, var(--level-1) ${Math.round(read * 40)}%, transparent)`,
            };
          }
        }
        cellElements.push(
          <span key={a} className={className} style={style} data-address={a}>
            {text}
          </span>,
        );
        ascii += cellChar(value, x);
      }
      rowElements.push(
        <div
          key={row}
          className="memory-row"
          style={{ transform: `translateY(${row * ROW_HEIGHT}px)` }}
          data-row={rowAddress(base, digits)}
        >
          <span className="memory-row-address">{rowAddress(base, digits)}</span>
          {cellElements}
          <span className="memory-ascii">{ascii}</span>
        </div>,
      );
    }
  }

  return (
    <div className="memory" data-testid="memory-panel">
      <div className="memory-toolbar">
        <select
          className="toolbar-select memory-picker"
          aria-label="Memory"
          value={entry.id}
          onChange={(event) => onPick(event.target.value)}
        >
          {memories.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="memory-now mono" data-testid="memory-address">
          {address ? `Address ${address.text}` : ''}
        </span>
        <label className="memory-follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => onFollow(event.target.checked)}
          />
          Follow
        </label>
        <form className="memory-goto" onSubmit={jump}>
          <input
            ref={goToInput}
            className="prop-input mono"
            aria-label="Go to address"
            placeholder="Go to"
            value={goTo}
            onChange={(event) => setGoTo(event.target.value)}
          />
        </form>
        <span className="memory-actions">{actions?.(entry)}</span>
      </div>
      {notice !== '' && (
        <div className="field-error memory-notice" role="status">
          {notice}
        </div>
      )}
      {cells.kind === 'none' ? (
        <div className="empty-note" data-testid="memory-none">
          {cells.reason}
        </div>
      ) : (
        <div
          ref={grid}
          className="memory-grid mono"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the hex view takes keys to edit cells
          tabIndex={0}
          role="application"
          aria-label={`Cells of ${entry.id}`}
          data-state={status.state}
          onKeyDown={onKeyDown}
          onMouseDown={(event) => {
            const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-address]');
            if (!cell) return;
            event.preventDefault();
            setCursor({ address: Number(cell.dataset.address), typed: '' });
            grid.current?.focus();
          }}
          onScroll={onScroll}
          onWheel={() => {
            if (follow) onFollow(false);
          }}
        >
          <span ref={measure} className="memory-measure" aria-hidden>
            0000000000
          </span>
          <div className="memory-rows" style={{ height: rows * ROW_HEIGHT }}>
            {rowElements}
          </div>
        </div>
      )}
    </div>
  );
}

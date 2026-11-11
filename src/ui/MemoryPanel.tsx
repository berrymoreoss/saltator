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
import { bytesPerWord, cellsReference, type Editor, type MemoryEntry } from '../editor';
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
 * chip's pins outlined and followed — whose bytes are edited in place. A module memory's wider
 * words (HDL-6) show as words or, switched, as their bytes little-endian. Spec:
 * docs/editor.md#memory-tab.
 */
export function MemoryPanel({ editor, pick, onPick, follow, onFollow, actions }: MemoryPanelProps) {
  useStore(editor.state);
  // The memories shown as bytes rather than words, by reference.
  const [asBytes, setAsBytes] = useState<ReadonlySet<string>>(new Set());
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
      key={`${entry.id}${asBytes.has(entry.id) ? ' bytes' : ''}`}
      editor={editor}
      entry={entry}
      memories={memories}
      onPick={onPick}
      follow={follow}
      onFollow={onFollow}
      actions={actions}
      bytes={entry.width > 8 && asBytes.has(entry.id)}
      onBytes={(bytes) =>
        setAsBytes((set) => {
          const next = new Set(set);
          if (bytes) next.add(entry.id);
          else next.delete(entry.id);
          return next;
        })
      }
    />
  );
}

interface MemoryViewProps extends Omit<MemoryPanelProps, 'pick'> {
  readonly entry: MemoryEntry;
  readonly memories: readonly MemoryEntry[];
  /** A wider memory's cells as bytes, little-endian, at byte addresses (HDL-6). */
  readonly bytes: boolean;
  readonly onBytes: (bytes: boolean) => void;
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
  bytes,
  onBytes,
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
  // The cells shown: words (their index from 0, their address from the memory's first one), or
  // a wider memory's bytes little-endian at byte addresses (HDL-6).
  const per = bytes ? bytesPerWord(entry.width) : 1;
  const words = entry.words * per;
  const width = bytes ? 8 : entry.width;
  const first = entry.offset * per;
  const wordOf = (cell: number) => Math.floor(cell / per);
  const digits = addressDigits(first + words);
  const perRow = bytesPerRow(box.width - 16, charWidth, digits, cellDigits(width), width <= 8);
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
    const problem = bytes
      ? inspector.writeByte(entry.id, wordOf(at), at % per, value)
      : inspector.write(entry.id, at, [value]);
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
    const parsed = parseAddress(goTo, words, first);
    if (typeof parsed === 'string') {
      setNotice(parsed);
      return;
    }
    const target = parsed - first;
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

  // The word at the cursor (in the Bytes view, the word holding its byte), at its address.
  const word = entry.offset + wordOf(cursor.address);
  const watched = cellsReference(entry.id, word, word);

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
    cells.kind === 'live'
      ? cells.view.data
      : cells.kind === 'image' || cells.kind === 'power-up'
        ? cells.data
        : undefined;
  const unknown =
    cells.kind === 'live'
      ? cells.view.unknown
      : cells.kind === 'power-up'
        ? cells.unknown
        : undefined;
  /** A shown cell's value and unknown bits: a word, or a byte of one. */
  const cellAt = (a: number): [number, number] => {
    const w = wordOf(a);
    const value = data![w]!;
    const x = unknown?.[w] ?? 0;
    if (per === 1) return [value, x];
    const shift = 8 * (a % per);
    return [(value >>> shift) & 0xff, (x >>> shift) & 0xff];
  };
  const erasedDim = !entry.volatile;
  const firstRow = Math.max(0, firstVisible - OVERSCAN);
  const lastRow = Math.min(rows, firstVisible + visibleRows + OVERSCAN + 1);
  const rowElements: ReactNode[] = [];
  if (data) {
    for (let row = firstRow; row < lastRow; row++) {
      const base = row * perRow;
      const cellElements: ReactNode[] = [];
      let ascii = '';
      for (let i = 0; i < perRow && base + i < words; i++) {
        const a = base + i;
        const [value, x] = cellAt(a);
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
          const written = inspector.intensity(cells.view.writtenAt[wordOf(a)]!);
          const read = inspector.intensity(cells.view.readAt[wordOf(a)]!);
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
          data-row={rowAddress(first + base, digits)}
        >
          <span className="memory-row-address">{rowAddress(first + base, digits)}</span>
          {cellElements}
          {width <= 8 && <span className="memory-ascii">{ascii}</span>}
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
        {entry.width > 8 && (
          <select
            className="toolbar-select"
            aria-label="Cells as"
            title="Show the words, or their bytes little-endian at byte addresses (as a CPU sees them)"
            value={bytes ? 'bytes' : 'words'}
            onChange={(event) => onBytes(event.target.value === 'bytes')}
          >
            <option value="words">Words</option>
            <option value="bytes">Bytes</option>
          </select>
        )}
        <button
          type="button"
          className="tool-button memory-action"
          title="Watch the cell at the cursor in the Debug tab"
          onClick={() => setNotice(editor.debug.addWatch(watched) ?? '')}
        >
          Watch {watched}
        </button>
        <span className="memory-actions">{actions?.(entry)}</span>
      </div>
      {notice !== '' && (
        <div className="field-error memory-notice" role="status">
          {notice}
        </div>
      )}
      {cells.kind === 'power-up' && (
        <div className="memory-note muted" data-testid="memory-power-up">
          Power-up contents (initial, $readmemh): Step (F10) to run and edit them.
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

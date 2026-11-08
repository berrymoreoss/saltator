/**
 * Extracts the HD44780U character generator ROMs (A00, A02) from Table 4 of the Hitachi data
 * sheet (ADE-207-272(Z), Rev. 0.0, pages 17 and 18). The table is vector art: render each page
 * to a grayscale PGM and this script reads the dots off the grid.
 *
 *   pdftoppm -f 17 -l 18 -r 400 -gray hd44780u.pdf page   # page-17.pgm (A00), page-18.pgm (A02)
 *   node scripts/extract-hd44780-font.ts page-17.pgm page-18.pgm > src/library/periph/hd44780-font.ts
 *   pnpm lint:fix
 *
 * How: the table's vertical lines give the 16 code columns (upper 4 bits); its horizontal
 * lines the 16 rows (lower 4 bits). Each dot is a filled square; their centers, measured from
 * the cell's corner, fall on a lattice with one pitch, whose origin is the smallest offset any
 * dot of the table has (some glyph uses the top row and the left column). A column whose cells
 * span the whole row height holds 5 × 10 patterns (A00's 0xE0–0xFF), the others 5 × 8. The
 * script fails loudly when a dot is off the lattice or outside the pattern.
 */
import { readFileSync } from 'node:fs';

interface Gray {
  readonly width: number;
  readonly height: number;
  readonly dark: Uint8Array;
}

/** A binary PGM (P5, 8-bit) as dark (1) / light (0) pixels. */
function readPgm(path: string): Gray {
  const bytes = readFileSync(path);
  const fields: string[] = [];
  let at = 0;
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(bytes[at] ?? 0x20))) at++;
    if (bytes[at] === 0x23) {
      while (bytes[at] !== 0x0a) at++;
      continue;
    }
    let field = '';
    while (at < bytes.length && !/\s/.test(String.fromCharCode(bytes[at]!))) {
      field += String.fromCharCode(bytes[at]!);
      at++;
    }
    fields.push(field);
  }
  at++; // the single whitespace after maxval
  const [magic, w, h, max] = fields;
  if (magic !== 'P5' || max !== '255') throw new Error(`${path}: not an 8-bit binary PGM`);
  const width = Number(w);
  const height = Number(h);
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < dark.length; i++) dark[i] = bytes[at + i]! < 128 ? 1 : 0;
  return { width, height, dark };
}

/** Centers of the runs of indices whose count exceeds `threshold`. */
function lineCenters(counts: Int32Array, threshold: number): number[] {
  const centers: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    if (counts[i]! <= threshold) continue;
    const start = i;
    while (i + 1 < counts.length && counts[i + 1]! > threshold) i++;
    centers.push((start + i) / 2);
  }
  return centers;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

interface Grid {
  /** 17 x positions: the left edge of code column 0 … the right edge of column 15. */
  readonly columns: readonly number[];
  /** Top of glyph row 0 and the row pitch. */
  readonly top: number;
  readonly rowPitch: number;
}

function findGrid(img: Gray): Grid {
  const { width, height, dark } = img;
  const perRow = new Int32Array(height);
  const perColumn = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (dark[y * width + x]) {
        perRow[y]!++;
        perColumn[x]!++;
      }
    }
  }
  // Table lines run (nearly) the whole table; glyph dots and text never come close.
  const vertical = lineCenters(perColumn, 0.75 * Math.max(...perColumn));
  const horizontal = lineCenters(perRow, 0.9 * Math.max(...perRow));
  if (vertical.length !== 18) {
    throw new Error(`expected 18 vertical table lines, found ${vertical.length}: ${vertical}`);
  }
  const gaps = horizontal.slice(1).map((y, i) => y - horizontal[i]!);
  const rowPitch = median(gaps.filter((gap) => gap > 100));
  const bottom = horizontal.at(-1)!;
  return { columns: vertical.slice(1), top: bottom - 16 * rowPitch, rowPitch };
}

interface Dot {
  readonly x: number;
  readonly y: number;
}

/** Filled squares (connected dark pixels of dot size) inside a rectangle. */
function dotsIn(img: Gray, x0: number, y0: number, x1: number, y1: number): Dot[] {
  const { width, dark } = img;
  const seen = new Uint8Array((x1 - x0) * (y1 - y0));
  const dots: Dot[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const local = (y - y0) * (x1 - x0) + (x - x0);
      if (!dark[y * width + x] || seen[local]) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      const stack = [x, y];
      seen[local] = 1;
      while (stack.length > 0) {
        const py = stack.pop()!;
        const px = stack.pop()!;
        count++;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        for (const [nx, ny] of [
          [px + 1, py],
          [px - 1, py],
          [px, py + 1],
          [px, py - 1],
        ] as const) {
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const n = (ny - y0) * (x1 - x0) + (nx - x0);
          if (!dark[ny * width + nx] || seen[n]) continue;
          seen[n] = 1;
          stack.push(nx, ny);
        }
      }
      // Keep only filled squares: a dot, not a piece of a table line or of text.
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (w <= 40 && h <= 40 && w >= 6 && h >= 6 && count >= 0.7 * w * h) {
        dots.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
      }
    }
  }
  return dots;
}

const MARGIN = 3; // pixels kept clear of the table lines (they are 2–4 px thick at 400 dpi)

interface Cell {
  readonly code: number;
  readonly tall: boolean;
  readonly dots: readonly Dot[];
}

/**
 * Whether column `c`'s cells hold 5 × 10 patterns: no horizontal line closes them at the
 * height of a 5 × 8 cell (the line other columns have at 4/5 of the row).
 */
function isTallColumn(img: Gray, grid: Grid, c: number): boolean {
  const { width, dark } = img;
  const x0 = Math.ceil(grid.columns[c]! + MARGIN);
  const x1 = Math.floor(grid.columns[c + 1]! - MARGIN);
  for (let row = 0; row < 16; row++) {
    const top = grid.top + row * grid.rowPitch;
    for (let y = Math.round(top + 0.7 * grid.rowPitch); y < top + 0.9 * grid.rowPitch; y++) {
      let run = 0;
      for (let x = x0; x < x1; x++) run += dark[y * width + x]!;
      if (run > 0.9 * (x1 - x0)) return false;
    }
  }
  return true;
}

function cellsOf(img: Gray, grid: Grid): Cell[] {
  const cells: Cell[] = [];
  for (let c = 1; c < 16; c++) {
    // Column 0 is CGRAM: no ROM patterns.
    const tall = isTallColumn(img, grid, c);
    const x0 = Math.ceil(grid.columns[c]! + MARGIN);
    const x1 = Math.floor(grid.columns[c + 1]! - MARGIN);
    for (let row = 0; row < 16; row++) {
      const top = grid.top + row * grid.rowPitch;
      const bottom = top + (tall ? 1 : 0.8) * grid.rowPitch;
      const y0 = Math.ceil(top + MARGIN);
      const y1 = Math.floor(bottom - MARGIN);
      const dots = dotsIn(img, x0, y0, x1, y1).map((d) => ({ x: d.x - x0, y: d.y - y0 }));
      cells.push({ code: c * 16 + row, tall, dots });
    }
  }
  return cells;
}

/** Pitch of the dot lattice: the most common distance between horizontal neighbors. */
function dotPitch(cells: readonly Cell[]): number {
  const distances: number[] = [];
  for (const { dots } of cells) {
    for (const a of dots) {
      let best = Infinity;
      for (const b of dots) {
        if (b !== a && Math.abs(b.y - a.y) < 3 && b.x > a.x) best = Math.min(best, b.x - a.x);
      }
      if (best < Infinity) distances.push(best);
    }
  }
  return median(distances);
}

/** The pattern rows (5 bits each, bit 4 = leftmost dot) of every cell, by code. */
function patterns(img: Gray, name: string): Map<number, number[]> {
  const grid = findGrid(img);
  const cells = cellsOf(img, grid);
  const pitch = dotPitch(cells);
  const result = new Map<number, number[]>();
  for (const tall of [false, true]) {
    const group = cells.filter((cell) => cell.tall === tall);
    const all = group.flatMap((cell) => cell.dots);
    if (all.length === 0) continue;
    // Rows line up across the table; columns don't (A00's columns A and B sit a third of a
    // pitch to the right), so each column's lattice starts at its own leftmost dot.
    const originY = Math.min(...all.map((d) => d.y));
    const originsX = new Map<number, number>();
    for (const { code, dots } of group) {
      const column = code >> 4;
      originsX.set(column, Math.min(originsX.get(column) ?? Infinity, ...dots.map((d) => d.x)));
    }
    const height = tall ? 11 : 8;
    for (const { code, dots } of group) {
      const originX = originsX.get(code >> 4)!;
      const rows = new Array<number>(height).fill(0);
      for (const dot of dots) {
        const fx = (dot.x - originX) / pitch;
        const fy = (dot.y - originY) / pitch;
        const column = Math.round(fx);
        const row = Math.round(fy);
        const where = `${name} 0x${code.toString(16).toUpperCase()}`;
        if (Math.abs(fx - column) > 0.25 || Math.abs(fy - row) > 0.25) {
          throw new Error(`${where}: dot off the lattice (${fx.toFixed(2)}, ${fy.toFixed(2)})`);
        }
        if (column < 0 || column > 4 || row < 0 || row >= height) {
          throw new Error(`${where}: dot outside the pattern (column ${column}, row ${row})`);
        }
        rows[row]! |= 1 << (4 - column);
      }
      result.set(code, rows);
    }
  }
  return result;
}

const hex = (rows: readonly number[]) =>
  rows.map((r) => r.toString(16).toUpperCase().padStart(2, '0')).join('');

function romSource(name: string, rows: Map<number, number[]>): string {
  const lines = [`export const HD44780_${name}: readonly string[] = [`];
  for (let code = 0; code < 256; code++) {
    const pattern = rows.get(code);
    lines.push(`  '${pattern ? hex(pattern) : ''}', // 0x${code.toString(16).toUpperCase()}`);
  }
  lines.push('];');
  return lines.join('\n');
}

const [a00, a02] = process.argv.slice(2);
if (!a00 || !a02) {
  throw new Error('usage: node scripts/extract-hd44780-font.ts <page-17.pgm> <page-18.pgm>');
}
const header = `/**
 * Character generator ROMs of the HD44780U: ROM code A00 (Japanese standard) and A02 (European
 * standard), from Table 4 of the Hitachi data sheet (ADE-207-272(Z), Rev. 0.0, pages 17–18).
 * Generated by scripts/extract-hd44780-font.ts — do not edit.
 *
 * Per character code, its pattern rows top first as two hex digits each (5 bits, bit 4 = the
 * leftmost dot): 8 rows for 5 × 8 patterns, 11 for 5 × 10 ones (A00's 0xE0–0xFF); empty for
 * the CGRAM codes 0x00–0x0F.
 */`;
process.stdout.write(
  `${header}\n\n${romSource('A00', patterns(readPgm(a00), 'A00'))}\n\n${romSource('A02', patterns(readPgm(a02), 'A02'))}\n`,
);

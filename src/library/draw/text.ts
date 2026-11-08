import { defineComponent } from '../../core';

/** Font sizes of a text, in cells, by its `size` prop. */
export const TEXT_SIZES = { small: 0.5, normal: 0.7, large: 1, title: 1.5 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** A text's typeface: the UI's sans-serif, or monospaced for listings and tables. */
export type TextFont = 'sans' | 'mono';

/** Distance between the baselines of two lines, in font sizes. */
export const TEXT_LINE_HEIGHT = 1.25;

/**
 * Room between the box's left and right edges and the text, in cells. Lines need none above and
 * below: a line is taller than its letters.
 */
export const TEXT_PADDING = 0.2;

/** Columns a tab stops at, as an assembler listing expects. */
const TAB_WIDTH = 4;

/** Width of one character of the monospaced font, in font sizes (SF Mono, Menlo: 0.6 em). */
const MONO_WIDTH = 0.6;

/**
 * Widths of the sans-serif font's characters, in font sizes, by class — rounded up from the
 * system UI fonts (SF Pro, Segoe UI, Roboto), so the box errs wide. The pure layers have no font
 * metrics (ADR-0029); the drawer starts at the box's top-left, so a short guess never clips.
 */
const SANS_WIDTHS: readonly (readonly [RegExp, number])[] = [
  [/[il|!.,:;'`]/, 0.3],
  [/[ Ijft()[\]{}"/\\-]/, 0.4],
  [/[r]/, 0.42],
  [/[mw]/, 0.9],
  [/[MW@%]/, 1],
  [/[a-z]/, 0.58],
  [/[A-Z]/, 0.72],
  [/[0-9]/, 0.62],
];

/** Any other character: symbols, letters of other scripts. */
const SANS_DEFAULT = 0.7;

function sansWidth(char: string): number {
  for (const [chars, width] of SANS_WIDTHS) if (chars.test(char)) return width;
  return SANS_DEFAULT;
}

/** A line with its tabs expanded to the next multiple of four columns. */
function expandTabs(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const char of line) {
    out += char === '\t' ? ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH)) : char;
  }
  return out;
}

/** The lines of a text as drawn: split at line breaks (`\n`, `\r\n`), tabs expanded. */
export function textLines(text: string): string[] {
  return text.split(/\r?\n/).map(expandTabs);
}

/** Estimated width of a drawn line, in font sizes. */
export function lineWidth(line: string, font: TextFont): number {
  if (font === 'mono') return [...line].length * MONO_WIDTH;
  let width = 0;
  for (const char of line) width += sansWidth(char);
  return width;
}

/**
 * The box of a text in whole cells (at least 1 × 1): its lines at `TEXT_LINE_HEIGHT` and its
 * widest line with `TEXT_PADDING` on either side.
 */
export function textBlockSize(
  text: string,
  size: TextSize,
  font: TextFont,
): { width: number; height: number } {
  const em = TEXT_SIZES[size];
  const lines = textLines(text);
  const widest = Math.max(0, ...lines.map((line) => lineWidth(line, font)));
  // A hair over a whole cell stays in it: floating-point sums shouldn't add a cell.
  const cells = (length: number) => Math.max(1, Math.ceil(length - 1e-9));
  return {
    width: cells(widest * em + 2 * TEXT_PADDING),
    height: cells(lines.length * TEXT_LINE_HEIGHT * em),
  };
}

/**
 * Text: a block of free text on the schematic — a title, a description, a program listing.
 * Schematic-only and without pins: drawn, moved, copied and saved like any part, never
 * simulated (ADR-0029). Spec: docs/components.md#graphics-draw.
 */
export const schematicText = defineComponent<
  { text: string; size: TextSize; font: TextFont },
  undefined
>({
  type: 'draw/text',
  name: 'TEXT',
  title: 'Text (a note on the schematic, never simulated)',
  keywords: ['text', 'note', 'comment', 'annotation', 'title', 'description', 'listing'],
  designatorPrefix: 'TXT',
  schematicOnly: true,
  props: [
    { key: 'text', label: 'Text', type: 'string', default: 'Text', multiline: true },
    {
      key: 'size',
      label: 'Size',
      type: 'enum',
      default: 'normal',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'normal', label: 'Normal' },
        { value: 'large', label: 'Large' },
        { value: 'title', label: 'Title' },
      ],
    },
    {
      key: 'font',
      label: 'Font',
      type: 'enum',
      default: 'sans',
      options: [
        { value: 'sans', label: 'Sans-serif' },
        { value: 'mono', label: 'Monospaced' },
      ],
    },
  ],
  pins: [],
  symbol: ({ text, size, font }) => ({
    kind: 'text',
    ...textBlockSize(text, size, font),
    pins: {},
  }),
  create: () => ({}),
});

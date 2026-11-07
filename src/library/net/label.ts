import { defineComponent, netNameRuns, runsText } from '../../core';

/** One character of a net name. */
const NAME_CHAR = String.raw`[A-Za-z0-9_+\-/#]`;

/**
 * What a net name may be: letters, digits, `_ + - / #`, and `~{…}` for an overline (KiCad's
 * syntax), at most 32 characters. No whitespace; no `.`, which netlists use to address pins
 * (`U1.Y`); no `[` `]`, kept for bus ranges (R10b).
 */
export const NET_NAME = new RegExp(`^(?=.{1,32}$)(?:${NAME_CHAR}|~\\{${NAME_CHAR}+\\})+$`);

export const NET_NAME_HINT =
  'letters, digits, _ + - / # and ~{…} for an overline, at most 32 characters';

/** The name of the first net label placed in a session (`nextNetName` continues from there). */
export const FIRST_NET_NAME = 'NET1';

/** Font size of a label's name, in cells; the drawer uses it, the layout sizes the body by it. */
export const NET_LABEL_FONT = 0.6;

/** Width of one character of the (monospaced) name font, in cells. */
const CHAR_WIDTH = NET_LABEL_FONT * 0.6;

/** Body width in cells: the name plus the tag's point and padding. */
export function netLabelWidth(name: string): number {
  return Math.max(2, Math.ceil(runsText(netNameRuns(name)).length * CHAR_WIDTH + 1));
}

/**
 * The name the next placed label gets after `name`: its trailing number incremented, keeping the
 * digits' width (`D0` → `D1`, `A09` → `A10`, `~{CS}1` → `~{CS}2`); a name without a trailing
 * number is kept (a second `CLK`).
 */
export function nextNetName(name: string): string {
  const match = /^(.*?)(\d+)$/.exec(name);
  if (!match) return name;
  const [, stem, digits] = match as unknown as [string, string, string];
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  const candidate = `${stem}${next}`;
  return NET_NAME.test(candidate) ? candidate : name;
}

/**
 * Net label: a flag with a name and one connection point. Every label of a name is one net, so
 * distant parts connect without a wire between them (KiCad's net label, Logisim's tunnel).
 * Schematic-only: it joins nets and is never simulated. Spec: docs/components.md#net-labels.
 */
export const netLabel = defineComponent<{ name: string }, undefined>({
  type: 'net/label',
  name: 'NET LABEL',
  title: 'Net label (joins every label of its name)',
  keywords: ['net', 'label', 'tunnel', 'name', 'signal', 'flag'],
  designatorPrefix: 'NL',
  schematicOnly: true,
  props: [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      default: FIRST_NET_NAME,
      pattern: { regex: NET_NAME, hint: NET_NAME_HINT },
    },
  ],
  nextProps: ({ name }) => ({ name: nextNetName(name) }),
  pins: ({ name }) => [
    { name: 'N', dir: 'nc', net: name, description: `joins every net label named ${name}` },
  ],
  symbol: ({ name }) => ({
    kind: 'net-label',
    width: netLabelWidth(name),
    height: 1,
    centered: true,
    pins: { N: { side: 'left', offset: 0 } },
  }),
  create: () => ({}),
});

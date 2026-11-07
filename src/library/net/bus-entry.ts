import { defineComponent, NET_NAME, NET_NAME_HINT } from '../../core';
import { nextNetName } from './label';

/** The name of the first bus entry placed in a session. */
export const FIRST_BUS_ENTRY_NAME = 'D0';

/**
 * Bus entry: one bit leaving a bus (KiCad's 45° bus entry), carrying the name of the member net
 * it joins. Its bus end `B` sits on a bus line, its bit end `N` on a pin or a wire and joins the
 * net of its name like a net label, so the bus line only gathers its entries. Placed by the bit
 * end, entries stack on a chip's adjacent pins (`D0` → `D1` → …) with their bus ends in one
 * column. Schematic-only. Spec: docs/components.md#net-labels-net.
 */
export const busEntry = defineComponent<{ name: string }, undefined>({
  type: 'net/bus-entry',
  name: 'BUS ENTRY',
  title: 'Bus entry (one bit of a bus, joins the net of its name)',
  keywords: ['bus', 'entry', 'ripper', 'splitter', 'tap', 'bit'],
  designatorPrefix: 'BE',
  schematicOnly: true,
  props: [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      default: FIRST_BUS_ENTRY_NAME,
      pattern: { regex: NET_NAME, hint: NET_NAME_HINT },
    },
  ],
  nextProps: ({ name }) => ({ name: nextNetName(name) }),
  pins: ({ name }) => [
    { name: 'N', dir: 'nc', net: name, description: `joins the net ${name}` },
    { name: 'B', dir: 'nc', bus: true, description: 'sits on a bus line' },
  ],
  // A stub, a diagonal across the one-cell body, a stub: N at (0, 0), B at (3, 1).
  symbol: {
    kind: 'bus-entry',
    width: 1,
    height: 1,
    pins: { N: { side: 'left', offset: 0 }, B: { side: 'right', offset: 1 } },
  },
  create: () => ({}),
});

import {
  defineComponent,
  isBusName,
  LABEL_NAME,
  LABEL_NAME_HINT,
  netNameRuns,
  type PortDirection,
  type PortSide,
  runsText,
} from '../../core';
import { NET_LABEL_FONT, nextNetName } from './label';

/** The name of the first port placed in a session (`nextNetName` continues from there). */
export const FIRST_PORT_NAME = 'PORT1';

/** Width of one character of the (monospaced) name font, in cells. */
const CHAR_WIDTH = NET_LABEL_FONT * 0.6;

/**
 * Body width in cells: the name plus room for a point at both ends, whatever the direction, so
 * changing a port's direction never moves anything.
 */
export function portWidth(name: string): number {
  return Math.max(2, Math.ceil(runsText(netNameRuns(name)).length * CHAR_WIDTH + 1.5));
}

const DIRECTION_WORDS: Readonly<Record<PortDirection, string>> = {
  in: 'input',
  out: 'output',
  bidir: 'bidirectional',
};

/**
 * Port: a subcircuit's interface pin (KiCad's hierarchical label). Like a net label it joins the
 * net (or, named like a bus, the bus) of its name in its circuit; an instance of the circuit
 * then has a pin of that name, on the side `side` says, which joins whatever the outer circuit
 * connects to it. Its direction shapes the flag and says which side `auto` means; electrically
 * every port is a plain connection, as a board's connector is. Schematic-only. Spec:
 * docs/components.md#ports-net-port.
 */
export const port = defineComponent<
  { name: string; direction: PortDirection; side: PortSide },
  undefined
>({
  type: 'net/port',
  name: 'PORT',
  title: "Port (a subcircuit's pin: joins the net or bus of its name)",
  keywords: ['port', 'pin', 'interface', 'subcircuit', 'hierarchical', 'module', 'input', 'output'],
  designatorPrefix: 'P',
  schematicOnly: true,
  props: [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      default: FIRST_PORT_NAME,
      pattern: { regex: LABEL_NAME, hint: LABEL_NAME_HINT },
    },
    {
      key: 'direction',
      label: 'Direction',
      type: 'enum',
      default: 'in',
      options: [
        { value: 'in', label: 'Input' },
        { value: 'out', label: 'Output' },
        { value: 'bidir', label: 'Bidirectional' },
      ],
    },
    {
      key: 'side',
      label: 'Side',
      type: 'enum',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto (inputs left)' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ],
    },
  ],
  nextProps: ({ name, direction, side }) => ({ name: nextNetName(name), direction, side }),
  port: ({ name, direction, side }) => ({ name, direction, side }),
  pins: ({ name, direction }) => {
    const word = DIRECTION_WORDS[direction];
    return [
      isBusName(name)
        ? { name: 'N', dir: 'nc', net: name, bus: true, description: `the ${word} bus ${name}` }
        : { name: 'N', dir: 'nc', net: name, description: `the ${word} ${name}` },
    ];
  },
  symbol: ({ name }) => ({
    kind: 'port',
    width: portWidth(name),
    height: 1,
    centered: true,
    pins: { N: { side: 'left', offset: 0 } },
  }),
  create: () => ({}),
});

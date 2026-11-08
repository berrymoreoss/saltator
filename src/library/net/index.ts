import type { AnyComponentDefinition } from '../../core';
import { busEntry } from './bus-entry';
import { netLabel } from './label';
import { port } from './port';

export { busEntry, FIRST_BUS_ENTRY_NAME } from './bus-entry';
export {
  FIRST_NET_NAME,
  NET_LABEL_FONT,
  netLabel,
  netLabelWidth,
  nextNetName,
} from './label';
export { FIRST_PORT_NAME, port, portWidth } from './port';

/** All `net/*` parts, in palette order. */
export const nets: readonly AnyComponentDefinition[] = [netLabel, busEntry, port];

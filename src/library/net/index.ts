import type { AnyComponentDefinition } from '../../core';
import { busEntry } from './bus-entry';
import { netLabel } from './label';

export { busEntry, FIRST_BUS_ENTRY_NAME } from './bus-entry';
export {
  FIRST_NET_NAME,
  NET_LABEL_FONT,
  netLabel,
  netLabelWidth,
  nextNetName,
} from './label';

/** All `net/*` parts, in palette order. */
export const nets: readonly AnyComponentDefinition[] = [netLabel, busEntry];

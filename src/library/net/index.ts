import type { AnyComponentDefinition } from '../../core';
import { netLabel } from './label';

export {
  FIRST_NET_NAME,
  NET_LABEL_FONT,
  netLabel,
  netLabelWidth,
  nextNetName,
} from './label';

/** All `net/*` parts, in palette order. */
export const nets: readonly AnyComponentDefinition[] = [netLabel];

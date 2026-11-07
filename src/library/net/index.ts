import type { AnyComponentDefinition } from '../../core';
import { netLabel } from './label';

export {
  FIRST_NET_NAME,
  NET_LABEL_FONT,
  NET_NAME,
  NET_NAME_HINT,
  netLabel,
  netLabelWidth,
  nextNetName,
} from './label';

/** All `net/*` parts, in palette order. */
export const nets: readonly AnyComponentDefinition[] = [netLabel];

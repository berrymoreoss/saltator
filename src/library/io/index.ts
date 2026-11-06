import type { AnyComponentDefinition } from '../../core';
import { pushButton } from './button';
import { dipSwitch } from './dip-switch';
import { gnd, vcc } from './rails';
import { toggleSwitch } from './switch';

export { type ButtonAction, type ButtonState, pushButton } from './button';
export type { Contact } from './contact';
export {
  type DipSwitchAction,
  type DipSwitchState,
  dipSwitch,
  MAX_DIP_SWITCHES,
} from './dip-switch';
export { gnd, vcc } from './rails';
export { type SwitchAction, type SwitchState, toggleSwitch } from './switch';

/** All `io/*` parts, in palette order. */
export const io: readonly AnyComponentDefinition[] = [
  vcc,
  gnd,
  toggleSwitch,
  pushButton,
  dipSwitch,
];

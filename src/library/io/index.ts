import type { AnyComponentDefinition } from '../../core';
import { pushButton } from './button';
import { clock } from './clock';
import { dipSwitch } from './dip-switch';
import { hexDisplay } from './hex-display';
import { led, ledBar } from './led';
import { probe } from './probe';
import { gnd, vcc } from './rails';
import { sevenSegment } from './seven-segment';
import { toggleSwitch } from './switch';

export { type ButtonAction, type ButtonState, pushButton } from './button';
export { type ClockAction, type ClockState, clock, clockPhases } from './clock';
export type { Contact } from './contact';
export {
  type DipSwitchAction,
  type DipSwitchState,
  dipSwitch,
  MAX_DIP_SWITCHES,
} from './dip-switch';
export { hexDigit, hexDisplay } from './hex-display';
export { led, ledBar, MAX_LED_BAR } from './led';
export {
  createLights,
  LED_COLORS,
  type LedColor,
  Light,
  type LightsState,
  ledLight,
  onTimeAt,
  setLight,
} from './lights';
export { probe } from './probe';
export { gnd, vcc } from './rails';
export { SEGMENTS, sevenSegment } from './seven-segment';
export { type SwitchAction, type SwitchState, toggleSwitch } from './switch';

/** All `io/*` parts, in palette order. */
export const io: readonly AnyComponentDefinition[] = [
  vcc,
  gnd,
  toggleSwitch,
  pushButton,
  dipSwitch,
  clock,
  led,
  ledBar,
  sevenSegment,
  hexDisplay,
  probe,
];

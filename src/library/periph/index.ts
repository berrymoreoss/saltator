import type { AnyComponentDefinition } from '../../core';
import { hd44780 } from './hd44780';

export {
  HD44780_BACKLIGHTS,
  type Hd44780Backlight,
  type Hd44780Props,
  type Hd44780State,
  hd44780,
  hd44780Controller,
  hd44780ControllerTiming,
  hd44780Symbol,
  LCD_CHAR_PITCH,
  LCD_DOT_PITCH,
  LCD_LINE_PITCH,
} from './hd44780';
export {
  ALL_UNKNOWN,
  type Controller as Hd44780Controller,
  type ControllerTiming as Hd44780ControllerTiming,
  createController as createHd44780Controller,
  ddramCell,
  Hd44780Diagnostic,
  Iface as Hd44780Iface,
  Unknown as Hd44780Unknown,
} from './hd44780-controller';
export {
  blinkOn,
  blinkPeriod,
  GLASS_ROWS,
  type Hd44780Frame,
  hd44780Frame,
  hd44780Text,
} from './hd44780-frame';
export {
  HD44780_SIZE_LABELS,
  HD44780_SIZES,
  type Hd44780Glass,
  type Hd44780Size,
  hd44780Glass,
} from './hd44780-modules';
export { HD44780_ROMS, type Hd44780Rom, isTallPattern, romRow } from './hd44780-rom';

/** All `periph/*` parts, in palette order. */
export const peripherals: readonly AnyComponentDefinition[] = [hd44780];

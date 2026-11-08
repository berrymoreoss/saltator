import type { AnyComponentDefinition } from '../../core';
import { hd44780 } from './hd44780';
import { st7789 } from './st7789';

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
export {
  type St7789Props,
  type St7789State,
  st7789,
  st7789Controller,
  st7789Symbol,
  TFT_BEZEL,
  TFT_HEADER,
  TFT_PIXELS_PER_CELL,
} from './st7789';
export {
  COMMANDS as ST7789_COMMANDS,
  type Controller as St7789Controller,
  PIXEL_X,
  St7789Diagnostic,
} from './st7789-controller';
export {
  GRAM_HEIGHT,
  GRAM_WIDTH,
  ST7789_PANEL_LABELS,
  ST7789_PANELS,
  type St7789Glass,
  type St7789Panel,
  st7789Glass,
} from './st7789-panels';

/** All `periph/*` parts, in palette order. */
export const peripherals: readonly AnyComponentDefinition[] = [hd44780, st7789];

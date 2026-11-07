/**
 * Timers: behavioral analog timer chips as DIP packages, their RC networks as props
 * (ADR-0013). See docs/components.md#timers-timer.
 */
import type { AnyComponentDefinition } from '../../core';
import { ne555 } from './ne555';

export { ne555, type TimerMode, type TimerState, timerTiming } from './ne555';

/** Every timer in the default registry. */
export const timers: readonly AnyComponentDefinition[] = [ne555];

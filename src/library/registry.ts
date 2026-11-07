import { Registry } from '../core';
import { chips74xx } from './74xx';
import { io } from './io';
import { primitives } from './primitives';
import { timers } from './timer';

/** A fresh registry with every built-in part. */
export function createDefaultRegistry(): Registry {
  return new Registry([...primitives, ...io, ...chips74xx, ...timers]);
}

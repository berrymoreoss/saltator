import { Registry } from '../core';
import { io } from './io';
import { primitives } from './primitives';

/** A fresh registry with every built-in part. */
export function createDefaultRegistry(): Registry {
  return new Registry([...primitives, ...io]);
}

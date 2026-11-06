import { Registry } from '../core';
import { primitives } from './primitives';

/** A fresh registry with every built-in part. */
export function createDefaultRegistry(): Registry {
  return new Registry(primitives);
}

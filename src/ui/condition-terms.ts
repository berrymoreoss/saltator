/**
 * The conditions a term of a trigger (R13) or a breakpoint (R14) can have, as the dialogs offer
 * them: an edge or a level of one signal, or a value of a bus or group.
 */
import { Level, type TriggerTerm } from '../core';

export interface ConditionChoice {
  /** `rise`, `level:1`, `equal`, … */
  readonly id: string;
  readonly label: string;
  /** Offered for a value (a bus or group), not for one signal. */
  readonly vector: boolean;
}

export const CONDITIONS: readonly ConditionChoice[] = [
  { id: 'rise', label: 'rises', vector: false },
  { id: 'fall', label: 'falls', vector: false },
  { id: 'edge', label: 'changes', vector: false },
  { id: 'level:1', label: 'is 1', vector: false },
  { id: 'level:0', label: 'is 0', vector: false },
  { id: 'level:X', label: 'is X', vector: false },
  { id: 'level:Z', label: 'is Z', vector: false },
  { id: 'equal', label: '=', vector: true },
  { id: 'notEqual', label: '≠', vector: true },
];

const LEVELS: Readonly<Record<string, Level>> = {
  '0': Level.L0,
  '1': Level.L1,
  X: Level.X,
  Z: Level.Z,
};

export const levelText = (level: Level) =>
  level === Level.L0 ? '0' : level === Level.L1 ? '1' : level === Level.Z ? 'Z' : 'X';

/** A term's kind (and level) from a condition id. */
export function conditionTerm(id: string): {
  readonly kind: TriggerTerm['kind'];
  readonly level?: Level;
} {
  if (id.startsWith('level:')) return { kind: 'level', level: LEVELS[id.slice(6)] ?? Level.L1 };
  return { kind: id as TriggerTerm['kind'] };
}

/** The condition id of a term's kind (and level). */
export function conditionId(kind: TriggerTerm['kind'], level?: Level): string {
  return kind === 'level' ? `level:${levelText(level ?? Level.L1)}` : kind;
}

/** Whether a condition id compares a value. */
export const isValueCondition = (id: string) => id === 'equal' || id === 'notEqual';

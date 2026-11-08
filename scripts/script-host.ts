/**
 * The Node script host for test scripts (R15a): each script runs in a `node:vm` context of its
 * own holding only the bench's globals — no `process`, no `require`, no `Math.random`, no
 * `Date`, no `console` (`b.log` reports) — with a time limit on every call, and its lines read
 * from stack frames. Not a security boundary (a determined script reaches the host through the
 * functions it is given): CI runs one's own files. Used by `pnpm test:circuits` and the
 * scenario tests.
 */
import vm from 'node:vm';
import type { ScriptHost } from '../src/circuit/index.ts';

export interface NodeScriptHostOptions {
  /** Wall-clock limit of a script's top level and of each bench, in ms (default 60 000). */
  readonly timeout?: number;
  /** The script's file name in stack frames (default `test-script.js`). */
  readonly filename?: string;
}

/** What the bench's globals may not be read through. */
const PRELUDE =
  'delete Math.random; delete globalThis.Date; delete globalThis.console; Error.stackTraceLimit = 50;';

export function nodeScriptHost(options: NodeScriptHostOptions = {}): ScriptHost {
  const filename = options.filename ?? 'test-script.js';
  const timeout = options.timeout ?? 60_000;
  // `file.js:12:5` in a stack frame, `file.js:12` heading a syntax error.
  const frame = new RegExp(`${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`);
  let context: vm.Context | undefined;
  const deep = <T>(run: () => T): T => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 100;
    try {
      return run();
    } finally {
      Error.stackTraceLimit = limit;
    }
  };
  return {
    load(source, globals) {
      context = vm.createContext({ ...globals });
      vm.runInContext(PRELUDE, context);
      const script = new vm.Script(source, { filename });
      deep(() => script.runInContext(context!, { timeout }));
    },
    call(fn, args) {
      if (!context) throw new Error('no script loaded');
      const call = { fn, args };
      context.__call = call;
      try {
        return deep(() =>
          vm.runInContext('__call.fn(...__call.args)', context!, {
            timeout,
            filename: 'bench-call',
          }),
        );
      } finally {
        delete context.__call;
      }
    },
    line(error) {
      const stack =
        error === undefined
          ? deep(() => new Error().stack)
          : (error as { stack?: unknown } | null)?.stack;
      const match = typeof stack === 'string' ? frame.exec(stack) : null;
      return match ? Number(match[1]) : undefined;
    },
  };
}

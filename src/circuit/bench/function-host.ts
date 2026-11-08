/**
 * A script host in this realm: the script as a `new Function` of its globals, lines from V8's
 * stack frames (Node, Chromium). No isolation and no time limit, so only for code one trusts or
 * a realm that is a sandbox already (tests; inside R15b's browser sandbox). The Node host
 * (scripts/script-host.ts) runs scripts in a `vm` context instead.
 */
import type { ScriptHost } from './script';

/** The script's name in stack frames. */
const FILE = 'test-script.js';
/** `new Function` puts two lines before the body: `function anonymous(…` and `) {`. */
const HEADER_LINES = 2;
const FRAME = new RegExp(`${FILE.replace('.', '\\.')}:(\\d+):\\d+`);

export function functionScriptHost(): ScriptHost {
  const lineOf = (stack: unknown) => {
    const match = typeof stack === 'string' ? FRAME.exec(stack) : null;
    return match ? Number(match[1]) - HEADER_LINES : undefined;
  };
  // V8 keeps 10 frames by default: too few to reach the script from deep inside the bench.
  const v8 = Error as unknown as { stackTraceLimit: number };
  const deep = <T>(run: () => T): T => {
    const limit = v8.stackTraceLimit;
    v8.stackTraceLimit = 100;
    try {
      return run();
    } finally {
      v8.stackTraceLimit = limit;
    }
  };
  return {
    load(source, globals) {
      const names = Object.keys(globals);
      const fn = new Function(...names, `${source}\n//# sourceURL=${FILE}`);
      deep(() => fn(...names.map((n) => globals[n])));
    },
    call: (fn, args) => deep(() => (fn as (...a: unknown[]) => unknown)(...args)),
    line: (error) =>
      lineOf(
        error === undefined
          ? deep(() => new Error().stack)
          : (error as { stack?: unknown } | null)?.stack,
      ),
  };
}

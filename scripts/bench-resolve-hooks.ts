/**
 * Node module hooks for running benchmarks on native `import` (no Vite module runner, whose
 * export getters distort hot-loop timings). Resolves the bundler-style specifiers used in src/:
 * extensionless files (`./logic` → `./logic.ts`) and directories (`../core` → `../core/index.ts`).
 * Node strips the types itself (the code base is erasable-syntax only).
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.')) return nextResolve(specifier, context);
    try {
      return nextResolve(specifier, context);
    } catch {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // try the next candidate
        }
      }
      throw new Error(`cannot resolve "${specifier}" from ${context.parentURL ?? '?'}`);
    }
  },
});

// `node --test` runs the TypeScript sources directly (Node strips the types), but the sources use
// bundler-style extensionless imports, which Node's ESM resolver rejects. This maps them to `.ts`.
import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});

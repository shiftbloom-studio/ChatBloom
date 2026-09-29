// `node --test` runs the TypeScript sources directly (Node strips the types), but the sources use
// bundler-style extensionless imports, which Node's ESM resolver rejects. This maps them to `.ts`.
// Worker modules also import the Durable Object base class from the Workers runtime, which
// Node does not have; they get a stand-in.
import { registerHooks } from "node:module";

const WORKERS_RUNTIME_STUB = new URL("./stubs/cloudflare-workers.ts", import.meta.url).href;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "cloudflare:workers") {
            return { url: WORKERS_RUNTIME_STUB, shortCircuit: true };
        }
        if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});

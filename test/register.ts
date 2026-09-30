// `node --test` runs the TypeScript sources directly, but they use extensionless imports, which
// Node's resolver rejects, and the Worker imports `cloudflare:workers`, which Node does not have.
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

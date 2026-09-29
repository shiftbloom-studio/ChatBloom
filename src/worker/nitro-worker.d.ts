/**
 * The Worker that Nitro's Cloudflare preset builds. `vite.config.ts` points this name at the
 * preset's entry and makes `entry.ts` the entry of the build instead.
 */
declare module "#petal/nitro-worker" {
    const worker: {
        fetch(request: Request, env: unknown, context: ExecutionContext): Promise<Response>;
    };
    export default worker;
}

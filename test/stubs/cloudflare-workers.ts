/** Stand-in for the base class of the Workers runtime: it keeps what the constructor gets. */
export class DurableObject<Env = unknown> {
    protected readonly ctx: unknown;
    protected readonly env: Env;

    constructor(ctx: unknown, env: Env) {
        this.ctx = ctx;
        this.env = env;
    }
}

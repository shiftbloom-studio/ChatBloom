/** Set by Cloudflare on every request; a client cannot forge or remove it. */
const CLIENT_ADDRESS_HEADER = "cf-connecting-ip";

/**
 * Whether the client may go on. `scope` keeps the counters of different endpoints apart
 * (`irc`, `data`, `miss`, `status`), since one binding counts every key against one limit.
 *
 * Fails open: a binding that is missing or failing must never be the reason chat is refused.
 * The same holds for a request without a client address, which would otherwise share one
 * counter with every other such request.
 */
export async function withinLimit(
    limiter: RateLimit | undefined,
    scope: string,
    request: Request,
): Promise<boolean> {
    const address = request.headers.get(CLIENT_ADDRESS_HEADER);
    if (!limiter || !address) return true;
    try {
        const { success } = await limiter.limit({ key: `${scope}:${address}` });
        return success;
    } catch {
        return true;
    }
}

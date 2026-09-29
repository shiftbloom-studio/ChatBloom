/** The most names a link carries. */
export const MAX_IGNORED = 20;

const plural = (count: number) => `${count} ${count === 1 ? "name" : "names"}`;

/**
 * Tells the streamer what became of the text in the "Also hide these users" field: how many
 * names the link carries, and which entries it does not. `accepted` is that text as read by
 * `parseIgnoreList`, which has the last word on what counts as a name.
 */
export function describeIgnoreList(input: string, accepted: readonly string[]): string {
    const entries = input.split(/[\s,;]+/).filter(Boolean);
    if (entries.length === 0) return "";

    const taken = new Set(accepted);
    const skipped = entries.filter((entry) => !taken.has(entry.replace(/^@/, "").toLowerCase()));
    const parts = [`${plural(accepted.length)} accepted.`];
    if (skipped.length > 0) parts.push(`Skipped: ${[...new Set(skipped)].join(", ")}.`);
    if (accepted.length >= MAX_IGNORED) parts.push(`A link carries ${MAX_IGNORED} names at most.`);
    return parts.join(" ");
}

// Twitch logins are 1–25 letters, digits and underscores, stored lowercase.
const login = /^[a-z0-9_]{1,25}$/;

/**
 * Reads a Twitch channel from what people actually paste: a bare name, "@name",
 * "#name" or a twitch.tv link. Returns the lowercase login, or undefined.
 */
export function parseChannel(input: string): string | undefined {
    const channel = input
        .trim()
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\//, "")
        .replace(/^[@#]/, "")
        .replace(/[/?#].*$/, "");
    return login.test(channel) ? channel : undefined;
}

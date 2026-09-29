/**
 * Puts text on the clipboard and tells whether it got there. Browsers keep the clipboard closed
 * on pages without HTTPS and when the visitor has denied the permission.
 */
export async function copyText(
    text: string,
    clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<boolean> {
    if (!clipboard) return false;
    try {
        await clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

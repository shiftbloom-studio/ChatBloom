export type Language = "en" | "de";

// Petal is written in English, apart from the German versions of the legal pages. The server
// writes the language of the page it renders into `<html lang>` (entry-server.tsx), also when it
// prerenders the legal pages at build time, and the client keeps it in step when it navigates
// (app.tsx), so screen readers and translation tools follow the page that is shown. The router
// compares static segments case-insensitively and tolerates one trailing slash, so this does too.
// test/language.test.ts checks that every legal page declares the language this gives its path.
const GERMAN = /^\/(?:impressum|datenschutz)\/?$/i;

/** The language of the page at `pathname`. */
export function pageLanguage(pathname: string): Language {
    return GERMAN.test(pathname) ? "de" : "en";
}

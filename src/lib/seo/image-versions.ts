// Written by `pnpm og` (scripts/og.ts), not by hand.
//
// The first characters of the SHA-256 of every image of a shared link. They are part of the
// image's address: platforms keep the image of an address for weeks, so a changed image has to
// be a new address to them.
export const versions = {
    "og.png": "c5fd7d48",
    "og-square.png": "31ff75d2",
} as const;

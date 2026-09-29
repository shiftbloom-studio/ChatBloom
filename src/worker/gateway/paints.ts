import { SEVENTV_ID_PATTERN } from "./routes";

/**
 * 7TV scores the paint selection below at 32 points per paint and refuses queries above 400
 * ("Query is too complex."), so 12 paints fit into one query and 13 do not.
 */
export const PAINTS_PER_QUERY = 12;

/** What the client asks for at once; answered with up to three upstream queries. */
export const PAINTS_PER_REQUEST = 25;

/** The client never sends more than 13 KB; the query text is not read, only bounded. */
const QUERY_TEXT_MAX = 24 * 1024;

/**
 * The selection the client's `paintFromV4` reads, so that a gateway answer and a direct answer
 * have the same shape. A copy of the client's `V4_PAINT_FIELDS`, since the Worker is checked
 * without the browser's types; a test holds the two together.
 */
export const V4_PAINT_FIELDS = `id name data {
    layers { opacity ty { __typename
        ... on PaintLayerTypeSingleColor { color { hex } }
        ... on PaintLayerTypeLinearGradient { angle repeating stops { at color { hex } } }
        ... on PaintLayerTypeRadialGradient { shape repeating stops { at color { hex } } }
        ... on PaintLayerTypeImage { images { url scale frameCount } }
    } }
    shadows { color { hex } offsetX offsetY blur }
}`;

export function buildPaintsQuery(ids: string[]): {
    query: string;
    variables: Record<string, string>;
} {
    const declarations = ids.map((_, i) => `$i${i}: Id!`).join(", ");
    const fields = ids.map((_, i) => `p${i}: paint(id: $i${i}) { ${V4_PAINT_FIELDS} }`);
    return {
        query: `query(${declarations}) { paints {\n${fields.join("\n")}\n} }`,
        variables: Object.fromEntries(ids.map((id, i) => [`i${i}`, id])),
    };
}

/**
 * Reads the paint ids out of the GraphQL request the client sends, in the order of its
 * variables `i0`, `i1`, and so on. Returns undefined for anything that is not exactly that
 * request: other keys, other variable names, gaps, or values that are not 7TV ids.
 */
export function parsePaintsRequest(text: string): string[] | undefined {
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const keys = Object.keys(body).sort();
    if (keys.length !== 2 || keys[0] !== "query" || keys[1] !== "variables") return undefined;

    const { query, variables } = body as { query: unknown; variables: unknown };
    if (typeof query !== "string" || query.length > QUERY_TEXT_MAX) return undefined;
    if (typeof variables !== "object" || variables === null || Array.isArray(variables)) {
        return undefined;
    }
    const count = Object.keys(variables).length;
    if (count < 1 || count > PAINTS_PER_REQUEST) return undefined;

    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
        const id = (variables as Record<string, unknown>)[`i${i}`];
        if (typeof id !== "string" || !SEVENTV_ID_PATTERN.test(id)) return undefined;
        ids.push(id);
    }
    return ids;
}

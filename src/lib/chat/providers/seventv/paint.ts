/**
 * 7TV name paints, normalised to the layered v4 model: each layer is a text-clipped background
 * stacked over the previous one, and the drop shadows apply to the first layer only. This is
 * how 7TV's own website renders them.
 */
export interface Paint {
    id: string;
    name: string;
    layers: PaintLayer[];
    /** `drop-shadow(...)` chain for the shadows, if any. */
    filter?: string;
}

export interface PaintLayer {
    opacity: number;
    image?: string;
    color?: string;
}

/** 7TV v3 encodes colors as signed 32-bit RGBA integers. */
export function colorFromInt(color: number): string {
    return `#${(color >>> 0).toString(16).padStart(8, "0")}`;
}

export interface V3PaintData {
    id: string;
    name: string;
    function: "LINEAR_GRADIENT" | "RADIAL_GRADIENT" | "URL";
    color: number | null;
    repeat: boolean;
    angle: number;
    shape?: string;
    image_url?: string;
    stops: { at: number; color: number }[];
    shadows: { x_offset: number; y_offset: number; radius: number; color: number }[] | null;
}

function stopList(stops: { at: number; color: string }[]): string {
    return stops.map((stop) => `${stop.color} ${stop.at * 100}%`).join(", ");
}

function linearGradient(angle: number, repeating: boolean, stops: { at: number; color: string }[]) {
    return `${repeating ? "repeating-" : ""}linear-gradient(${angle}deg, ${stopList(stops)})`;
}

function radialGradient(shape: string, repeating: boolean, stops: { at: number; color: string }[]) {
    return `${repeating ? "repeating-" : ""}radial-gradient(${shape}, ${stopList(stops)})`;
}

function dropShadows(shadows: { x: number; y: number; blur: number; color: string }[]) {
    if (shadows.length === 0) return undefined;
    return shadows.map((s) => `drop-shadow(${s.color} ${s.x}px ${s.y}px ${s.blur}px)`).join(" ");
}

/** Converts the v3 shape sent by the EventAPI. v3 only carries a paint's first layer. */
export function paintFromV3(data: V3PaintData): Paint {
    const stops = data.stops.map((stop) => ({ at: stop.at, color: colorFromInt(stop.color) }));
    let image: string | undefined;
    if (data.function === "URL") {
        if (data.image_url) image = `url("${data.image_url}")`;
    } else if (stops.length > 0) {
        image =
            data.function === "LINEAR_GRADIENT"
                ? linearGradient(data.angle, data.repeat, stops)
                : radialGradient(data.shape || "circle", data.repeat, stops);
    }
    const color = data.color === null ? undefined : colorFromInt(data.color);

    return {
        id: data.id,
        name: data.name,
        layers: image || color ? [{ opacity: 1, image, color }] : [],
        filter: dropShadows(
            (data.shadows ?? []).map((s) => ({
                x: s.x_offset,
                y: s.y_offset,
                blur: s.radius,
                color: colorFromInt(s.color),
            })),
        ),
    };
}

interface V4Stop {
    at: number;
    color: { hex: string };
}

export interface V4Paint {
    id: string;
    name: string;
    data: {
        layers: {
            opacity: number;
            ty:
                | { __typename: "PaintLayerTypeSingleColor"; color: { hex: string } }
                | {
                      __typename: "PaintLayerTypeLinearGradient";
                      angle: number;
                      repeating: boolean;
                      stops: V4Stop[];
                  }
                | {
                      __typename: "PaintLayerTypeRadialGradient";
                      shape: "CIRCLE" | "ELLIPSE";
                      repeating: boolean;
                      stops: V4Stop[];
                  }
                | {
                      __typename: "PaintLayerTypeImage";
                      images: { url: string; scale: number; frameCount: number }[];
                  };
        }[];
        shadows: { color: { hex: string }; offsetX: number; offsetY: number; blur: number }[];
    };
}

/** Selection set for {@link V4Paint}, for use in v4 GraphQL queries. */
export const V4_PAINT_FIELDS = `id name data {
    layers { opacity ty { __typename
        ... on PaintLayerTypeSingleColor { color { hex } }
        ... on PaintLayerTypeLinearGradient { angle repeating stops { at color { hex } } }
        ... on PaintLayerTypeRadialGradient { shape repeating stops { at color { hex } } }
        ... on PaintLayerTypeImage { images { url scale frameCount } }
    } }
    shadows { color { hex } offsetX offsetY blur }
}`;

function layerFromV4(layer: V4Paint["data"]["layers"][number]): PaintLayer | undefined {
    const ty = layer.ty;
    const stops = "stops" in ty ? ty.stops.map((s) => ({ at: s.at, color: s.color.hex })) : [];
    switch (ty.__typename) {
        case "PaintLayerTypeSingleColor":
            return { opacity: layer.opacity, color: ty.color.hex };
        case "PaintLayerTypeLinearGradient":
            if (stops.length === 0) return undefined;
            return { opacity: layer.opacity, image: linearGradient(ty.angle, ty.repeating, stops) };
        case "PaintLayerTypeRadialGradient":
            if (stops.length === 0) return undefined;
            return {
                opacity: layer.opacity,
                image: radialGradient(ty.shape.toLowerCase(), ty.repeating, stops),
            };
        case "PaintLayerTypeImage": {
            const animated = ty.images.some((img) => img.frameCount > 1);
            const oneX = ty.images.find(
                (img) => img.scale === 1 && img.frameCount > 1 === animated,
            );
            return oneX ? { opacity: layer.opacity, image: `url("${oneX.url}")` } : undefined;
        }
        default:
            return undefined;
    }
}

export function paintFromV4(paint: V4Paint): Paint {
    return {
        id: paint.id,
        name: paint.name,
        layers: paint.data.layers.flatMap((layer) => layerFromV4(layer) ?? []),
        filter: dropShadows(
            paint.data.shadows.map((s) => ({
                x: s.offsetX,
                y: s.offsetY,
                blur: s.blur,
                color: s.color.hex,
            })),
        ),
    };
}

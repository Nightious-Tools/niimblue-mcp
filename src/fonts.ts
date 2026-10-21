// Font names shared by Node and the page (src/page/render.ts): no imports, so the page bundle stays browser-only.

export const NOTO = "Noto Sans Variable";

/**
 * Bundled fonts: fonts/<family>.woff2, the Latin static file of @fontsource/<id>@5.3.0 (THIRD_PARTY_NOTICES.md).
 * family = file stem, as NiimBlue's Fonts menu names an upload. min_px: smallest fontSize at 203 dpi from the render sweep (×dpmm/8 at 300).
 */
export const BUILTIN = [
  { family: "JetBrains Mono Bold", notes: "monospace, 700", min_px: 18 },
  { family: "Barlow Condensed Bold", notes: "condensed grotesk, 700", min_px: 18 },
  { family: "Archivo Black", notes: "heavy wide display (a 400-class file: leave fontWeight unset or it fakes bold)", min_px: 20 },
  { family: "Archivo ExtraBold", notes: "heavy grotesk, 800", min_px: 16 },
  { family: "Bitter Bold", notes: "slab serif, 700", min_px: 16 },
] as const;

/** A fontFamily that is valid unquoted CSS (fabric quotes Textbox families, NiimBlue's Barcode doesn't): words of letters, digits, _ and -, no digit or -digit first, single spaces. */
export const FAMILY_RX = /^-?[\p{L}_][\p{L}\p{N}_-]*(?: -?[\p{L}_][\p{L}\p{N}_-]*)*$/u;

/** "U+2192 '→', …" for a warning, at most 5. */
export const codepoints = (chars: string[]) => chars.slice(0, 5).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} '${c}'`).join(", ");

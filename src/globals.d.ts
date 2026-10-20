// Shared by tsconfig.json (Node) and tsconfig.page.json (browser): the page contract crosses Chrome as JSON, so it lives here, not in either side.

/** Stage-1 page bundle text, injected by build.mjs / vitest.config.ts `define`. */
declare const __PAGE_JS__: string;

declare module "*.woff2" {
  const bytes: Uint8Array;
  export default bytes;
}

/** NiimBlue's LabelProps (`$/types` LabelPropsSchema), the subset this server sets. */
type LabelProps = {
  printDirection: "left" | "top";
  size: { width: number; height: number };
  split?: "none" | "vertical" | "horizontal";
  splitParts?: number;
  tailPos?: "right" | "bottom" | "left" | "top";
  tailLength?: number;
  mirror?: "none" | "copy" | "flip";
};

/** What label.ts hands the page: px label props, fabric object JSON in paint order, dots per mm. */
type PageInput = { label: LabelProps; objects: object[]; dpmm: number };

type RenderWarning = { code: string; object?: number; message: string };
type RenderBox = { i: number; type: string; left: number; top: number; width: number; height: number };

/** What `niimRender` returns: the upscaled threshold-140 PNG, NiimBlue's own `toJSON()` canvas, rendered boxes, page warnings. */
type PageResult = { png_b64: string; canvas: object; boxes: RenderBox[]; warnings: RenderWarning[]; zoom: number };

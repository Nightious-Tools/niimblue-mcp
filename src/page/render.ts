// Runs inside headless Chrome: replays NiimBlue's own #load (designer) and PrintPreview steps, so the PNG is what the app prints.
import * as fabric from "fabric";
import QRCodeFactory from "qrcode-generator";
import { configureFabric, OBJECT_DEFAULTS, OBJECT_DEFAULTS_TEXT, OBJECT_DEFAULTS_VECTOR } from "$/defaults";
import QRCode from "$/fabric-object/qrcode";
import Barcode from "$/fabric-object/barcode";
import { CustomCanvas } from "$/fabric-object/custom_canvas";
import { CanvasUtils } from "$/utils/canvas_utils";
import { canvasPreprocess } from "$/utils/canvas_preprocess";
import { threshold } from "$/utils/post_process";
import latin from "@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2";
import cyrillic from "@fontsource-variable/noto-sans/files/noto-sans-cyrillic-wght-normal.woff2";
import icons from "material-icons/iconfont/material-icons.woff2";

configureFabric();

const NOTO = "Noto Sans Variable";
// descriptors copied from NiimBlue's styles/font.scss
const fontsReady = Promise.all([
  new FontFace(NOTO, latin as BufferSource, { style: "normal", weight: "100 900", display: "swap", unicodeRange: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }),
  new FontFace(NOTO, cyrillic as BufferSource, { style: "normal", weight: "100 900", display: "swap", unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }),
  new FontFace("Material Icons", icons as BufferSource, { style: "normal", weight: "400", display: "swap" }),
].map((f) => (document.fonts.add(f), f.load())));

const TEXT = new Set(["Textbox", "Text"]);
const VECTOR = new Set(["Rect", "Circle", "Polyline"]);
const THRESHOLD = 140; // PrintPreview.svelte default; the link carries no print settings

(globalThis as any).niimRender = async ({ label, objects, dpmm }: PageInput): Promise<PageResult> => {
  await fontsReady;
  const merged = objects.map((o: any) => {
    const m: any = { ...(TEXT.has(o.type) ? OBJECT_DEFAULTS_TEXT : VECTOR.has(o.type) ? OBJECT_DEFAULTS_VECTOR : OBJECT_DEFAULTS), ...o };
    if (o.type === "Polyline") for (const k of ["left", "top"]) if (o[k] === undefined) delete m[k]; // fabric places an omitted axis from the points
    return m;
  });
  for (const o of merged) {
    const font = TEXT.has(o.type) ? `${o.fontStyle ?? "normal"} ${o.fontWeight ?? "normal"} 16px "${o.fontFamily}"` : o.type === "Barcode" ? `bold 16px "${NOTO}"` : "";
    if (font && !document.fonts.check(font)) throw new Error(`FONT_NOT_LOADED: ${font}`);
  }
  const { width: W, height: H } = label.size;

  // designer step = FileUtils.loadCanvasState on #load (file_utils.ts imports stores, so its reviver is restated)
  const c1 = new CustomCanvas(undefined, { width: W, height: H });
  c1.setLabelProps(label as any);
  await c1.loadFromJSON({ version: fabric.version, objects: merged }, (_: unknown, o: any) => {
    if (o instanceof fabric.FabricObject) { o.set({ snapAngle: OBJECT_DEFAULTS.snapAngle }); CanvasUtils.fixFabricObjectScale(o); }
  });
  const canvas = c1.toJSON();
  c1.dispose();

  // preview step = PrintPreview.svelte generatePreviewData + updatePreview(threshold)
  const c2 = new CustomCanvas(undefined, { width: W, height: H });
  c2.setCustomBackground(false);
  c2.setHighlightMirror(false);
  c2.setLabelProps(label as any);
  await c2.loadFromJSON(canvas);
  canvasPreprocess(c2, {});
  const objs = c2.getObjects(); // before mirroring, so index i = input order
  await c2.createMirroredObjects();
  c2.requestRenderAll();
  const el = c2.toCanvasElement();
  const img = threshold(el.getContext("2d")!.getImageData(0, 0, el.width, el.height), THRESHOLD);
  c2.dispose();

  const black = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && img.data[(y * W + x) * 4] === 0;
  const anyBlack = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (black(x, y)) return true;
    return false;
  };
  const warnings: RenderWarning[] = [];
  const warn = (code: string, object: number, message: string) => warnings.push({ code, object, message });
  const boxes = objs.map((o: any, i) => {
    const r = o.getBoundingRect(), type: string = o.constructor.type; // o.type is lowercased in fabric 7
    const box = { i, type, left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    const { left: x, top: y, width: w, height: h } = box, content = TEXT.has(type) || o instanceof QRCode || o instanceof Barcode;
    const over = Math.max(-x, -y, x + w - W, y + h - H), gap = Math.min(x, y, W - x - w, H - y - h);
    // bands and frames may bleed off the edge on purpose; text and codes may not
    if (x >= W || y >= H || x + w <= 0 || y + h <= 0) warn("OFF_LABEL", i, `${type} is entirely outside the ${W}×${H} px label; move it inside.`);
    else if (content && over > 0) warn("OFF_LABEL", i, `${type} extends ${over} px past the label edge (${W}×${H} px); move it inside or make it smaller.`);
    else if (content && gap < dpmm) warn("NEAR_EDGE", i, `${type} is ${gap} px from the label edge; keep text and codes ≥ ${Math.ceil(dpmm)} px (1 mm) from every edge.`);

    const angle0 = (o.angle ?? 0) % 360 === 0; // shortcut: quiet-zone scans only for unrotated codes, rotate-aware rects if agents rotate codes
    const c = o.getCenterPoint();
    if (o instanceof QRCode) { // same maths as QRCode._render
      let n = 0;
      try { const qr = QRCodeFactory(o.qrVersion, o.ecl); qr.addData(o.text, o.mode); qr.make(); n = qr.getModuleCount(); } catch {}
      const m = n ? Math.floor(o.width / n) : 0, qw = m * n - ((m * n) % 2);
      if (!o.text || m < 1) warn("QR_ERR", i, `QR code renders the ERR box: ${n ? `${n} modules don't fit in ${o.width} px` : "the text is too long for any QR version"}; widen it, shorten the text or use ecl L.`);
      else if (m < 3) warn("QR_MODULE_SMALL", i, `QR modules are ${m} px (${n}×${n}), may not scan; widen it to ≥ ${3 * n + ((3 * n) % 2)} px, shorten the text or use ecl L.`);
      if (m >= 1 && angle0) {
        const x0 = Math.floor(c.x - qw / 2 - 0.5), y0 = Math.floor(c.y - qw / 2 - 0.5), q = 4 * m;
        const x1 = Math.ceil(c.x - qw / 2 - 0.5 + m * n), y1 = Math.ceil(c.y - qw / 2 - 0.5 + m * n); // odd m·n: the symbol is 1 px wider than qw
        if (anyBlack(x0 - q, x0, y0 - q, y1 + q) || anyBlack(x1, x1 + q, y0 - q, y1 + q) || anyBlack(x0, x1, y0 - q, y0) || anyBlack(x0, x1, y1, y1 + q))
          warn("QR_QUIET_ZONE", i, `Black within 4 modules (${q} px) of the QR symbol; keep ${q} px clear on every side.`);
      }
    }
    if (o instanceof Barcode) { // same maths as Barcode._render
      const b = o as any;
      if (b.error) warn("BARCODE_ERR", i, `Barcode renders the ERR box: ${o.encoding === "EAN13" ? "EAN13 needs 12–13 digits and a valid check digit" : "CODE128B takes printable ASCII only, ≤ 229 chars"}; fix the text.`);
      else if (b.barcodeEncoded && angle0) {
        const s = o.scaleFactor, q = 10 * s, ox = c.x - o.width / 2 + 0.5, oy = c.y - o.height / 2 + 0.5;
        const x0 = Math.floor(ox + (o.encoding === "EAN13" ? b._measureLetterWidth() : 0)), x1 = Math.ceil(x0 + s * b.barcodeEncoded.length);
        const bars = o.height - (o.printText ? o.fontSize * 1.2 : o.encoding === "EAN13" ? 8 : 0), y0 = Math.floor(oy), y1 = Math.ceil(oy + bars);
        if (anyBlack(x0 - q, x0, y0, y1) || anyBlack(x1, x1 + q, y0, y1))
          warn("BARCODE_QUIET_ZONE", i, `Black within 10 modules (${q} px) left or right of the bars; keep ${q} px clear on both sides.`);
      }
    }
    return box;
  });

  // nearest-neighbour upscale keeps every printer dot a crisp zoom×zoom square
  const zoom = Math.min(8, Math.max(1, Math.floor(1200 / Math.max(W, H))));
  const one = document.createElement("canvas"), out = document.createElement("canvas");
  [one.width, one.height, out.width, out.height] = [W, H, W * zoom, H * zoom];
  one.getContext("2d")!.putImageData(img, 0, 0);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(one, 0, 0, W * zoom, H * zoom);
  // the label background is opaque white; a cold Chrome on Windows once read back all-transparent (an all-black PNG)
  if (!img.data[3] || !ctx.getImageData(0, 0, 1, 1).data[3]) throw new Error("BLANK_CANVAS: Chrome returned an empty canvas; call render_label again.");
  return { png_b64: out.toDataURL("image/png").split(",")[1], canvas, boxes, warnings, zoom };
};

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
import { BUILTIN, NOTO, codepoints } from "../fonts";
import jetbrains from "../../fonts/JetBrains Mono Bold.woff2";
import barlow from "../../fonts/Barlow Condensed Bold.woff2";
import archivoBlack from "../../fonts/Archivo Black.woff2";
import archivoExtra from "../../fonts/Archivo ExtraBold.woff2";
import bitter from "../../fonts/Bitter Bold.woff2";

configureFabric();

const BYTES: Record<(typeof BUILTIN)[number]["family"], Uint8Array> = {
  "JetBrains Mono Bold": jetbrains, "Barlow Condensed Bold": barlow, "Archivo Black": archivoBlack, "Archivo ExtraBold": archivoExtra, "Bitter Bold": bitter,
};
// descriptors copied from NiimBlue's styles/font.scss
const fontsReady = Promise.all([
  new FontFace(NOTO, latin as BufferSource, { style: "normal", weight: "100 900", display: "swap", unicodeRange: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }),
  new FontFace(NOTO, cyrillic as BufferSource, { style: "normal", weight: "100 900", display: "swap", unicodeRange: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }),
  new FontFace("Material Icons", icons as BufferSource, { style: "normal", weight: "400", display: "swap" }),
].map((f) => (document.fonts.add(f), f.load())));

const TEXT = new Set(["Textbox", "Text"]);
const VECTOR = new Set(["Rect", "Circle", "Polyline"]);
const THRESHOLD = 140; // PrintPreview.svelte default; the link carries no print settings

(globalThis as any).niimRender = async ({ label, objects, dpmm, variables, glyphs, fonts }: PageInput): Promise<PageResult> => {
  await fontsReady;
  const warnings: RenderWarning[] = [];
  const warn = (code: string, object: number, message: string) => warnings.push({ code, object, message });

  // the families the label uses, loaded as FileUtils.loadFonts does (file_utils.ts:440, no descriptors); a folder file beats a built-in
  const files = new Map<string, [string, BufferSource]>(BUILTIN.map((b) => [b.family.toLowerCase(), [b.family, BYTES[b.family] as BufferSource]]));
  for (const f of fonts ?? []) files.set(f.family.toLowerCase(), [f.family, Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))]);
  const first = new Map<string, number>(), loaded = new Set<string>();
  objects.forEach((o: any, i) => { const k = o.fontFamily?.toLowerCase(); if (files.has(k) && !first.has(k)) first.set(k, i); });
  await Promise.all([...first].map(async ([k, i]) => {
    const [family, bytes] = files.get(k)!;
    try { document.fonts.add(await new FontFace(family, bytes).load()); loaded.add(k); }
    catch { warn("FONT_MISSING", i, `'${family}' is not a valid font file, so it prints in a fallback font; replace the file or use a list_fonts family.`); }
  }));
  // a glyph the file lacks draws exactly as in a family nobody has
  // shortcut: a font whose glyph is pixel-identical to the system fallback's warns falsely; compare a second fallback family if that ever bites
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  probe.canvas.width = probe.canvas.height = 64;
  const draw = (font: string, ch: string) => { probe.clearRect(0, 0, 64, 64); probe.font = font; probe.fillText(ch, 4, 52); return probe.getImageData(0, 0, 64, 64).data.join(); };
  for (const [i, chars] of Object.entries(glyphs ?? {})) {
    const fam: string = (objects[+i] as any).fontFamily;
    if (!loaded.has(fam.toLowerCase())) continue;
    const miss = [...chars].filter((ch) => draw(`48px "${fam}"`, ch) === draw('48px "NoSuchFamily"', ch));
    if (miss.length) warn("GLYPH_FALLBACK", +i, `${codepoints(miss)} not in ${fam}, so each machine substitutes its own font; replace them or use a list_fonts family that has them.`);
  }

  const merged = objects.map((o: any) => {
    const m: any = { ...(TEXT.has(o.type) ? OBJECT_DEFAULTS_TEXT : VECTOR.has(o.type) ? OBJECT_DEFAULTS_VECTOR : OBJECT_DEFAULTS), ...o };
    if (o.type === "Polyline") for (const k of ["left", "top"]) if (o[k] === undefined) delete m[k]; // fabric places an omitted axis from the points
    return m;
  });
  for (const o of merged) {
    const font = TEXT.has(o.type) ? `${o.fontStyle ?? "normal"} ${o.fontWeight ?? "normal"} 16px "${o.fontFamily}"` : o.type === "Barcode" ? `bold 16px "${o.fontFamily ?? NOTO}"` : "";
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
  canvasPreprocess(c2, variables ?? {});
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
  const boxes = objs.map((o: any, i) => {
    const r = o.getBoundingRect(), type: string = o.constructor.type; // o.type is lowercased in fabric 7
    const box = { i, type, left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    const { left: x, top: y, width: w, height: h } = box, content = TEXT.has(type) || o instanceof QRCode || o instanceof Barcode;
    const over = Math.max(-x, -y, x + w - W, y + h - H), gap = Math.min(x, y, W - x - w, H - y - h);
    // bands and frames may bleed off the edge on purpose; text and codes may not
    if (x >= W || y >= H || x + w <= 0 || y + h <= 0) warn("OFF_LABEL", i, `${type} is entirely outside the ${W}×${H} px label; move it inside.`);
    else if (content && over > 0) warn("OFF_LABEL", i, `${type} extends ${over} px past the label edge (${W}×${H} px); move it inside or make it smaller.`);
    else if (content && gap < dpmm) warn("NEAR_EDGE", i, `${type} is ${gap} px from the label edge; keep text and codes ≥ ${Math.ceil(dpmm)} px (1 mm) from every edge.`);

    if (o instanceof fabric.Textbox && o.textLines.length > o.text.split("\n").length) { // wrapped at width, not at an explicit \n
      const w0 = o.width;
      o.set({ width: 1e5 }); o.initDimensions();
      const need = Math.ceil(o.calcTextWidth());
      o.set({ width: w0 }); o.initDimensions();
      warn("TEXT_WRAPPED", i, `Textbox wraps to ${o.textLines.length} lines at width ${Math.round(w0)} px; widen it to ≥ ${need} px or put \\n where you want the break.`);
    }

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
        // clear columns beside the bars, up to the q a scanner needs
        const clear = (x: number, step: number) => { let d = 0; while (d < q && !anyBlack(x + d * step, x + d * step + 1, y0, y1)) d++; return d; };
        for (const [side, d] of [["left", clear(x0 - 1, -1)], ["right", clear(x1, 1)]] as const)
          if (d < q) warn("BARCODE_QUIET_ZONE", i, `Only ${d} px clear ${side} of the bars, under 10 modules (${q} px); keep ${q} px clear on the ${side}.`);
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

import { gzipSync } from "node:zlib";
import { z } from "zod";
import { modelsLibrary, getPrinterMetaByModel, type PrinterModel } from "@mmote/niimbluelib"; // root import: the deep dist/cjs/printer_models.js import is circular (F3)
import { iconCodepoints } from "$/styles/mdi_icons";
import { NbError } from "./util/errors.js";

/** niimbluelib's printer model names, for the `printer` z.enum. */
export const MODELS = modelsLibrary.map((m) => m.model) as [string, ...string[]];

const ICONS = iconCodepoints as Record<string, number>;
const POS = z.number().min(-1000).max(5000);
const COLOR = z.enum(["black", "white", "transparent"]).describe("Only black prints; white knocks out, transparent draws nothing");
const COMMON = {
  left: POS.describe("x of the origin point, in dots"),
  top: POS.describe("y of the origin point, in dots"),
  originX: z.enum(["left", "center", "right"]).optional().describe("Which point left refers to (default left)"),
  originY: z.enum(["top", "center", "bottom"]).optional().describe("Which point top refers to (default top)"),
  angle: z.number().min(-360).max(360).optional().describe("Rotation in degrees around the origin"),
};
const STROKE_WIDTH = z.number().min(0).max(50).optional().describe("Stroke width in dots (default 3); ≥2 at 203 dpi");

const OBJECT = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Textbox"), ...COMMON,
    text: z.string().min(1).max(2000).describe("Text; \\n breaks lines. {dt}, {dt|DD.MM.YYYY} or {dt+7d|DD.MM} print the date at print time"),
    width: z.number().min(1).max(5000).describe("Wrap width in dots (long words widen the box)"),
    fontSize: z.number().min(6).max(999).describe("Font size in dots; ≥16 at 203 dpi"),
    fontWeight: z.number().int().min(100).max(900).optional().describe("Noto Sans Variable weight (default 600); ≥500 under 24 dots"),
    fontStyle: z.enum(["normal", "italic"]).optional().describe("italic is a synthetic oblique"),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional().describe("Default center, as in the app"),
    lineHeight: z.number().min(0.7).max(3).optional().describe("Line height in font sizes (default 1)"),
    charSpacing: z.number().min(-200).max(1000).optional().describe("Tracking in 1/1000 em"),
    scaleX: z.number().min(0.6).max(1.5).optional().describe("Horizontal scale; 0.8–0.9 gives a condensed look"),
    fontAutoSize: z.boolean().optional().describe("Shrinks the font only when a {dt…} field filled in at print time adds lines or widens the text; a long word never shrinks it"),
    fill: COLOR.optional().describe("Text colour (default black)"),
    backgroundColor: COLOR.optional().describe("Box fill behind the text; black + white fill makes an inverse band"),
  }).strict(),
  z.object({
    type: z.literal("Icon"), ...COMMON,
    name: z.string().min(1).max(60).describe("Material Icons name in snake_case, e.g. lan, kitchen, wine_bar"),
    fontSize: z.number().min(8).max(999).describe("Glyph size in dots; ≥32 at 203 dpi"),
    fill: COLOR.optional().describe("Glyph colour (default black)"),
  }).strict(),
  z.object({
    type: z.literal("Rect"), ...COMMON,
    width: z.number().min(1).max(5000).describe("Width in dots"),
    height: z.number().min(1).max(5000).describe("Height in dots"),
    rx: z.number().min(0).max(500).optional().describe("Corner radius x"),
    ry: z.number().min(0).max(500).optional().describe("Corner radius y"),
    fill: COLOR.optional().describe("Fill (default transparent)"),
    stroke: COLOR.optional().describe("Outline (default black)"),
    strokeWidth: STROKE_WIDTH,
  }).strict(),
  z.object({
    type: z.literal("Circle"), ...COMMON,
    radius: z.number().min(1).max(2500).describe("Radius in dots"),
    fill: COLOR.optional().describe("Fill (default transparent)"),
    stroke: COLOR.optional().describe("Outline (default black)"),
    strokeWidth: STROKE_WIDTH,
  }).strict(),
  z.object({
    type: z.literal("Polyline"),
    left: POS.optional().describe("Omit: points are absolute"),
    top: POS.optional().describe("Omit: points are absolute"),
    originX: COMMON.originX, originY: COMMON.originY, angle: COMMON.angle,
    points: z.array(z.object({ x: POS, y: POS }).strict()).min(2).max(64).describe("Absolute canvas points in dots"),
    stroke: COLOR.optional().describe("Line colour (default black)"),
    strokeWidth: z.number().min(1).max(50).optional().describe("Line width in dots (default 3); ≥2 at 203 dpi"),
  }).strict(),
  z.object({
    type: z.literal("QRCode"), ...COMMON,
    text: z.string().min(1).max(1200).describe("Encoded text or URL"),
    width: z.number().min(42).max(2000).describe("Side of the square in dots; modules must be ≥3 dots"),
    ecl: z.enum(["L", "M", "Q", "H"]).optional().describe("Error correction (default M); L fits more on small labels"),
  }).strict(),
  z.object({
    type: z.literal("Barcode"), ...COMMON,
    text: z.string().min(1).max(229).describe("CODE128B: printable ASCII, never $ or ). EAN13: 12–13 digits"),
    encoding: z.enum(["CODE128B", "EAN13"]).describe("Symbology"),
    height: z.number().min(10).max(2000).describe("Height in dots, including the printed text"),
    scaleFactor: z.number().int().min(1).max(10).optional().describe("Dots per module (default 2); width follows from it"),
    printText: z.boolean().optional().describe("Print the text under the bars (default true)"),
    fontSize: z.number().min(6).max(60).optional().describe("Size of the printed text (default 12)"),
  }).strict(),
]);

/** render_label's input schema (server.ts registers it, skill.test parses recipes with it). */
export const InputSchema = z.object({
  printer: z.enum(MODELS).describe("Printer model, e.g. D110, B1, D11_H: sets dpi, print direction and printable width"),
  width_mm: z.number().min(4).max(300).describe("Label width as set in NiimBlue. B-series (top): runs across the head"),
  height_mm: z.number().min(4).max(300).describe("Label height as set in NiimBlue. D-series (left): the tape width across the head"),
  title: z.string().min(1).max(100).optional().describe("Label name in NiimBlue's saved labels"),
  split: z.enum(["none", "vertical", "horizontal"]).optional().describe("Split the label into parts (cable flags)"),
  split_parts: z.number().int().min(1).max(8).optional().describe("Number of split parts"),
  mirror: z.enum(["none", "copy", "flip"]).optional().describe("Repeat the design into the other split part, optionally rotated"),
  tail_pos: z.enum(["right", "bottom", "left", "top"]).optional().describe("Side of the cable-flag tail"),
  tail_length_mm: z.number().min(0).max(200).optional().describe("Tail length in mm"),
  objects: z.array(OBJECT).min(1).max(100).describe("Objects in paint order: the first is the bottom layer"),
  include_json: z.boolean().optional().describe("Also return the NiimBlue .json export; set it on the final call"),
}).strict();

/** render_label's top-level args (server.ts zod schema output). */
export type LabelArgs = z.infer<typeof InputSchema>;

/** The `label` block of the tool output. */
export type LabelInfo = { printer: string; dpi: number; dpmm: number; print_direction: "left" | "top"; printhead_px: number; width_px: number; height_px: number };

/** Characters outside font.scss's Noto Sans Variable latin + cyrillic unicode-ranges (label.test checks it against font.scss). */
export const NOT_IN_FONT = /[^\u0000-ÿıŒœʻʼˆ˚˜̩̄̈ -⁯⁴€™↑↓−∕﻿�́Ѐ-џҐґҰұ№]/gu;
const FIELD_RX = /{\s*(\$?\w+)(?:([+-])(\d+)([yMwdhms]))?\s*(?:\|\s*(.*?)\s*)?}/g; // canvas_preprocess.ts VARIABLE_TEMPLATE_RX

const suggest = (name: string): string[] => {
  const toks = name.toLowerCase().split("_");
  const score = (n: string) => n.split("_").filter((t) => toks.includes(t)).length * 2 + (n.includes(name) || name.includes(n) ? 1 : 0);
  return Object.keys(ICONS).map((n) => [n, score(n)] as const).filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).slice(0, 5).map(([n]) => n);
};

/** Pure: printer lookup, mm→px, object defaults, Icon→Text, BAD_INPUT guards, node-side warnings. */
export function prepare(args: LabelArgs): { label: LabelInfo; input: PageInput; warnings: RenderWarning[] } {
  const meta = getPrinterMetaByModel(args.printer as PrinterModel)!; // InputSchema's z.enum(MODELS) guarantees a match
  const { dpi, printDirection, printheadPixels: head } = meta;
  const dpmm = ({ 203: 8, 300: 11.81 } as Record<number, number>)[dpi] ?? dpi / 25.4;
  const k = dpmm / 8;
  // as LabelPropsEditor onApply: mm×dpmm, head side down to a multiple of 8, then floor
  let w = args.width_mm * dpmm, h = args.height_mm * dpmm;
  if (printDirection === "left") h -= h % 8; else w -= w % 8;
  const width = Math.floor(w), height = Math.floor(h);
  const headPx = printDirection === "left" ? height : width;
  const warnings: RenderWarning[] = [];
  if (headPx > head) {
    const mm = Math.floor((head / dpmm) * 10) / 10; // mm×dpmm ≤ head, so the px never overflow
    warnings.push({ code: "HEAD_OVERFLOW", message: `The label is ${headPx} px across the printhead but ${args.printer} prints ${head} px, so the rest is not printed; set ${printDirection === "left" ? "height_mm" : "width_mm"} to ${mm} or less.` });
  }
  const fields = (i: number, text: string) => {
    for (const [src, key] of text.matchAll(FIELD_RX)) if (key !== "dt") warnings.push({ code: "UNFILLED_FIELD", object: i, message: `${src} prints literally (only {dt…} is filled); replace it with the real text.` });
  };
  const small = (i: number, size: number) => { if (size < 16 * k) warnings.push({ code: "TEXT_SMALL", object: i, message: `fontSize ${size} is under ${+(16 * k).toFixed(1)} px and prints illegibly; use fontSize ${Math.ceil(16 * k)} or more.` }); };
  const objects = args.objects.map((o, i): object => {
    const base = { originX: "left", originY: "top" }; // fabric 7 and OBJECT_DEFAULTS_TEXT default to center
    if (o.type === "Textbox") {
      const weight = o.fontWeight ?? 600;
      small(i, o.fontSize);
      if (weight < 500 && o.fontSize < 24 * k) warnings.push({ code: "TEXT_THIN", object: i, message: `fontWeight ${weight} at fontSize ${o.fontSize} prints broken strokes; use fontWeight 600 or fontSize ${Math.ceil(24 * k)} or more.` });
      const bad = [...new Set(o.text.match(NOT_IN_FONT))];
      if (bad.length) warnings.push({ code: "GLYPH_FALLBACK", object: i, message: `${bad.slice(0, 5).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} '${c}'`).join(", ")} not in Noto Sans Variable (Latin and Cyrillic only), so each machine substitutes its own font; replace them or use an Icon.` });
      fields(i, o.text);
      return { ...base, fontWeight: 600, ...o };
    }
    if (o.type === "Icon") {
      const cp = ICONS[o.name];
      if (cp === undefined) {
        const s = suggest(o.name);
        throw new NbError("BAD_INPUT", `objects[${i}]: unknown Material Icons name '${o.name}'${s.length ? `; did you mean ${s.join(", ")}?` : "."} Use an exact snake_case name from https://fonts.google.com/icons?icon.set=Material+Icons`);
      }
      const { name: _, ...rest } = o;
      return { ...base, ...rest, type: "Text", text: String.fromCodePoint(cp), fontFamily: "Material Icons", lineHeight: 1 };
    }
    if (o.type === "Rect" || o.type === "Circle" || o.type === "Polyline") {
      const sw = o.strokeWidth ?? 3; // OBJECT_DEFAULTS_VECTOR
      if (o.stroke !== "transparent" && sw > 0 && sw < 2 * k) warnings.push({ code: "STROKE_THIN", object: i, message: `strokeWidth ${sw} is under ${+(2 * k).toFixed(1)} px and drops out in print; use strokeWidth ${Math.ceil(2 * k)} or more.` });
      return { ...base, ...o };
    }
    if (o.type === "QRCode") { fields(i, o.text); return { ...base, ...o, height: o.width }; }
    // shortcut: niimblue barcode.ts:88,93 encode $ and ) wrongly; drop this guard when upstream fixes it
    if (o.encoding === "CODE128B" && /[$)]/.test(o.text)) throw new NbError("BAD_INPUT", `objects[${i}]: Code 128 text contains '$' or ')', which NiimBlue encodes wrongly so the barcode won't scan; remove them or use a QRCode.`);
    if ((o.scaleFactor ?? 2) < 2) warnings.push({ code: "BARCODE_MODULE_SMALL", object: i, message: `scaleFactor ${o.scaleFactor} makes 1 px bars that bleed together; use scaleFactor 2 or more.` });
    if (o.printText ?? true) small(i, o.fontSize ?? 12); // niimblue barcode.ts defaults: printText true, fontSize 12
    fields(i, o.text);
    return { ...base, scaleFactor: 2, ...o };
  });
  const label: LabelProps = { printDirection, size: { width, height }, split: args.split, splitParts: args.split_parts, mirror: args.mirror, tailPos: args.tail_pos,
    tailLength: args.tail_length_mm === undefined ? undefined : Math.floor(args.tail_length_mm * dpmm) };
  return {
    label: { printer: args.printer, dpi, dpmm, print_direction: printDirection, printhead_px: head, width_px: width, height_px: height },
    input: { label, objects, dpmm },
    warnings,
  };
}

/** NiimBlue ExportedLabelTemplate, as the app's export (timestamp in seconds, FileUtils.timestamp). */
export function makeTemplate(label: LabelProps, canvas: object, title?: string): object {
  return { canvas, label, ...(title ? { title } : {}), timestamp: Math.floor(Date.now() / 1000) };
}

/** NiimBlue `#load=` link: appUrl + "#load=" + base64(gzip(JSON(template))); standard base64, the app splits on & and atob()s. */
export function makeLink(appUrl: string, template: object): string {
  return appUrl + "#load=" + gzipSync(JSON.stringify(template)).toString("base64");
}

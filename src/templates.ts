// Template store (save_as, list_templates, get_template) and NiimBlue .json export → render_label args.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { csvParse } from "d3-dsv";
import { getPrinterMetaByModel, type PrinterModel } from "@mmote/niimbluelib";
import { iconCodepoints } from "$/styles/mdi_icons";
import { InputSchema, OBJECT, fieldKeys, printerDpmm, type LabelArgs } from "./label.js";
import { NbError } from "./util/errors.js";
import { NOTO } from "./fonts.js";

/** File-name-safe name: lowercase Unicode letters, marks, digits and dashes (no / \\ or .), so a name can't leave the folder; may be "". */
export const slug = (t?: string) => [...(t ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")].slice(0, 60).join("").replace(/^-|-$/g, "");
/** A template's file stem; a name with no letter or digit is BAD_INPUT, never a shared fallback that would stand in for another template. */
const stem = (name: string) => slug(name) || (() => { throw new NbError("BAD_INPUT", `Template name '${name}' has no letter or digit; pick a name with some.`); })();

const ARGS = ".args.json", EXPORT = ".niimblue.json";

/** Writes <dir>/<slug>.args.json and <dir>/<slug>.niimblue.json; refuses to replace either unless overwrite. */
export async function saveTemplate(dir: string, name: string, args: object, exported: object, overwrite = false) {
  const s = stem(name), args_path = join(dir, s + ARGS), niimblue_path = join(dir, s + EXPORT);
  const hit = [args_path, niimblue_path].find((p) => existsSync(p));
  if (hit && !overwrite) throw new NbError("BAD_INPUT", `Template '${s}' already exists (${hit}); pass overwrite: true to replace it, or pick another save_as.`);
  await mkdir(dir, { recursive: true });
  await writeFile(args_path, JSON.stringify(args, null, 2) + "\n");
  await writeFile(niimblue_path, JSON.stringify(exported, null, 2) + "\n");
  return { args_path, niimblue_path };
}

/** A saved template's render_label args. */
export async function loadTemplate(dir: string, name: string): Promise<Record<string, unknown>> {
  const s = stem(name), p = join(dir, s + ARGS);
  let text: string;
  try { text = await readFile(p, "utf8"); } catch { throw new NbError("BAD_INPUT", `No template '${s}' in ${dir}; call list_templates for the saved names.`); }
  try { return JSON.parse(text); } catch { throw new NbError("BAD_INPUT", `${p} is not valid JSON; fix the file or save the template again.`); }
}

/** Every <name>.args.json in dir, newest first; a missing dir is an empty list. */
export async function listTemplates(dir: string) {
  const files = await readdir(dir).catch(() => [] as string[]);
  const out = await Promise.all(files.filter((f) => f.endsWith(ARGS)).map(async (f) => {
    const name = f.slice(0, -ARGS.length), p = join(dir, f), modified = (await stat(p)).mtime.toISOString();
    try {
      const a = JSON.parse(await readFile(p, "utf8"));
      return { name, title: a.title, printer: a.printer, width_mm: a.width_mm, height_mm: a.height_mm, fields: fieldKeys(a.objects ?? []), rows: a.rows?.length ?? 0, modified };
    } catch { return { name, modified, error: "not valid JSON; fix or delete the file" }; }
  }));
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Reads a NiimBlue .json export (≤ 2 MB) from disk and converts it with fromExport. */
export async function importExport(path: string, printer: string) {
  const p = resolve(path.replace(/^~(?=$|[\\/])/, homedir()));
  if (!p.endsWith(".json")) throw new NbError("BAD_INPUT", `${p} is not a .json file; pass a NiimBlue label export (Saved labels → Export).`);
  const size = await stat(p).then((s) => s.size, () => -1);
  if (size < 0) throw new NbError("BAD_INPUT", `${p} does not exist; check the path.`);
  if (size > 2 * 1024 * 1024) throw new NbError("BAD_INPUT", `${p} is over 2 MB, too big for a label export; pass the label's own .json.`);
  let json: unknown;
  try { json = JSON.parse(await readFile(p, "utf8")); } catch { throw new NbError("BAD_INPUT", `${p} is not valid JSON; pass a NiimBlue label export.`); }
  return fromExport(json, printer);
}

const ICON_NAME = new Map(Object.entries(iconCodepoints as Record<string, number>).reverse().map(([n, cp]) => [cp, n])); // reversed: the first name wins
const SHAPES = new Map(OBJECT.options.map((o) => [o.shape.type.value as string, o.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>]));
const COMMON_D = { originX: "left", originY: "top", angle: 0 };
const VECTOR_D = { ...COMMON_D, fill: "transparent", stroke: "black", strokeWidth: 3 };
/** What label.ts or the page fills in when a key is omitted: such values are left out of the args. */
const OURS: Record<string, Record<string, unknown>> = {
  Textbox: { ...COMMON_D, fontFamily: NOTO, fontWeight: 600, fontStyle: "normal", textAlign: "center", lineHeight: 1, charSpacing: 0, scaleX: 1, fontAutoSize: false, fill: "black", backgroundColor: "transparent" },
  Icon: { ...COMMON_D, fill: "black" },
  Rect: { ...VECTOR_D, rx: 0, ry: 0 }, Circle: VECTOR_D, Polyline: VECTOR_D,
  QRCode: { ...COMMON_D, ecl: "M" },
  Barcode: { ...COMMON_D, scaleFactor: 2, printText: true, fontSize: 12, fontFamily: NOTO },
};
/** fabric 7 / NiimBlue defaults for keys render_label has no param for: a different value is reported in notes. */
const FABRIC: Record<string, unknown> = {
  pathStartOffset: 0, pathSide: "left", pathAlign: "baseline", underline: false, overline: false, linethrough: false, textBackgroundColor: "",
  direction: "ltr", textDecorationThickness: 66.667, minWidth: 20, splitByGrapheme: false, stroke: null, strokeWidth: 1, strokeDashArray: null,
  strokeLineCap: "butt", strokeDashOffset: 0, strokeLineJoin: "miter", strokeMiterLimit: 4, scaleX: 1, scaleY: 1, flipX: false, flipY: false,
  opacity: 1, shadow: null, visible: true, backgroundColor: "", fillRule: "nonzero", paintFirst: "fill", globalCompositeOperation: "source-over",
  skewX: 0, skewY: 0, startAngle: 0, endAngle: 360, counterClockwise: false, mode: "Byte", qrVersion: 0,
};
const SKIP = new Set(["version", "strokeUniform", "snapAngle", "width", "height"]); // derived from other keys, or not drawn
const SKIP_BY_TYPE: Record<string, string[]> = { // keys the object's own _render ignores or that the Icon conversion fixes
  QRCode: ["fill", "stroke", "strokeWidth"], Barcode: ["fill", "stroke", "strokeWidth"],
  Icon: ["text", "fontFamily", "fontWeight", "fontStyle", "lineHeight", "textAlign", "charSpacing"],
};
const COLORS: Record<string, string> = { "#000": "black", "#000000": "black", "rgb(0,0,0)": "black", "#fff": "white", "#ffffff": "white", "rgb(255,255,255)": "white", "": "transparent" };
const norm = (k: string, v: unknown) =>
  ["fill", "stroke", "backgroundColor"].includes(k) ? (v === null ? "transparent" : typeof v === "string" ? COLORS[v.replace(/\s/g, "").toLowerCase()] ?? v.toLowerCase() : v)
  : k === "fontWeight" ? ({ normal: 400, bold: 700 } as Record<string, number>)[String(v)] ?? Number(v)
  : k === "points" && Array.isArray(v) ? v.map((p) => ({ x: p?.x, y: p?.y })) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * NiimBlue ExportedLabelTemplate (the app's Export, or a .niimblue.json) → render_label args for `printer`.
 * Keeps what the schema can say; anything else that differs from fabric's default is listed in notes; Image/ArUco/Path/Group are BAD_INPUT.
 */
export function fromExport(t: any, printer: string): { args: LabelArgs; notes: string[] } {
  if (!Array.isArray(t?.canvas?.objects) || !t?.label?.size) throw new NbError("BAD_INPUT", "Not a NiimBlue label export (no canvas.objects or label.size); pass a file from Saved labels → Export.");
  const notes: string[] = [], dpmm = printerDpmm(printer), L = t.label;
  const mm = (px: number) => Math.ceil(+((px / dpmm) * 100).toFixed(6)) / 100; // up to 0.01 mm, so label.ts's floor(mm × dpmm) gives the px back
  // the render_label type for a fabric object, or undefined when it has none
  const kind = (o: any): string | undefined => o?.type === "Text" && o.fontFamily === "Material Icons" ? (ICON_NAME.has(o.text?.codePointAt(0)) ? "Icon" : undefined)
    : o?.type === "Text" ? "Textbox" : o?.type !== "Icon" && SHAPES.has(o?.type) ? o.type : undefined;
  const bad = t.canvas.objects.flatMap((o: any, i: number) => kind(o) ? [] : [`${i} (${o?.type})`]);
  if (bad.length) throw new NbError("BAD_INPUT", `objects ${bad.join(", ")} can't be converted: render_label takes Textbox, Material Icons, Rect, Circle, Polyline, QRCode and Barcode only (no images, ArUco markers, paths or groups); delete them in NiimBlue and export again.`);

  const objects = t.canvas.objects.map((src: any, i: number) => {
    const type = kind(src)!, shape = SHAPES.get(type)!, skip = new Set([...SKIP, ...(SKIP_BY_TYPE[type] ?? [])]);
    const other = type === "Textbox" && typeof src.fontFamily === "string" && src.fontFamily.toLowerCase() !== NOTO.toLowerCase();
    const ours = other ? { ...OURS.Textbox, fontWeight: 400 } : OURS[type]; // label.ts defaults a non-Noto family to 400, not 600
    const o: Record<string, unknown> = { type };
    for (const [k, raw] of Object.entries(src)) {
      const v = norm(k, raw), dflt = k in ours && same(v, ours[k]);
      if (k === "type" || dflt) continue;
      if (k in shape) {
        if (shape[k].safeParse(v).success) o[k] = v;
        else notes.push(`objects[${i}]: ${k} ${JSON.stringify(raw)} is not supported, dropped.`);
      } else if (!skip.has(k) && !(k in FABRIC && same(raw, FABRIC[k])) && !(k === "styles" && !Object.keys(raw ?? {}).length))
        notes.push(`objects[${i}]: ${k} ${JSON.stringify(raw)} has no render_label param, dropped.`);
    }
    if (type === "Icon") o.name = ICON_NAME.get(src.text.codePointAt(0));
    if (src.type === "Text" && type === "Textbox") {
      o.width = Math.ceil(src.width ?? 0) + 1; // a static Text never wraps; 1 px slack keeps the Textbox on one line
      notes.push(`objects[${i}]: static Text became a Textbox ${o.width} px wide; check it doesn't wrap.`);
    }
    return o;
  });

  const dir = getPrinterMetaByModel(printer as PrinterModel)!.printDirection;
  if (L.printDirection && L.printDirection !== dir) notes.push(`The export prints ${L.printDirection} but ${printer} prints ${dir}: the design keeps its x/y, so check it reads the right way up.`);
  if (L.shape && L.shape !== "rect") notes.push(`Label shape ${L.shape} has no render_label param, dropped.`);
  const args: Record<string, unknown> = { printer, width_mm: mm(L.size.width), height_mm: mm(L.size.height), ...(t.title ? { title: t.title } : {}) };
  for (const [from, to] of [["split", "split"], ["splitParts", "split_parts"], ["mirror", "mirror"], ["tailPos", "tail_pos"]]) if (L[from] !== undefined) args[to] = L[from];
  if (L.tailLength !== undefined) args.tail_length_mm = mm(L.tailLength);
  args.objects = objects;
  if (t.csv?.data) {
    const csv = csvParse(t.csv.data), rows = csv.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "$times").map(([k, v]) => [k, (v ?? "").replaceAll("\\n", "\n")])));
    if (csv.columns.includes("$times")) notes.push("The CSV's $times column is not supported, dropped: each row prints once.");
    if (rows.length) args.rows = rows;
  }
  const p = InputSchema.safeParse(args);
  if (!p.success) throw new NbError("BAD_INPUT", `The export converts to args render_label rejects:\n${p.error.issues.slice(0, 10).map((e) => `${e.path.join(".")}: ${e.message}`).join("\n")}\nFix those objects in NiimBlue and export again.`);
  return { args: p.data, notes };
}

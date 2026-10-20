import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ExportedLabelTemplateSchema } from "$/types";
import { InputSchema, prepare, makeTemplate, makeLink, NOT_IN_FONT, MODELS, type LabelArgs } from "../src/label.js";
import { NbError } from "../src/util/errors.js";

const run = (printer: string, width_mm: number, height_mm: number, objects: LabelArgs["objects"], extra: Partial<LabelArgs> = {}) =>
  prepare(InputSchema.parse({ printer, width_mm, height_mm, objects, ...extra }));
const rect: LabelArgs["objects"] = [{ type: "Rect", left: 0, top: 0, width: 10, height: 10 }];
const text = (t: string, fontSize = 32, fontWeight?: number): LabelArgs["objects"] => [{ type: "Textbox", left: 0, top: 0, width: 100, text: t, fontSize, ...(fontWeight ? { fontWeight } : {}) }];
const codes = (r: ReturnType<typeof prepare>) => r.warnings.map((w) => w.code);
const bad = (f: () => unknown) => { try { f(); } catch (e) { expect(e).toBeInstanceOf(NbError); expect((e as NbError).code).toBe("BAD_INPUT"); return (e as NbError).message; } throw new Error("no throw"); };

describe("sizes", () => {
  it("D110 40×12 → 320×96 left", () => expect(run("D110", 40, 12, rect).label).toEqual({ printer: "D110", dpi: 203, dpmm: 8, print_direction: "left", printhead_px: 96, width_px: 320, height_px: 96 }));
  it("B1 50×30 → 400×240 top", () => expect(run("B1", 50, 30, rect).input.label).toEqual({ printDirection: "top", size: { width: 400, height: 240 } }));
  it("D11_H 40×12 → 472×136 at 11.81", () => {
    const r = run("D11_H", 40, 12, rect, { tail_length_mm: 10, tail_pos: "right", split: "horizontal", mirror: "copy" });
    expect(r.input.label).toEqual({ printDirection: "left", size: { width: 472, height: 136 }, tailLength: 118, tailPos: "right", split: "horizontal", mirror: "copy" });
    expect(r.input.dpmm).toBe(11.81);
  });
  it("every model resolves", () => { expect(MODELS.length).toBeGreaterThan(70); for (const p of MODELS) expect(run(p, 40, 12, rect).label.dpmm).toBeGreaterThan(0); });
});

describe("warnings", () => {
  it("HEAD_OVERFLOW names a size that fits", () => {
    const r = run("D110", 40, 14, rect);
    expect(codes(r)).toEqual(["HEAD_OVERFLOW"]);
    expect(r.warnings[0].message).toContain("height_mm to 12 or less");
    expect(codes(run("D110", 40, 12, rect))).toEqual([]);
    const m = run("D11_H", 40, 14, rect).warnings[0].message.match(/to ([\d.]+) or less/)!;
    expect(run("D11_H", 40, +m[1], rect).label.height_px).toBe(136);
    expect(run("B1", 50, 30, rect, { width_mm: 60 }).warnings[0].message).toContain("width_mm to 48 or less");
  });
  it("TEXT_SMALL / TEXT_THIN scale with dpi", () => {
    expect(codes(run("D110", 40, 12, text("A", 15)))).toEqual(["TEXT_SMALL"]);
    expect(codes(run("D110", 40, 12, text("A", 16)))).toEqual([]);
    expect(codes(run("D110", 40, 12, text("A", 20, 400)))).toEqual(["TEXT_THIN"]);
    expect(codes(run("D110", 40, 12, text("A", 24, 400)))).toEqual([]);
    expect(codes(run("D11_H", 40, 12, text("A", 20)))).toEqual(["TEXT_SMALL"]);
    expect(codes(run("D11_H", 40, 12, text("A", 30, 400)))).toEqual(["TEXT_THIN"]);
    expect(codes(run("D11_H", 40, 12, text("A", 36, 400)))).toEqual([]);
  });
  it("STROKE_THIN and BARCODE_MODULE_SMALL", () => {
    expect(codes(run("D110", 40, 12, [{ type: "Rect", left: 0, top: 0, width: 9, height: 9, strokeWidth: 1 }]))).toEqual(["STROKE_THIN"]);
    expect(codes(run("D110", 40, 12, [{ type: "Rect", left: 0, top: 0, width: 9, height: 9, strokeWidth: 0 }]))).toEqual([]);
    expect(codes(run("D11_H", 40, 12, [{ type: "Circle", left: 0, top: 0, radius: 9, strokeWidth: 2 }]))).toEqual(["STROKE_THIN"]);
    expect(codes(run("D110", 40, 12, [{ type: "Barcode", left: 0, top: 0, text: "AB1", encoding: "CODE128B", height: 40, scaleFactor: 1, fontSize: 16 }]))).toEqual(["BARCODE_MODULE_SMALL"]);
    expect(codes(run("D110", 40, 12, [{ type: "Barcode", left: 0, top: 0, text: "AB1", encoding: "CODE128B", height: 40 }]))).toEqual(["TEXT_SMALL"]); // upstream default fontSize 12
    expect(codes(run("D110", 40, 12, [{ type: "Barcode", left: 0, top: 0, text: "AB1", encoding: "CODE128B", height: 40, printText: false }]))).toEqual([]);
  });
  it("GLYPH_FALLBACK for → but not Привет or é", () => {
    const r = run("D110", 40, 12, text("A → B"));
    expect(codes(r)).toEqual(["GLYPH_FALLBACK"]);
    expect(r.warnings[0]).toMatchObject({ object: 0, message: expect.stringContaining("U+2192 '→'") });
    expect(codes(run("D110", 40, 12, text("Привет café")))).toEqual([]);
  });
  it("NOT_IN_FONT matches font.scss unicode-range exactly", () => {
    const scss = readFileSync("node_modules/niimblue/src/styles/font.scss", "utf8");
    const ranges = [...scss.matchAll(/unicode-range:([^;]+);/g)].flatMap((m) => m[1].split(",")).map((s) => s.trim().slice(2).split("-").map((h) => parseInt(h, 16)));
    expect(ranges.length).toBeGreaterThan(20);
    for (let cp = 0; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const inFont = ranges.some(([a, b = a]) => cp >= a && cp <= b);
      expect(new RegExp(NOT_IN_FONT.source, "u").test(String.fromCodePoint(cp)), `U+${cp.toString(16)}`).toBe(!inFont);
    }
  });
  it("UNFILLED_FIELD for {name}, not {dt…}", () => {
    const r = run("D110", 40, 12, text("{dt} {dt+7d|DD.MM.YYYY} {name}"));
    expect(r.warnings).toEqual([{ code: "UNFILLED_FIELD", object: 0, message: expect.stringContaining("{name}") }]);
    expect(codes(run("D110", 40, 12, [{ type: "QRCode", left: 0, top: 0, width: 60, text: "{sku}" }]))).toEqual(["UNFILLED_FIELD"]);
  });
});

describe("objects", () => {
  it("writes origins and defaults", () => {
    const r = run("D110", 40, 12, [...text("A"), { type: "QRCode", left: 1, top: 2, width: 60, text: "x" }, { type: "Barcode", left: 0, top: 0, text: "1", encoding: "CODE128B", height: 40 }, { type: "Polyline", points: [{ x: 0, y: 0 }, { x: 9, y: 9 }] }]);
    expect(r.input.objects).toEqual([
      { type: "Textbox", originX: "left", originY: "top", fontWeight: 600, left: 0, top: 0, width: 100, text: "A", fontSize: 32 },
      { type: "QRCode", originX: "left", originY: "top", left: 1, top: 2, width: 60, height: 60, text: "x" },
      { type: "Barcode", originX: "left", originY: "top", scaleFactor: 2, left: 0, top: 0, text: "1", encoding: "CODE128B", height: 40 },
      { type: "Polyline", originX: "left", originY: "top", points: [{ x: 0, y: 0 }, { x: 9, y: 9 }] },
    ]);
  });
  it("Icon lan → Material Icons Text", () => {
    expect(run("D110", 40, 12, [{ type: "Icon", name: "lan", left: 4, top: 4, fontSize: 64, originX: "center" }]).input.objects[0]).toEqual(
      { type: "Text", originX: "center", originY: "top", left: 4, top: 4, fontSize: 64, text: String.fromCodePoint(0xeb2f), fontFamily: "Material Icons", lineHeight: 1 });
  });
  it("unknown icon is BAD_INPUT with suggestions", () => {
    const m = bad(() => run("D110", 40, 12, [{ type: "Icon", name: "wine_glass", left: 0, top: 0, fontSize: 64 }]));
    expect(m).toMatch(/did you mean .*wine_bar/);
    expect(m.match(/did you mean ([^?]+)\?/)![1].split(", ").length).toBeLessThanOrEqual(5);
  });
  it("Code 128 with $ or ) is BAD_INPUT, EAN13 untouched", () => {
    bad(() => run("D110", 40, 12, [{ type: "Barcode", left: 0, top: 0, text: "A$1", encoding: "CODE128B", height: 40 }]));
    bad(() => run("D110", 40, 12, [{ type: "Barcode", left: 0, top: 0, text: "A)1", encoding: "CODE128B", height: 40 }]));
  });
  it("schema rejects extra keys and unknown printers", () => {
    expect(InputSchema.safeParse({ printer: "D110", width_mm: 40, height_mm: 12, objects: [{ ...rect[0], foo: 1 }] }).success).toBe(false);
    expect(InputSchema.safeParse({ printer: "D999", width_mm: 40, height_mm: 12, objects: rect }).success).toBe(false);
    expect(InputSchema.safeParse({ printer: "D110", width_mm: 40, height_mm: 12, objects: rect, x: 1 }).success).toBe(false);
  });
});

describe("template and link", () => {
  const r = run("D110", 40, 12, text("Hello {dt}"), { split: "vertical", split_parts: 2, tail_pos: "right", tail_length_mm: 5 });
  const tpl = makeTemplate(r.input.label, { version: "7.4.0", objects: r.input.objects }, "Jar");
  it("validates with NiimBlue's ExportedLabelTemplateSchema", () => expect(ExportedLabelTemplateSchema.safeParse(tpl).error).toBeUndefined());
  it("link gunzips back to the template, no %", () => {
    const link = makeLink("https://niim.blue/", tpl);
    expect(link.startsWith("https://niim.blue/#load=")).toBe(true);
    expect(link).not.toContain("%");
    expect(JSON.parse(gunzipSync(Buffer.from(link.split("#load=")[1], "base64")).toString())).toEqual(tpl);
  });
});

describe("pins", () => {
  const PINS = { fabric: "7.4.0", "qrcode-generator": "2.0.4", dayjs: "1.11.21", "@fontsource-variable/noto-sans": "5.2.10", "material-icons": "1.13.14", "@mmote/niimbluelib": "0.47.0" };
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")).packages as Record<string, unknown>;
  it.each(Object.entries(PINS))("%s is %s, installed once", (name, v) => {
    expect(JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version).toBe(v);
    expect(Object.keys(lock).filter((k) => k.endsWith(`node_modules/${name}`))).toEqual([`node_modules/${name}`]);
    expect(existsSync(`node_modules/niimblue/node_modules/${name}`)).toBe(false);
  });
});

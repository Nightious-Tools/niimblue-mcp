import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { iconCodepoints } from "$/styles/mdi_icons";
import { ExportedLabelTemplateSchema } from "$/types";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLabel } from "../src/chrome.js";
import { InputSchema, prepare } from "../src/label.js";
import { resolveFonts } from "../src/fontdir.js";
import { BUILTIN } from "../src/fonts.js";
import { CHROME } from "./helpers.js";

const B1: LabelProps = { printDirection: "top", size: { width: 384, height: 240 } };
const LT = { originX: "left", originY: "top" };

async function render(objects: object[], label: LabelProps = B1, variables?: Record<string, string>) {
  const r = await renderLabel({ label, objects, dpmm: 8, variables });
  const png = PNG.sync.read(Buffer.from(r.png_b64, "base64"));
  const { width: W, height: H } = label.size;
  const black = (x: number, y: number) => png.data[(y * r.zoom * png.width + x * r.zoom) * 4] === 0;
  let ink = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ink += +black(x, y);
  return { ...r, png, black, ink, codes: r.warnings.map((w) => w.code) };
}

describe.skipIf(!CHROME && !process.env.CI)("page render (real Chrome)", () => {
  it("returns a pure 1-bit PNG at zoom, and a canvas NiimBlue's own schema accepts", async () => {
    const r = await render([{ type: "Rect", left: 10, top: 10, width: 100, height: 40 }]);
    expect(r.zoom).toBe(3); // floor(1200/384)
    expect([r.png.width, r.png.height]).toEqual([384 * 3, 240 * 3]);
    for (let i = 0; i < r.png.data.length; i += 4) {
      const [R, G, B, A] = r.png.data.subarray(i, i + 4);
      if (!(R === G && G === B && (R === 0 || R === 255) && A === 255)) throw new Error(`pixel ${i / 4} is ${R},${G},${B},${A}`);
    }
    expect(ExportedLabelTemplateSchema.safeParse({ canvas: r.canvas, label: B1 }).success).toBe(true);
    expect(r.boxes).toEqual([{ i: 0, type: "Rect", left: 10, top: 10, width: 103, height: 43 }]);
    expect(r.warnings).toEqual([]);
  });

  it("draws Rect stroke 3 and fabric 7 Polyline points where NiimBlue does", async () => {
    const r = await render([
      { type: "Rect", left: 10, top: 10, width: 100, height: 40 },
      { type: "Polyline", points: [{ x: 10, y: 80 }, { x: 200, y: 80 }], strokeWidth: 2 },
    ]);
    for (const [x, y] of [[10, 10], [12, 30], [11, 52], [112, 10]]) expect(r.black(x, y), `${x},${y}`).toBe(true);
    for (const [x, y] of [[9, 30], [13, 30], [20, 25], [113, 30], [11, 53]]) expect(r.black(x, y), `${x},${y}`).toBe(false);
    for (const [x, y] of [[10, 79], [100, 80], [199, 79]]) expect(r.black(x, y), `${x},${y}`).toBe(true);
    for (const [x, y] of [[100, 77], [100, 82], [8, 79], [202, 79]]) expect(r.black(x, y), `${x},${y}`).toBe(false);
  });

  it("places a Polyline axis from its points when only the other one is given", async () => {
    const line = { type: "Polyline", ...LT, points: [{ x: 20, y: 100 }, { x: 200, y: 100 }], strokeWidth: 2 };
    const r = await render([{ ...line, left: 20 }, { ...line, top: 150 }]);
    expect(r.boxes.map((b) => [b.left, b.top])).toEqual([[20, 99], [19, 150]]);
  });

  it("puts a QR symbol at its box corner and jsQR decodes it", async () => {
    const corner = await render([{ type: "QRCode", left: 8, top: 8, width: 84, text: "A" }]);
    expect([corner.black(8, 8), corner.black(91, 8), corner.black(92, 8), corner.black(7, 8)]).toEqual([true, true, false, false]);
    expect(corner.warnings).toEqual([]); // 8 px = 1 mm is not NEAR_EDGE; off-label counts as quiet
    for (const width of [63, 105]) expect((await render([{ type: "QRCode", left: 100, top: 60, width, text: "A" }])).warnings, `${width}`).toEqual([]); // odd m·n: far-edge scan must start past the last module
    const text = "https://inv.example.com/a/LT-0042";
    const r = await render([{ type: "QRCode", left: 40, top: 40, width: 126, text }]);
    expect(jsQR(new Uint8ClampedArray(r.png.data), r.png.width, r.png.height)?.data).toBe(text);
    expect(r.warnings).toEqual([]);
  });

  it("renders Noto 700 text and a Material Icon with the bundled fonts, ink within their boxes", async () => {
    const r = await render([
      { type: "Textbox", ...LT, left: 16, top: 16, width: 240, text: "FLOUR\nПривет é", fontSize: 40, fontWeight: 700, fontFamily: "Noto Sans Variable" },
      { type: "Textbox", ...LT, left: 16, top: 160, width: 240, text: "since {dt|YYYY}", fontSize: 24, fontWeight: 500, fontStyle: "italic" },
      { type: "Text", ...LT, left: 280, top: 16, text: String.fromCodePoint(iconCodepoints.lan), fontSize: 64, fontFamily: "Material Icons", lineHeight: 1 },
    ]);
    expect(r.warnings).toEqual([]);
    // ±2 px: Material Icons glyphs rise 2 px above fabric's line box at 64 px (the app draws them the same way)
    const inBox = (x: number, y: number) => r.boxes.some((b) => x >= b.left - 2 && x < b.left + b.width + 2 && y >= b.top - 2 && y < b.top + b.height + 2);
    let inside = 0, outside = 0;
    for (let y = 0; y < 240; y++) for (let x = 0; x < 384; x++) if (r.black(x, y)) inBox(x, y) ? inside++ : outside++;
    expect(outside).toBe(0);
    expect((r.canvas as any).objects[1].text).toBe("since {dt|YYYY}"); // the link keeps the field; only the preview resolves it
    const icon = r.boxes[2];
    let iconInk = 0;
    for (let y = icon.top; y < icon.top + icon.height; y++) for (let x = icon.left; x < icon.left + icon.width; x++) iconInk += +r.black(x, y);
    expect(iconInk / (icon.width * icon.height)).toBeGreaterThan(0.2); // the glyph, not a fallback box or the ligature-less letters
    expect(icon.width).toBeLessThan(70); // one 64 px glyph
  });

  it("fires every page warning code, and only it", async () => {
    const qrText = "https://inv.example.com/a/LT-0042";
    const cases: Array<[string, object[]]> = [
      ["OFF_LABEL", [{ type: "Textbox", ...LT, left: 300, top: 100, width: 120, text: "EDGE", fontSize: 32 }]],
      ["OFF_LABEL", [{ type: "Rect", left: 400, top: 10, width: 20, height: 20 }]],
      ["NEAR_EDGE", [{ type: "Textbox", ...LT, left: 3, top: 100, width: 120, text: "EDGE", fontSize: 32 }]],
      ["QR_ERR", [{ type: "QRCode", left: 40, top: 40, width: 42, text: "x".repeat(600) }]],
      ["QR_MODULE_SMALL", [{ type: "QRCode", left: 40, top: 40, width: 60, text: qrText }]],
      ["QR_QUIET_ZONE", [{ type: "QRCode", left: 40, top: 40, width: 126, text: qrText }, { type: "Rect", left: 172, top: 60, width: 4, height: 40, fill: "black", strokeWidth: 0 }]],
      ["BARCODE_ERR", [{ type: "Barcode", left: 40, top: 40, height: 60, encoding: "EAN13", text: "12345abc" }]],
      ["TEXT_WRAPPED", [{ type: "Textbox", ...LT, left: 16, top: 16, width: 200, text: "NOT FOR HUMAN CONSUMPTION", fontSize: 17, fontWeight: 500, charSpacing: 20 }]],
      ["BARCODE_QUIET_ZONE", [{ type: "Barcode", left: 60, top: 40, height: 60, scaleFactor: 2, encoding: "CODE128B", text: "AB-100" }, { type: "Rect", left: 44, top: 50, width: 4, height: 20, fill: "black", strokeWidth: 0 }]],
    ];
    const results = await Promise.all(cases.map(([, objects]) => render(objects)));
    results.forEach((r, n) => expect(r.codes, cases[n][0]).toEqual([cases[n][0]]));
    expect(results[0].warnings[0]).toMatchObject({ object: 0, message: expect.stringMatching(/move it inside/) });
    // the clean twins stay silent
    const clean = await Promise.all([
      render([{ type: "Barcode", left: 60, top: 40, height: 60, scaleFactor: 2, encoding: "CODE128B", text: "AB-100" }]),
      render([{ type: "Barcode", left: 60, top: 40, height: 60, scaleFactor: 2, encoding: "EAN13", text: "4006381333931" }]),
      render([{ type: "Textbox", ...LT, left: 16, top: 16, width: 200, text: "NOT FOR HUMAN\nCONSUMPTION", fontSize: 17, fontWeight: 500, charSpacing: 20 }]),
    ]);
    clean.forEach((r) => expect(r.warnings).toEqual([]));
  });

  it("draws row 1 of variables while the canvas keeps the {key} fields", async () => {
    const tb = (text: string) => [{ type: "Textbox", ...LT, left: 16, top: 16, width: 352, text, fontSize: 40, fontWeight: 700 }];
    const [filled, literal, blank] = await Promise.all([render(tb("{a}"), B1, { a: "WWWWWW" }), render(tb("WWWWWW")), render(tb("{a} x"), B1, { a: "" })]);
    expect(filled.ink).toBe(literal.ink);
    expect((filled.canvas as any).objects[0].text).toBe("{a}");
    expect(blank.boxes[0].width).toBeGreaterThan(0);
    expect(blank.ink).toBeLessThan((await render(tb("{a} x"))).ink); // "" draws nothing; the unfilled field draws "{a}"
  });

  it("mirror copy across a horizontal split doubles the ink", async () => {
    const label: LabelProps = { printDirection: "left", size: { width: 320, height: 192 }, split: "horizontal", splitParts: 2 };
    const text = [{ type: "Textbox", ...LT, left: 16, top: 16, width: 280, text: "NAS PSU", fontSize: 48, fontWeight: 700 }];
    const [one, two] = await Promise.all([render(text, { ...label, mirror: "none" }), render(text, { ...label, mirror: "copy" })]);
    expect(two.ink / one.ink).toBeGreaterThan(1.98);
    expect(two.ink / one.ink).toBeLessThan(2.02);
    expect(two.boxes).toHaveLength(1); // boxes are the input objects, not the mirrored clones
  });
});

describe.skipIf(!CHROME && !process.env.CI)("fonts (real Chrome)", () => {
  const font = (f: string) => fileURLToPath(new URL(`../fonts/${f}.woff2`, import.meta.url));
  const folder = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "niimblue-fonts-"));
    for (const [name, src] of Object.entries(files)) src.startsWith("/") ? copyFileSync(src, join(dir, name)) : writeFileSync(join(dir, name), src);
    return dir;
  };
  const NONE = join(tmpdir(), "niimblue-test-fonts-unused");
  /** The server's path: prepare, resolveFonts, render; the PNG and every warning code. */
  async function label(fontFamily: string | undefined, dir = NONE, text = "Hamburg 123", extra: object = {}) {
    const a = InputSchema.parse({ printer: "B1", width_mm: 48, height_mm: 30, objects: [{ type: "Textbox", text, left: 16, top: 16, width: 352, fontSize: 40, ...(fontFamily ? { fontFamily } : {}), ...extra }] });
    const { input, warnings } = prepare(a), f = await resolveFonts(dir, a.objects);
    const r = await renderLabel({ ...input, fonts: f.fonts });
    const all = [...warnings, ...f.warnings.filter((w) => !r.warnings.some((p) => p.code === "FONT_MISSING" && p.object === w.object)), ...r.warnings]; // as server.ts
    return { png: r.png_b64, all, codes: all.map((w) => w.code) };
  }

  it("each built-in draws differently from Noto, and only asks for its file", async () => {
    const [noto, ...rest] = await Promise.all([label(undefined), ...BUILTIN.map((b) => label(b.family))]);
    expect(noto.codes).toEqual([]);
    rest.forEach((r, i) => { expect(r.codes, BUILTIN[i].family).toEqual(["FONT_NOT_IN_LINK"]); expect(r.png, BUILTIN[i].family).not.toBe(noto.png); });
    expect(new Set(rest.map((r) => r.png)).size).toBe(BUILTIN.length);
  });

  it("a folder file loads, and beats the built-in of the same name", async () => {
    const dir = folder({ "Fixture Face.woff2": font("Bitter Bold"), "Bitter Bold.woff2": font("JetBrains Mono Bold") });
    const [fixture, bitter, shadowed, mono, w400] = await Promise.all([label("Fixture Face", dir), label("Bitter Bold"), label("Bitter Bold", dir), label("JetBrains Mono Bold"), label("Bitter Bold", NONE, undefined, { fontWeight: 400 })]);
    expect(fixture.codes).toEqual(["FONT_NOT_IN_LINK"]);
    expect(fixture.png).toBe(bitter.png);
    expect(shadowed.png).toBe(mono.png);
    expect(w400.png).toBe(bitter.png); // the default is 400: the file as drawn
  });

  it("an .otf loads; an unknown family and a broken file are FONT_MISSING, not a failed render", async () => {
    const dir = folder({ "Barlow Otf.otf": fileURLToPath(new URL("fixtures/BarlowCondensed-Bold.otf", import.meta.url)), "Junk.ttf": "not a font" });
    const [otf, unknown, junk, noto] = await Promise.all([label("Barlow Otf", dir), label("No Such Face", dir), label("Junk", dir), label(undefined)]);
    expect(otf.codes).toEqual(["FONT_NOT_IN_LINK"]);
    expect(otf.png).not.toBe(noto.png);
    expect(unknown.codes).toEqual(["FONT_MISSING"]);
    expect(junk.codes).toEqual(["FONT_MISSING"]);
    expect(junk.all[0].message).toMatch(/not a valid font file/);
  });

  it("GLYPH_FALLBACK names what a built-in lacks, nothing for Latin", async () => {
    const [cyr, latin] = await Promise.all([label("Bitter Bold", NONE, "Hello ж"), label("Bitter Bold", NONE, "Hello, world! 0-9 é")]);
    expect(cyr.codes).toEqual(["FONT_NOT_IN_LINK", "GLYPH_FALLBACK"]);
    expect(cyr.all[1]).toMatchObject({ object: 0, message: expect.stringMatching(/^U\+0436 'ж' not in Bitter Bold/) });
    expect(latin.codes).toEqual(["FONT_NOT_IN_LINK"]);
  });
});

import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createServer, INSTRUCTIONS, type Deps } from "../src/server.js";
import { NbError } from "../src/util/errors.js";
import { BUILTIN } from "../src/fonts.js";
import { fakeRender, testConfig } from "./helpers.js";

const LABEL = { printer: "D110", width_mm: 40, height_mm: 12, objects: [{ type: "Textbox", text: "LAN", left: 8, top: 8, width: 300, fontSize: 48 }] };

// v2 in-process client: the handler's fetch takes a Request, the client transport calls fetch(url, init)
async function connect(deps: Deps = {}) {
  const handler = createMcpHandler(() => createServer({ cfg: testConfig(), render: fakeRender(), ...deps }));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (u, i) => handler.fetch(new Request(u, i)) }));
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { raw: r, json: JSON.parse(r.content.find((c: any) => c.type === "text").text) };
  };
  const call = (args: Record<string, unknown>) => tool("render_label", args);
  return { client, call, tool, close: async () => { await client.close(); await handler.close(); } };
}

/** Every `properties` key anywhere in a JSON Schema. */
const propNames = (s: unknown): string[] => !s || typeof s !== "object" ? [] :
  Object.entries(s).flatMap(([k, v]) => k === "properties" && v && typeof v === "object" ? [...Object.keys(v), ...Object.values(v).flatMap(propNames)] : propNames(v));

describe("MCP server", () => {
  it("exposes render_label (writes only for save_as) and three read-only tools, with portable schemas", async () => {
    const c = await connect();
    const tools = (await c.client.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(["render_label", "list_templates", "list_fonts", "get_template"]);
    expect(tools[0].annotations).toEqual({ title: "Render NiimBlue label", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(tools.slice(1).map((t) => t.annotations?.readOnlyHint)).toEqual([true, true, true]);
    for (const t of tools) {
      const s = t.inputSchema as any;
      expect(s.type).toBe("object");
      for (const k of ["anyOf", "oneOf", "allOf"]) expect(s[k]).toBeUndefined();
      for (const n of propNames(s)) expect(n).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
    }
    expect(propNames(tools[0].inputSchema)).toContain("objects");
    expect(c.client.getInstructions()).toBe(INSTRUCTIONS);
    await c.close();
  });

  it("returns the PNG, then text JSON equal to structuredContent, with a #load link on the configured app", async () => {
    const render = fakeRender({ warnings: [{ code: "NEAR_EDGE", object: 0, message: "move it" }] });
    const c = await connect({ render, cfg: testConfig({ appUrl: "http://localhost:4391/" }) });
    const { raw, json } = await c.call(LABEL);
    expect(raw.isError).toBeFalsy();
    expect(raw.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(raw.content).toHaveLength(2);
    expect(json).toEqual(raw.structuredContent); // the server checks structuredContent against outputSchema, else isError
    expect(json).toMatchObject({ ok: true, tool: "render_label", zoom: 2, label: { printer: "D110", dpi: 203, print_direction: "left" } });
    expect(json.warnings).toContainEqual({ code: "NEAR_EDGE", object: 0, message: "move it" });
    expect(json.link).toMatch(/^http:\/\/localhost:4391\/#load=[A-Za-z0-9+/=]+$/);
    expect(json.link_chars).toBe(json.link.length);
    const tpl = JSON.parse(gunzipSync(Buffer.from(json.link.split("#load=")[1], "base64")).toString());
    expect(tpl.label).toEqual(render.calls[0].label);
    expect(tpl.canvas.objects).toHaveLength(1);
    await c.close();
  });

  it("names boxes by the input type, so an Icon stays Icon", async () => {
    const c = await connect();
    const { json } = await c.call({ ...LABEL, objects: [...LABEL.objects, { type: "Icon", name: "lan", left: 200, top: 8, fontSize: 64 }] });
    expect(json.boxes.map((b: any) => b.type)).toEqual(["Textbox", "Icon"]);
    await c.close();
  });

  it("include_json adds the template as a resource block", async () => {
    const c = await connect();
    const { raw } = await c.call({ ...LABEL, title: "Server Rack #2", include_json: true });
    const res = raw.content[2];
    expect(res).toMatchObject({ type: "resource", resource: { uri: "niimblue://label/server-rack-2.json", mimeType: "application/json" } });
    expect(JSON.parse(res.resource.text)).toMatchObject({ title: "Server Rack #2", label: { printDirection: "left" }, canvas: { objects: [{ text: "LAN" }] } });
    await c.close();
  });

  it("rejects a bad printer or an extra key before rendering", async () => {
    const render = fakeRender();
    const c = await connect({ render });
    for (const args of [{ ...LABEL, printer: "NOPE" }, { ...LABEL, color: "red" }]) {
      const r: any = await c.client.callTool({ name: "render_label", arguments: args });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toBeUndefined();
    }
    expect(render.calls).toHaveLength(0);
    await c.close();
  });

  it("maps a thrown NbError to the error envelope, with no structuredContent", async () => {
    const c = await connect({ render: async () => { throw new NbError("CHROME_NOT_FOUND", "install Chrome"); } });
    const { raw, json } = await c.call(LABEL);
    expect(raw.isError).toBe(true);
    expect(raw.structuredContent).toBeUndefined();
    expect(json).toEqual({ ok: false, tool: "render_label", error: { code: "CHROME_NOT_FOUND", message: "install Chrome" } });
    await c.close();
  });

  it("keeps instructions under the 4096-char host limit", () => {
    expect(INSTRUCTIONS.length).toBeLessThan(4096);
  });
});

describe("templates", () => {
  const ROWS = [{ lan: "A" }, { lan: 'B, "q"\nx' }];
  const FIELD = { ...LABEL, objects: [{ ...LABEL.objects[0], text: "{lan}" }] };
  const setup = async () => {
    const dir = mkdtempSync(join(tmpdir(), "niimblue-tpl-"));
    const render = fakeRender();
    return { dir, render, ...(await connect({ render, cfg: testConfig({ templatesDir: dir }) })) };
  };

  it("save_as writes both files, refuses a second save, replaces with overwrite", async () => {
    const c = await setup();
    const { json } = await c.call({ ...FIELD, rows: ROWS, title: "Rack", save_as: "Rack 2", include_json: true });
    expect(json.saved).toEqual({ args_path: join(c.dir, "rack-2.args.json"), niimblue_path: join(c.dir, "rack-2.niimblue.json") });
    expect(JSON.parse(readFileSync(json.saved.args_path, "utf8"))).toEqual({ ...FIELD, rows: ROWS, title: "Rack" }); // no save_as/include_json
    const exp = JSON.parse(readFileSync(json.saved.niimblue_path, "utf8"));
    expect(exp.canvas.objects[0].text).toBe("{lan}");
    expect(exp.csv.data).toBe('lan\nA\n"B, ""q""\\nx"');
    const again = await c.call({ ...LABEL, save_as: "rack-2" });
    expect(again.raw.isError).toBe(true);
    expect(again.json.error).toMatchObject({ code: "BAD_INPUT", message: expect.stringContaining("overwrite: true") });
    expect(JSON.parse(readFileSync(json.saved.args_path, "utf8")).rows).toEqual(ROWS); // untouched
    expect((await c.call({ ...LABEL, save_as: "rack-2", overwrite: true })).raw.isError).toBeFalsy();
    expect(JSON.parse(readFileSync(json.saved.args_path, "utf8")).rows).toBeUndefined();
    await c.close();
  });

  it("keeps non-Latin names apart and refuses a name with no letter or digit", async () => {
    const c = await setup();
    for (const n of ["Мука", "Сахар"]) expect((await c.call({ ...LABEL, title: n, save_as: n })).json.saved.args_path).toBe(join(c.dir, `${n.toLowerCase()}.args.json`));
    expect((await c.tool("get_template", { name: "Сахар" })).json.args.title).toBe("Сахар");
    const missing = await c.tool("get_template", { name: "Соль" });
    expect(missing.json.error).toMatchObject({ code: "BAD_INPUT", message: expect.stringContaining("No template 'соль'") });
    for (const n of ["!!!", "../.."]) {
      const r = await c.call({ ...LABEL, save_as: n });
      expect(r.json.error).toMatchObject({ code: "BAD_INPUT", message: expect.stringContaining("no letter or digit") });
    }
    await c.close();
  });

  it("list_templates and template + rows: given args override, rows replace", async () => {
    const c = await setup();
    await c.call({ ...FIELD, rows: ROWS, title: "Rack", save_as: "rack" });
    const list = await c.tool("list_templates", {});
    expect(list.json).toMatchObject({ ok: true, dir: c.dir, templates: [{ name: "rack", title: "Rack", printer: "D110", width_mm: 40, height_mm: 12, fields: ["lan"], rows: 2 }] });
    const { json } = await c.call({ template: "rack", rows: [{ lan: "WAN" }], width_mm: 50 });
    expect(json.ok).toBe(true);
    expect(c.render.calls[1].label.size.width).toBe(400);
    expect(c.render.calls[1].variables).toEqual({ lan: "WAN" });
    const tpl = JSON.parse(gunzipSync(Buffer.from(json.link.split("#load=")[1], "base64")).toString());
    expect(tpl.canvas.objects[0].text).toBe("WAN"); // 1 row: filled, no csv
    expect(tpl.csv).toBeUndefined();
    expect((await c.tool("get_template", { name: "rack" })).json.args.rows).toEqual(ROWS);
    await c.close();
  });

  it("rows no {key} field uses stay out of the link and the saved files", async () => {
    const c = await setup();
    await c.call({ ...FIELD, rows: [...ROWS, { lan: "C" }], save_as: "three" });
    const load = (link: string) => JSON.parse(gunzipSync(Buffer.from(link.split("#load=")[1], "base64")).toString());
    const { json } = await c.call({ template: "three", objects: LABEL.objects, save_as: "plain" }); // inherits 3 rows, objects have no {key}
    expect(load(json.link).csv).toBeUndefined();
    expect(JSON.parse(readFileSync(json.saved.args_path, "utf8")).rows).toBeUndefined();
    expect(JSON.parse(readFileSync(json.saved.niimblue_path, "utf8")).csv).toBeUndefined();
    const given = await c.call({ ...LABEL, objects: [{ ...LABEL.objects[0], text: "{dt} only" }], rows: [{ x: "1" }, { x: "2" }] });
    expect(load(given.json.link).csv).toBeUndefined();
    await c.close();
  });

  it("get_template path converts a .niimblue.json back to the same args, and refuses an Image", async () => {
    const c = await setup();
    const { json } = await c.call({ ...FIELD, rows: ROWS, save_as: "rt" });
    const back = await c.tool("get_template", { path: json.saved.niimblue_path, printer: "D110" });
    expect(back.json).toMatchObject({ ok: true, notes: [] });
    expect(back.json.args).toEqual({ ...FIELD, rows: ROWS });
    const img = join(c.dir, "img.json");
    writeFileSync(img, JSON.stringify({ label: { size: { width: 320, height: 96 } }, canvas: { objects: [{ type: "Textbox", text: "x" }, { type: "Image", src: "data:," }] } }));
    const r = await c.tool("get_template", { path: img, printer: "D110" });
    expect(r.json.error).toMatchObject({ code: "BAD_INPUT", message: expect.stringContaining("objects 1 (Image)") });
    expect((await c.tool("get_template", { path: img })).json.error.message).toMatch(/path needs printer/);
    expect(existsSync(join(c.dir, "img.args.json"))).toBe(false);
    await c.close();
  });
});

describe("fonts", () => {
  const FONTS = new URL("../fonts/", import.meta.url), font = (f: string) => fileURLToPath(new URL(`${f}.woff2`, FONTS));
  const tb = (fontFamily: string, top = 8) => ({ type: "Textbox", text: "LAN", left: 8, top, width: 300, fontSize: 32, fontFamily });
  const setup = async (files: Record<string, string | number> = {}, render = fakeRender()) => {
    const dir = mkdtempSync(join(tmpdir(), "niimblue-fonts-"));
    for (const [name, src] of Object.entries(files)) typeof src === "number" ? (writeFileSync(join(dir, name), ""), truncateSync(join(dir, name), src)) : copyFileSync(src, join(dir, name));
    return { dir, render, ...(await connect({ render, cfg: testConfig({ fontsDir: dir, templatesDir: dir }) })) };
  };

  it("fonts/ holds exactly the BUILTIN files", () => {
    expect(readdirSync(FONTS).sort()).toEqual(BUILTIN.map((b) => `${b.family}.woff2`).sort());
  });

  it("list_fonts: built-ins with paths, folder files (a shadowing one, an .otf), skips with reasons", async () => {
    const c = await setup({ "Bitter Bold.woff2": font("JetBrains Mono Bold"), "Barlow Otf.otf": "test/fixtures/BarlowCondensed-Bold.otf", "Barlow Otf.ttf": font("Barlow Condensed Bold"),
      "readme.txt": font("Bitter Bold"), "1bad.woff2": font("Bitter Bold"), "Material Icons.ttf": font("Bitter Bold"), "Huge.ttf": 3 * 2 ** 20 });
    symlinkSync(font("Archivo Black"), join(c.dir, "Linked.woff2")); mkdirSync(join(c.dir, "Sub.ttf"));
    const { json } = await c.tool("list_fonts", {});
    expect(json).toMatchObject({ ok: true, tool: "list_fonts", default: "Noto Sans Variable" });
    expect(json.builtin).toEqual(BUILTIN.map((b) => ({ family: b.family, notes: b.notes, min_px: b.min_px, path: font(b.family) })));
    expect(json.folder.dir).toBe(c.dir);
    expect(json.folder.fonts).toEqual(expect.arrayContaining([
      { family: "Bitter Bold", path: join(c.dir, "Bitter Bold.woff2"), bytes: 21908, shadows_builtin: true },
      { family: "Barlow Otf", path: join(c.dir, "Barlow Otf.ttf"), bytes: 22444 }, // .ttf beats .otf
    ]));
    expect(json.folder.fonts).toHaveLength(2);
    expect(json.folder.skipped.map((s: any) => s.file).sort()).toEqual(["1bad.woff2", "Barlow Otf.otf", "Huge.ttf", "Linked.woff2", "Material Icons.ttf", "Sub.ttf", "readme.txt"]);
    expect(json.folder.skipped.find((s: any) => s.file === "Linked.woff2").reason).toMatch(/^a link or folder/);
    await c.close();
  });

  it("render_label: folder bytes to the page, FONT_NOT_IN_LINK once per family, FONT_MISSING with near names, Noto silent", async () => {
    const c = await setup({ "Fixture Face.otf": "test/fixtures/BarlowCondensed-Bold.otf" });
    const { json } = await c.call({ ...LABEL, objects: [tb("Noto Sans Variable"), tb("fixture face", 40), tb("Fixture Face", 60), tb("Bitter Bold", 70), tb("Bitter Bold"), tb("Bitter Slab")] });
    expect(json.warnings.map((w: any) => [w.code, w.object])).toEqual([["FONT_NOT_IN_LINK", 1], ["FONT_NOT_IN_LINK", 3], ["FONT_MISSING", 5]]);
    expect(json.warnings[0].message).toContain(`add ${join(c.dir, "Fixture Face.otf")} in NiimBlue → Fonts`);
    expect(json.warnings[0].message).toContain("renamed to .ttf first");
    expect(json.warnings[1].message).toContain(`add ${font("Bitter Bold")} in NiimBlue`);
    expect(json.warnings[1].message).toMatch(/name has a space.*NIIMBLUE_APP_URL/);
    expect(json.warnings[2].message).toMatch(new RegExp(`'Bitter Slab' is neither .* ${c.dir}.*use Bitter Bold,`));
    expect(c.render.calls[0].fonts).toEqual([{ family: "Fixture Face", b64: readFileSync("test/fixtures/BarlowCondensed-Bold.otf").toString("base64") }]);
    expect((await c.call(LABEL)).json.warnings).toEqual([]);
    expect(c.render.calls[1].fonts).toEqual([]);
    await c.close();
  });

  it("a family the page couldn't load gets only the page's FONT_MISSING, not FONT_NOT_IN_LINK", async () => {
    const c = await setup({ "Junk.ttf": font("Bitter Bold") }, fakeRender({ warnings: [{ code: "FONT_MISSING", object: 0, message: "not a valid font file" }] }));
    expect((await c.call({ ...LABEL, objects: [tb("Junk"), tb("Bitter Bold", 40)] })).json.warnings.map((w: any) => [w.code, w.object])).toEqual([["FONT_NOT_IN_LINK", 1], ["FONT_MISSING", 0]]);
    await c.close();
  });

  it("a folder font over 2 MB is BAD_INPUT before rendering", async () => {
    const c = await setup({ "Huge.ttf": 3 * 2 ** 20 });
    const { json } = await c.call({ ...LABEL, objects: [tb("Huge")] });
    expect(json.error).toMatchObject({ code: "BAD_INPUT", message: expect.stringContaining("over the 2 MB") });
    expect(c.render.calls).toHaveLength(0);
    await c.close();
  });

  it("get_template: a Bitter Bold export round-trips with no notes, its 400 default left out", async () => {
    const c = await setup();
    const args = { ...LABEL, objects: [tb("Bitter Bold"), { type: "Barcode", text: "A1", encoding: "CODE128B", left: 8, top: 40, height: 40, fontSize: 16, fontFamily: "Bitter Bold" }] };
    const { json } = await c.call({ ...args, save_as: "bitter" });
    const back = await c.tool("get_template", { path: json.saved.niimblue_path, printer: "D110" });
    expect(back.json).toMatchObject({ ok: true, notes: [] });
    expect(back.json.args).toEqual(args);
    const noto = join(c.dir, "noto.json"); // NiimBlue writes Noto's family and weight out: no key comes back
    writeFileSync(noto, JSON.stringify({ label: { size: { width: 320, height: 96 } }, canvas: { objects: [{ ...tb("Noto Sans Variable"), originX: "left", originY: "top", fontWeight: 600 }] } }));
    expect((await c.tool("get_template", { path: noto, printer: "D110" })).json.args.objects).toEqual([{ type: "Textbox", text: "LAN", left: 8, top: 8, width: 300, fontSize: 32 }]);
    await c.close();
  });
});

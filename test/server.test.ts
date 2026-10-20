import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createServer, INSTRUCTIONS, type Deps } from "../src/server.js";
import { NbError } from "../src/util/errors.js";
import { fakeRender, testConfig } from "./helpers.js";

const LABEL = { printer: "D110", width_mm: 40, height_mm: 12, objects: [{ type: "Textbox", text: "LAN", left: 8, top: 8, width: 300, fontSize: 48 }] };

// v2 in-process client: the handler's fetch takes a Request, the client transport calls fetch(url, init)
async function connect(deps: Deps = {}) {
  const handler = createMcpHandler(() => createServer({ cfg: testConfig(), render: fakeRender(), ...deps }));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { fetch: (u, i) => handler.fetch(new Request(u, i)) }));
  const call = async (args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name: "render_label", arguments: args });
    return { raw: r, json: JSON.parse(r.content.find((c: any) => c.type === "text").text) };
  };
  return { client, call, close: async () => { await client.close(); await handler.close(); } };
}

/** Every `properties` key anywhere in a JSON Schema. */
const propNames = (s: unknown): string[] => !s || typeof s !== "object" ? [] :
  Object.entries(s).flatMap(([k, v]) => k === "properties" && v && typeof v === "object" ? [...Object.keys(v), ...Object.values(v).flatMap(propNames)] : propNames(v));

describe("MCP server", () => {
  it("exposes exactly render_label, read-only, with portable schemas", async () => {
    const c = await connect();
    const tools = (await c.client.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(["render_label"]);
    expect(tools[0].annotations).toEqual({ title: "Render NiimBlue label", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const s = tools[0].inputSchema as any;
    expect(s.type).toBe("object");
    for (const k of ["anyOf", "oneOf", "allOf"]) expect(s[k]).toBeUndefined();
    const names = propNames(s);
    expect(names).toContain("objects");
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
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

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CHROME } from "./helpers.js";

const DIST = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

// the committed bundle alone, over stdio, as every host runs it; skipped until `npm run build` has written it
describe.skipIf(!existsSync(DIST))("dist/index.mjs", () => {
  const connect = async () => {
    const client = new Client({ name: "dist-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [DIST], env: { ...process.env, NIIMBLUE_LOG_LEVEL: "error" } as Record<string, string> }));
    return client;
  };

  it("lists the four tools", async () => {
    const client = await connect();
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["render_label", "list_templates", "list_fonts", "get_template"]);
    await client.close();
  });

  it.skipIf(!CHROME && !process.env.CI)("renders an image", async () => {
    const client = await connect();
    const r: any = await client.callTool({ name: "render_label", arguments: { printer: "D110", width_mm: 40, height_mm: 12, objects: [{ type: "Textbox", text: "LAN", left: 8, top: 8, width: 300, fontSize: 48 }] } });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    await client.close();
  });
});

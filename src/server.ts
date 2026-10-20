import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadConfig, type Config } from "./config.js";
import { Logger } from "./util/log.js";
import { NbError } from "./util/errors.js";
import { InputSchema, makeLink, makeTemplate, prepare } from "./label.js";
import { renderLabel } from "./chrome.js";

export const SERVER_NAME = "niimblue";
export const SERVER_VERSION = "1.0.0";
const TOOL = "render_label";

export const INSTRUCTIONS = `Designs labels for NIIMBOT thermal printers and hands them to NiimBlue (niim.blue) to print. render_label renders NiimBlue's own exact 1-bit print preview (PNG) and returns an open-in-NiimBlue link. This server never prints.

Workflow:
1. If the user has not given the printer model or label stock (mm), don't stop to ask: assume a common one (B1 on 50×30 mm stock, drawn 48×30; D11/D110 on 40×12 mm), render, and say what you assumed so they can correct it.
2. Call render_label.
3. Look at the PNG and read every warning: each one ends with its fix. Fix them all and render again.
4. On the final render set include_json (it adds the NiimBlue .json export).
5. Give the user the link and say: "Save any label open in NiimBlue, open the link, click OK, then Print."

Units: printer dots, 8 per mm at 203 dpi, 11.81 per mm at 300 dpi (label.dpmm). Origin top-left; objects paint in array order. width_mm/height_mm are the label as drawn in NiimBlue; the side across the printhead must fit label.printhead_px.

Floors at 203 dpi (multiply by dpmm/8 at 300 dpi):
- text ≥16 px; weight ≥500 under 24 px; inverse (white on black) text ≥20 px bold
- strokes ≥2 px; icons ≥32 px
- QR modules ≥3 px with 4 clear modules around the symbol
- Code 128 module (scaleFactor) ≥2 px with 10 clear modules each side
- keep text and codes ≥1 mm from the edges; let full bands bleed off the edge instead
Colours are black, white or transparent; greys and anti-aliasing threshold to 1-bit.

Fonts: only Noto Sans Variable (Latin and Cyrillic, weights 100–900) and Material Icons survive the link. Other characters fall back to a system font and print differently on the user's machine.

Look: one hero line, at most 3 sizes (icons count), inverse bands and weight for hierarchy rather than nested boxes.`;

const BOX = { left: z.number().int(), top: z.number().int(), width: z.number().int(), height: z.number().int() };
const OutputSchema = z.object({
  ok: z.literal(true),
  tool: z.literal(TOOL),
  label: z.object({ printer: z.string(), dpi: z.number(), dpmm: z.number(), print_direction: z.enum(["left", "top"]), printhead_px: z.number().int(), width_px: z.number().int(), height_px: z.number().int() }),
  zoom: z.number().int().describe("Each printer dot is zoom×zoom PNG pixels"),
  link: z.string().url().describe("Opens the label in NiimBlue (after a confirm that replaces the open label)"),
  link_chars: z.number().int(),
  boxes: z.array(z.object({ i: z.number().int().describe("Index into objects"), type: z.string(), ...BOX })).describe("Rendered bounding boxes in dots, after auto-size"),
  warnings: z.array(z.object({ code: z.string(), object: z.number().int().optional(), message: z.string() })).max(30),
});

export interface Deps { cfg?: Config; logger?: Logger; render?: typeof renderLabel }

/** Build the MCP server. Dependencies are injectable so tests can stub Chrome. */
export function createServer(deps: Deps = {}): McpServer {
  const cfg = deps.cfg ?? loadConfig();
  const log = deps.logger ?? new Logger(cfg.logLevel);
  const render = deps.render ?? renderLabel;
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS, maxToolInputElements: 5000 });

  const guard = async (tool: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    try {
      const r = await fn();
      log.info("tool ok", { tool });
      return r;
    } catch (e) {
      const error = e instanceof NbError ? { code: e.code, message: e.message } : { code: "INTERNAL", message: (e as Error)?.message ?? String(e) };
      log.error("tool failed", { tool, ...error });
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, tool, error }) }], isError: true };
    }
  };

  server.registerTool(
    TOOL,
    {
      title: "Render NiimBlue label",
      description:
        "Design a NIIMBOT label for NiimBlue and see exactly what the printhead burns. " +
        "Returns the 1-bit PNG NiimBlue prints (threshold 140; each dot drawn zoom×zoom px), each object's rendered box, warnings that end with their fix, and a niim.blue #load= link that opens the label in NiimBlue for printing. " +
        "Units are printer dots: 8 per mm at 203 dpi, 11.81 at 300 dpi; origin top-left; objects paint in array order and use NiimBlue/fabric property names. " +
        "Floors at 203 dpi (×dpmm/8 at 300 dpi): text ≥16 px; weight ≥500 under 24 px; strokes ≥2 px; QR modules ≥3 px with 4 clear modules; Code 128 scaleFactor ≥2 with 10 clear modules; text and codes ≥1 mm from the edges. " +
        "Colours: black, white, transparent. Only Noto Sans Variable (Latin, Cyrillic) + Material Icons survive the link. " +
        "Fix every warning and render again. Final call: include_json, for the .json export. " +
        "The link replaces the label open in NiimBlue after a confirm: tell the user to save it first.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { title: "Render NiimBlue label", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a, ctx) => guard(TOOL, async () => {
      const { label, input, warnings } = prepare(a);
      const r = await render(input, ctx.mcpReq.signal);
      const template = makeTemplate(input.label, r.canvas, a.title);
      const link = makeLink(cfg.appUrl, template);
      const out: z.infer<typeof OutputSchema> = { ok: true, tool: TOOL, label, zoom: r.zoom, link, link_chars: link.length,
        boxes: r.boxes.map((b) => ({ ...b, type: a.objects[b.i]?.type ?? b.type })), // the page reports an Icon as fabric's "Text"
        warnings: [...warnings, ...r.warnings].slice(0, 30) };
      const content: CallToolResult["content"] = [{ type: "image", data: r.png_b64, mimeType: "image/png" }, { type: "text", text: JSON.stringify(out) }];
      if (a.include_json) content.push({ type: "resource", resource: { uri: `niimblue://label/${slug(a.title)}.json`, mimeType: "application/json", text: JSON.stringify(template, null, 2) } });
      return { content, structuredContent: out };
    }),
  );

  return server;
}

const slug = (t?: string) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "label";

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadConfig, type Config } from "./config.js";
import { Logger } from "./util/log.js";
import { NbError } from "./util/errors.js";
import { InputSchema, MODELS, ToolSchema, fieldKeys, makeLink, makeTemplate, prepare } from "./label.js";
import { renderLabel } from "./chrome.js";
import { listFonts, resolveFonts } from "./fontdir.js";
import { importExport, listTemplates, loadTemplate, saveTemplate, slug } from "./templates.js";

export const SERVER_NAME = "niimblue";
export const SERVER_VERSION = "1.2.0";
const TOOL = "render_label";

export const INSTRUCTIONS = `Designs labels for NIIMBOT thermal printers and hands them to NiimBlue (niim.blue) to print. render_label renders NiimBlue's own exact 1-bit print preview (PNG) and returns an open-in-NiimBlue link. This server never prints.

Workflow:
1. If the user has not given the printer model or label stock (mm), don't stop to ask: assume a common one (B1 on 50×30 mm stock, drawn 48×30; D11/D110 on 40×12 mm), render, and say what you assumed so they can correct it.
2. Call render_label.
3. Look at the PNG and read every warning: each one ends with its fix. Fix them all and render again, except FONT_NOT_IN_LINK: pass that one to the user.
4. On the final render set include_json (it adds the NiimBlue .json export).
5. Give the user the link and say: "Save any label open in NiimBlue, open the link, click OK, then Print." With FONT_NOT_IN_LINK, tell them to add that font file in NiimBlue first.

Units: printer dots, 8 per mm at 203 dpi, 11.81 per mm at 300 dpi (label.dpmm). Origin top-left; objects paint in array order. width_mm/height_mm are the label as drawn in NiimBlue; the side across the printhead must fit label.printhead_px.

Floors at 203 dpi (multiply by dpmm/8 at 300 dpi):
- text ≥16 px, or the font's min_px from list_fonts; weight ≥500 under 24 px; inverse (white on black) text ≥20 px bold
- strokes ≥2 px; icons ≥32 px
- QR modules ≥3 px with 4 clear modules around the symbol
- Code 128 module (scaleFactor) ≥2 px with 10 clear modules each side
- keep text and codes ≥1 mm from the edges; let full bands bleed off the edge instead
Colours are black, white or transparent; greys and anti-aliasing threshold to 1-bit.

Fonts: fontFamily defaults to Noto Sans Variable (Latin and Cyrillic, weights 100–900), which every NiimBlue has. list_fonts shows the built-in fonts (one weight each: leave fontWeight unset) and the user's font folder; the link carries only the name, so the user adds each file in NiimBlue once. Never download or write font files into the font folder yourself: the user adds them. niim.blue currently drops an uploaded font whose name has a space (it prints in the fallback font); a fix has been submitted to NiimBlue, and until it is live the user sets NIIMBLUE_APP_URL to a NiimBlue build that has it. Characters a font lacks fall back to a system font and print differently on the user's machine.

Look: one hero line, at most 3 sizes (icons count), inverse bands and weight for hierarchy rather than nested boxes.

From a photo: pick stock by aspect ratio (4:1 → D101 100×24; B-series 48×12, or rotate), scale coordinates to dots, tints → inverse black, mono → JetBrains Mono Bold, condensed → Barlow Condensed Bold, heavy → Archivo Black or Archivo ExtraBold, slab → Bitter Bold, arrows → a filled Polyline.

Templates: put {key} fields in the text and pass rows (one object per label). render_label save_as stores the args; list_templates shows them; render_label {template, rows} reprints with new values. More than one row puts them in NiimBlue's CSV (replacing the user's open CSV): say so. get_template returns saved args, or converts a NiimBlue .json export (path + printer) to edit.`;

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
  saved: z.object({ args_path: z.string(), niimblue_path: z.string() }).optional().describe("save_as: the template files written"),
});
const ListOutput = z.object({
  ok: z.literal(true), tool: z.literal("list_templates"), dir: z.string(),
  templates: z.array(z.object({ name: z.string(), title: z.string().optional(), printer: z.string().optional(), width_mm: z.number().optional(), height_mm: z.number().optional(),
    fields: z.array(z.string()).optional().describe("{key} fields rows must fill"), rows: z.number().int().optional(), modified: z.string(), error: z.string().optional() })),
});
const FontsOutput = z.object({
  ok: z.literal(true), tool: z.literal("list_fonts"), default: z.string().describe("fontFamily when none is given"),
  builtin: z.array(z.object({ family: z.string(), notes: z.string(), min_px: z.number().describe("Smallest legible fontSize at 203 dpi (×dpmm/8 at 300)"),
    path: z.string().nullable().describe("The file the user adds in NiimBlue → Fonts; null: this copy has no fonts/ folder") })),
  folder: z.object({ dir: z.string().describe("NIIMBLUE_FONTS_DIR"),
    fonts: z.array(z.object({ family: z.string(), path: z.string(), bytes: z.number().int(), shadows_builtin: z.boolean().optional().describe("Used instead of the built-in of the same name") })),
    skipped: z.array(z.object({ file: z.string(), reason: z.string() })) }),
});
const GetInput = z.object({
  name: z.string().min(1).max(60).optional().describe("Saved template name (list_templates)"),
  path: z.string().min(1).max(1000).optional().describe("Or: a NiimBlue .json label export to convert (Saved labels → Export, or a saved .niimblue.json)"),
  printer: z.enum(MODELS).optional().describe("With path: the printer to convert for (dots per mm); the export doesn't name one"),
}).strict();
const GetOutput = z.object({
  ok: z.literal(true), tool: z.literal("get_template"),
  args: z.record(z.string(), z.unknown()).describe("render_label args: edit them and render"),
  notes: z.array(z.string()).describe("What the conversion dropped or changed"),
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

  const json = <T extends object>(out: T): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out as Record<string, unknown> });

  server.registerTool(
    TOOL,
    {
      title: "Render NiimBlue label",
      description:
        "Design a NIIMBOT label for NiimBlue and see exactly what the printhead burns. " +
        "Returns the 1-bit PNG NiimBlue prints (threshold 140; each dot drawn zoom×zoom px), each object's rendered box, warnings that end with their fix, and a niim.blue #load= link that opens the label in NiimBlue for printing. " +
        "Units are printer dots: 8 per mm at 203 dpi, 11.81 at 300 dpi; origin top-left; objects paint in array order and use NiimBlue/fabric property names. " +
        "Floors at 203 dpi (×dpmm/8 at 300 dpi): text ≥16 px, or the font's min_px from list_fonts; weight ≥500 under 24 px; strokes ≥2 px; QR modules ≥3 px with 4 clear modules; Code 128 scaleFactor ≥2 with 10 clear modules; text and codes ≥1 mm from the edges. " +
        "Colours: black, white, transparent. Fonts: Noto Sans Variable (Latin, Cyrillic) by default; any other fontFamily (list_fonts) travels by name only, so the user adds its file in NiimBlue (FONT_NOT_IN_LINK). " +
        "Fix every warning and render again. Final call: include_json, for the .json export. " +
        "The link replaces the label open in NiimBlue after a confirm: tell the user to save it first. " +
        "{key} fields fill from rows (preview: row 1; more than 1 row travels as NiimBlue's CSV, one label per row). " +
        "save_as writes the args and an importable .niimblue.json to the templates folder; template starts from saved args.",
      inputSchema: ToolSchema,
      outputSchema: OutputSchema,
      annotations: { title: "Render NiimBlue label", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ template: base, save_as, overwrite, ...given }, ctx) => guard(TOOL, async () => {
      const parsed = InputSchema.safeParse(base ? { ...(await loadTemplate(cfg.templatesDir, base)), ...given } : given);
      if (!parsed.success) throw new NbError("BAD_INPUT", `${parsed.error.issues.slice(0, 10).map((e) => `${e.path.join(".") || "args"}: ${e.message}`).join("\n")}\nFix these args${base ? ` (template '${base}' supplies the rest)` : ""}.`);
      const a = parsed.data;
      const { label, input, warnings } = prepare(a);
      const font = await resolveFonts(cfg.fontsDir, a.objects); // here, not in prepare: prepare stays pure
      const r = await render({ ...input, fonts: font.fonts }, ctx.mcpReq.signal);
      const rows = fieldKeys(a.objects).length ? a.rows : undefined; // rows no field uses would still replace the user's CSV and print N copies
      const template = makeTemplate(input.label, r.canvas, a.title, rows);
      const link = makeLink(cfg.appUrl, template);
      const { include_json, rows: _, ...keep } = a;
      const saved = save_as ? await saveTemplate(cfg.templatesDir, save_as, rows ? { ...keep, rows } : keep, makeTemplate(input.label, r.canvas, a.title, rows, true), overwrite) : undefined;
      const out: z.infer<typeof OutputSchema> = { ok: true, tool: TOOL, label, zoom: r.zoom, link, link_chars: link.length,
        boxes: r.boxes.map((b) => ({ ...b, type: a.objects[b.i]?.type ?? b.type })), // the page reports an Icon as fabric's "Text"
        warnings: [...warnings, ...font.warnings.filter((w) => !r.warnings.some((p) => p.code === "FONT_MISSING" && p.object === w.object)), ...r.warnings].slice(0, 30), ...(saved ? { saved } : {}) };
      const content: CallToolResult["content"] = [{ type: "image", data: r.png_b64, mimeType: "image/png" }, { type: "text", text: JSON.stringify(out) }];
      if (include_json) content.push({ type: "resource", resource: { uri: `niimblue://label/${slug(a.title) || "label"}.json`, mimeType: "application/json", text: JSON.stringify(template, null, 2) } });
      return { content, structuredContent: out };
    }),
  );

  server.registerTool(
    "list_templates",
    {
      title: "List saved label templates",
      description: "List the templates render_label save_as stored: name (pass it as render_label template or get_template name), title, printer, size in mm, the {key} fields rows must fill, row count, last modified.",
      inputSchema: z.object({}).strict(),
      outputSchema: ListOutput,
      annotations: { title: "List saved label templates", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => guard("list_templates", async () => json({ ok: true as const, tool: "list_templates" as const, dir: cfg.templatesDir, templates: await listTemplates(cfg.templatesDir) })),
  );

  server.registerTool(
    "list_fonts",
    {
      title: "List label fonts",
      description: "List the fontFamily values render_label can draw: the default (Noto Sans Variable), the built-in fonts with notes and the smallest legible size, and the font files in the user's font folder (NIIMBLUE_FONTS_DIR; .woff2, .ttf or .otf, family = the name before the first dot). " +
        "The link carries only the family name: the user adds each non-default font's file (path) in NiimBlue → Fonts once.",
      inputSchema: z.object({}).strict(),
      outputSchema: FontsOutput,
      annotations: { title: "List label fonts", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => guard("list_fonts", async () => json({ ok: true as const, tool: "list_fonts" as const, ...(await listFonts(cfg.fontsDir)) })),
  );

  server.registerTool(
    "get_template",
    {
      title: "Get label template args",
      description: "Return render_label args to edit: a saved template by name, or a NiimBlue .json label export (path + printer) converted to objects and rows. " +
        "Images, ArUco markers, paths and groups can't be converted (BAD_INPUT); notes lists what else was dropped.",
      inputSchema: GetInput,
      outputSchema: GetOutput,
      annotations: { title: "Get label template args", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, path, printer }) => guard("get_template", async () => {
      if (!name === !path) throw new NbError("BAD_INPUT", "Pass either name (a saved template) or path (a NiimBlue .json export), not both or neither.");
      if (path && !printer) throw new NbError("BAD_INPUT", "path needs printer: the export doesn't say which printer it is for; pass the model, e.g. D110 or B1.");
      const r = path ? await importExport(path, printer!) : { args: await loadTemplate(cfg.templatesDir, name!), notes: [] };
      return json({ ok: true as const, tool: "get_template" as const, args: r.args, notes: r.notes });
    }),
  );

  return server;
}

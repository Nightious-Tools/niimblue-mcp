# NiimBlue Labels MCP

[MCP](https://modelcontextprotocol.io) server that designs labels for NIIMBOT thermal printers (D11, D110, B1, B21 and others) and hands them to [NiimBlue](https://niim.blue) to print.

It renders each label with NiimBlue's own code in headless Chrome or Edge and returns the exact 1-bit image the printhead burns, plus warnings for anything that will print badly. It also returns a link that opens the label in NiimBlue. The server never prints and never talks to a printer: you open the link, check the label, and print from NiimBlue. It can also save a label as a fill-in template and reprint it with new values.

## Requirements

- Node.js 20+.
- Google Chrome, Chromium or Microsoft Edge. NiimBlue needs one of them to print over Bluetooth anyway. The server finds it in the usual install folders; set `NIIMBLUE_CHROME` if yours is elsewhere.

No API keys and no network access: the render runs offline from the bundled NiimBlue code and fonts, plus any font files you put in your font folder.

## Install

Claude Code (server plus the `niimblue` skill):

```
/plugin marketplace add Nightious-Tools/niimblue-mcp
/plugin install niimblue-mcp@niimblue-mcp
```

Codex:

```
codex plugin marketplace add Nightious-Tools/niimblue-mcp
```

Then run `/plugins`, install NiimBlue Labels, and start a new session.

Claude Desktop: download `niimblue-mcp.mcpb` from Releases and open it. It asks for an optional Chrome path, the NiimBlue URL, the templates folder and the font folder.

OpenCode: clone the repo and add this to your `opencode.json`. OpenCode reads the skill from `.claude/skills/`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "niimblue": {
      "type": "local",
      "command": ["node", "/path/to/niimblue-mcp/dist/index.mjs"]
    }
  }
}
```

Other MCP clients:

```json
{
  "mcpServers": {
    "niimblue": {
      "command": "npx",
      "args": ["-y", "github:Nightious-Tools/niimblue-mcp"]
    }
  }
}
```

On Windows, some clients need `"command": "cmd", "args": ["/c", "npx", "-y", "github:Nightious-Tools/niimblue-mcp"]`.

Server only:

```bash
claude mcp add niimblue -s user -- npx -y github:Nightious-Tools/niimblue-mcp
codex mcp add niimblue -- npx -y github:Nightious-Tools/niimblue-mcp
```

## Tools

| Tool | Purpose |
| --- | --- |
| `render_label` | Render a label and return the print preview and the NiimBlue link. Writes files only when `save_as` is set. |
| `list_templates` | List saved templates: name, title, printer, size in mm, the `{key}` fields rows must fill, row count, last modified. Read-only. |
| `list_fonts` | List the `fontFamily` values `render_label` can draw: the default, the built-in fonts with their files and the smallest legible size, and the files in your font folder with any it skipped. Read-only. |
| `get_template` | Return `render_label` args to edit: a saved template by `name`, or a NiimBlue `.json` export by `path` plus `printer`. Read-only. |

### render_label

| Param | Purpose |
| --- | --- |
| `printer` | Printer model, such as `D110`, `B1` or `D11_H`. Sets dpi, print direction and printable width. |
| `width_mm`, `height_mm` | Label size as set in NiimBlue, 4–300 mm. |
| `title` | Optional label name in NiimBlue's saved labels. |
| `split`, `split_parts`, `mirror` | Optional cable-flag layout: split into parts, then copy or flip the design into the other part. |
| `tail_pos`, `tail_length_mm` | Optional cable-flag tail. |
| `objects` | 1–100 objects in paint order: `Textbox`, `Icon` (Material Icons name), `Rect`, `Circle`, `Polyline`, `QRCode`, `Barcode` (`CODE128B` or `EAN13`). Positions and sizes are printer dots (8 per mm at 203 dpi, 11.81 at 300 dpi), origin top-left. Text may hold `{dt}` or `{dt|DD.MM.YYYY}`, which NiimBlue fills in at print time, and `{key}` fields that `rows` fills. A `Polyline` with `fill` fills the shape its points enclose (chevrons, arrows). |
| `fontFamily` | Optional on `Textbox` and `Barcode`: `Noto Sans Variable` (the default), a built-in font or a font folder family (see [Fonts](#fonts)). Letters, digits, `_` and `-` in words, single spaces, up to 60 characters. Noto defaults to `fontWeight` 600, any other family to 400. |
| `rows` | Optional values for the `{key}` fields, 1–500 objects of strings, one per label (`dt` is reserved). The preview shows row 1. With 1 row the link carries the filled text. With more, the link carries them as NiimBlue's CSV and NiimBlue prints one label per row; this replaces the CSV open in NiimBlue. NiimBlue's `$times` column is not supported. |
| `template` | Optional saved template name. Its args are the base; args given here override them, and `objects` or `rows` replace the template's wholesale. |
| `save_as`, `overwrite` | Save these args as a template: `<name>.args.json` and `<name>.niimblue.json` (importable in NiimBlue's Saved labels) in `NIIMBLUE_TEMPLATES_DIR`. An existing template is refused unless `overwrite` is `true`. The name keeps letters and digits in any script; a name with none is refused. |
| `include_json` | Also return the NiimBlue `.json` export. Set it on the final call. |

It returns the 1-bit PNG, then JSON with `label` (dpi, print direction, printhead width and size in dots), `zoom`, `link`, `link_chars`, `boxes` (each object's rendered bounding box), `warnings`, and `saved` (`args_path`, `niimblue_path`) after a `save_as`.

Opening the link replaces the label open in NiimBlue, after a confirm. Save it first.

Each warning has a `code`, the object index when it has one, and a `message` that ends with the fix:
`HEAD_OVERFLOW`, `OFF_LABEL`, `NEAR_EDGE`, `TEXT_SMALL`, `TEXT_THIN`, `STROKE_THIN`, `TEXT_WRAPPED`, `GLYPH_FALLBACK`, `FONT_MISSING`, `FONT_NOT_IN_LINK`, `UNFILLED_FIELD`, `QR_ERR`, `QR_MODULE_SMALL`, `QR_QUIET_ZONE`, `BARCODE_ERR`, `BARCODE_MODULE_SMALL`, `BARCODE_QUIET_ZONE`.

`TEXT_WRAPPED` means a Textbox wrapped where its text has no `\n`; widen it or break the line yourself. `UNFILLED_FIELD` means a `{key}` has no value in `rows`, so it prints literally. `FONT_MISSING` means a `fontFamily` is neither built in nor in your font folder, or its file isn't a valid font; the preview used a fallback. `FONT_NOT_IN_LINK` names the font file to add in NiimBlue before you open the link (see [Fonts](#fonts)).

### get_template

Pass `name` for a saved template's args, or `path` and `printer` to convert a NiimBlue `.json` export (Saved labels → Export, or a `.niimblue.json`, up to 2 MB). The conversion keeps Textbox, Material Icons text, Rect, Circle, Polyline, QRCode and Barcode, and turns the export's CSV into `rows`. An export with images, ArUco markers, paths or groups is refused with `BAD_INPUT`; `notes` lists anything else it dropped.

Errors return `ok: false` with `error.code`: `BAD_INPUT`, `CHROME_NOT_FOUND`, `RENDER_FAILED`, `RENDER_TIMEOUT` or `INTERNAL`.

The first time NiimBlue opens a link it may lay out text before its font has loaded. If the text in the app looks wrapped differently from the preview, reopen the link.

## Fonts

Every NiimBlue has Noto Sans Variable (Latin and Cyrillic) and Material Icons. The link carries only a font's name, so any other `fontFamily` needs its file added in NiimBlue once: open the Fonts menu (the gear by the font picker) and upload it. Characters a font lacks, such as `ł` or `→`, fall back to a system font and print differently on each machine (`GLYPH_FALLBACK`).

The server bundles five Latin-only fonts. Upload these files from `fonts/` once:

| `fontFamily` | Style | File |
| --- | --- | --- |
| `JetBrains Mono Bold` | Monospace, 700 | `fonts/JetBrains Mono Bold.woff2` |
| `Barlow Condensed Bold` | Condensed grotesk, 700 | `fonts/Barlow Condensed Bold.woff2` |
| `Archivo Black` | Heavy wide display, 400 | `fonts/Archivo Black.woff2` |
| `Archivo ExtraBold` | Heavy grotesk, 800 | `fonts/Archivo ExtraBold.woff2` |
| `Bitter Bold` | Slab serif, 700 | `fonts/Bitter Bold.woff2` |

Each file holds one weight, so leave `fontWeight` unset: any family but Noto defaults to 400, which draws the file as is, and a higher weight prints a faked bold.

niim.blue currently drops an uploaded font whose name has a space, so the label prints in the fallback font. That covers all five built-ins. A fix has been submitted to NiimBlue; until it is live, set `NIIMBLUE_APP_URL` to a NiimBlue build that has it.

For your own fonts, put `.woff2`, `.ttf` or `.otf` files (up to 2 MB) in the font folder (`NIIMBLUE_FONTS_DIR`). The family is the file name up to the first dot, as in NiimBlue's Fonts menu: `Inter Bold.ttf` is `Inter Bold`. A folder file overrides a built-in font of the same name. NiimBlue takes only `.ttf` and `.woff2`, so rename an `.otf` to `.ttf` before you upload it. `list_fonts` shows what the server found and why it skipped a file. Put only fonts you trust there: the preview's Chrome parses them without its sandbox.

## Environment variables

All optional. See `.env.example`.

| Variable | Default |
| --- | --- |
| `NIIMBLUE_CHROME` | Auto-detected. Linux: `google-chrome(-stable)`, `chromium(-browser)`, `microsoft-edge(-stable)` on `PATH`. macOS: Chrome, Chromium or Edge in `/Applications` or `~/Applications`. Windows: Chrome, then Edge, in Program Files, Program Files (x86) and LocalAppData. |
| `NIIMBLUE_APP_URL` | `https://niim.blue/`. Must be http(s); any `#hash` is dropped. |
| `NIIMBLUE_TEMPLATES_DIR` | `~/Documents/NiimBlue Templates`. Where `save_as` writes; created on first save. |
| `NIIMBLUE_FONTS_DIR` | `~/Documents/NiimBlue Fonts`. Your font files (see [Fonts](#fonts)); read only, never created. |
| `NIIMBLUE_LOG_LEVEL` | `info` (`silent`, `error`, `info`, `debug`; stderr) |

## Development

Needs Node.js 22.12+ and npm 11+ to develop (vitest 5 and the lockfile's `overrides` need them); the shipped bundle runs on Node 20.

```bash
git clone https://github.com/Nightious-Tools/niimblue-mcp && cd niimblue-mcp
npx -y npm@11 ci
npm test         # render tests need Chrome or Edge
npm run build    # writes dist/index.mjs, which is committed
npm run inspect  # MCP Inspector
npm run pack     # build, then niimblue-mcp.mcpb
```

## License

Source-available, not open source. You may install and run it; you may not redistribute or modify it. See [LICENSE](LICENSE). The bundle includes NiimBlue (MIT), fabric, Noto Sans, JetBrains Mono, Barlow Condensed, Archivo, Archivo Black, Bitter (OFL-1.1), Material Icons (Apache-2.0) and other third-party code under their own licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Not affiliated with NIIMBOT or NiimBlue.

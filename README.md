# NiimBlue Labels MCP

[MCP](https://modelcontextprotocol.io) server that designs labels for NIIMBOT thermal printers (D11, D110, B1, B21 and others) and hands them to [NiimBlue](https://niim.blue) to print.

It renders each label with NiimBlue's own code in headless Chrome or Edge and returns the exact 1-bit image the printhead burns, plus warnings for anything that will print badly. It also returns a link that opens the label in NiimBlue. The server never prints and never talks to a printer: you open the link, check the label, and print from NiimBlue.

## Requirements

- Node.js 20+.
- Google Chrome, Chromium or Microsoft Edge. NiimBlue needs one of them to print over Bluetooth anyway. The server finds it in the usual install folders; set `NIIMBLUE_CHROME` if yours is elsewhere.

No API keys and no network access: the render runs offline from the bundled NiimBlue code and fonts.

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

Claude Desktop: download `niimblue-mcp.mcpb` from Releases and open it. It asks for an optional Chrome path and the NiimBlue URL.

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

## Tool

`render_label` is the only tool. It is read-only.

| Param | Purpose |
| --- | --- |
| `printer` | Printer model, such as `D110`, `B1` or `D11_H`. Sets dpi, print direction and printable width. |
| `width_mm`, `height_mm` | Label size as set in NiimBlue, 4–300 mm. |
| `title` | Optional label name in NiimBlue's saved labels. |
| `split`, `split_parts`, `mirror` | Optional cable-flag layout: split into parts, then copy or flip the design into the other part. |
| `tail_pos`, `tail_length_mm` | Optional cable-flag tail. |
| `objects` | 1–100 objects in paint order: `Textbox`, `Icon` (Material Icons name), `Rect`, `Circle`, `Polyline`, `QRCode`, `Barcode` (`CODE128B` or `EAN13`). Positions and sizes are printer dots (8 per mm at 203 dpi, 11.81 at 300 dpi), origin top-left. Text may hold `{dt}` or `{dt|DD.MM.YYYY}`, which NiimBlue fills in at print time. |
| `include_json` | Also return the NiimBlue `.json` export. Set it on the final call. |

It returns the 1-bit PNG, then JSON with `label` (dpi, print direction, printhead width and size in dots), `zoom`, `link`, `link_chars`, `boxes` (each object's rendered bounding box) and `warnings`.

Opening the link replaces the label open in NiimBlue, after a confirm. Save it first.

Each warning has a `code`, the object index when it has one, and a `message` that ends with the fix:
`HEAD_OVERFLOW`, `OFF_LABEL`, `NEAR_EDGE`, `TEXT_SMALL`, `TEXT_THIN`, `STROKE_THIN`, `GLYPH_FALLBACK`, `UNFILLED_FIELD`, `QR_ERR`, `QR_MODULE_SMALL`, `QR_QUIET_ZONE`, `BARCODE_ERR`, `BARCODE_MODULE_SMALL`, `BARCODE_QUIET_ZONE`.

Errors return `ok: false` with `error.code`: `BAD_INPUT`, `CHROME_NOT_FOUND`, `RENDER_FAILED`, `RENDER_TIMEOUT` or `INTERNAL`.

Only Noto Sans Variable (Latin and Cyrillic) and Material Icons travel with the link. Other characters, such as `ł` or `→`, fall back to a system font and print differently on each machine (`GLYPH_FALLBACK`).

The first time NiimBlue opens a link it may lay out text before its font has loaded. If the text in the app looks wrapped differently from the preview, reopen the link.

## Environment variables

All optional. See `.env.example`.

| Variable | Default |
| --- | --- |
| `NIIMBLUE_CHROME` | Auto-detected. Linux: `google-chrome(-stable)`, `chromium(-browser)`, `microsoft-edge(-stable)` on `PATH`. macOS: Chrome, Chromium or Edge in `/Applications` or `~/Applications`. Windows: Chrome, then Edge, in Program Files, Program Files (x86) and LocalAppData. |
| `NIIMBLUE_APP_URL` | `https://niim.blue/`. Must be http(s); any `#hash` is dropped. |
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

Source-available, not open source. You may install and run it; you may not redistribute or modify it. See [LICENSE](LICENSE). The bundle includes NiimBlue (MIT), fabric, Noto Sans (OFL-1.1), Material Icons (Apache-2.0) and other third-party code under their own licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Not affiliated with NIIMBOT or NiimBlue.

What this change does: The change adds a new MCP server with one read-only tool, `render_label`. The tool turns a label description into NiimBlue's own 1-bit print preview, rendered in headless Chrome, and returns warnings, boxes and an open-in-NiimBlue link. Round 3 rechecks the whole repo.

Checked: `CI=true npm test` (61 passed), `npm run typecheck` (clean), and a rebuild that is byte-identical to `dist/index.mjs`, so the bundle is fresh. I also ran `tools/list` over stdio against `dist/index.mjs` (schema 14.8 kB, description 954 chars, instructions 1644 chars, root `type: object`) and probed edge cases with real Chrome: a 300×300 mm label at 300 dpi (1.4 s), a rotated Polyline, a barcode quiet-zone sweep (EAN13 and CODE128B, scaleFactor 2–3, fontSize 12–22, odd and even `left`: no false warnings), and QR codes with module sizes 3, 4 and 5. I compared the host files, CI and CLAUDE.md with zendesk-knowledge-mcp and MCPS/CLAUDE.md. Assumed load: one person and one agent, a few renders a minute.

Status of round-2 items (not repeated as findings): the Polyline axis fix and the `fontAutoSize` wording are done. `.agents/.gitignore` (`*`) is still there, so `.agents/plugins/marketplace.json` is still ignored. The Icon branch still has no `small(i, o.fontSize)`.

**Must fix:**

1. **A lone QR code with an odd module size gets a false QR_QUIET_ZONE** (`src/page/render.ts:92`)
   - **What this is:** The page scans for black pixels within 4 modules of the QR symbol. `x1`/`y1` are where the right and bottom strips start.
   - **Problem:** NiimBlue draws `m·n` px of modules but shifts them by only `qw/2`, where `qw = m·n` rounded down to even (`qrcode.ts:109-117`). `n` is always odd, so when the module size `m` is odd (3, 5…) the last module column and row sit at `ceil(c + qw/2 - 0.5)`, which is inside the scanned strip. Probe on an empty B1 label with `{type:"QRCode", text:"A", left:100, top:60}`: width 63 (m=3) and width 105 (m=5) both give `QR_QUIET_ZONE`, and width 84 (m=4) gives none. Measured ink runs to x=163 and x=205, and the strip starts at 163 and 205. Moving the code or clearing space cannot fix it. The `QR_MODULE_SMALL` advice ("widen it to ≥ 3n + (3n mod 2)", which gives 64 for V1) leads straight to m=3 and this false warning. m=3 is also the floor the tool states.
   - **Fix:** Measure the far edge from the drawn start: `const x1 = Math.ceil(c.x - qw / 2 - 0.5 + m * n), y1 = Math.ceil(c.y - qw / 2 - 0.5 + m * n);`. Measured, that gives 164 and 206, one past the ink. Add one clean twin to the render test: `render([{ type: "QRCode", left: 100, top: 60, width: 63, text: "A" }])` gives `warnings: []`. All current QR tests use m=4, so none catch this.
   - **If we skip it:** Any QR at 3 or 5 px modules never comes back clean. The agent loops on a warning it cannot fix, and eval 03 ("no warning whose code starts with QR_") fails whenever it picks m=3.

**Nice to have:**

2. **A NiimBlue URL without a scheme stops the server with a bare "Invalid URL"** (`src/config.ts:14`)
   - **What this is:** `loadConfig` turns `NIIMBLUE_APP_URL` into a URL and rejects non-http(s) with a message that names the variable.
   - **Problem:** `new URL("niim.blue")` throws before that check runs. Probe: `NIIMBLUE_APP_URL=niim.blue node dist/index.mjs` exits 1 with `fatal: TypeError: Invalid URL` and a stack, and it never names the setting. `ftp://x` gets the clear message. Claude Desktop's `app_url` field makes a scheme-less entry likely.
   - **Fix:** Check before parsing: `const raw = env.NIIMBLUE_APP_URL || "https://niim.blue/"; const u = URL.canParse(raw) ? new URL(raw) : undefined; if (u?.protocol !== "http:" && u?.protocol !== "https:") throw new Error(...)`. `URL.canParse` exists in Node 20. Add one line to `test/config.test.ts`: `niim.blue` throws `/http/`.
   - **If we skip it:** A Desktop user who types the bare domain gets a server that will not start, and a log that does not say which setting is wrong.

Verdict: fix 1 first.
Not checked: Windows Edge, macOS and app-vs-render pixel parity (F1 to F5). Upstream: a draft for NiimBlue's `key in variables` prototype bug (`{toString}` prints function source) was added to issues.md as #6, and nothing was posted.

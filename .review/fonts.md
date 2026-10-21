# Review: fonts (v1.2.0), working tree against d4b95a4

What this change does: `render_label` gets an optional `fontFamily` on Textbox and Barcode. The page can now draw five bundled fonts and fonts from a user folder (`NIIMBLUE_FONTS_DIR`). A new read-only `list_fonts` tool shows them. Because the `#load=` link carries only the font's name, a new warning, FONT_NOT_IN_LINK, tells the user which file to add in NiimBlue's Fonts menu.

Load assumed: one person, one stdio server, one render at a time, with a fresh Chrome for each render (`chrome.ts`).

## Must fix

1. **The docs promise that built-in fonts print on niim.blue, but none of them do yet** (`README.md:113-127`, `src/fontdir.ts:36`, `src/server.ts:22,34,110,157`, `src/label.ts:24`, `skills/niimblue/SKILL.md:21,92,190,199`)
   - **What this is:** For any font other than Noto, the server tells the user: "before opening the link, add `<file>` in NiimBlue → Fonts". After that, the label is supposed to print in the font shown in the preview.
   - **Problem:** At the pinned sha, `FileUtils.loadFonts` (`node_modules/niimblue/src/utils/file_utils.ts:452-459`) removes every user font whose family name has a space. Chrome returns such a name in quotes (`"Bitter Bold"`), so the `===` check against `Bitter Bold` fails. All five built-ins have a space in their name, and so does the README's own example, `Inter Bold.ttf`. Browser check V3 shows it: 0 of 5 families stay in `document.fonts`, and the app's Barlow render is identical to its fallback render (0 dots differ). So a user who follows the instructions prints in a fallback font, while our preview shows Bitter. Nothing warns them.
   - **Fix:** Do not release v1.2.0 until the NiimBlue fix is live on niim.blue. If it must ship sooner, add one sentence to the README Fonts section and to the FONT_NOT_IN_LINK message: fonts whose name has a space don't stay loaded in NiimBlue until <upstream PR> is live. The other option is no-space built-in names (`JetBrainsMono-Bold` and so on). That reverses the user's "With weight" naming decision, so it needs their call and browser check B1 below first.
   - **If we skip it:** Every built-in-font label prints in the wrong font on the live site. The user finds out only from the printed label.

## Should fix

2. **The font folder is where an agent would save a downloaded font, and Chrome runs without its sandbox** (`src/chrome.ts:12-14`, `CLAUDE.md` Rules, `README.md:127`)
   - **What this is:** The `--no-sandbox` rule rests on one claim: font bytes come only from the bundle and from a folder "the user controls", and never from tool input or the network.
   - **Problem:** The hosts this ships to (Claude Code, Codex, OpenCode) give the same agent tools to write files and fetch URLs. Say a user asks "use the font from this site". The agent can download that `.ttf` into `~/Documents/NiimBlue Fonts`, and the next render parses network bytes in an unsandboxed Chrome. Only Chrome's OTS font check stands in the way. INSTRUCTIONS, SKILL.md and the README say nothing against this.
   - **Fix:** Add one sentence to the INSTRUCTIONS Fonts paragraph and the SKILL.md Pitfalls font line: "Never download or write font files into the font folder yourself: the user adds them." Add one to the README Fonts section: "Put only fonts you trust there: the preview's Chrome parses them without its sandbox."
   - **If we skip it:** The trust boundary in CLAUDE.md is true only while no agent writes to that folder, and nothing tells agents not to.

3. **`npx` installs ship without `fonts/`** (`package.json:12`)
   - **What this is:** `"files": ["dist"]` controls what `npx -y github:Nightious-Tools/niimblue-mcp` installs. The README gives that command for Claude Code (`README.md:65`), Codex (`:66`) and other clients.
   - **Problem:** With no `fonts/` folder, `builtinPath` returns null. So `list_fonts` reports `path: null` for every built-in, and FONT_NOT_IN_LINK points the user to the GitHub repo instead of a file on their disk. The README Fonts section ("Upload these files from `fonts/`") then refers to a folder those users don't have.
   - **Fix:** `"files": ["dist", "fonts"]`. That adds 96 KB to the install.
   - **If we skip it:** `npx` users have to find and download each font by hand before they can print.

4. **`BUILTIN.file` and `BUILTIN.bytes` are values kept by hand that nothing needs** (`src/fonts.ts:10-14`, `src/fontdir.ts:72`, `src/server.ts:62`, `test/server.test.ts` "fonts/ holds exactly…", `CLAUDE.md` "a built-in font" row)
   - **What this is:** Each built-in records its fontsource file id and its size in bytes.
   - **Problem:** No code reads `file`. The pinned URL lives in THIRD_PARTY_NOTICES.md. `bytes` only feeds a `bytes` field in `list_fonts` for built-ins. No caller needs that value: the 2 MB limit applies to folder files only. Both are extra items to update for every new font, and a test exists only to keep `bytes` in sync with the file.
   - **Fix:** Delete `file` and `bytes` from `BUILTIN`. Drop `bytes` from the `builtin` entries in `listFonts` and `FontsOutput`. Keep the test's name check and drop its size line. Drop both words from the CLAUDE.md Lockstep row.
   - **If we skip it:** Ten values to keep in sync by hand, which no one reads.

5. **`FABRIC.fontFamily` is now dead** (`src/templates.ts:82`)
   - **What this is:** `FABRIC` lists the default values that are left out quietly when a key has no `render_label` param.
   - **Problem:** `fontFamily` is now a param of Textbox and Barcode, and Icon skips it (`SKIP_BY_TYPE`). No other type that gets converted has the key, so `FABRIC.fontFamily` can never match.
   - **Fix:** Delete `fontFamily: "Noto Sans Variable"` from `FABRIC`.
   - **If we skip it:** A reader assumes it still guards something.

## Nice to have

6. **A broken folder file gets two warnings that disagree** (`src/server.ts:133`; the test at `test/render.test.ts` "an .otf loads…" asserts both)
   - **What this is:** Put a file `Junk.ttf` that is not a real font in the folder.
   - **Problem:** Node warns FONT_NOT_IN_LINK ("add …/Junk.ttf in NiimBlue"), and the page then warns FONT_MISSING ("not a valid font file"). INSTRUCTIONS step 3 says to pass FONT_NOT_IN_LINK to the user, so the user can be told to upload a file that isn't a font.
   - **Fix:** In `server.ts`, drop the font warnings whose object also has a page-side FONT_MISSING: `font.warnings.filter((w) => !r.warnings.some((p) => p.code === "FONT_MISSING" && p.object === w.object))`. Change the test to expect `["FONT_MISSING"]`.
   - **If we skip it:** The message is confusing. It goes away once the agent switches fonts.

7. **Linked font files disappear without a reason** (`src/fontdir.ts:22`)
   - **What this is:** `scan` keeps only entries where `isFile()` is true. A symbolic link (a shortcut to a file elsewhere) is not a "file" here.
   - **Problem:** If a user links their font collection into the folder, each link is dropped before the loop. It shows in neither `fonts` nor `skipped`, so `list_fonts` gives no hint and every render says FONT_MISSING.
   - **Fix:** List the non-files under `skipped` with the reason "a link or folder, not a file; copy the font in". That keeps the listing-only boundary.
   - **If we skip it:** The user has to work out why by trial and error.

Verdict: fix 1 first.
Lean: -3 lines and 10 hand-kept values possible (4, 5).
Not checked: anything in a browser. The live niim.blue build, and Chrome's quoting of a no-space name (B1), are for `ol-browser:browser-verifier`. V5's unexplained 4,695-dot app-vs-MCP gap for a font that did load is still open.

## Checked and fine

- Trust boundary in code: tool input never builds a path. `family` is only a lookup key (`fontdir.ts:43`). Paths are `join(dir, listed name)` (`:30`) or a `BUILTIN` family (`:14`). Bytes reach the page only from the bundle or `resolveFonts`.
- `FAMILY_RX` (`fonts.ts:18`) rejects `' " , ; / ( )` and backslashes. Fabric quotes Textbox families. NiimBlue's Barcode `bold ${fontSize}px ${fontFamily}` (`barcode.ts:140`) parses as one unquoted family. Generic words such as `serif` or `monospace` pass the regex but get FONT_MISSING, so the user is warned.
- Parity: `new FontFace(family, bytes)` with no descriptors (`render.ts:49`) matches `file_utils.ts:440`.
- Non-Noto default weight 400: `label.ts` (`noto ? 600 : 400`) and `templates.ts:451-452` agree. A Bitter export round-trips with `notes: []` (server test).
- Per-font GLYPH_FALLBACK: the page skips families it couldn't load. The false-positive limit has its `shortcut:` comment. The skill test runs recipe 10 through Chrome.
- Warning cap and dedupe: prepare, then font, then page warnings, `.slice(0, 30)`. FONT_NOT_IN_LINK and both FONT_MISSING kinds come once per family.
- Lockstep: the six version files and `package-lock.json:3,9` are at 1.2.0. `manifest.json` has `user_config.fonts_dir` and `mcp_config.env`. `.env.example`, the README env row, tools table, param row, warnings and Fonts section are all in. THIRD_PARTY_NOTICES.md has 5 rows, pinned URLs, sha256 values equal to round 1's table, and the OFL texts. SKILL.md has the photo mapping, the min-size bullet and recipe 10. The `skill.test` count is 10. CLAUDE.md says 4 tools.
- `dist/index.mjs` is byte-identical to a fresh build with `build.mjs`'s options (2,640,441 bytes; scratch build in `.work/change-reviewer/fonts/`).

## Browser checks for ol-browser:browser-verifier (only if finding 1 takes the rename route)

- B1: in Chrome, `new FontFace(n, "url(x)").family` for `JetBrainsMono-Bold`, `BarlowCondensed-Bold`, `ArchivoBlack`, `Archivo-ExtraBold` and `Bitter-Bold`: each returns `n` unquoted.
- B2: on https://niim.blue/, upload one renamed built-in through Fonts. After opening a link that uses it, `document.fonts` holds 1 FontFace of that family with status `loaded`.

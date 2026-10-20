What this change does: The change adds a new MCP server with one read-only tool, `render_label`. The tool turns a label description into NiimBlue's own 1-bit print preview, rendered in headless Chrome, and returns warnings, boxes and an open-in-NiimBlue link. The repo also holds the six host files, a skill, evals, CI and a committed `dist/index.mjs`.

Checked: `CI=true npm test` (58 passed, 0 skipped), `npm run typecheck` (clean), a scratch rebuild that is byte-identical to `dist/index.mjs`, clean stdout over stdio, one render under Node 20.20.2 and Node 22, `mcpb validate manifest.json` (passes), and THIRD_PARTY_NOTICES against the bundle's metafile inputs (complete). Assumed load: one person and one agent, a few renders a minute.

**Should fix:**

1. **The jar eval grader gives a date syntax that NiimBlue does not support** (`evals/01-jar/graders/criteria.md:9`)
   - **What this is:** The LLM grader checks that the label has a `{dt…}` date field, and gives `{dt:DD.MM.YYYY}` as its example.
   - **Problem:** NiimBlue's field regex (`canvas_preprocess.ts:7`, copied as `FIELD_RX` in `src/label.ts:110`) only accepts `|` before the format. `{dt:DD.MM.YYYY}` does not match, so it prints literally. `prepare()` also gives no `UNFILLED_FIELD` warning for it (checked: `[]`). So a run that prints a broken date can still pass the grader.
   - **Fix:** Change the example to `{dt|DD.MM.YYYY}`, which is what SKILL.md line 153 teaches.
   - **If we skip it:** The jar eval can score a broken label as a pass.

2. **Barcode text at the default 12 px gets no warning** (`src/label.ts:167`)
   - **What this is:** `TEXT_SMALL` warns when text is under 16 px at 203 dpi. The tool description, the instructions and SKILL.md line 58 all give this as the floor, including "`printText` with `fontSize` ≥16".
   - **Problem:** Only the Textbox branch checks it (`:143`). A Barcode prints its text by default (`barcode.ts:12` `printText: true`, `:14` `fontSize: 12`). So `{type:"Barcode", text:"AB-100", encoding:"CODE128B", height:80}` prints 12 px text under the bars and returns `warnings: []` (checked). Eval 05 then passes it as clean.
   - **Fix:** Add one line in the Barcode branch: `if ((o.printText ?? true) && (o.fontSize ?? 12) < 16 * k)`, then push `TEXT_SMALL` with the same message. Add one line to the `STROKE_THIN and BARCODE_MODULE_SMALL` test.
   - **If we skip it:** Agents ship barcode labels whose readable line is below the floor, and the warning loop never tells them.

3. **The "Chrome exits before replying" path has no test** (`src/chrome.ts:59`)
   - **What this is:** If Chrome starts and then dies, for example when a container is missing a library, this branch turns the exit into `RENDER_FAILED` with the end of stderr.
   - **Problem:** It is the error users see most when Chrome is broken, and no test covers it. It works now: `runInChrome("/bin/false", …)` gives `RENDER_FAILED "Chrome exited (1) before replying"`.
   - **Fix:** Add one ungated test next to the missing-binary test: `await expect(runInChrome("/bin/false", "", 0, { timeoutMs: 5000 })).rejects.toMatchObject({ code: "RENDER_FAILED" })`.
   - **If we skip it:** A refactor of the `failed`/`closed` wiring could make this case hang until the 30 s timeout, and no test would catch it.

4. **The app URL check has no test** (`src/config.ts:14-15`)
   - **What this is:** `loadConfig` only accepts http(s) for `NIIMBLUE_APP_URL` and removes any `#hash`, so `#load=` lands in the right place.
   - **Problem:** No test covers it. If the hash is left in, every link becomes `…#x#load=…`, and NiimBlue does not load that.
   - **Fix:** Add one test: `loadConfig({NIIMBLUE_APP_URL:"https://x.test/app#a"}).appUrl === "https://x.test/app"`, and `javascript:alert(1)` throws.
   - **If we skip it:** A regression breaks every link in silence, because the server tests inject `cfg`.

**Nice to have:**

5. **An unreachable printer check** (`src/label.ts:122`)
   - **What this is:** `if (!meta) throw BAD_INPUT "Unknown printer"`.
   - **Problem:** `printer` is `z.enum(MODELS)`, and the test "every model resolves" proves every enum value has metadata. Both callers parse the input first, so this line never runs.
   - **Fix:** Delete it and use `getPrinterMetaByModel(...)!`.
   - **If we skip it:** One dead line remains.

6. **A second copy of `CHROME` in chrome.test** (`test/chrome.test.ts:7`)
   - **What this is:** The Chrome-gating constant.
   - **Problem:** `test/helpers.ts:5` already exports it, and every other test imports that one.
   - **Fix:** `import { CHROME } from "./helpers.js"` and delete line 7.
   - **If we skip it:** Two gates that must change together.

7. **The `$` alias is defined twice** (`vitest.config.ts:8`, `build.mjs:6`)
   - **What this is:** The alias from `$/` to `node_modules/niimblue/src`.
   - **Problem:** The same expression is in both files, and it must change in both places.
   - **Fix:** `export const alias` in build.mjs (vitest.config.ts already imports from it), then use `resolve: { alias }`.
   - **If we skip it:** A path change could make the tests and the bundle resolve different NiimBlue sources.

Verdict: fix 1 and 2 first.
Lean: -3 lines possible.
Not checked: F1 to F5 (Windows Edge, macOS, app-vs-render pixel parity), which are unit H's.

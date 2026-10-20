What this change does: The change adds a new MCP server with one read-only tool, `render_label`. The tool turns a label description into NiimBlue's own 1-bit print preview, rendered in headless Chrome, and returns warnings, boxes and an open-in-NiimBlue link. This round checks the round-1 fixes and the whole repo again.

Checked: `CI=true npm test` (60 passed), `npm run typecheck` (clean), a scratch rebuild that is byte-identical to `dist/index.mjs` (fresh), stdout over stdio (JSON only; the process exits when stdin closes), and probes of edge cases against `dist/index.mjs` over stdio with real Chrome. All seven round-1 findings are fixed in the tree. Assumed load: one person and one agent, a few renders a minute.

**Must fix:**

1. **The Codex marketplace file can never be committed** (`.agents/.gitignore:1`)
   - **What this is:** `.agents/plugins/marketplace.json` is the Codex host file. MCPS/CLAUDE.md and design.md line 297 require it, and the zendesk house repo tracks it.
   - **Problem:** `.agents/.gitignore` holds `*`. It was written at 16:04, at the same moment as the scratch ignores in `.review/` and `.work/`. `git check-ignore -v .agents/plugins/marketplace.json` answers `.agents/.gitignore:1:*`, and `git ls-files --others --exclude-standard` does not list the file. So the first commit ships without it, and `codex plugin marketplace add Nightious-Tools/niimblue-mcp` (README line 26) finds no marketplace.
   - **Fix:** Delete `.agents/.gitignore`. Or stage the file with `git add -f .agents/plugins/marketplace.json`: once a file is tracked, ignore rules no longer apply to it.
   - **If we skip it:** The Codex install path in the README does not work, and nothing in CI catches it.

**Should fix:**

2. **A Polyline with only `left` or only `top` lands in the wrong place** (`src/page/render.ts:33`)
   - **What this is:** For a Polyline, omitting `left`/`top` means "the points are absolute". The page deletes NiimBlue's default `left: 10, top: 10` so fabric places the line from its points.
   - **Problem:** The page deletes both keys only when `left` is missing. With `{left: 20, points: [(20,100),(200,100)]}`, `top` stays at the default 10, and the line jumps from y=100 to y=10 (probe: box `top: 10`). With `{top: 150, points: …}`, the given `top` is silently dropped (probe: box `top: 99`). No warning fires in either case. fabric handles each key on its own (`Polyline.ts:126-127`).
   - **Fix:** Delete each key on its own: `for (const k of ["left", "top"]) if (o[k] === undefined) delete m[k];`. Add one assert to the Polyline render test: left only gives box top 99.
   - **If we skip it:** An agent that sets one coordinate gets a rule in the wrong place, and no warning tells it.

3. **An icon below the stated floor gets no warning** (`src/label.ts:150-157`)
   - **What this is:** INSTRUCTIONS (`src/server.ts:26`) and SKILL.md line 64 say icons must be ≥32 px. The workflow tells the agent to fix every warning.
   - **Problem:** The Icon branch runs no size check. `{type:"Icon", name:"lan", fontSize:12}` renders a 13×15 px glyph with `warnings: []` (probe). Even `TEXT_SMALL`, whose design trigger is just `fontSize < 16k`, skips icons.
   - **Fix:** Add `small(i, o.fontSize);` as the first line of the Icon branch, which reuses `TEXT_SMALL`. Add one line to the `TEXT_SMALL` test.
   - **If we skip it:** Tiny icons pass as clean and print as blobs.

**Nice to have:**

4. **`fontAutoSize` claims a shrink that never happens for long words** (`src/label.ts:34`)
   - **What this is:** The schema says "Shrink the font until the text fits width".
   - **Problem:** NiimBlue shrinks only in `canvasPreprocess` (`canvas_preprocess.ts:59-60`), with `maxWidth = obj.width`. By then fabric has already widened the box to the longest word. `"SUPERCALIFRAGILISTIC"`, width 100, fontSize 32 gives the same 363 px box with and without `fontAutoSize` (probe). The app does the same, so the render is right but the description is wrong.
   - **Fix:** Reword the describe: "Shrinks the font at print time only when a {dt…} field adds lines; a long word widens the box instead".
   - **If we skip it:** Agents set `fontAutoSize` to fix overflow, get `OFF_LABEL` again, and waste a round.

Verdict: fix 1 first, then 2 and 3.
Not checked: Windows Edge, macOS and app-vs-render pixel parity (F1 to F5). `maxToolInputElements: 5000` can reject inputs the schema allows (more than about 25 Polylines of 64 points), but design.md line 146 requires it, so it is not a finding.

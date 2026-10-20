# Review: templates (niimblue-mcp 1.1.0), base 0531b53

What this change does: `render_label` gains `rows` (fill-in `{key}` fields), `template`, `save_as` and `overwrite`. `save_as` writes `<slug>.args.json` and `<slug>.niimblue.json` to `NIIMBLUE_TEMPLATES_DIR`. Two new read-only tools: `list_templates` and `get_template`, which returns saved args or converts a NiimBlue `.json` export. The render page gains `TEXT_WRAPPED` and a per-side `BARCODE_QUIET_ZONE`. The work stopped partway (see impl.md "Left"), so tests and docs are missing.

Load assumed: one person, one stdio server process (README/CLAUDE.md).

Checked live against the committed `dist/index.mjs` (rebuilt: byte-identical, so dist is not stale), with a scratch templates dir (`.work/change-reviewer/templates/live/`):
- `save_as` writes both files. The second save under the same slug is refused with `BAD_INPUT`. `list_templates` shows the fields `batch`, `exp` and `code`.
- With 1 row, the link has filled text and no `csv`. With 3 rows, the link keeps the placeholders and carries `csv`. This matches decisions.md.
- CSV quoting: `A,"q"` and a real newline survive as `"A,""q"""` and `line1\nline2`. That is what PrintPreview's `replaceAll("\\n", "\n")` expects.
- Round trip: render, then `get_template {path: .niimblue.json}`, then render again gives a pixel-equal PNG, with `notes: []`. The rows come back too.
- `npm run typecheck` is green. `npm test`: 2 failed, 59 passed.

## Must fix

1. **Non-Latin template names all become the same file, `label`** (`src/templates.ts:13`; used by `saveTemplate`:19 and `loadTemplate`:30)
   - **What this is:** `slug()` turns a template name into a file name. It keeps only `a-z0-9` and falls back to `"label"`.
   - **Problem:** "Мука", "Сахар" and "Соль" all slug to `label`. Seen live: `save_as: "Мука"` wrote `label.args.json`. Then `save_as: "Сахар"` was refused with "Template 'label' already exists". An agent that retries with `overwrite: true` deletes "Мука". `get_template {name: "Соль"}`, a name that was never saved, returned the "Мука" args with no error. The bundled font covers Cyrillic, so these names are realistic.
   - **Fix:** Keep Unicode letters and digits in the slug: `.replace(/[^\p{L}\p{N}]+/gu, "-")`. This still cannot escape the folder: there are no `/`, `\` or `.` characters. Also stop falling back to `"label"` for template names: if the slug is empty, throw `BAD_INPUT`. The `include_json` URI can keep its `"label"` fallback.
   - **If we skip it:** One template silently overwrites or stands in for another.

2. **The preview shows `{key}` where the print shows an empty field** (`src/label.ts:204`)
   - **What this is:** The page fills fields from `rows[0]`. With more than one row, NiimBlue fills them from the CSV.
   - **Problem:** `csvFormat` writes every column for every row, so a key that row 1 lacks becomes `""` in NiimBlue. The preview gets `rows[0]` as given, so it prints the key literally. `UNFILLED_FIELD` stays quiet because the key exists in some other row. Seen live: with `rows: [{a:"1"},{a:"2",b:"x"}]` and text `{a} {b}`, the PNG shows "1 {b}" with zero warnings, while NiimBlue prints "1 ".
   - **Fix:** `variables: Object.fromEntries([...keys].map((k) => [k, rows[0][k] ?? ""]))` in place of `rows[0]`. One line.
   - **If we skip it:** The "exact print preview" is wrong for any row set with uneven keys.

3. **Two tests fail, and none of the plan's new tests exist** (`test/server.test.ts:31-32`, `test/dist.test.ts:18-20`)
   - **What this is:** `npm test` shows 2 failed: "exposes exactly render_label…" (it expects 1 tool and `readOnlyHint: true`) and "lists the one tool".
   - **Problem:** CI goes red. The new risky code has no test that fails when it breaks: the overwrite gate and file writes, `fromExport` parsing, `toCsv` escaping, `UNFILLED_FIELD` with rows, `TEXT_WRAPPED`, the default `templatesDir`, and the `skill.test` recipe count.
   - **Fix:** Update both expectations to the 3 tools and `readOnlyHint: false`. Then add the tests plan.md §Tests lists, in a temp `NIIMBLUE_TEMPLATES_DIR`. Add one test per item 1 and item 2 above.
   - **If we skip it:** CI fails. A future edit can drop the overwrite gate without any test noticing.

4. **Version lockstep incomplete: `manifest.json` is still 1.0.0** (`manifest.json:5`)
   - **What this is:** CLAUDE.md requires the version in six files, and CI checks all six.
   - **Problem:** Five files say 1.1.0. `manifest.json` still says 1.0.0.
   - **Fix:** Set `"version": "1.1.0"` by hand. Do not regex-bump: the file also has `manifest_version`.
   - **If we skip it:** CI fails, and the `.mcpb` ships the wrong version.

5. **Lockstep for the new tools, params, warning code and env var is missing** (README.md, skills/niimblue/SKILL.md, .env.example, manifest.json, CLAUDE.md, docs/decisions/)
   - **What this is:** The CLAUDE.md lockstep rows "a tool or param", "a warning or error code" and "an env var", plus the plan's Docs section.
   - **Problem:** None of these files changed:
     - README still says "`render_label` is the only tool. It is read-only." (README.md:71). It has no `rows`/`template`/`save_as`/`overwrite`, no Polyline `fill`, no `TEXT_WRAPPED`, no `NIIMBLUE_TEMPLATES_DIR` row, and no note that `$times` is unsupported.
     - SKILL.md has no "Recreate from a photo", no Templates flow, no product-label recipe, and no `chevron_right`/`arrow_forward_ios`. Its pitfall still says other `{name}` fields print literally.
     - `.env.example` has no `NIIMBLUE_TEMPLATES_DIR`. `manifest.json` has no `user_config.templates_dir` and no `mcp_config.env` entry for it.
     - CLAUDE.md still says "one read-only tool" and "never write files" (Rules). The `{dt…}`-only pitfall, "expect 1 tool" and the env lockstep row are unchanged.
     - ADR `docs/decisions/0002-template-store.md` (status candidate) does not exist.
   - **Fix:** Write them as plan.md §Docs lists. Build the product recipe from final-args.json, so `test/skill.test.ts` parses it.
   - **If we skip it:** Agents never learn the template flow. Claude Desktop users cannot set the folder. The repo's own rules contradict the code.

## Should fix

6. **Rows inherited from a template still replace the user's CSV when no field uses them** (`src/server.ts:111`)
   - **What this is:** `{template, objects}` replaces the objects but keeps the template's `rows`.
   - **Problem:** Take `{template: "hgt-vial", objects: [a plain Textbox]}`. It inherits 3 rows. The link then carries the CSV, which overwrites the user's saved CSV in NiimBlue and prints 3 identical labels. There is no warning. The same happens for any `rows` with no `{key}` in the objects.
   - **Fix:** In `prepare`, when `rows` is given but `fieldKeys(args.objects)` is empty, warn that the rows are unused and should be dropped, or have the link ignore them. A new warning code needs the README line.
   - **If we skip it:** The user's CSV in NiimBlue is lost for no reason, and they get N copies.

## Nice to have

7. **Read `$times` from the parse you already did** (`src/templates.ts:136`)
   - **What this is:** The CSV header is split by hand on `,` to find `$times`.
   - **Problem:** It is a second, naive parse of the header. It is wrong if a quoted header contains a comma.
   - **Fix:** Keep the `csvParse` result and test `parsed.columns.includes("$times")`.
   - **If we skip it:** A rare false note. Nothing else.

Verdict: fix 1, 2, 3, 4 and 5 first.
Lean: -1 lines possible.
Not checked: NiimBlue itself opening the 1-row and 3-row links and showing 3 pages in print preview (manual step 4 in the plan); a real app Export with moved or static-text objects (only our own `.niimblue.json` was round-tripped).

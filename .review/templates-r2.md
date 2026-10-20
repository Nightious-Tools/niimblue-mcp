# Review round 2: templates (niimblue-mcp 1.1.0), base 0531b53

What this change does: `render_label` gains `rows` (values for `{key}` fields), `template`, `save_as` and `overwrite`. `save_as` writes `<slug>.args.json` and `<slug>.niimblue.json` to `NIIMBLUE_TEMPLATES_DIR`. Two new read-only tools, `list_templates` and `get_template`, read saved args or convert a NiimBlue `.json` export. The page gains `TEXT_WRAPPED` and a quiet-zone check per side. Docs, ADR 0002, version 1.1.0 and tests are now in.

Load assumed: one person, one stdio server process.

Round-1 items, checked in the tree:
- 1 (non-Latin slugs collide): **fixed.** `src/templates.ts:13` keeps `\p{L}\p{M}\p{N}`. `stem()` at :15 throws `BAD_INPUT` when the slug is empty. The `include_json` URI keeps `|| "label"` (`src/server.ts`). Live: `Мука` wrote `мука.args.json`. The test covers `Мука`/`Сахар`/`Соль` and `!!!`/`../..`.
- 2 (preview showed `{key}` where the print is empty): **fixed.** `src/label.ts:334` fills every key from `rows[0][k] ?? ""`. A test covers it.
- 3 (red tests, no new tests): **fixed.** `npm test`: 74 passed, 0 failed. `npm run typecheck`: green. New tests cover the overwrite gate, the file writes, Unicode names, list/template/rows, the path round trip, Image → `BAD_INPUT`, CSV escaping, `UNFILLED_FIELD`, `TEXT_WRAPPED`, the default dir and 9 recipes.
- 4 (manifest 1.0.0): **fixed.** All six files say 1.1.0.
- 5 (docs lockstep): **fixed.** README, SKILL.md (photo, templates, product recipe, two icons, pitfall), `.env.example`, `manifest.json` `user_config.templates_dir` + `mcp_config.env`, CLAUDE.md (summary, Rules, env row, "expect 3 tools", pitfall) and `docs/decisions/0002-template-store.md` (status candidate).
- 6 (inherited rows used by no field): **still open**, see 1 below.
- 7 (hand-split `$times` header): **still open**, see 2 below.

Also checked: `npm run build` gives a byte-identical `dist/index.mjs`, so dist is fresh. Live against the bundle with a scratch templates dir: the SKILL.md product recipe renders with zero warnings and `save_as` writes both files. 3 rows: the link has `{batch}`/`{exp}`/`{code}` plus a 3-line CSV. `list_templates` shows the fields `batch,exp,code`. `save_as: "мука"` after `"Мука"` is refused (the ADR names this). The d3-dsv notice is in THIRD_PARTY_NOTICES.md. `destructiveHint: false` is what plan.md asks for.

## Should fix

1. **Rows that no field uses still replace the user's CSV in NiimBlue** (`src/server.ts:116`)
   - **What this is:** `render_label` passes `a.rows` to `makeTemplate`. With more than 1 row, the link then carries them as NiimBlue's CSV.
   - **Problem:** Seen live: `{template: "hgt3", objects: [a plain "PLAIN" Textbox]}` takes the template's 3 rows. The link carries `batch,exp,code\nA1,…` with zero warnings. The same happens with `rows: [{x:"1"},{x:"2"}]` on a label with no `{x}`. Opening the link replaces the user's open CSV, and NiimBlue prints 3 identical labels.
   - **Fix:** Send rows to the link only when a field uses them: `makeTemplate(input.label, r.canvas, a.title, fieldKeys(a.objects).length ? a.rows : undefined)`. One line. `fieldKeys` is already exported from `label.ts`.
   - **If we skip it:** The user's CSV is lost for no reason, and they get N copies of a static label.

## Nice to have

2. **Read `$times` from the parse you already did** (`src/templates.ts:138`)
   - **What this is:** The code splits the CSV header by hand on `,` to find `$times`.
   - **Problem:** This is a second, naive parse. A quoted header that holds a comma gives a wrong note.
   - **Fix:** Keep the `csvParse(t.csv.data)` result and test `.columns.includes("$times")`. The type already declares `columns` (`src/globals.d.ts`).
   - **If we skip it:** A rare false note. Nothing else.

Verdict: Ship.
Not checked: NiimBlue itself opening the 1-row and 3-row links and showing 3 pages (manual step 4); a real app Export with static Text or moved objects; the save path on Windows.

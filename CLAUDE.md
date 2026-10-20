# niimblue-mcp

MCP stdio server with one read-only tool, `render_label`. `src/label.ts` turns the input into NiimBlue
label props and objects (pure, no Chrome). `src/chrome.ts` runs the bundled page (`src/page/render.ts`,
NiimBlue's own fabric code at the pinned sha) in headless Chrome or Edge over `--remote-debugging-pipe`
and gets back the threshold-140 PNG, NiimBlue's canvas JSON, boxes and page warnings. `src/server.ts`
builds the `#load=` link (gzip, standard base64) and registers the tool.

## Rules

- Never print, never talk to a printer, never write files (except Chrome's temp profile,
  removed after each render). The hand-off is the link.
- Logs to stderr only; stdout is the MCP transport.
- The page loads nothing external. That is the only reason the always-on `--no-sandbox` is acceptable:
  revisit it before allowing images or URLs.
- Object fields keep NiimBlue/fabric names (`fontSize`, `originX`) because they are the file format;
  top-level params are snake_case.
- Each warning message ends with its fix. At most 30 per call.

## dist/ is what runs

Installs run the committed `dist/index.mjs`, no `npm install`, so every dependency is a devDependency.
`build.mjs` has two stages: the browser page bundle (fonts inlined as binary) becomes `__PAGE_JS__`
inside the Node bundle. After any `src/` edit, `npm run build` and commit `dist/` with it; CI fails on a
stale bundle. Keep the `createRequire` banner and its third-party notice line.

## Plugin hosts

Claude Code: `.claude-plugin/`. Codex: `.agents/plugins/marketplace.json`, `.codex-plugin/plugin.json`,
`.mcp.json`. OpenCode: `opencode.json` (skill from `.claude/skills/`). Claude Desktop: `manifest.json`
plus the `.mcpb` on Releases; `.mcpbignore` keeps only `dist/`, `manifest.json`, README, LICENSE and
THIRD_PARTY_NOTICES.md. All: `skills/niimblue/SKILL.md`.

Codex doesn't expand `${CLAUDE_PLUGIN_ROOT}`, so `.mcp.json` uses a relative path + `"cwd": "."`.
Claude Code also loads `.mcp.json`; the inline server in `.claude-plugin/plugin.json` has the same name
(`niimblue`) so it overrides it.

## Cloud sessions

On claude.ai/code repo-declared plugins don't install: the server loads from `.mcp.json` and the skill
from `.claude/skills/niimblue`, a symlink to `skills/niimblue` (edit the original). The server connects
in the background and can miss the first prompt: if its tools aren't listed, `ToolSearch` for
`niimblue` (it waits for a connecting server) before saying they're unavailable. Cloud containers often
have no Chrome: then every render returns `CHROME_NOT_FOUND`, which is expected, not a bug.

## Lockstep

| Change | Also update |
|---|---|
| version | `package.json`, `SERVER_VERSION` in `src/server.ts`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`plugins[0]`), `.codex-plugin/plugin.json`, `manifest.json`. CI checks all six. Never regex-bump: `manifest.json` also has `manifest_version`. |
| a tool or param | `src/label.ts` (schema), `src/server.ts` (description, `INSTRUCTIONS`), `README.md`, `skills/niimblue/SKILL.md` and its recipes (`test/skill.test.ts` parses them) |
| a warning or error code | where it is raised, `README.md`, SKILL.md if it changes advice |
| plugin name `niimblue-mcp` | `package.json`, both `marketplace.json`, both `plugin.json`, `manifest.json`, README |
| server name `niimblue` | `SERVER_NAME`, `.mcp.json`, `.claude-plugin/plugin.json`, `opencode.json`, README snippets, the eval `--allow-tools` pattern |
| an env var | `src/config.ts`, `.env.example`, README table, `manifest.json` `user_config` + `mcp_config.env` (`NIIMBLUE_CHROME`, `NIIMBLUE_APP_URL` only) |
| NiimBlue sha bump | the `niimblue` git sha in `package.json`, plus the six exact pins (`fabric`, `qrcode-generator`, `dayjs`, `@fontsource-variable/noto-sans`, `material-icons`, `@mmote/niimbluelib`) copied from upstream's `package-lock.json` at that sha; `npx -y npm@11 install`; `npm test`; `npm run build`; regenerate THIRD_PARTY_NOTICES.md; rerun the app-vs-render parity check (F1) |
| Code128B guard | delete the `$`/`)` `BAD_INPUT` guard in `src/label.ts` (and its test, README, SKILL.md) once upstream fixes `src/utils/barcode.ts:88,93` |
| a bundled package | THIRD_PARTY_NOTICES.md (full license text) |

## Releasing

Bump version first (six files). The README points Claude Desktop users at the `.mcpb` on Releases, so an
unreleased version is a broken install path.

```
npm run typecheck && npm test && npm run pack
git commit -am vX.Y.Z && git push
gh release create vX.Y.Z niimblue-mcp.mcpb --title vX.Y.Z --notes "..."
```

Run `npm run pack` right before attaching; a `.mcpb` left in the working directory may be stale. As
GitHub user `nightious` (`gh auth switch -u nightious`).

## Verification

`npm test` is offline. Render tests need Chrome or Edge: locally they skip without one, under `CI=true`
they fail instead. Bundle: copy `dist/index.mjs` alone to an empty dir, pipe `initialize` + `tools/list`
into `node index.mjs`; expect 1 tool. Live: `npm run inspect`, call `render_label` with
`{"printer":"D110","width_mm":40,"height_mm":12,"objects":[{"type":"Textbox","text":"Hello","left":8,"top":8,"width":296,"fontSize":48}]}`,
then open the link and compare NiimBlue's print preview with the PNG.

Skill: `claude plugin eval . --mocks off --allow-real-servers --allow-tools "mcp__plugin_niimblue-mcp_niimblue__*" --runs 3 --threshold 0.8`.

## Pitfalls

- Use npm 11 (`npx -y npm@11 install`) to change the lockfile. System npm 9 fails on the
  `overrides` entry (`Invalid comparator: npm:uninstall`), and npm 10 ignores it on a fresh install and
  pulls native `canvas`. npm 10 `npm ci` against the committed lock is fine (CI uses it). npm 9's
  `npx` fails the same way anywhere inside the repo, so `npm run pack` needs npm ≥10 too.
- Development needs Node 22.12+ (vitest 5); the bundle targets Node 20.
- `$/…` imports are NiimBlue's own `src/` (`node_modules/niimblue/src`), aliased in `build.mjs` (which
  `vitest.config.ts` imports). `tsconfig.json` uses `moduleResolution: bundler` because NiimBlue's `mdi_icons.ts`
  has an extensionless import that NodeNext rejects.
- Import niimbluelib from its root. The deep `dist/cjs/printer_models.js` import is a circular require
  that throws, so the bundle includes `@capacitor/*`.
- NiimBlue's `font.scss` ships only the Latin and Cyrillic subsets of Noto Sans and no italic. Anything
  else falls back per machine, which is why `GLYPH_FALLBACK` exists.
- `canvasPreprocess` leaves unknown `{name}` fields printed literally: only `{dt…}` works in a link.
- fabric 7 defaults origins to center; `label.ts` sets left/top explicitly.
- The app doesn't preload fonts before `#load`, so its first layout of a linked label can differ from
  ours. Not fixable here.
- `skills/niimblue/SKILL.md`: keep the description single-quoted. An unquoted `: ` breaks the YAML and
  the skill silently never loads.

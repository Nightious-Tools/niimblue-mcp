---
title: Load bundled and user font files into the unsandboxed preview
status: accepted
amends: 0001's "--no-sandbox is on only because the page loads nothing external"
---

## Context

Labels need more than Noto Sans: a monospace for codes, a condensed face for long words, and a
heavy or slab face for one-word labels. The user also wants their own fonts. NiimBlue draws any
font uploaded in its Fonts menu, and the `#load=` link carries only the font's name. 0001 accepted
`--no-sandbox` because the page loaded nothing external.

## Decision

- The page loads five OFL fonts from `fonts/` (JetBrains Mono Bold, Barlow Condensed Bold,
  Archivo Black, Archivo ExtraBold, Bitter Bold) and any `.woff2`, `.ttf` or `.otf` up to 2 MB
  from `NIIMBLUE_FONTS_DIR`, default `~/Documents/NiimBlue Fonts`. The server only reads that folder
  and never creates it.
- Tool input never builds a font path. `fontFamily` is a lookup key, checked against `FAMILY_RX`,
  and matched against the bundled list and the folder listing. Links and subfolders are listed as
  skipped, not followed.
- Chrome keeps `--no-sandbox`. Font bytes pass Chrome's OTS check before FreeType and HarfBuzz
  parse them.
- INSTRUCTIONS and the skill tell agents never to download or write font files into the folder.
  The README tells users to put only fonts they trust there.

## Rationale

A font file the user chose is as trusted as the rest of their machine, and OTS rejects malformed
tables before the parsers see them. Turning the sandbox back on would bring back the root,
container and AppArmor failures that 0001 avoided. Matching against a listing instead of joining a
path keeps tool input out of the file system.

## Consequences

- The trust boundary is now "bundle plus a folder the user controls". It holds only while no agent
  writes to that folder, and only instructions stop an agent from doing so.
- Font bytes from tool input or the network require dropping `--no-sandbox` first.
- Each non-Noto font needs one upload in NiimBlue. `FONT_NOT_IN_LINK` names the file.
- niim.blue drops an uploaded font whose name has a space, which covers all five built-ins, until
  the fix submitted upstream is live. CLAUDE.md lists the four places to edit once it is.
- `fonts/` adds 96 KB to the npm package and the `.mcpb`.

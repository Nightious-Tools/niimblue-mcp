/** Node side of the fonts: the NIIMBLUE_FONTS_DIR listing, the bytes the page loads, and the warnings that tell the user what to upload in NiimBlue. */
import { existsSync, type Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN, FAMILY_RX, NOTO } from "./fonts.js";
import { NbError } from "./util/errors.js";
import type { LabelArgs } from "./label.js";

const EXT = ["woff2", "ttf", "otf"]; // preference order when one family has several files
const MAX = 2 * 1024 * 1024; // NiimBlue keeps uploads in localStorage (gzip + base64), with no quota handling
const RESERVED = [NOTO, "Material Icons"].map((f) => f.toLowerCase());
const BUNDLED = fileURLToPath(new URL("../fonts/", import.meta.url)); // fonts/ beside dist/ or src/; absent when dist/index.mjs is copied alone
const builtinPath = (family: string) => { const p = join(BUNDLED, `${family}.woff2`); return existsSync(p) ? p : null; }; // family from BUILTIN, never tool input

type Found = { family: string; file: string; path: string; bytes: number };

/** The folder's font files by lowercased family (the name up to the first dot, as NiimBlue's Fonts menu names an upload), and what was skipped. */
async function scan(dir: string): Promise<{ fonts: Map<string, Found>; skipped: { file: string; reason: string }[] }> {
  const fonts = new Map<string, Found>(), skipped: { file: string; reason: string }[] = [];
  const rank = (name: string) => EXT.indexOf(name.split(".").pop()!.toLowerCase());
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
  for (const e of ents) if (!e.isFile()) skipped.push({ file: e.name, reason: "a link or folder, not a file; copy the font in" }); // links stay unfollowed: only listed files are read
  for (const { name: file } of ents.filter((e) => e.isFile()).sort((a, b) => rank(a.name) - rank(b.name))) {
    const family = file.split(".")[0], key = family.toLowerCase();
    const reason = rank(file) < 0 ? "not a .woff2, .ttf or .otf file"
      : family.length > 60 || !FAMILY_RX.test(family) ? "the name before the first dot is not a usable family name (letters, digits, _ and -, single spaces, no digit first)"
      : RESERVED.includes(key) ? `${family} is reserved: NiimBlue already has it`
      : fonts.has(key) ? `${fonts.get(key)!.file} is used for ${family}` : "";
    if (reason) { skipped.push({ file, reason }); continue; }
    const path = join(dir, file); // the listed name, never the family string from tool input
    fonts.set(key, { family, file, path, bytes: (await stat(path)).size });
  }
  return { fonts, skipped };
}

// Remove SPACE_CAVEAT once niim.blue ships NiimBlue's fix (CLAUDE.md Lockstep)
const SPACE_CAVEAT = ". niim.blue currently drops an uploaded font whose name has a space, so the label prints in the fallback font. A fix has been submitted to NiimBlue; until it is live, set NIIMBLUE_APP_URL to a NiimBlue build that has it";
const upload = (family: string, path: string, otf = false) => `before opening the link, add ${path} in NiimBlue → Fonts (gear by the font picker)${otf ? ", renamed to .ttf first: the Fonts menu takes .ttf/.woff2" : ""}${family.includes(" ") ? SPACE_CAVEAT : ""}`;

/** Once per non-Noto family, at its first object: the folder file's bytes for the page, FONT_MISSING or FONT_NOT_IN_LINK. Reads the folder on each call. */
export async function resolveFonts(dir: string, objects: LabelArgs["objects"]): Promise<{ fonts: { family: string; b64: string }[]; warnings: RenderWarning[] }> {
  const first = new Map<string, [string, number]>();
  objects.forEach((o, i) => {
    const f = "fontFamily" in o ? o.fontFamily : undefined, k = f?.toLowerCase();
    if (f && k !== RESERVED[0] && !first.has(k!)) first.set(k!, [f, i]);
  });
  const fonts: { family: string; b64: string }[] = [], warnings: RenderWarning[] = [];
  if (!first.size) return { fonts, warnings };
  const found = (await scan(dir)).fonts;
  for (const [k, [family, i]] of first) {
    const f = found.get(k), b = BUILTIN.find((x) => x.family.toLowerCase() === k);
    if (f) {
      if (f.bytes > MAX) throw new NbError("BAD_INPUT", `objects[${i}]: ${f.path} is ${(f.bytes / 2 ** 20).toFixed(1)} MB, over the 2 MB NiimBlue can store; use a .woff2 or a subset of it, or a list_fonts family.`);
      fonts.push({ family: f.family, b64: (await readFile(f.path)).toString("base64") });
      warnings.push({ code: "FONT_NOT_IN_LINK", object: i, message: `The link names '${f.family}' but can't carry the font file; ${upload(f.family, f.path, f.file.toLowerCase().endsWith(".otf"))}.` });
    } else if (b) {
      const path = builtinPath(b.family) ?? `fonts/${b.family}.woff2 (from https://github.com/Nightious-Tools/niimblue-mcp)`;
      warnings.push({ code: "FONT_NOT_IN_LINK", object: i, message: `The link names '${b.family}' but can't carry the font file; ${upload(b.family, path)}.` });
    } else {
      const words = k.split(" "), known = [...BUILTIN.map((x) => x.family), ...[...found.values()].map((x) => x.family)];
      const near = known.map((n) => [n, n.toLowerCase().split(" ").filter((w) => words.includes(w)).length] as const).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n]) => n);
      warnings.push({ code: "FONT_MISSING", object: i, message: `'${family}' is neither a built-in font nor a file in ${dir}, so it prints in this machine's fallback font; use ${near.join(", ")} (list_fonts), or add ${family}.woff2 or .ttf to that folder.` });
    }
  }
  return { fonts, warnings };
}

/** list_fonts: the default, the built-ins and the folder. */
export async function listFonts(dir: string) {
  const { fonts, skipped } = await scan(dir), all = [...fonts.values()];
  const isBuiltin = (k: string) => BUILTIN.some((b) => b.family.toLowerCase() === k);
  return {
    default: NOTO,
    builtin: BUILTIN.map(({ family, notes, min_px }) => ({ family, notes, min_px, path: builtinPath(family) })),
    folder: {
      dir,
      fonts: all.filter((f) => f.bytes <= MAX).map(({ family, path, bytes }) => ({ family, path, bytes, ...(isBuiltin(family.toLowerCase()) ? { shadows_builtin: true } : {}) })),
      skipped: [...skipped, ...all.filter((f) => f.bytes > MAX).map((f) => ({ file: f.file, reason: "over 2 MB, more than NiimBlue can store" }))],
    },
  };
}

import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.js";
import { findChrome } from "../src/chrome.js";

/** Chrome/Edge on this machine, or undefined. Gate with `describe.skipIf(!CHROME && !process.env.CI)` so CI fails rather than skips. */
export const CHROME = (() => { try { return findChrome(process.env); } catch { return undefined; } })();

export function testConfig(over: Partial<Config> = {}): Config {
  return { ...loadConfig({}), logLevel: "silent", templatesDir: join(tmpdir(), "niimblue-test-templates-unused"), fontsDir: join(tmpdir(), "niimblue-test-fonts-unused"), ...over }; // never the real ~/Documents
}

/** 1×1 black PNG. */
export const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";

/** Stand-in for chrome.ts renderLabel: echoes the page input back as the canvas, one box per object. */
export function fakeRender(over: Partial<PageResult> = {}) {
  const calls: PageInput[] = [];
  const fn = async (input: PageInput): Promise<PageResult> => {
    calls.push(input);
    return {
      png_b64: PNG_1PX, zoom: 2, warnings: [],
      canvas: { version: "7.4.0", objects: input.objects },
      boxes: input.objects.map((o, i) => ({ i, type: (o as { type: string }).type, left: 0, top: 0, width: 10, height: 10 })),
      ...over,
    };
  };
  return Object.assign(fn, { calls });
}
